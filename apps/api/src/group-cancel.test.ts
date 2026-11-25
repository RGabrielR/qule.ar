import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

test("cancelar un mensaje de grupo al vencer su turno", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "qule-mensajes-"));
  process.env.DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_URL;
  const { db, schema, runMigrations, closeDb } = await import("./db/index.js");
  t.after(async () => { await closeDb(); await rm(dir, { recursive: true, force: true }); });
  await runMigrations();
  const { auth } = await import("./auth.js");
  const { groupRoutes } = await import("./routes/groups.js");
  const app = new Hono().route("/", groupRoutes);

  async function account(name: string) {
    const credentials = { email: name + "@example.com", password: "clave-para-pruebas" };
    const { user } = await auth.api.signUpEmail({ body: { ...credentials, name } });
    await db.insert(schema.profile).values({ userId: user.id, displayName: name, birthdate: "1990-01-01" });
    const login = await auth.api.signInEmail({ body: credentials, asResponse: true });
    const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    return { id: user.id, cookie };
  }

  const sender = await account("remitente");
  await db.insert(schema.group).values({ id: "grupo", name: "Grupo" });
  await db.insert(schema.groupMember).values({ groupId: "grupo", userId: sender.id, role: "member" });
  const group = "/groups/grupo/messages";
  const [original, queued, racing] = await db.insert(schema.groupMessage).values(
    ["published", "queued", "queued"].map((status, i) => ({
      id: String(i), userId: sender.id, groupId: "grupo", body: "Hola", status, scheduledAt: new Date(),
    })),
  ).returning();
  const cancel = (id: string) => app.request(`${group}/${id}?onlyQueued=1`, {
    method: "DELETE", headers: { cookie: sender.cookie },
  });
  const queuedId = queued.id;
  assert.equal((await cancel(queuedId)).status, 200);
  assert.equal((await cancel(queuedId)).status, 200);
  assert.equal((await cancel(original.id)).status, 409);
  const afterCancel = await db.select().from(schema.groupMessage);
  assert.equal(afterCancel.find((m) => m.id === queuedId)?.status, "cancelled");
  assert.equal(afterCancel.find((m) => m.id === original.id)?.body, "Hola");

  const [response, published] = await Promise.all([
    cancel(racing.id),
    db.update(schema.groupMessage).set({ status: "published" })
      .where(and(eq(schema.groupMessage.id, racing.id), eq(schema.groupMessage.status, "queued"))).returning(),
  ]);
  const [result] = await db.select().from(schema.groupMessage).where(eq(schema.groupMessage.id, racing.id));
  assert.equal(response.status, published.length ? 409 : 200);
  assert.equal(result.status, published.length ? "published" : "cancelled");
  assert.equal(result.body, published.length ? racing.body : "");
});
