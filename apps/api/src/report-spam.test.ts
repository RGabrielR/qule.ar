import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import type { AppEnv } from "./lib.js";

/**
 * Alerta de spam de reportes (reportSpam.ts, discusión #219): salta con 5 personas distintas en una hora, no esconde
 * nada, y moderación puede descartar sus reportes de la hora (sin tocar los urgentes), ignorarla o suspender a quien
 * reporta. El equipo actúa con el identificador de la alerta, sin ver de qué cuenta es.
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
  const { recentReportTargets, reportSpamAlerts, reportSpamStatus, REPORT_SPAM_TARGETS, REPORT_SPAM_WINDOW_MS } = await import("./reportSpam.js");

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

  // Un reporte de Ricardo de antes de la ventana: no cuenta para la alerta ni se descarta en bloque
  const oldId = crypto.randomUUID();
  await db.insert(schema.report).values({
    id: oldId, reporterId: ricardo.id, targetUserId: people[5].id, reason: "perfil falso",
    createdAt: new Date(Date.now() - 2 * REPORT_SPAM_WINDOW_MS),
  });

  // Ricardo reporta a 4 personas: todavía no hay alerta
  for (const p of people.slice(0, 4)) assert.equal((await report(ricardo, p)).status, 200);
  assert.deepEqual(await reportSpamAlerts(), []);

  // Con la quinta persona distinta salta la alerta (ese último reporte es urgente)
  assert.equal((await report(ricardo, people[4], "amenazas o violencia")).status, 200);
  const alerts = await reportSpamAlerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].reporterId, ricardo.id);
  assert.equal(alerts[0].targets, REPORT_SPAM_TARGETS);
  assert.equal(alerts[0].dismissable, 4, "el urgente y el viejo no se descartan en bloque");
  assert.deepEqual(alerts[0].history, { total: 6, open: 6, dismissed: 0, actioned: 0 });
  assert.equal((await reportSpamStatus(ricardo.id)).flagged, true, "en alerta, lo urgente no avisa al instante");

  // Los reportes no se esconden: siguen todos abiertos
  const open = await db.select().from(schema.report).where(eq(schema.report.reporterId, ricardo.id));
  assert.equal(open.filter((r) => r.status === "open").length, 6);

  // Solo quien tiene Suspensiones (o la administración general) ve la alerta. Sin nombre ni id de la cuenta
  assert.equal((await request("/api/admin/report-spam", helper)).status, 403);
  const seen = await request("/api/admin/report-spam", mod);
  assert.equal(seen.status, 200);
  const list = await seen.json() as { id: string; reporterId?: string; reporter: unknown; dismissable: number }[];
  assert.equal(list[0].reporter, null, "quién reporta con nombre solo lo ve la administración general");
  assert.equal(list[0].reporterId, undefined, "con el id se podría saber quién reporta");
  assert.ok(list[0].id && list[0].id !== ricardo.id);
  assert.ok(!JSON.stringify(list).includes(ricardo.id));
  const key = list[0].id;
  assert.equal((await request(`/api/admin/report-spam/${ricardo.id}/dismiss`, mod, { method: "POST" })).status, 404,
    "se actúa con el identificador de la alerta, no con el de la cuenta");

  // Descartar en bloque: solo los de la hora y no urgentes
  const dismissed = await request(`/api/admin/report-spam/${key}/dismiss`, mod, { method: "POST" });
  assert.equal((await dismissed.json() as { dismissed: number }).dismissed, 4);
  const after = await db.select().from(schema.report).where(eq(schema.report.reporterId, ricardo.id));
  assert.equal(after.filter((r) => r.status === "dismissed").length, 4);
  assert.equal(after.find((r) => r.reason === "amenazas o violencia")?.status, "open", "lo urgente se revisa de a uno");
  assert.equal(after.find((r) => r.id === oldId)?.status, "open", "lo de antes de la alerta tampoco se toca");
  assert.equal((await reportSpamAlerts())[0].history.dismissed, 4);

  // Ignorar: la alerta se va y sus reportes urgentes vuelven a avisar al instante
  assert.equal((await request(`/api/admin/report-spam/${key}/ignore`, mod, { method: "POST" })).status, 200);
  assert.deepEqual(await reportSpamAlerts(), []);
  assert.equal((await reportSpamStatus(ricardo.id)).flagged, false, "ignorada, lo urgente avisa de nuevo");
  assert.equal((await request(`/api/admin/report-spam/${key}/ignore`, mod, { method: "POST" })).status, 404, "ya no está activa");

  // Suspender a quien reporta desde la alerta: tampoco aparece más
  await db.delete(schema.modAction);
  assert.equal((await reportSpamAlerts()).length, 1, "sin el ignorar, vuelve");
  const suspended = await request(`/api/admin/report-spam/${key}/suspend`, mod, json("POST", { reason: "Spam de reportes" }));
  assert.equal(suspended.status, 200);
  assert.deepEqual(await reportSpamAlerts(), []);
  assert.equal((await report(ricardo, people[5])).status, 401, "sin sesión no puede seguir reportando");
});
