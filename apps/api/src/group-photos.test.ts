import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hono } from "hono";
import sharp from "sharp";

test("las fotos del piloto son privadas, se ocultan con tres cuentas distintas y se pueden restaurar", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "qule-fotos-grupo-"));
  process.env.DATA_DIR = dir;
  process.env.GROUP_PHOTO_PILOT_IDS = "piloto,general";
  process.env.ADMIN_EMAILS = "equipo@example.test";
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_URL;
  const { db, schema, runMigrations, closeDb } = await import("./db/index.js");
  t.after(async () => { await closeDb(); await rm(dir, { recursive: true, force: true }); });
  await runMigrations();
  const { auth } = await import("./auth.js");
  const { groupRoutes } = await import("./routes/groups.js");
  const { socialRoutes } = await import("./routes/social.js");
  const { adminRoutes } = await import("./routes/admin.js");
  const app = new Hono().route("/", groupRoutes).route("/", socialRoutes).route("/", adminRoutes);
  const { eq } = await import("drizzle-orm");

  async function account(name: string) {
    const credentials = { email: `${name}@example.test`, password: "clave-para-pruebas" };
    const { user } = await auth.api.signUpEmail({ body: { ...credentials, name } });
    await db.insert(schema.profile).values({ userId: user.id, displayName: name, birthdate: "1990-01-01" });
    await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, user.id));
    const login = await auth.api.signInEmail({ body: credentials, asResponse: true });
    return { id: user.id, cookie: login.headers.getSetCookie().map((s) => s.split(";")[0]).join("; ") };
  }

  const sender = await account("autor");
  const [a, b, c, outsider, staff] = await Promise.all(["ana", "bea", "cel", "fuera", "equipo"].map(account));
  await db.insert(schema.group).values([
    { id: "piloto", name: "Piloto" }, { id: "otro", name: "Otro" },
    { id: "general", name: "General", isGeneral: true },
  ]);
  await db.insert(schema.groupMember).values([
    { groupId: "piloto", userId: sender.id, role: "owner" },
    ...[a, b, c].map(({ id }) => ({ groupId: "piloto", userId: id })),
    { groupId: "otro", userId: sender.id, role: "owner" },
    { groupId: "general", userId: sender.id, role: "owner" },
  ]);
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "orange" } }).png().toBuffer();
  function submitPhoto(group: string, cookie: string) {
    const body = new FormData();
    body.set("file", new File([new Uint8Array(png)], "prueba.png", { type: "image/png" }));
    return app.request(`/groups/${group}/messages/photo`, { method: "POST", headers: { cookie }, body });
  }
  function json(url: string, cookie: string, body: unknown, method = "POST") {
    return app.request(url, { method, headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  assert.equal((await submitPhoto("otro", sender.cookie)).status, 404);
  assert.equal((await submitPhoto("general", sender.cookie)).status, 404);
  assert.equal((await submitPhoto("piloto", outsider.cookie)).status, 404);
  const uploaded = await submitPhoto("piloto", sender.cookie);
  assert.equal(uploaded.status, 200);
  const { message } = await uploaded.json();
  assert.equal(message.photo, "available");
  assert.equal("photoKey" in message, false);

  const media = `/groups/piloto/messages/${message.id}/photo`;
  const open = (cookie: string) => app.request(media, { headers: { cookie } });
  assert.equal((await open(outsider.cookie)).status, 404);
  const first = await open(a.cookie);
  assert.equal(first.status, 200);
  assert.match(first.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(first.headers.get("content-type"), "image/webp");

  const flag = (cookie: string) => json("/reports", cookie, {
    userId: sender.id, reason: "fotos inapropiadas", messageId: message.id, messageKind: "group",
  });
  assert.equal((await flag(outsider.cookie)).status, 400);
  for (let n = 0; n < 3; n++) assert.equal((await flag(a.cookie)).status, 200);
  assert.equal((await open(a.cookie)).status, 200);
  const reports = await Promise.all([flag(b.cookie), flag(c.cookie)]);
  assert.deepEqual(reports.map((r) => r.status), [200, 200]);
  assert.equal((await open(a.cookie)).status, 404);
  const current = await app.request("/groups/piloto/messages", { headers: { cookie: a.cookie } });
  assert.equal((await current.json()).messages[0].photo, "hidden");
  const admin = await app.request("/admin/reports", { headers: { cookie: staff.cookie } });
  assert.equal(admin.status, 200);
  const pending = await admin.json();
  assert.equal(pending.length, 3);
  assert.equal(new Set(pending.map((r: { subject: string }) => r.subject)).size, 1);
  assert.ok(pending.every((r: { urgent: boolean; message: { hidden: boolean } }) => r.urgent && r.message.hidden));

  const restore = `/admin/reports/${pending[0].id}/restore-group-photo`;
  assert.equal((await json(restore, a.cookie, {})).status, 403);
  assert.equal((await json(restore, staff.cookie, {})).status, 200);
  assert.equal((await open(a.cookie)).status, 200);

  assert.equal((await json("/groups/piloto/photo-pilot", a.cookie, { paused: true }, "PUT")).status, 403);
  assert.equal((await json("/groups/piloto/photo-pilot", sender.cookie, { paused: true }, "PUT")).status, 200);
  assert.equal((await submitPhoto("piloto", sender.cookie)).status, 409);
});
