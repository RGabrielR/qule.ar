import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import type { AppEnv } from "./lib.js";

/** Personas: solo la administración general busca cuentas y ve su rol y su estado, sin ver mails. */
test("la pestaña Personas es solo para la administración general", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "qule-personas-"));
  const origin = "http://localhost:3001";
  process.env.DATABASE_URL = "";
  process.env.DATA_DIR = dataDir;
  process.env.DATA_KEY = randomBytes(32).toString("base64");
  process.env.NODE_ENV = "test";
  process.env.APP_URL = origin;
  process.env.SMTP_URL = "";
  process.env.BETTER_AUTH_SECRET = "clave-local-de-pruebas-de-personas-qule";
  process.env.ADMIN_USER_IDS = "";
  let close: (() => Promise<void>) | undefined;
  t.after(async () => {
    try { await close?.(); } finally { await rm(dataDir, { recursive: true, force: true }); }
  });

  t.mock.method(console, "log", () => {});
  const { db, closeDb, runMigrations, schema } = await import("./db/index.js");
  close = closeDb;
  await runMigrations();
  const { env } = await import("./env.js");
  const { auth } = await import("./auth.js");
  const { adminRoutes } = await import("./routes/admin.js");
  const app = new Hono<AppEnv>();
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.route("/api", adminRoutes);

  type Account = { id: string; cookie: string };
  const request = (url: string, account?: Account, init?: RequestInit) => {
    const headers = new Headers({ origin, ...(init?.body ? { "content-type": "application/json" } : {}) });
    if (account) headers.set("cookie", account.cookie);
    return app.request(new URL(url, origin), { ...init, headers });
  };
  async function account(name: string): Promise<Account> {
    const res = await app.request(new URL("/api/auth/sign-up/email", origin), {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ name, email: `${name.toLowerCase()}@example.test`, password: "una frase sintética de prueba" }),
    });
    assert.equal(res.status, 200);
    const { user } = await res.json() as { user: { id: string } };
    await db.insert(schema.profile).values({ userId: user.id, displayName: name, birthdate: "1990-01-01" });
    return { id: user.id, cookie: res.headers.getSetCookie().map((v) => v.split(";", 1)[0]).join("; ") };
  }

  const gabi = await account("Gabi");
  const axel = await account("Axel");
  const juan = await account("Juan");
  const tito = await account("Tito");
  await account("Titina");
  env.ADMIN_USER_IDS.push(gabi.id, axel.id);
  await db.insert(schema.staffPermission).values([
    { userId: juan.id, permission: "reports" }, { userId: juan.id, permission: "sanctions" },
  ]);
  const { eq } = await import("drizzle-orm");
  await db.update(schema.profile).set({ suspendedAt: new Date(), suspendReason: "Spam" }).where(eq(schema.profile.userId, tito.id));

  type Person = { id: string; name: string; owner: boolean; permissions: string[]; suspendedAt: string | null; suspendReason: string | null; email?: string };
  const search = (who: Account, body: Record<string, string> = {}) => request("/api/admin/people", who, {
    method: "POST", body: JSON.stringify(body),
  });
  const people = async (who: Account, body: Record<string, string>) => {
    const res = await search(who, body);
    assert.equal(res.status, 200);
    return (await res.json() as { people: Person[] }).people;
  };

  // Moderación con permisos chicos no entra; la administración general sí (los dos)
  assert.equal((await search(juan)).status, 403);
  assert.equal((await search(tito)).status, 403);
  const ok = await search(axel);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");

  // Buscar por nombre, sin que salga el mail
  const found = await people(gabi, { q: "tit" });
  assert.deepEqual(found.map((p) => p.name).sort(), ["Tito", "Titina"].sort());
  assert.ok(found.every((p) => !("email" in p)), "no muestra mails");
  // Por mail exacto o por ID
  assert.deepEqual((await people(gabi, { q: "JUAN@example.test" })).map((p) => p.name), ["Juan"]);
  assert.deepEqual((await people(gabi, { q: axel.id })).map((p) => p.name), ["Axel"]);
  // Por el código de ocho caracteres de la marca visible de una captura
  assert.ok((await people(gabi, { q: axel.id.slice(0, 8) })).some((p) => p.name === "Axel"));
  // Un % no es un comodín
  assert.deepEqual(await people(gabi, { q: "%" }), []);

  // Equipo: la administración general y quien tiene permisos
  const staff = await people(gabi, { filter: "staff" });
  assert.deepEqual(staff.map((p) => p.name).sort(), ["Axel", "Gabi", "Juan"]);
  assert.equal(staff.find((p) => p.name === "Axel")?.owner, true);
  assert.deepEqual(staff.find((p) => p.name === "Juan")?.permissions.sort(), ["reports", "sanctions"]);

  // Suspendidas, con el motivo
  const suspended = await people(gabi, { filter: "suspended" });
  assert.deepEqual(suspended.map((p) => [p.name, p.suspendReason]), [["Tito", "Spam"]]);
});
