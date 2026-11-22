import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Hono } from "hono";
import sharp from "sharp";

test("reintentos de mensajes privados, fotos temporales y turnos de grupo", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "qule-mensajes-"));
  process.env.DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_URL;
  const { db, schema, runMigrations, closeDb } = await import("./db/index.js");
  t.after(async () => { await closeDb(); await rm(dir, { recursive: true, force: true }); });
  await runMigrations();
  const { auth } = await import("./auth.js");
  const { groupRoutes } = await import("./routes/groups.js");
  const { socialRoutes } = await import("./routes/social.js");
  const { toqueRoutes } = await import("./routes/toques.js");
  const app = new Hono().route("/", groupRoutes).route("/", socialRoutes).route("/", toqueRoutes);

  async function account(name: string) {
    const credentials = { email: name + "@example.com", password: "clave-para-pruebas" };
    const { user } = await auth.api.signUpEmail({ body: { ...credentials, name } });
    await db.insert(schema.profile).values({ userId: user.id, displayName: name, birthdate: "1990-01-01" });
    const login = await auth.api.signInEmail({ body: credentials, asResponse: true });
    const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    return { id: user.id, cookie };
  }

  const sender = await account("remitente");
  const recipient = await account("destino");
  const [userA, userB] = [sender.id, recipient.id].sort();
  await db.insert(schema.conversation).values({ id: "privado", userA, userB });
  await db.insert(schema.group).values({ id: "grupo", name: "Grupo" });
  await db.insert(schema.groupMember).values({ groupId: "grupo", userId: sender.id, role: "member" });
  async function post(url: string, key: string, form?: FormData, replyToId?: string) {
    const headers = new Headers({ cookie: sender.cookie, "Idempotency-Key": key });
    if (!form) headers.set("content-type", "application/json");
    const response = await app.request(url, { method: "POST", headers, body: form ?? JSON.stringify({ body: "Hola", replyToId }) });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }

  const dm = "/conversations/privado/messages";
  const key = crypto.randomUUID();
  const [first, second] = await Promise.all([post(dm, key), post(dm, key)]);
  assert.equal(first.id, second.id);
  assert.notEqual(first.id, key);
  assert.equal(first.idempotencyKey, key);
  assert.notEqual((await post(dm, crypto.randomUUID())).id, first.id);

  const form = new FormData();
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).png().toBuffer();
  form.append("file", new File([new Uint8Array(png)], "foto.png", { type: "image/png" }));
  form.append("expiring", "1");
  const photoKey = crypto.randomUUID();
  const photo = await post(dm, photoKey, form);
  assert.equal((await post(dm, photoKey, form)).id, photo.id);
  assert.equal(photo.expiring, true);
  assert.equal(photo.photo, null);
  const history = await app.request(dm, { headers: { cookie: recipient.cookie } });
  const received = (await history.json()).messages;
  assert.equal(received.length, 3);
  assert.ok(received.every((m: { idempotencyKey?: string }) => m.idempotencyKey === undefined));

  const group = "/groups/grupo/messages";
  const { message: original } = await post(group, key);
  assert.notEqual(original.id, first.id);
  assert.equal(original.idempotencyKey, key);
  await post(group, crypto.randomUUID());
  const replyKey = crypto.randomUUID();
  const replies = await Promise.all([post(group, replyKey, undefined, original.id), post(group, replyKey, undefined, original.id)]);
  assert.notEqual(replies[0].message.id, replyKey);
  assert.equal(replies[0].message.idempotencyKey, replyKey);
  assert.equal(replies[0].message.id, replies[1].message.id);
  assert.equal(replies[0].message.replyTo.id, original.id);
  assert.equal(replies[0].message.status, "queued");
  assert.equal((await db.select().from(schema.groupMessage)).length, 3);

  const collision = await app.request(dm, { method: "POST", headers: {
    cookie: recipient.cookie, "Idempotency-Key": key, "content-type": "application/json",
  }, body: JSON.stringify({ body: "Otro mensaje" }) });
  assert.equal(collision.status, 200);
  assert.notEqual((await collision.json()).id, first.id);

  const legacy = await app.request(dm, {
    method: "POST",
    headers: { cookie: sender.cookie, "content-type": "application/json" },
    body: JSON.stringify({ body: "Sin clave de reintento" }),
  });
  assert.equal(legacy.status, 200);
  assert.ok((await legacy.json()).id);

  async function react(scope: string, kind: string) {
    const messageId = scope === "dm" ? first.id : original.id;
    const result = await app.request(`/reactions/${scope}/${messageId}`, { method: "PUT", headers: {
      cookie: sender.cookie, "content-type": "application/json",
    }, body: JSON.stringify({ kind }) });
    assert.equal(result.status, 200);
    return (await result.json()).reactions;
  }
  assert.deepEqual(await react("dm", "hola"), [{ kind: "hola", by: [sender.id] }]);
  assert.deepEqual(await react("group", "hola"), [{ kind: "hola", by: [sender.id] }]);
  assert.equal((await app.request(dm + "/" + first.id, { method: "DELETE", headers: { cookie: sender.cookie } })).status, 200);
  const replacement = await post(dm, key);
  assert.notEqual(replacement.id, first.id);
  assert.deepEqual(await react("group", "hola"), []);
});
