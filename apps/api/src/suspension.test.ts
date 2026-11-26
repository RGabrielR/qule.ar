import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import sharp from "sharp";
import type { AppEnv } from "./lib.js";

/**
 * Suspender borra lo público de la persona: sus mensajes en grupos (también los en cola), sus reacciones, sus fotos,
 * álbumes y videos, y las fotos que mandó por privado. Lo que es prueba de un reporte queda guardado, y los reportes
 * sobre su perfil suman sus fotos públicas antes del borrado.
 */
test("suspender borra mensajes en grupos y archivos, y conserva la prueba de los reportes", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "qule-suspender-"));
  const origin = "http://localhost:3001";
  process.env.DATABASE_URL = "";
  process.env.DATA_DIR = dataDir;
  process.env.DATA_KEY = randomBytes(32).toString("base64");
  process.env.NODE_ENV = "test";
  process.env.APP_URL = origin;
  process.env.SMTP_URL = "";
  process.env.VAPID_PUBLIC_KEY = "";
  process.env.VAPID_PRIVATE_KEY = "";
  process.env.BETTER_AUTH_SECRET = "clave-local-de-pruebas-de-suspender-qule";
  let close: (() => Promise<void>) | undefined;
  t.after(async () => {
    try {
      await close?.();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  t.mock.method(console, "log", () => {});
  const { db, closeDb, runMigrations, schema } = await import("./db/index.js");
  close = closeDb;
  await runMigrations();
  const { eq } = await import("drizzle-orm");
  const { auth } = await import("./auth.js");
  const { adminRoutes } = await import("./routes/admin.js");
  const { saveImage } = await import("./storage.js");

  const app = new Hono<AppEnv>();
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.route("/api", adminRoutes);

  type Account = { id: string; cookie: string };
  const request = (url: string, account?: Account, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("origin", origin);
    if (account) headers.set("cookie", account.cookie);
    return app.request(new URL(url, origin), { ...init, headers });
  };
  const json = (method: string, body?: unknown): RequestInit =>
    ({ method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

  async function account(name: string): Promise<Account> {
    const res = await request("/api/auth/sign-up/email", undefined, json("POST", {
      name, email: `${name.toLowerCase()}@example.test`, password: "una frase sintética de prueba",
    }));
    assert.equal(res.status, 200);
    const { user } = await res.json() as { user: { id: string } };
    const cookie = res.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    await db.insert(schema.profile).values({ userId: user.id, displayName: name, birthdate: "1990-01-01" });
    return { id: user.id, cookie };
  }
  const stored = (key: string) => access(path.join(dataDir, "uploads", key)).then(() => true, () => false);
  const image = async (r: number) =>
    saveImage(await sharp({ create: { width: 12, height: 12, channels: 3, background: { r, g: 60, b: 70 } } }).png().toBuffer());

  const mod = await account("Mod");
  const tito = await account("Tito");
  const ana = await account("Ana");
  await db.insert(schema.staffPermission).values({ userId: mod.id, permission: "sanctions" });

  // Tito: una foto de perfil, un álbum privado con una foto, y una foto mandada por privado a Ana
  const [publicKey, privateKey, dmKey, reportedDmKey] = await Promise.all([image(10), image(20), image(30), image(40)]);
  await db.insert(schema.album).values({ id: "al1", userId: tito.id, name: "Privado" });
  await db.insert(schema.photo).values([
    { id: "p1", userId: tito.id, key: publicKey, position: 0 },
    { id: "p2", userId: tito.id, key: privateKey, position: 1, isPrivate: true, albumId: "al1" },
  ]);
  await db.insert(schema.albumGrant).values({ albumId: "al1", ownerId: tito.id, granteeId: ana.id });
  const [a, b] = [ana.id, tito.id].sort();
  await db.insert(schema.conversation).values({ id: "c1", userA: a, userB: b });
  await db.insert(schema.directMessage).values([
    { id: "dm1", conversationId: "c1", senderId: tito.id, photoKey: dmKey },
    { id: "dm2", conversationId: "c1", senderId: tito.id, body: "hola, ¿todo bien?" },
    { id: "dm3", conversationId: "c1", senderId: tito.id, photoKey: reportedDmKey },
    { id: "dm4", conversationId: "c1", senderId: tito.id, kind: "album", albumId: "al1" },
  ]);

  // Un grupo con un mensaje publicado de Tito, uno en cola y uno de Ana al que Tito reaccionó
  const later = new Date(Date.now() + 60_000);
  await db.insert(schema.group).values({ id: "g1", name: "Ruta 3" });
  await db.insert(schema.groupMember).values([{ groupId: "g1", userId: tito.id }, { groupId: "g1", userId: ana.id }]);
  await db.insert(schema.groupMessage).values([
    { id: "m1", groupId: "g1", userId: tito.id, body: "comprá acá", status: "published", scheduledAt: new Date() },
    { id: "m2", groupId: "g1", userId: tito.id, body: "otra vez", status: "queued", scheduledAt: later },
    { id: "m3", groupId: "g1", userId: ana.id, body: "buenas", status: "published", scheduledAt: new Date() },
  ]);
  await db.insert(schema.reaction).values([
    { messageId: "m3", scope: "group", userId: tito.id, kind: "fuego" },
    { messageId: "m1", scope: "group", userId: ana.id, kind: "risa" },
  ]);

  // Reportes: el perfil (sin copia de fotos, no es urgente), el mensaje del grupo y la foto privada
  const base = { reporterId: ana.id, targetUserId: tito.id, targetName: "Tito" };
  await db.insert(schema.report).values([
    { id: "r1", ...base, reason: "fotos inapropiadas" },
    { id: "r2", ...base, reason: "venta o drogas", messageId: "m1", messageKind: "group", messageBody: "comprá acá" },
    { id: "r3", ...base, reason: "acoso", messageId: "dm3", messageKind: "dm", evidenceKeys: [reportedDmKey] },
  ]);

  const res = await request(`/api/admin/users/${tito.id}/suspend`, mod, json("POST", { reason: "Venta en grupos" }));
  assert.equal(res.status, 200);

  // Mensajes en grupos: el publicado queda borrado (sin texto), el de la cola cancelado, el de Ana intacto
  const msgs = Object.fromEntries((await db.select().from(schema.groupMessage)).map((m) => [m.id, m]));
  assert.equal(msgs.m1.status, "deleted");
  assert.equal(msgs.m1.body, "");
  assert.equal(msgs.m2.status, "cancelled");
  assert.equal(msgs.m2.body, "");
  assert.equal(msgs.m3.status, "published");
  assert.deepEqual(await db.select().from(schema.reaction), [], "sin sus reacciones ni las de sus mensajes");

  // Fotos, álbumes y accesos: no queda nada
  assert.deepEqual(await db.select().from(schema.photo).where(eq(schema.photo.userId, tito.id)), []);
  assert.deepEqual(await db.select().from(schema.album).where(eq(schema.album.userId, tito.id)), []);
  assert.deepEqual(await db.select().from(schema.albumGrant), []);

  // Por privado: la foto se va, el texto queda (es privado y es la prueba de Ana), el aviso del álbum pasa a revocado
  const dms = Object.fromEntries((await db.select().from(schema.directMessage)).map((m) => [m.id, m]));
  assert.deepEqual(Object.keys(dms).sort(), ["dm2", "dm4"]);
  assert.equal(dms.dm4.kind, "album_revoked");

  // Archivos: se borran, salvo los que son prueba de un reporte
  assert.equal(await stored(privateKey), false, "la foto del álbum se borra");
  assert.equal(await stored(dmKey), false, "la foto por privado se borra");
  assert.equal(await stored(reportedDmKey), true, "la foto reportada queda como prueba");
  assert.equal(await stored(publicKey), true, "la foto del perfil reportado queda como prueba");

  // Los reportes quedan cerrados con la medida, el del perfil con sus fotos públicas y el del grupo con su copia
  const reps = Object.fromEntries((await db.select().from(schema.report)).map((r) => [r.id, r]));
  assert.ok(Object.values(reps).every((r) => r.status === "actioned"));
  assert.deepEqual(reps.r1.evidenceKeys, [publicKey]);
  assert.deepEqual(reps.r3.evidenceKeys, [reportedDmKey]);
  const panel = await request("/api/admin/reports?status=closed", mod);
  assert.equal(panel.status, 200);
  const shown = (await panel.json() as { id: string; message: { body: string | null; deleted: boolean } | null }[])
    .find((r) => r.id === "r2");
  assert.deepEqual(shown?.message, { body: "comprá acá", photo: false, deleted: true }, "moderación sigue viendo la copia");

  // El registro dice cuánto se borró
  const [log] = await db.select().from(schema.modAction).where(eq(schema.modAction.targetId, tito.id));
  assert.match(log.details ?? "", /Venta en grupos · Se borraron 2 mensajes en grupos y 4 archivos/);

  // Con un reporte urgente (acá, por menor de edad) todos sus archivos quedan como prueba, aunque desaparezcan de la app
  const leo = await account("Leo");
  const [leoPublic, leoPrivate, leoDm] = await Promise.all([image(50), image(60), image(70)]);
  await db.insert(schema.photo).values([
    { id: "p3", userId: leo.id, key: leoPublic, position: 0 },
    { id: "p4", userId: leo.id, key: leoPrivate, position: 1, isPrivate: true },
  ]);
  const [x, y] = [ana.id, leo.id].sort();
  await db.insert(schema.conversation).values({ id: "c2", userA: x, userB: y });
  await db.insert(schema.directMessage).values({ id: "dm5", conversationId: "c2", senderId: leo.id, photoKey: leoDm });
  await db.insert(schema.report).values({ id: "r4", reporterId: ana.id, targetUserId: leo.id, targetName: "Leo", reason: "menor de edad" });
  assert.equal((await request(`/api/admin/users/${leo.id}/suspend`, mod, json("POST", { reason: "Menor de edad" }))).status, 200);
  assert.deepEqual(await db.select().from(schema.photo).where(eq(schema.photo.userId, leo.id)), [], "de la app desaparece");
  assert.deepEqual(await db.select().from(schema.directMessage).where(eq(schema.directMessage.id, "dm5")), []);
  const [r4] = await db.select().from(schema.report).where(eq(schema.report.id, "r4"));
  assert.deepEqual([...r4.evidenceKeys].sort(), [leoPublic, leoPrivate, leoDm].sort());
  for (const key of [leoPublic, leoPrivate, leoDm]) assert.equal(await stored(key), true, "queda en el servidor como prueba");
});
