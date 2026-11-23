import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import sharp from "sharp";
import type { AppEnv } from "./lib.js";

test("accesos al álbum privado", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "qule-album-"));
  const origin = "http://localhost:3001";
  process.env.DATABASE_URL = "";
  process.env.DATA_DIR = dataDir;
  process.env.NODE_ENV = "test";
  process.env.APP_URL = origin;
  process.env.SMTP_URL = "";
  process.env.VAPID_PUBLIC_KEY = "";
  process.env.VAPID_PRIVATE_KEY = "";
  process.env.BETTER_AUTH_SECRET = "clave-local-de-pruebas-de-album-qule";
  let close: (() => Promise<void>) | undefined;
  t.after(async () => {
    try {
      await close?.();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  // Sin SMTP, el mail de bienvenida simulado se mostraría en la salida de las pruebas.
  t.mock.method(console, "log", () => {});
  const { db, closeDb, runMigrations, schema } = await import("./db/index.js");
  close = closeDb;
  await runMigrations();
  const { auth } = await import("./auth.js");
  const { meRoutes } = await import("./routes/me.js");
  const { premiumRoutes } = await import("./routes/premium.js");
  const { socialRoutes } = await import("./routes/social.js");
  const { saveImage } = await import("./storage.js");

  const app = new Hono<AppEnv>();
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.route("/api", meRoutes);
  app.route("/api", socialRoutes);
  app.route("/api", premiumRoutes);

  type Account = { id: string; cookie: string };
  type Album = { privateAlbum: { count: number; items: Array<{ url: string; thumb: string }> | null } };

  function request(url: string, account?: Account, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    headers.set("origin", origin);
    if (account) headers.set("cookie", account.cookie);
    return app.request(new URL(url, origin), { ...init, headers });
  }

  function json(method: string, body: unknown): RequestInit {
    return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  }

  async function account(name: string): Promise<Account> {
    const res = await request("/api/auth/sign-up/email", undefined, json("POST", {
      name, email: `${name.toLowerCase()}@example.test`, password: "una frase sintética de prueba",
    }));
    assert.equal(res.status, 200);
    const { user } = await res.json() as { user: { id: string } };
    const cookie = res.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    assert.ok(cookie);
    await db.insert(schema.profile).values({ userId: user.id, displayName: name, birthdate: "1990-01-01" });
    return { id: user.id, cookie };
  }

  const owner = await account("Ana");
  const person = await account("Luz");
  const other = await account("Sol");
  const sample = await sharp({ create: { width: 12, height: 12, channels: 3, background: { r: 45, g: 60, b: 70 } } }).png().toBuffer();

  const data = new FormData();
  data.set("file", new File([Uint8Array.from(sample)], "prueba.png", { type: "image/png" }));
  data.set("private", "1");
  const photo = await request("/api/me/photos", owner, { method: "POST", body: data });
  assert.equal(photo.status, 200);

  // La ruta sirve bytes por rango; la prueba no necesita un códec ni ffmpeg.
  const videoBytes = Buffer.from("video de prueba");
  const videoKey = `${randomUUID()}.mp4`;
  const posterKey = await saveImage(sample);
  await writeFile(path.join(dataDir, "uploads", videoKey), videoBytes);
  await db.insert(schema.photo).values({
    id: randomUUID(), userId: owner.id, position: 1, key: videoKey, posterKey, kind: "video", isPrivate: true,
  });

  async function albumFor(viewer: Account) {
    const res = await request(`/api/users/${owner.id}`, viewer);
    assert.equal(res.status, 200);
    return ((await res.json()) as Album).privateAlbum;
  }

  const ownerAlbum = await albumFor(owner);
  assert.equal(ownerAlbum.count, 2);
  assert.ok(ownerAlbum.items);
  const [photoItem, videoItem] = ownerAlbum.items;
  const fileUrls = [photoItem.url, photoItem.thumb, videoItem.thumb, videoItem.url];

  async function giveAccess(from: Account, to: Account, hours: number | null = null) {
    const res = await request(`/api/album/grants/${to.id}`, from, json("PUT", { hours }));
    assert.equal(res.status, 200);
  }

  async function grants(from: Account): Promise<string[]> {
    const res = await request("/api/album/grants", from);
    assert.equal(res.status, 200);
    return ((await res.json()) as { id: string }[]).map(({ id }) => id);
  }

  async function assertHidden(viewer: Account) {
    assert.equal((await albumFor(viewer)).items, null);
    for (const url of fileUrls) assert.equal((await request(url, viewer)).status, 404);
  }

  async function assertVisible(viewer: Account) {
    assert.deepEqual((await albumFor(viewer)).items, ownerAlbum.items);
    for (const url of fileUrls.slice(0, 3)) {
      const response = await request(url, viewer);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      await response.arrayBuffer();
    }
    const video = await request(videoItem.url, viewer, { headers: { range: "bytes=0-3" } });
    assert.equal(video.status, 206);
    assert.equal(video.headers.get("cache-control"), "no-store");
    assert.equal(video.headers.get("content-range"), `bytes 0-3/${videoBytes.length}`);
    assert.deepEqual(Buffer.from(await video.arrayBuffer()), videoBytes.subarray(0, 4));
  }

  await t.test("solo la persona dueña ve sus fotos, miniaturas y video al principio", async () => {
    assert.equal((await request(photoItem.url)).status, 401);
    assert.equal((await request("/api/album/grants", undefined, { method: "DELETE" })).status, 401);
    await assertVisible(owner);
    await assertHidden(person);
  });

  await t.test("compartir habilita los archivos; el vencimiento los cierra", async () => {
    await giveAccess(owner, person, 1);
    await assertVisible(person);
    await assertHidden(other);
    await db.update(schema.albumGrant).set({ expiresAt: new Date(0) }).where(and(
      eq(schema.albumGrant.ownerId, owner.id), eq(schema.albumGrant.granteeId, person.id),
    ));
    await assertHidden(person);
    assert.deepEqual(await grants(owner), []);
  });

  await t.test("quitar un acceso conserva los demás", async () => {
    await giveAccess(owner, person);
    await giveAccess(owner, other);
    assert.equal((await request(`/api/album/grants/${person.id}`, owner, { method: "DELETE" })).status, 200);
    await assertHidden(person);
    await assertVisible(other);
  });

  await t.test("quitar todos los accesos afecta solo a la persona que hace el cambio", async () => {
    await giveAccess(owner, person);
    await giveAccess(person, other);
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.equal((await request("/api/album/grants", owner, { method: "DELETE" })).status, 200);
    }
    assert.deepEqual(await grants(owner), []);
    assert.deepEqual(await grants(person), [other.id]);
    await assertHidden(person);
    await assertHidden(other);
    await assertVisible(owner);
  });

  await t.test("bloquear a alguien quita el acceso concedido a esa persona", async () => {
    await giveAccess(owner, person);
    assert.equal((await request("/api/blocks", owner, json("POST", { userId: person.id }))).status, 200);
    assert.deepEqual(await grants(owner), []);
    assert.equal((await request(`/api/users/${owner.id}`, person)).status, 404);
    for (const url of fileUrls) assert.equal((await request(url, person)).status, 404);
  });
});
