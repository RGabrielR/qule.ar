import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import type { AppEnv } from "./lib.js";

/**
 * Historial de una cuenta en la mesa de moderación: los reportes sobre ella, lo que hizo moderación, sus pedidos de
 * revisión y los reportes que hizo. Sin quién reportó; quién de moderación actuó lo ve solo la administración general.
 */
test("historial completo de una cuenta para moderación", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "qule-historial-"));
  const origin = "http://localhost:3001";
  process.env.DATABASE_URL = "";
  process.env.DATA_DIR = dataDir;
  process.env.DATA_KEY = randomBytes(32).toString("base64");
  process.env.NODE_ENV = "test";
  process.env.APP_URL = origin;
  process.env.SMTP_URL = "";
  process.env.VAPID_PUBLIC_KEY = "";
  process.env.VAPID_PRIVATE_KEY = "";
  process.env.BETTER_AUTH_SECRET = "clave-local-de-pruebas-de-historial-qule";
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
  const juan = await account("Juan");
  const vera = await account("Vera");
  const nico = await account("Nico");
  const lola = await account("Lola");
  env.ADMIN_USER_IDS.push(gabi.id);
  await db.insert(schema.staffPermission).values([{ userId: juan.id, permission: "reports" }, { userId: juan.id, permission: "sanctions" }]);

  // Nico fue reportado tres veces (una ya descartada) y él reportó dos veces a Lola (una descartada)
  const day = 24 * 60 * 60_000;
  await db.insert(schema.report).values([
    { id: "rep-viejo", reporterId: vera.id, targetUserId: nico.id, reason: "spam", details: "Links raros", status: "dismissed", resolution: "Descartado", resolvedBy: gabi.id, resolvedAt: new Date(Date.now() - 9 * day), createdAt: new Date(Date.now() - 10 * day) },
    { id: "rep-acoso", reporterId: vera.id, targetUserId: nico.id, reason: "acoso", details: "No para de escribir", createdAt: new Date(Date.now() - day) },
    { id: "rep-lola", reporterId: lola.id, targetUserId: nico.id, reason: "acoso", createdAt: new Date() },
    { id: "rep-de-nico-1", reporterId: nico.id, targetUserId: lola.id, reason: "spam", status: "dismissed", resolution: "Descartado" },
    { id: "rep-de-nico-2", reporterId: nico.id, targetUserId: lola.id, reason: "spam" },
  ]);
  await db.insert(schema.modAction).values([
    { id: "a1", actorId: gabi.id, action: "Descartó un reporte", targetId: "rep-viejo", createdAt: new Date(Date.now() - 9 * day) },
    // Mirar fotos es sobre moderación, no sobre la cuenta: no va en el historial
    { id: "a2", actorId: juan.id, action: "Vio la captura adjunta a un reporte", targetId: "rep-acoso" },
    { id: "a3", actorId: gabi.id, action: "Cambió permisos", targetId: nico.id, details: "Reportes" },
    // De otra cuenta: no va
    { id: "a4", actorId: gabi.id, action: "Reactivó una cuenta", targetId: lola.id },
  ]);

  // Juan suspende a Nico desde la mesa y Nico pide la revisión
  assert.equal((await request(`/api/admin/users/${nico.id}/suspend`, juan, { method: "POST", body: JSON.stringify({ reason: "Acoso a varias personas" }) })).status, 200);
  const { eq } = await import("drizzle-orm");
  const [p] = await db.select().from(schema.profile).where(eq(schema.profile.userId, nico.id));
  await db.insert(schema.appeal).values({ id: "ap1", userId: nico.id, suspendedAt: p!.suspendedAt!, suspendReason: p!.suspendReason, suspendedBy: juan.id, body: "Fue un malentendido" });

  type History = {
    createdAt: string; suspendedAt: string | null; suspendReason: string | null; reportCount: number;
    reports: { id: string; reason: string; status: string; automatic: boolean; reporterId?: string }[];
    reportsMade: { total: number; dismissed: number; mutedAt: string | null };
    actions: { action: string; actor: string | null; details: string | null; reportId: string | null }[];
    appeals: { status: string; body: string | null; suspendReason: string | null }[];
    more: boolean;
  };
  const history = async (who: Account, id = nico.id) => {
    const res = await request(`/api/admin/users/${id}/history`, who);
    return { status: res.status, body: res.status === 200 ? await res.json() as History : null };
  };

  // Solo moderación con permiso de reportes o suspensiones
  assert.equal((await history(vera)).status, 403);
  assert.equal((await history(juan, "no-existe")).status, 404);

  const { body: forJuan } = await history(juan);
  assert.ok(forJuan);
  assert.equal(forJuan.suspendReason, "Acoso a varias personas");
  assert.equal(forJuan.reportCount, 3);
  assert.deepEqual(forJuan.reports.map((r) => r.id), ["rep-lola", "rep-acoso", "rep-viejo"]);
  assert.ok(forJuan.reports.every((r) => !("reporterId" in r)), "no dice quién reportó");
  assert.deepEqual(forJuan.reportsMade, { total: 2, dismissed: 1, mutedAt: null });
  const juanActions = forJuan.actions.map((a) => a.action);
  assert.ok(juanActions.includes("Suspendió una cuenta"));
  assert.ok(juanActions.includes("Descartó un reporte"));
  assert.ok(!juanActions.includes("Vio la captura adjunta a un reporte"));
  assert.ok(!juanActions.includes("Cambió permisos"), "los permisos del equipo son de la administración general");
  assert.ok(!juanActions.includes("Reactivó una cuenta"));
  assert.ok(forJuan.actions.every((a) => a.actor === null), "no dice quién de moderación actuó");
  // Sin el permiso Revisiones: se ve que pidió la revisión, no lo que escribió
  assert.equal(forJuan.appeals.length, 1);
  assert.equal(forJuan.appeals[0]!.status, "open");
  assert.equal(forJuan.appeals[0]!.body, null);
  assert.equal(forJuan.actions.find((a) => a.action === "Descartó un reporte")?.reportId, "rep-viejo");
  assert.equal(forJuan.actions.find((a) => a.action === "Suspendió una cuenta")?.reportId, null);
  assert.equal(forJuan.more, false);

  const { body: forGabi } = await history(gabi);
  assert.ok(forGabi);
  assert.ok(forGabi.actions.some((a) => a.action === "Cambió permisos"));
  assert.equal(forGabi.actions.find((a) => a.action === "Suspendió una cuenta")?.actor, "Juan");
  assert.equal(forGabi.actions.find((a) => a.action === "Descartó un reporte")?.actor, "Gabi");
  assert.equal(forGabi.appeals[0]!.body, "Fue un malentendido");
});
