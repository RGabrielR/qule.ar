import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { eq, isNull } from "drizzle-orm";

test("la fecha del resumen conserva la actividad y nunca queda detrás de la vista previa", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "qule-summary-"));
  process.env.DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_URL;
  const { db, schema, runMigrations, closeDb } = await import("./db/index.js");
  t.after(async () => { await closeDb(); await rm(dir, { recursive: true, force: true }); });
  await runMigrations();
  const { auth } = await import("./auth.js");
  const { socialRoutes } = await import("./routes/social.js");
  const credentials = { email: "ana@example.test", password: "clave-para-pruebas" };
  const { user } = await auth.api.signUpEmail({ body: { ...credentials, name: "Ana" } });
  const login = await auth.api.signInEmail({ body: credentials, asResponse: true });
  const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  await db.insert(schema.user).values({ id: "sol", email: "sol@example.test", name: "Sol" });
  await db.insert(schema.profile).values([
    { userId: user.id, displayName: "Ana", birthdate: "1990-01-01" },
    { userId: "sol", displayName: "Sol", birthdate: "1990-01-01" },
  ]);
  const [userA, userB] = [user.id, "sol"].sort();
  const previewDate = new Date("2026-01-01T10:01:00Z");
  await db.insert(schema.conversation).values({ id: "chat", userA, userB, lastMessageAt: new Date("2026-01-01T10:00:00Z") });
  await db.insert(schema.directMessage).values({ id: "mensaje", conversationId: "chat", senderId: "sol", createdAt: previewDate });

  async function assertSummary(expectedActivity: Date) {
    const response = await socialRoutes.request("/conversations/chat/summary", { headers: { cookie } });
    assert.equal(response.status, 200);
    const summary = await response.json();
    assert.equal(summary.last.createdAt, previewDate.toISOString());
    assert.equal(summary.lastMessageAt, expectedActivity.toISOString());
  }

  await assertSummary(previewDate);
  const laterActivity = new Date("2026-01-01T10:02:00Z");
  await db.update(schema.conversation).set({ lastMessageAt: laterActivity }).where(eq(schema.conversation.id, "chat"));
  await assertSummary(laterActivity);

  await t.test("una lectura por límite incluye el historial largo y deja pendiente el siguiente mensaje", async () => {
    const messages = Array.from({ length: 130 }, (_, index) => ({
      id: `anterior-${String(index).padStart(3, "0")}`, conversationId: "chat", senderId: "sol", createdAt: previewDate,
    }));
    await db.insert(schema.directMessage).values(messages);
    async function read(body?: string) {
      const res = await socialRoutes.request("/conversations/chat/read", { method: "POST", headers: { cookie }, body });
      assert.equal(res.status, 200);
      return (await res.json()).changed;
    }
    const batch = JSON.stringify({ beforeId: messages[129].id, messageIds: [messages[129].id] });
    assert.equal(await read(batch), true);
    const unread = await db.select({ id: schema.directMessage.id }).from(schema.directMessage).where(isNull(schema.directMessage.readAt));
    assert.deepEqual(unread, [{ id: "mensaje" }]);
    assert.equal(await read(batch), false);
    assert.equal(await read(), true);
    assert.equal(await read(), false);
  });
});
