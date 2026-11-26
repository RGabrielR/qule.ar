import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import sharp from "sharp";
import { detectAiProvenance } from "@mortero/shared/aiProvenance";
import type { AppEnv } from "./lib.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/ai/${name}`, import.meta.url));

test("fotos hechas con IA: se marcan al subirlas y la marca viaja a la web", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "qule-ai-"));
  const origin = "http://localhost:3001";
  process.env.DATABASE_URL = "";
  process.env.DATA_DIR = dataDir;
  process.env.NODE_ENV = "test";
  process.env.APP_URL = origin;
  process.env.SMTP_URL = "";
  process.env.VAPID_PUBLIC_KEY = "";
  process.env.VAPID_PRIVATE_KEY = "";
  process.env.BETTER_AUTH_SECRET = "clave-local-de-pruebas-de-ia-qule";
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
  const { socialRoutes } = await import("./routes/social.js");
  const { groupRoutes } = await import("./routes/groups.js");
  const { readImage } = await import("./storage.js");

  const app = new Hono<AppEnv>();
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.route("/api", meRoutes);
  app.route("/api", socialRoutes);
  app.route("/api", groupRoutes);

  type Account = { id: string; cookie: string };
  const request = (url: string, account?: Account, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("origin", origin);
    if (account) headers.set("cookie", account.cookie);
    return app.request(new URL(url, origin), { ...init, headers });
  };
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

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

  const upload = (url: string, who: Account, file: Buffer, name: string, fields: Record<string, string> = {}) => {
    const form = new FormData();
    form.set("file", new File([Uint8Array.from(file)], name, { type: name.endsWith(".png") ? "image/png" : "image/jpeg" }));
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return request(url, who, { method: "POST", body: form });
  };

  const ana = await account("Ana");
  const beto = await account("Beto");
  const plain = await sharp({ create: { width: 12, height: 12, channels: 3, background: { r: 45, g: 60, b: 70 } } }).png().toBuffer();

  // Perfil: la web recorta la foto (y pierde los metadatos), así que avisa con `ai` lo que traía el original
  const declared = await upload("/api/me/photos", ana, plain, "recorte.png", { ai: "generated" });
  assert.equal(declared.status, 200);
  assert.equal(((await declared.json()) as { ai: string | null }).ai, "generated");
  const normal = await upload("/api/me/photos", ana, plain, "normal.png");
  assert.equal(((await normal.json()) as { ai: string | null }).ai, null);
  // Y si el archivo llega entero con la marca, el servidor la ve solo
  const direct = await upload("/api/me/photos", ana, fixture("c2pa-generated.jpg"), "ia.jpg");
  assert.equal(((await direct.json()) as { ai: string | null }).ai, "generated");
  // Un valor inventado no se guarda
  const junk = await upload("/api/me/photos", ana, plain, "otra.png", { ai: "<script>" });
  assert.equal(((await junk.json()) as { ai: string | null }).ai, null);

  const profile = await (await request(`/api/users/${ana.id}`, beto)).json() as { photos: string[]; photosAi: (string | null)[] };
  assert.equal(profile.photos.length, 4);
  assert.deepEqual(profile.photosAi, ["generated", null, "generated", null]);
  const me = await (await request("/api/me", ana)).json() as { photos: { ai: string | null }[] };
  assert.deepEqual(me.photos.map((p) => p.ai), ["generated", null, "generated", null]);

  // Lo guardado no conserva los metadatos (privacidad): la marca vive solo en la base
  const key = profile.photos[2].split("/").pop()!;
  const stored = await readImage(key);
  assert.ok(stored);
  assert.equal(await detectAiProvenance(stored), null);

  // Mensaje privado con foto: el archivo llega sin tocar y el servidor detecta la marca
  const conv = await request("/api/conversations", ana, json("POST", { userId: beto.id }));
  const conversationId = ((await conv.json()) as { id: string }).id;
  const sent = await upload(`/api/conversations/${conversationId}/messages`, ana, fixture("c2pa-generated.png"), "ia.png");
  assert.equal(sent.status, 200);
  assert.equal(((await sent.json()) as { photoAi: string | null }).photoAi, "generated");
  const edited = await upload(`/api/conversations/${conversationId}/messages`, ana, fixture("c2pa-edited.jpg"), "retocada.jpg");
  assert.equal(((await edited.json()) as { photoAi: string | null }).photoAi, "edited");
  const camera = await upload(`/api/conversations/${conversationId}/messages`, ana, fixture("c2pa-camera.jpg"), "camara.jpg", { expiring: "1" });
  assert.equal(((await camera.json()) as { photoAi: string | null }).photoAi, null);
  const list = await (await request(`/api/conversations/${conversationId}/messages`, beto)).json() as { messages?: { photoAi: string | null }[] } | { photoAi: string | null }[];
  const messages = Array.isArray(list) ? list : list.messages ?? [];
  assert.deepEqual(messages.map((m) => m.photoAi).sort(), ["edited", "generated", null].sort());

  // Foto del grupo
  const groupId = randomUUID();
  await db.insert(schema.group).values({ id: groupId, name: "Mateadas" });
  await db.insert(schema.groupMember).values({ groupId, userId: ana.id, role: "owner" });
  const groupPhoto = await upload(`/api/groups/${groupId}/photo`, ana, fixture("c2pa-reopened.jpg"), "grupo.jpg");
  assert.equal(groupPhoto.status, 200);
  assert.equal(((await groupPhoto.json()) as { photoAi: string | null }).photoAi, "generated");
  const info = await (await request(`/api/groups/${groupId}`, ana)).json() as { photoAi: string | null };
  assert.equal(info.photoAi, "generated");
  assert.equal((await request(`/api/groups/${groupId}/photo`, ana, { method: "DELETE" })).status, 200);
  const cleared = await (await request(`/api/groups/${groupId}`, ana)).json() as { photoAi: string | null };
  assert.equal(cleared.photoAi, null);
});
