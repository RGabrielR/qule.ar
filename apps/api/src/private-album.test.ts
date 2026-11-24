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
  const secret = Buffer.alloc(32, 7);
  process.env.ALBUM_WATERMARK_KEY = secret.toString("base64");
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
  const { adminRoutes } = await import("./routes/admin.js");
  const { limitApiBody } = await import("./requestBody.js");
  const { auth } = await import("./auth.js");
  const { meRoutes } = await import("./routes/me.js");
  const { premiumRoutes } = await import("./routes/premium.js");
  const { socialRoutes } = await import("./routes/social.js");
  const { verifyAlbumImage } = await import("./albumWatermark.js");
  const { isEncryptedBlob } = await import("./fileCrypt.js");
  const { getRawBlob, readImage, saveImage } = await import("./storage.js");

  const app = new Hono<AppEnv>();
  app.use("/api/*", limitApiBody);
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.route("/api", meRoutes);
  app.route("/api", socialRoutes);
  app.route("/api", premiumRoutes);
  app.route("/api", adminRoutes);

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
  const sample = await sharp({ create: { width: 160, height: 120, channels: 3, background: { r: 45, g: 60, b: 70 } } }).png().toBuffer();

  const data = new FormData();
  data.set("file", new File([Uint8Array.from(sample)], "prueba.png", { type: "image/png" }));
  data.set("private", "1");
  const photo = await request("/api/me/photos", owner, { method: "POST", body: data });
  assert.equal(photo.status, 200);
  // Lo que se sube sin elegir álbum va al álbum por defecto
  const { albumId, id: originalId } = await photo.json() as { albumId: string; id: string };
  assert.ok(albumId);

  // La ruta sirve bytes por rango; la prueba no necesita un códec ni ffmpeg.
  const videoBytes = Buffer.from("video de prueba");
  const videoKey = `${randomUUID()}.mp4`;
  const posterKey = await saveImage(sample);
  await writeFile(path.join(dataDir, "uploads", videoKey), videoBytes);
  await db.insert(schema.photo).values({
    id: randomUUID(), userId: owner.id, position: 1, key: videoKey, posterKey, kind: "video", isPrivate: true, albumId,
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

  await t.test("las copias de fotos y miniaturas tienen una marca distinta para cada cuenta autorizada", async () => {
    await giveAccess(owner, person);
    await giveAccess(owner, other);
    const fileKey = photoItem.url.split("/").at(-1)!;
    for (const [url, thumb] of [[photoItem.url, false], [photoItem.thumb, true]] as const) {
      const original = await readImage(fileKey, thumb);
      assert.ok(original);
      const fetchImage = async (viewer: Account) => {
        const response = await request(url, viewer);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        return Buffer.from(await response.arrayBuffer());
      };
      assert.deepEqual(await fetchImage(owner), original);
      const [first, second] = await Promise.all([fetchImage(person), fetchImage(other)]);
      assert.notDeepEqual(first, original);
      assert.notDeepEqual(first, second);
      const mark = { secret, fileKey, viewerId: person.id, thumb };
      assert.equal((await verifyAlbumImage(original, first, mark)).match, true);
      assert.equal((await verifyAlbumImage(original, second, mark)).match, false);
      assert.equal((await verifyAlbumImage(original, original, mark)).match, false);
      assert.equal((await verifyAlbumImage(original, first, { ...mark, thumb: !thumb })).match, false);
      assert.deepEqual(await readImage(fileKey, thumb), original);
    }
    const ownerPoster = await request(videoItem.thumb, owner);
    const sharedPoster = await request(videoItem.thumb, person);
    assert.deepEqual(await sharedPoster.arrayBuffer(), await ownerPoster.arrayBuffer());
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

  await t.test("Moderación verifica una captura dentro de un reporte sin conservar el archivo", async () => {
    const moderator = await account("Paz");
    const unrelated = await account("Mar");
    const id = randomUUID();
    await db.insert(schema.report).values({ id, reporterId: owner.id, targetUserId: person.id, reason: "otro" });
    const url = `/api/admin/reports/${id}/photo-verification`;

    assert.equal((await request(url, unrelated)).status, 403);
    await db.insert(schema.staffPermission).values({ userId: moderator.id, permission: "reports" });
    assert.equal((await request(url, moderator)).status, 403);
    await db.insert(schema.staffPermission).values({ userId: moderator.id, permission: "photoVerification" });

    const list = await request(url, moderator);
    assert.equal(list.status, 200);
    assert.equal(list.headers.get("cache-control"), "no-store");
    const { photos } = await list.json() as { photos: { id: string; name: string }[] };
    assert.deepEqual(photos.map(({ id, name }) => ({ id, name })), [{ id: originalId, name: "Ana" }]);
    assert.equal((await request(`${url}/${originalId}/photo`, moderator)).status, 200);

    const otherUpload = new FormData();
    otherUpload.append("file", new File([Uint8Array.from(sample)], "otra.png", { type: "image/png" }));
    otherUpload.append("private", "1");
    const otherPhoto = await request("/api/me/photos", unrelated, { method: "POST", body: otherUpload });
    assert.equal(otherPhoto.status, 200);
    const otherId = (await otherPhoto.json() as { id: string }).id;
    assert.equal((await request(`${url}/${otherId}/photo`, moderator)).status, 404);

    await giveAccess(owner, person);
    const source = await request(photoItem.url, person);
    assert.equal(source.status, 200);
    const capture = await source.arrayBuffer();
    assert.equal((await request(`/api/album/grants/${person.id}`, owner, { method: "DELETE" })).status, 200);
    assert.equal((await request(photoItem.url, person)).status, 404);

    async function verify(viewerId: string, fields: Record<string, unknown> = {}) {
      const body = new FormData();
      body.append("file", new File([capture], "captura.webp", { type: "image/webp" }));
      body.append("fields", JSON.stringify({ photoId: originalId, variant: "photo", viewerId, ...fields }));
      return request(url, moderator, { method: "POST", body });
    }

    const matched = await verify(person.id, {
      captureCrop: { left: 8, top: 8, width: 144, height: 104 },
      originalCrop: { left: 8, top: 8, width: 144, height: 104 },
    });
    assert.equal(matched.status, 200);
    assert.deepEqual(await matched.json(), { status: "match", uploader: "Ana", recipient: { id: person.id, name: "Luz" } });
    assert.deepEqual(await (await verify(other.id)).json(), { status: "no_match", uploader: "Ana", recipient: null });
    assert.equal((await verify(person.id, { photoId: otherId })).status, 404);
    assert.deepEqual(await (await verify(person.id, { captureCrop: { left: 0, top: 0, width: 8, height: 8 } })).json(),
      { status: "insufficient", uploader: "Ana", recipient: null });
    const audit = await db.select().from(schema.modAction).where(and(eq(schema.modAction.targetId, id),
      eq(schema.modAction.action, "Verificó una foto de un reporte")));
    assert.equal(audit.length, 3);
    assert.ok(audit.every((entry) => entry.actorId === moderator.id));
    const [caseRow] = await db.select().from(schema.report).where(eq(schema.report.id, id));
    assert.deepEqual(caseRow.evidenceKeys, []);

    const evidence = new FormData();
    evidence.append("userId", person.id);
    evidence.append("reason", "otro");
    evidence.append("details", "Captura adjunta al reportar");
    evidence.append("file", new File([capture], "captura.webp", { type: "image/webp" }));
    assert.equal((await request("/api/reports", owner, { method: "POST", body: evidence })).status, 200);
    const [attachment] = await db.select().from(schema.report).where(eq(schema.report.details, "Captura adjunta al reportar"));
    assert.ok(attachment.captureKey);
    const stored = await getRawBlob(attachment.captureKey);
    assert.ok(stored && isEncryptedBlob(stored));
    const attachedUrl = `/api/admin/reports/${attachment.id}/photo-verification`;
    assert.equal((await request(`${attachedUrl}/capture`, owner)).status, 403);
    const preview = await request(`${attachedUrl}/capture`, moderator);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("cache-control"), "no-store");
    const referenceList = await request(attachedUrl, moderator);
    assert.equal((await referenceList.json() as { hasCapture: boolean }).hasCapture, true);
    const fromReport = await request(attachedUrl, moderator, json("POST", {
      photoId: originalId, variant: "photo", viewerId: person.id,
    }));
    assert.deepEqual(await fromReport.json(), { status: "match", uploader: "Ana", recipient: { id: person.id, name: "Luz" } });
    assert.equal((await request(`/api/admin/reports/${attachment.id}/dismiss`, moderator, { method: "POST" })).status, 200);
    assert.equal((await request(`${attachedUrl}/capture`, moderator)).status, 404);
    assert.equal(await getRawBlob(attachment.captureKey), null);
  });

  await t.test("bloquear a alguien quita el acceso concedido a esa persona", async () => {
    await giveAccess(owner, person);
    assert.equal((await request("/api/blocks", owner, json("POST", { userId: person.id }))).status, 200);
    assert.deepEqual(await grants(owner), []);
    assert.equal((await request(`/api/users/${owner.id}`, person)).status, 404);
    for (const url of fileUrls) assert.equal((await request(url, person)).status, 404);
  });
});
