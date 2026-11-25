import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import type { AppEnv } from "./lib.js";

/**
 * Reportes de mala fe (reportSpam.ts): las señales de proporción de descartados, de reportes que nunca terminan en una
 * medida y de cuentas nuevas que reportan juntas a la misma persona; y "que sus reportes no cuenten", que saca esos
 * reportes de la ocultación automática, de la cuenta de personas y de la suspensión preventiva.
 */
test("reportes de mala fe: señales y reportes que no cuentan", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "qule-mala-fe-"));
  const origin = "http://localhost:3001";
  Object.assign(process.env, {
    DATABASE_URL: "", DATA_DIR: dataDir, NODE_ENV: "test", APP_URL: origin, SMTP_URL: "",
    VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", BETTER_AUTH_SECRET: "clave-local-de-pruebas-de-reportes-de-mala-fe",
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
  const { eq, inArray } = await import("drizzle-orm");
  const { auth } = await import("./auth.js");
  const { adminRoutes } = await import("./routes/admin.js");
  const { socialRoutes } = await import("./routes/social.js");
  const { autoHiddenUsers } = await import("./moderation.js");
  const { reportSpamAlerts } = await import("./reportSpam.js");

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
  const DAY = 86_400_000;
  /** Una cuenta. daysOld: cuántos días hace que se creó (las de prueba nacen todas juntas; así se separan). */
  async function account(name: string, daysOld = 0): Promise<Account> {
    const res = await request("/api/auth/sign-up/email", undefined, json("POST", {
      name, email: `${name.toLowerCase()}@example.test`, password: "una frase sintética de prueba",
    }));
    assert.equal(res.status, 200);
    const { user } = await res.json() as { user: { id: string } };
    const cookie = res.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    await db.insert(schema.profile).values({ userId: user.id, displayName: name, birthdate: "1990-01-01" });
    if (daysOld) await db.update(schema.user).set({ createdAt: new Date(Date.now() - daysOld * DAY) }).where(eq(schema.user.id, user.id));
    return { id: user.id, cookie };
  }
  const report = (who: Account, target: Account, reason = "perfil falso") =>
    request("/api/reports", who, json("POST", { userId: target.id, reason }));
  const signalsOf = async (id: string) => (await reportSpamAlerts()).find((a) => a.reporterId === id)?.signals.map((s) => s.kind) ?? [];

  const owner = await account("Mod", 400);
  const sanciones = await account("Sanciones", 300);
  const ayuda = await account("Ayuda", 200);
  await db.insert(schema.staffPermission).values([
    { userId: sanciones.id, permission: "sanctions" },
    { userId: ayuda.id, permission: "reports" },
  ]);

  // ---------- Proporción de descartados y reportes que nunca terminan en una medida ----------
  const quejosa = await account("Quejosa", 100);
  const atenta = await account("Atenta", 110);
  const otros = await Promise.all(["A", "B", "C", "D", "E", "F"].map((n, i) => account(`Otro${n}`, 120 + i * 10)));
  for (const o of otros.slice(0, 4)) {
    assert.equal((await report(quejosa, o)).status, 200);
    assert.equal((await report(atenta, o)).status, 200);
  }
  const resolve = async (who: Account, status: "dismissed" | "actioned") =>
    // Revisados, y de hace unos días (así no cuentan como ráfaga de la última hora)
    db.update(schema.report).set({ status, createdAt: new Date(Date.now() - 3 * DAY) }).where(eq(schema.report.reporterId, who.id));
  await resolve(quejosa, "dismissed");
  await resolve(atenta, "actioned");
  assert.deepEqual(await signalsOf(quejosa.id), [], "con 4 revisados todavía no dice nada");
  assert.equal((await report(quejosa, otros[4])).status, 200);
  assert.equal((await report(atenta, otros[4])).status, 200);
  await resolve(quejosa, "dismissed");
  await resolve(atenta, "actioned");
  assert.deepEqual(await signalsOf(quejosa.id), ["dismissed"], "5 de 5 descartados");
  assert.deepEqual(await signalsOf(atenta.id), [], "a quien reporta de buena fe no le aparece nada");

  // Muchos reportes a lo largo de los días, sin ninguno que termine en una medida (aunque falte revisarlos)
  const insistente = await account("Insistente", 90);
  const viejos = Array.from({ length: 15 }, (_, i) => ({
    id: `viejo-${i}`, reporterId: insistente.id, targetUserId: otros[i % otros.length].id, reason: "spam",
    status: i < 2 ? "dismissed" : "open", createdAt: new Date(Date.now() - (i + 2) * DAY),
  }));
  await db.insert(schema.report).values(viejos.slice(0, 14));
  assert.deepEqual(await signalsOf(insistente.id), []);
  await db.insert(schema.report).values(viejos[14]);
  assert.deepEqual(await signalsOf(insistente.id), ["noAction"]);
  // Si alguno termina en una medida, ya no
  await db.update(schema.report).set({ status: "actioned" }).where(eq(schema.report.id, "viejo-3"));
  assert.deepEqual(await signalsOf(insistente.id), []);

  // ---------- Cuentas nuevas que reportan juntas a la misma persona ----------
  const blanco = await account("Blanco", 500);
  const vieja = await account("Vieja", 250);
  const nuevas = await Promise.all(["N1", "N2", "N3"].map((n) => account(n)));
  for (const n of nuevas.slice(0, 2)) assert.equal((await report(n, blanco, "menor de edad")).status, 200);
  assert.deepEqual(await signalsOf(nuevas[0].id), [], "dos cuentas no alcanzan");
  assert.equal((await report(vieja, blanco, "menor de edad")).status, 200);
  assert.deepEqual(await signalsOf(nuevas[0].id), ["pileOn"]);
  assert.deepEqual(await signalsOf(vieja.id), [], "quien reportó lo mismo desde una cuenta vieja no aparece");
  // Tres reportes urgentes de personas distintas: el perfil se oculta de la grilla por precaución
  assert.ok((await autoHiddenUsers()).has(blanco.id));

  // ---------- Que sus reportes no cuenten ----------
  // Solo con Suspensiones (o la administración general)
  assert.equal((await request(`/api/admin/report-spam/${nuevas[0].id}/mute`, ayuda, json("POST", {}))).status, 403);
  for (const n of nuevas.slice(0, 2)) {
    const res = await request(`/api/admin/report-spam/${n.id}/mute`, sanciones, json("POST", { reason: "Cuentas nuevas que reportan juntas" }));
    assert.equal(res.status, 200);
  }
  assert.ok(!(await autoHiddenUsers()).has(blanco.id), "con un solo reporte que cuenta, vuelve a la grilla");
  const panel = await (await request("/api/admin/report-spam", sanciones)).json() as {
    alerts: { reporterId: string }[]; muted: { reporterId: string; reporter: unknown; reason: string }[];
  };
  assert.ok(!panel.alerts.some((a) => a.reporterId === nuevas[0].id), "ya decidido: sale de las tarjetas");
  assert.deepEqual(panel.muted.map((m) => m.reporterId).sort(), nuevas.slice(0, 2).map((n) => n.id).sort());
  assert.equal(panel.muted[0].reporter, null, "sin nombre si no es administración general");
  // En los reportes se ven igual, marcados, y no suman personas
  const reports = await (await request("/api/admin/reports", sanciones)).json() as
    { subject: string; subjectReporters: number; reporterMuted: boolean }[];
  const deBlanco = reports.filter((r) => r.subject === `u:${blanco.id}`);
  assert.equal(deBlanco.length, 3, "los reportes siguen en la lista");
  assert.equal(deBlanco.filter((r) => r.reporterMuted).length, 2);
  assert.ok(deBlanco.every((r) => r.subjectReporters === 1));
  // A quien reporta no se le dice nada: el reporte entra como siempre
  assert.equal((await report(nuevas[0], otros[5])).status, 200);

  // ---------- Suspensión preventiva ----------
  // Ayuda (solo Reportes) no puede suspender con reportes de cuentas que no cuentan
  const sospechado = await account("Sospechado", 600);
  for (const n of nuevas.slice(0, 2)) assert.equal((await report(n, sospechado, "menor de edad")).status, 200);
  const sinBase = await request(`/api/admin/users/${sospechado.id}/suspend`, ayuda, json("POST", { reason: "Parece menor" }));
  assert.equal(sinBase.status, 403);
  // Volver a contar: ahora sí alcanza
  assert.equal((await request(`/api/admin/report-spam/${nuevas[0].id}/unmute`, sanciones, { method: "POST" })).status, 200);
  const conBase = await request(`/api/admin/users/${sospechado.id}/suspend`, ayuda, json("POST", { reason: "Parece menor" }));
  assert.equal(conBase.status, 200);

  // Todo queda en el registro
  const log = await db.select({ action: schema.modAction.action }).from(schema.modAction)
    .where(inArray(schema.modAction.targetId, nuevas.map((n) => n.id)));
  assert.equal(log.filter((l) => l.action.includes("dejen de contar")).length, 2);
  assert.equal(log.filter((l) => l.action.includes("vuelvan a contar")).length, 1);
});
