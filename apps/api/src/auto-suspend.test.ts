import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import type { AppEnv } from "./lib.js";

/**
 * Suspensión automática (autoSuspend.ts): 5 personas distintas que reportan a la misma cuenta por lo mismo en 3
 * semanas, sin que moderación lo revise en 24 h, la suspenden. Cuentas recién creadas, "otro", reportes descartados
 * o viejos no cuentan. Al equipo no se lo suspende solo. La suspensión queda para revisar.
 */
test("suspensión automática por reportes de varias personas", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "qule-suspension-automatica-"));
  const origin = "http://localhost:3001";
  Object.assign(process.env, {
    DATABASE_URL: "", DATA_DIR: dataDir, NODE_ENV: "test", APP_URL: origin, SMTP_URL: "",
    VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", BETTER_AUTH_SECRET: "clave-local-de-pruebas-de-suspension-automatica",
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
  const { and, eq, inArray } = await import("drizzle-orm");
  const { auth } = await import("./auth.js");
  const { adminRoutes } = await import("./routes/admin.js");
  const { socialRoutes } = await import("./routes/social.js");
  const { autoSuspendCandidates, pendingAutoSuspensions, runAutoSuspensions, AUTO_SUSPENDED } = await import("./autoSuspend.js");

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

  const HOUR = 3_600_000;
  const now = new Date();
  const ago = (h: number) => new Date(now.getTime() - h * HOUR);
  const mod = await account("Mod");
  const tito = await account("Tito");
  const lola = await account("Lola");
  const vieja = await account("Vieja");
  const team = await account("Equipo");
  const people = await Promise.all(["Uno", "Dos", "Tres", "Cuatro", "Cinco", "Seis"].map(account));
  const nueva = await account("Nueva");
  await db.insert(schema.staffPermission).values([
    { userId: mod.id, permission: "sanctions" },
    { userId: team.id, permission: "reports" },
  ]);
  // Todas las cuentas tienen un mes, salvo "Nueva", recién creada
  await db.update(schema.user).set({ createdAt: ago(24 * 30) });
  await db.update(schema.user).set({ createdAt: now }).where(eq(schema.user.id, nueva.id));

  let n = 0;
  const report = (from: Account, to: Account, reason: string, at: Date) =>
    db.insert(schema.report).values({ id: `r${++n}`, reporterId: from.id, targetUserId: to.id, reason, createdAt: at });

  // Tito: 4 personas por "acoso", una cuenta nueva (no cuenta) y una por otro motivo (no suma)
  for (const p of people.slice(0, 4)) await report(p, tito, "acoso", ago(30));
  await report(nueva, tito, "acoso", ago(29));
  await report(people[4], tito, "spam", ago(29));
  // Reportar dos veces no suma
  await report(people[0], tito, "acoso", ago(28));
  assert.deepEqual(await autoSuspendCandidates(now), []);

  // La quinta persona por lo mismo: llega al número, pero moderación tiene 24 h
  await report(people[5], tito, "acoso", ago(2));
  const [c] = await autoSuspendCandidates(now);
  assert.equal(c.targetId, tito.id);
  assert.equal(c.reporters, 5);
  assert.equal(c.reachedAt.getTime(), ago(2).getTime());
  const pending = await pendingAutoSuspensions(now);
  assert.equal(pending.get(tito.id)?.at, new Date(ago(2).getTime() + 24 * HOUR).toISOString());
  assert.equal(await runAutoSuspensions(now), 0, "todavía está dentro de las 24 h");
  // Si los reportes de una de las cinco personas dejan de contar, ya no llega al número
  await db.insert(schema.reportMute).values({ userId: people[5].id, mutedBy: mod.id });
  assert.deepEqual(await autoSuspendCandidates(now), []);
  await db.delete(schema.reportMute).where(eq(schema.reportMute.userId, people[5].id));
  assert.equal((await autoSuspendCandidates(now)).length, 1);

  // El panel lo muestra en el reporte
  const list = await (await request("/api/admin/reports", mod)).json() as { targetUserId?: string; target: { id: string } | null; targetAutoSuspendAt: string | null }[];
  assert.ok(list.some((r) => r.target?.id === tito.id && r.targetAutoSuspendAt));

  // "otro" no cuenta, y lo de hace más de 3 semanas tampoco
  for (const p of people.slice(0, 5)) await report(p, lola, "otro", ago(48));
  for (const p of people.slice(0, 4)) await report(p, vieja, "perfil falso", ago(24 * 22));
  await report(people[4], vieja, "perfil falso", ago(48));
  // Al equipo no lo suspende la app
  for (const p of people.slice(0, 5)) await report(p, team, "acoso", ago(48));

  // Tito tiene una foto de perfil (no hay archivo: purgar no falla si falta)
  await db.insert(schema.photo).values({ id: "foto-tito", userId: tito.id, key: "no-existe.webp" });
  const titoPhotos = async () => (await db.select().from(schema.photo).where(eq(schema.photo.userId, tito.id))).length;

  // Pasan las 24 h sin que nadie lo revise: Tito se suspende solo; el resto, no
  const later = new Date(now.getTime() + 23 * HOUR);
  assert.equal(await runAutoSuspensions(later), 1);
  const [tp] = await db.select().from(schema.profile).where(eq(schema.profile.userId, tito.id));
  assert.ok(tp.suspendedAt);
  assert.equal(tp.suspendedBy, null);
  assert.match(tp.suspendReason!, /5 personas distintas.*acoso/);
  const titoOpen = await db.select().from(schema.report).where(and(eq(schema.report.targetUserId, tito.id), eq(schema.report.status, "open")));
  assert.equal(titoOpen.length, 0, "sus reportes quedan cerrados con la medida");
  assert.equal((await db.select().from(schema.session).where(eq(schema.session.userId, tito.id))).length, 0, "se cierran sus sesiones");
  for (const id of [lola.id, vieja.id, team.id]) {
    const [p] = await db.select().from(schema.profile).where(eq(schema.profile.userId, id));
    assert.equal(p.suspendedAt, null, id);
  }
  const logged = await db.select().from(schema.modAction).where(inArray(schema.modAction.targetId, [tito.id, team.id]));
  assert.ok(logged.some((a) => a.targetId === tito.id && a.action === AUTO_SUSPENDED && a.actorId === null));
  assert.ok(logged.some((a) => a.targetId === team.id && a.action.includes("no aplicada")), "al equipo: solo un aviso");

  // Otra pasada no hace nada (ni repite el aviso del equipo)
  assert.equal(await runAutoSuspensions(later), 0);
  assert.equal((await db.select().from(schema.modAction).where(eq(schema.modAction.targetId, team.id))).length, 1);

  // Lo público no se borra todavía: podría ser un ataque
  assert.equal(await titoPhotos(), 1, "la foto sigue hasta que una persona la mantenga");

  // Queda para revisar, como la preventiva; alguien del equipo la mantiene
  const suspended = await (await request("/api/admin/suspended", mod)).json() as { id: string; automatic: boolean; preventive: boolean }[];
  const s = suspended.find((x) => x.id === tito.id);
  assert.equal(s?.automatic, true);
  assert.equal(s?.preventive, false);
  assert.equal((await request(`/api/admin/users/${tito.id}/confirm-suspension`, mod, { method: "POST" })).status, 200);
  const again = await (await request("/api/admin/suspended", mod)).json() as { id: string; automatic: boolean }[];
  assert.equal(again.find((x) => x.id === tito.id)?.automatic, false);
  assert.equal(await titoPhotos(), 0, "al mantenerla se borra lo público");

  // Si moderación descarta reportes, dejan de contar: Lola, ahora por "acoso", 5 personas y uno descartado
  for (const p of people.slice(0, 5)) await report(p, lola, "acoso", ago(48));
  await db.update(schema.report).set({ status: "dismissed" }).where(and(eq(schema.report.targetUserId, lola.id), eq(schema.report.reporterId, people[0].id), eq(schema.report.reason, "acoso")));
  assert.equal(await runAutoSuspensions(later), 0);

  // Por la API: el reporte se guarda igual y avisa a moderación sin romper nada
  const res = await request("/api/reports", people[0], json("POST", { userId: vieja.id, reason: "perfil falso" }));
  assert.equal(res.status, 200);
});
