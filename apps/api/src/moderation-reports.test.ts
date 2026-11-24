import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import type { AppEnv } from "./lib.js";

/**
 * Panel de reportes: cada reporte dice de qué tema es y cuántas personas lo reportaron, se pueden descartar varios
 * de una vez, y borrar un mensaje cierra todos los reportes de ese mensaje. También el aviso urgente aparte.
 */
test("reportes agrupados por tema, descarte en bloque y avisos de moderación", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "qule-reportes-"));
  const origin = "http://localhost:3001";
  process.env.DATABASE_URL = "";
  process.env.DATA_DIR = dataDir;
  process.env.NODE_ENV = "test";
  process.env.APP_URL = origin;
  process.env.SMTP_URL = "";
  process.env.VAPID_PUBLIC_KEY = "";
  process.env.VAPID_PRIVATE_KEY = "";
  process.env.BETTER_AUTH_SECRET = "clave-local-de-pruebas-de-reportes-qule";
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
  const { eq, inArray } = await import("drizzle-orm");
  const { auth } = await import("./auth.js");
  const { adminRoutes } = await import("./routes/admin.js");
  const { meRoutes } = await import("./routes/me.js");
  const { NOTIFY_KINDS } = await import("./push.js");

  const app = new Hono<AppEnv>();
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.route("/api", meRoutes);
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

  const mod = await account("Mod");
  const target = await account("Tito");
  const ana = await account("Ana");
  const bea = await account("Bea");
  await db.insert(schema.staffPermission).values({ userId: mod.id, permission: "reports" });

  // Un mensaje privado de Tito a Ana, que reportan Ana y Bea (Bea, por una captura)
  const [a, b] = [ana.id, target.id].sort();
  await db.insert(schema.conversation).values({ id: "conv1", userA: a, userB: b });
  await db.insert(schema.directMessage).values({ id: "msg1", conversationId: "conv1", senderId: target.id, body: "hola" });
  const base = { targetUserId: target.id, targetName: "Tito" };
  await db.insert(schema.report).values([
    { id: "r1", reporterId: ana.id, ...base, reason: "acoso", messageId: "msg1", messageKind: "dm", createdAt: new Date("2026-11-20T10:00:00Z") },
    { id: "r2", reporterId: bea.id, ...base, reason: "acoso", messageId: "msg1", messageKind: "dm", createdAt: new Date("2026-11-21T10:00:00Z") },
    { id: "r3", reporterId: ana.id, ...base, reason: "perfil falso", createdAt: new Date("2026-11-22T10:00:00Z") },
  ]);

  type Out = { id: string; subject: string; subjectReporters: number; reporter: unknown };
  const list = await request("/api/admin/reports?status=open", mod);
  assert.equal(list.status, 200);
  const reports = await list.json() as Out[];
  assert.deepEqual(reports.map((r) => r.id), ["r3", "r2", "r1"], "del más nuevo al más viejo");
  assert.ok(reports.every((r) => r.subject === `u:${target.id}`), "los tres son del mismo tema");
  assert.ok(reports.every((r) => r.subjectReporters === 2), "dos personas distintas");
  assert.ok(reports.every((r) => r.reporter === null), "quién reportó no lo ve el equipo");

  // Borrar el mensaje cierra los dos reportes de ese mensaje, no el del perfil
  assert.equal((await request("/api/admin/reports/r1/delete-message", mod, { method: "POST" })).status, 200);
  const after = await db.select({ id: schema.report.id, status: schema.report.status }).from(schema.report);
  const status = Object.fromEntries(after.map((r) => [r.id, r.status]));
  assert.deepEqual(status, { r1: "actioned", r2: "actioned", r3: "open" });

  // Descartar en bloque: solo cierra los abiertos y dice cuántos
  const dismissed = await request("/api/admin/reports/dismiss", mod, json("POST", { ids: ["r1", "r2", "r3"] }));
  assert.equal(dismissed.status, 200);
  assert.equal((await dismissed.json() as { dismissed: number }).dismissed, 1);
  const [r3] = await db.select().from(schema.report).where(eq(schema.report.id, "r3"));
  assert.equal(r3.status, "dismissed");
  const kept = await db.select().from(schema.report).where(inArray(schema.report.id, ["r1", "r2"]));
  assert.ok(kept.every((r) => r.resolution === "Mensaje borrado"), "los ya resueltos no cambian");

  // Sin permiso Reportes no se puede descartar
  assert.equal((await request("/api/admin/reports/dismiss", ana, json("POST", { ids: ["r3"] }))).status, 403);

  // El aviso urgente se puede apagar como cualquier otro
  assert.ok(NOTIFY_KINDS.includes("moderacion_urgente"));
  const prefs = await request("/api/me/notificaciones", mod, json("PUT", { moderacion_urgente: false }));
  assert.equal(prefs.status, 200);
  assert.equal((await prefs.json() as { notifyPrefs: Record<string, boolean> }).notifyPrefs.moderacion_urgente, false);
});
