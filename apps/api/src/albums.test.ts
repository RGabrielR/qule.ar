import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import sharp from "sharp";
import type { AppEnv } from "./lib.js";

test("varios álbumes privados, compartidos de a uno", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "qule-albumes-"));
  const origin = "http://localhost:3001";
  process.env.DATABASE_URL = "";
  process.env.DATA_DIR = dataDir;
  process.env.NODE_ENV = "test";
  process.env.APP_URL = origin;
  process.env.SMTP_URL = "";
  process.env.VAPID_PUBLIC_KEY = "";
  process.env.VAPID_PRIVATE_KEY = "";
  process.env.BETTER_AUTH_SECRET = "clave-local-de-pruebas-de-albumes-qule";
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
  const { auth } = await import("./auth.js");
  const { meRoutes } = await import("./routes/me.js");
  const { premiumRoutes } = await import("./routes/premium.js");
  const { socialRoutes } = await import("./routes/social.js");
  const { saveImage } = await import("./storage.js");
  const { MAX_ALBUMS, MAX_ALBUM_ITEMS } = await import("./albums.js");

  const app = new Hono<AppEnv>();
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.route("/api", meRoutes);
  app.route("/api", socialRoutes);
  app.route("/api", premiumRoutes);

  type Account = { id: string; cookie: string };
  type Media = { url: string; thumb: string | null };
  type SharedAlbum = { id: string; name: string; count: number; items: Media[]; expiresAt: string | null };
  type UserOut = {
    privateAlbum: { count: number; items: Media[] | null; albums: SharedAlbum[] } | null;
    iSharedAlbum: boolean;
    myShares: { albumId: string; expiresAt: string | null }[];
  };

  function request(url: string, account?: Account, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    headers.set("origin", origin);
    if (account) headers.set("cookie", account.cookie);
    return app.request(new URL(url, origin), { ...init, headers });
  }
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

  const owner = await account("Ana");
  const person = await account("Luz");
  const other = await account("Sol");
  const sample = await sharp({ create: { width: 12, height: 12, channels: 3, background: { r: 45, g: 60, b: 70 } } }).png().toBuffer();

  async function createAlbum(who: Account, name: string) {
    const res = await request("/api/album/albums", who, json("POST", { name }));
    assert.equal(res.status, 200, await res.clone().text());
    return (await res.json() as { id: string }).id;
  }

  async function uploadTo(who: Account, albumId: string | null) {
    const data = new FormData();
    data.set("file", new File([Uint8Array.from(sample)], "prueba.png", { type: "image/png" }));
    if (albumId) data.set("album", albumId);
    else data.set("private", "1");
    return request("/api/me/photos", who, { method: "POST", body: data });
  }

  async function upload(who: Account, albumId: string | null) {
    const res = await uploadTo(who, albumId);
    assert.equal(res.status, 200, await res.clone().text());
    return await res.json() as { id: string; albumId: string; url: string; thumb: string };
  }

  async function profileOf(viewer: Account, id = owner.id) {
    const res = await request(`/api/users/${id}`, viewer);
    assert.equal(res.status, 200);
    return await res.json() as UserOut;
  }

  async function canSee(viewer: Account, file: { url: string; thumb: string }) {
    const [a, b] = [await request(file.url, viewer), await request(file.thumb, viewer)];
    assert.equal(a.status, b.status);
    return a.status === 200;
  }

  const share = (albumId: string, to: Account, hours: number | null = null, from = owner) =>
    request(`/api/album/albums/${albumId}/grants/${to.id}`, from, json("PUT", { hours }));

  // Un álbum por defecto (lo crea la primera subida privada) y dos con nombre
  const first = await upload(owner, null);
  const base = first.albumId;
  const activo = await createAlbum(owner, "Activo");
  const pasivo = await createAlbum(owner, "Pasivo");
  const enActivo = await upload(owner, activo);
  const enPasivo = await upload(owner, pasivo);

  await t.test("se crean, se renombran y tienen un tope", async () => {
    const list = await (await request("/api/album/albums", owner)).json() as { id: string; name: string; count: number }[];
    assert.deepEqual(list.map((a) => [a.name, a.count]), [["Álbum privado", 1], ["Activo", 1], ["Pasivo", 1]]);
    assert.equal((await request(`/api/album/albums/${activo}`, owner, json("PATCH", { name: "  Activo de noche " }))).status, 200);
    const me = await (await request("/api/me", owner)).json() as { albums: { id: string; name: string }[] };
    assert.equal(me.albums.find((a) => a.id === activo)?.name, "Activo de noche");
    assert.equal((await request(`/api/album/albums/${activo}`, owner, json("PATCH", { name: "   " }))).status, 400);
    assert.equal((await request(`/api/album/albums/${activo}`, owner, json("PATCH", { name: "x".repeat(31) }))).status, 400);
    const extra: string[] = [];
    for (let i = list.length; i < MAX_ALBUMS; i++) extra.push(await createAlbum(owner, `Extra ${i}`));
    const over = await request("/api/album/albums", owner, json("POST", { name: "Uno más" }));
    assert.equal(over.status, 400);
    for (const id of extra) assert.equal((await request(`/api/album/albums/${id}`, owner, { method: "DELETE" })).status, 200);
  });

  await t.test("nadie más puede tocar mis álbumes", async () => {
    assert.equal((await request(`/api/album/albums/${activo}`, person, json("PATCH", { name: "Mío" }))).status, 404);
    assert.equal((await request(`/api/album/albums/${activo}`, person, { method: "DELETE" })).status, 404);
    assert.equal((await share(activo, other, null, person)).status, 404);
    assert.equal((await uploadTo(person, activo)).status, 404);
    const mine = await upload(person, null);
    assert.equal((await request(`/api/me/photos/${mine.id}`, person, json("PATCH", { albumId: activo }))).status, 404);
    assert.equal((await request(`/api/me/photos/${enActivo.id}`, person, json("PATCH", { albumId: mine.albumId }))).status, 404);
    // Y no se puede compartir el álbum de otra persona aunque se conozca el id
    assert.equal((await request(`/api/album/albums/${activo}/grants/${other.id}`, person, json("PUT", { hours: 1 }))).status, 404);
  });

  await t.test("con acceso a un álbum no se ven los archivos de otro", async () => {
    assert.equal((await share(activo, person, 24)).status, 200);
    assert.equal(await canSee(person, enActivo), true);
    assert.equal(await canSee(person, enPasivo), false);
    assert.equal(await canSee(person, first), false);
    assert.equal(await canSee(other, enActivo), false);
    const seen = await profileOf(person);
    assert.equal(seen.privateAlbum?.count, 3);
    // Solo aparece el álbum compartido, con su nombre; los otros nombres no se muestran
    assert.deepEqual(seen.privateAlbum?.albums.map((a) => [a.id, a.name, a.count]), [[activo, "Activo de noche", 1]]);
    assert.deepEqual(seen.privateAlbum?.items, [{ ...seen.privateAlbum!.albums[0].items[0] }]);
    assert.ok(!JSON.stringify(seen).includes("Pasivo"));
    assert.equal((await profileOf(other)).privateAlbum?.items, null);
    // Quien comparte ve qué álbum le compartió
    const mine = await profileOf(owner, person.id);
    assert.deepEqual(mine.myShares.map((s) => s.albumId), [activo]);
    assert.equal(mine.iSharedAlbum, true);
  });

  await t.test("mover un archivo de álbum cambia quién lo ve", async () => {
    assert.equal((await request(`/api/me/photos/${enPasivo.id}`, owner, json("PATCH", { albumId: activo }))).status, 200);
    assert.equal(await canSee(person, enPasivo), true);
    assert.equal((await request(`/api/me/photos/${enPasivo.id}`, owner, json("PATCH", { albumId: pasivo }))).status, 200);
    assert.equal(await canSee(person, enPasivo), false);
    // Pasarla al perfil público y volverla a un álbum
    assert.equal((await request(`/api/me/photos/${enPasivo.id}`, owner, json("PATCH", { isPrivate: false }))).status, 200);
    assert.equal(await canSee(other, enPasivo), true);
    assert.equal((await request(`/api/me/photos/${enPasivo.id}`, owner, json("PATCH", { albumId: pasivo }))).status, 200);
    assert.equal(await canSee(other, enPasivo), false);
    assert.equal((await request(`/api/me/photos/${enPasivo.id}`, owner, json("PATCH", { isPrivate: false, albumId: pasivo }))).status, 400);
  });

  await t.test("compartir y quitar es por álbum", async () => {
    assert.equal((await share(pasivo, person, 1)).status, 200);
    assert.equal(await canSee(person, enPasivo), true);
    const list = await (await request("/api/album/grants", owner)).json() as { id: string; albumId: string; albumName: string }[];
    assert.deepEqual(list.map((g) => [g.id, g.albumName]).sort(), [[person.id, "Activo de noche"], [person.id, "Pasivo"]]);
    assert.equal((await request(`/api/album/albums/${pasivo}/grants/${person.id}`, owner, { method: "DELETE" })).status, 200);
    assert.equal(await canSee(person, enPasivo), false);
    assert.equal(await canSee(person, enActivo), true);
    // El vencimiento de un álbum no toca el otro
    assert.equal((await share(pasivo, person, 1)).status, 200);
    const { and, eq } = await import("drizzle-orm");
    await db.update(schema.albumGrant).set({ expiresAt: new Date(0) })
      .where(and(eq(schema.albumGrant.albumId, pasivo), eq(schema.albumGrant.granteeId, person.id)));
    assert.equal(await canSee(person, enPasivo), false);
    assert.equal(await canSee(person, enActivo), true);
  });

  await t.test("bloquear revoca todos los álbumes en las dos direcciones", async () => {
    assert.equal((await share(pasivo, other)).status, 200);
    assert.equal((await share(activo, other)).status, 200);
    const theirs = await upload(other, null);
    assert.equal((await request(`/api/album/grants/${owner.id}`, other, json("PUT", { hours: null }))).status, 200);
    assert.equal(await canSee(owner, theirs), true);
    assert.equal(await canSee(other, enPasivo), true);
    assert.equal((await request("/api/blocks", owner, json("POST", { userId: other.id }))).status, 200);
    assert.equal(await canSee(other, enPasivo), false);
    assert.equal(await canSee(other, enActivo), false);
    assert.equal(await canSee(owner, theirs), false);
    const left = await db.select().from(schema.albumGrant);
    assert.ok(left.every((g) => g.granteeId !== other.id && g.ownerId !== other.id));
    // Al desbloquear no vuelve ningún acceso
    assert.equal((await request(`/api/blocks/${other.id}`, owner, { method: "DELETE" })).status, 200);
    assert.equal(await canSee(other, enActivo), false);
  });

  await t.test("el tope de archivos privados suma todos los álbumes", async () => {
    const { eq } = await import("drizzle-orm");
    const have = (await db.select().from(schema.photo).where(eq(schema.photo.userId, owner.id))).filter((p) => p.isPrivate).length;
    const key = await saveImage(sample);
    for (let i = have; i < MAX_ALBUM_ITEMS; i++) {
      await db.insert(schema.photo).values({ id: randomUUID(), userId: owner.id, key, position: 100 + i, isPrivate: true, albumId: i % 2 ? activo : pasivo });
    }
    const res = await uploadTo(owner, base);
    assert.equal(res.status, 400);
    assert.match(await res.text(), /todos tus álbumes/);
    await db.delete(schema.photo).where(eq(schema.photo.key, key));
  });

  await t.test("borrar un álbum mueve o borra sus archivos y corta sus accesos", async () => {
    const extra = await upload(owner, pasivo);
    assert.equal((await share(pasivo, person)).status, 200);
    // Pasar todo a Activo, que Luz ya puede ver
    assert.equal((await request(`/api/album/albums/${pasivo}?moveTo=${pasivo}`, owner, { method: "DELETE" })).status, 400);
    assert.equal((await request(`/api/album/albums/${pasivo}?moveTo=${activo}`, owner, { method: "DELETE" })).status, 200);
    assert.equal(await canSee(person, extra), true);
    const list = await (await request("/api/album/grants", owner)).json() as { albumId: string }[];
    assert.ok(list.every((g) => g.albumId !== pasivo));
    // Borrar Activo sin mover: se van sus archivos (ni la dueña los ve)
    assert.equal((await request(`/api/album/albums/${activo}`, owner, { method: "DELETE" })).status, 200);
    assert.equal(await canSee(owner, extra), false);
    assert.equal(await canSee(person, enActivo), false);
    const albums = await (await request("/api/album/albums", owner)).json() as { id: string }[];
    assert.deepEqual(albums.map((a) => a.id), [base]);
    assert.equal(await canSee(owner, first), true);
  });
});
