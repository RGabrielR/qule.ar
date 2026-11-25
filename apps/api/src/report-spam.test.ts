import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import type { AppEnv } from "./lib.js";

/**
 * Alerta de spam de reportes (reportSpam.ts, discusión #219): salta con 5 personas distintas en una hora, no esconde
 * nada, y moderación puede descartar todo de una vez, ignorarla o suspender a quien reporta.
 */
test("alerta de spam de reportes", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "qule-spam-reportes-"));
  const origin = "http://localhost:3001";
  Object.assign(process.env, {
    DATABASE_URL: "", DATA_DIR: dataDir, NODE_ENV: "test", APP_URL: origin, SMTP_URL: "",
    VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", BETTER_AUTH_SECRET: "clave-local-de-pruebas-de-spam-de-reportes",
  });
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
  const { socialRoutes } = await import("./routes/social.js");
  const { recentReportTargets, reportSpamAlerts, REPORT_SPAM_TARGETS } = await import("./reportSpam.js");

  const app = new Hono<AppEnv>();
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.route("/api", socialRoutes);
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
  const helper = await account("Ayuda");
  const ricardo = await account("Ricardo");
  const ana = await account("Ana");
  const people = await Promise.all(["Uno", "Dos", "Tres", "Cuatro", "Cinco", "Seis"].map(account));
  await db.insert(schema.staffPermission).values([
    { userId: mod.id, permission: "sanctions" },
    { userId: helper.id, permission: "reports" },
  ]);

  const report = (who: Account, target: Account, reason = "perfil falso") =>
    request("/api/reports", who, json("POST", { userId: target.id, reason }));

  // Reportar varias veces a la misma persona no cuenta: Ana reporta 6 veces a Uno
  for (let i = 0; i < 6; i++) assert.equal((await report(ana, people[0])).status, 200);
  assert.equal(await recentReportTargets(ana.id), 1);

  // Ricardo reporta a 4 personas: todavía no hay alerta
  for (const p of people.slice(0, 4)) assert.equal((await report(ricardo, p)).status, 200);
  assert.deepEqual(await reportSpamAlerts(), []);

  // Con la quinta persona distinta salta la alerta
  assert.equal((await report(ricardo, people[4], "amenazas o violencia")).status, 200);
  const alerts = await reportSpamAlerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].reporterId, ricardo.id);
  assert.equal(alerts[0].targets, REPORT_SPAM_TARGETS);
  assert.deepEqual(alerts[0].history, { total: 5, open: 5, dismissed: 0, actioned: 0 });

  // Los reportes no se esconden: siguen todos abiertos
  const open = await db.select().from(schema.report).where(eq(schema.report.reporterId, ricardo.id));
  assert.equal(open.filter((r) => r.status === "open").length, 5);

  // Solo quien tiene Suspensiones (o la administración general) ve la alerta; sin nombre si no es administración general
  assert.equal((await request("/api/admin/report-spam", helper)).status, 403);
  const seen = await request("/api/admin/report-spam", mod);
  assert.equal(seen.status, 200);
  const { alerts: list } = await seen.json() as { alerts: { reporterId: string; reporter: unknown }[] };
  assert.equal(list[0].reporterId, ricardo.id);
  assert.equal(list[0].reporter, null, "quién reporta con nombre solo lo ve la administración general");

  // Descartar todos sus reportes abiertos de una vez
  const dismissed = await request(`/api/admin/report-spam/${ricardo.id}/dismiss`, mod, { method: "POST" });
  assert.equal((await dismissed.json() as { dismissed: number }).dismissed, 5);
  const after = await db.select().from(schema.report).where(eq(schema.report.reporterId, ricardo.id));
  assert.ok(after.every((r) => r.status === "dismissed"));
  assert.equal((await reportSpamAlerts())[0].history.dismissed, 5);

  // Ignorar: la alerta se va (hasta que vuelva a saltar en otra ventana)
  assert.equal((await request(`/api/admin/report-spam/${ricardo.id}/ignore`, mod, { method: "POST" })).status, 200);
  assert.deepEqual(await reportSpamAlerts(), []);

  // Suspender a quien reporta: tampoco aparece más
  await db.delete(schema.modAction);
  assert.equal((await reportSpamAlerts()).length, 1, "sin el ignorar, vuelve");
  const suspended = await request(`/api/admin/users/${ricardo.id}/suspend`, mod, json("POST", { reason: "Spam de reportes" }));
  assert.equal(suspended.status, 200);
  assert.deepEqual(await reportSpamAlerts(), []);
  assert.equal((await report(ricardo, people[5])).status, 401, "sin sesión no puede seguir reportando");
});
