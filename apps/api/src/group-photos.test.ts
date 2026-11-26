import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hono } from "hono";
import sharp from "sharp";

test("las fotos del piloto son privadas, se moderan con tolerancia cero y se pueden restaurar", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "qule-fotos-grupo-"));
  process.env.DATA_DIR = dir;
  process.env.GROUP_PHOTO_PILOT_IDS = "piloto,general";
  process.env.ADMIN_EMAILS = "equipo@example.test";
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_URL;
  const { db, schema, runMigrations, closeDb } = await import("./db/index.js");
  t.after(async () => { await closeDb(); await rm(dir, { recursive: true, force: true }); });
  await runMigrations();
  const { auth } = await import("./auth.js");
  const { groupRoutes } = await import("./routes/groups.js");
  const { socialRoutes } = await import("./routes/social.js");
  const { adminRoutes } = await import("./routes/admin.js");
  const { grant } = await import("./staff.js");
  const app = new Hono().route("/", groupRoutes).route("/", socialRoutes).route("/", adminRoutes);
  const { and, eq } = await import("drizzle-orm");

  const DAY = 24 * 3_600_000;
  // Las cuentas "con antigüedad" se crearon hace 3 días: pueden mandar fotos y sus reportes suman para ocultar.
  async function account(name: string, { aged = true } = {}) {
    const credentials = { email: `${name}@example.test`, password: "clave-para-pruebas" };
    const { user } = await auth.api.signUpEmail({ body: { ...credentials, name } });
    await db.insert(schema.profile).values({ userId: user.id, displayName: name, birthdate: "1990-01-01" });
    await db.update(schema.user).set({ emailVerified: true, ...(aged && { createdAt: new Date(Date.now() - 3 * DAY) }) })
      .where(eq(schema.user.id, user.id));
    const login = await auth.api.signInEmail({ body: credentials, asResponse: true });
    return { id: user.id, cookie: login.headers.getSetCookie().map((s) => s.split(";")[0]).join("; ") };
  }

  const sender = await account("autor");
  const [a, b, c, outsider, staff, mod, muted] = await Promise.all(["ana", "bea", "cel", "fuera", "equipo", "modera", "callado"].map((n) => account(n)));
  const [d, e, f] = await Promise.all(["dani", "eli", "fede"].map((n) => account(n, { aged: false })));
  // Moderación con el permiso Reportes, sin Suspensiones
  await grant(mod.id, ["reports"], staff.id);
  // Una cuenta cuyos reportes moderación decidió que no cuentan (ver reportSpam.ts)
  await db.insert(schema.reportMute).values({ userId: muted.id, mutedBy: staff.id });
  await db.insert(schema.group).values([
    { id: "piloto", name: "Piloto" }, { id: "otro", name: "Otro" },
    { id: "general", name: "General", isGeneral: true },
  ]);
  await db.insert(schema.groupMember).values([
    { groupId: "piloto", userId: sender.id, role: "owner" },
    ...[a, b, c, d, e, f, muted].map(({ id }) => ({ groupId: "piloto", userId: id })),
    { groupId: "otro", userId: sender.id, role: "owner" },
    { groupId: "general", userId: sender.id, role: "owner" },
  ]);
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "orange" } }).png().toBuffer();
  function submitPhoto(group: string, cookie: string) {
    const body = new FormData();
    body.set("file", new File([new Uint8Array(png)], "prueba.png", { type: "image/png" }));
    return app.request(`/groups/${group}/messages/photo`, { method: "POST", headers: { cookie }, body });
  }
  function json(url: string, cookie: string, body: unknown, method = "POST") {
    return app.request(url, { method, headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  async function publish(cookie: string) {
    const uploaded = await submitPhoto("piloto", cookie);
    assert.equal(uploaded.status, 200);
    const { message } = await uploaded.json();
    assert.equal(message.status, "published");
    return message.id as string;
  }
  const photoUrl = (id: string) => `/groups/piloto/messages/${id}/photo`;
  const open = (id: string, cookie: string) => app.request(photoUrl(id), { headers: { cookie } });
  const flag = (id: string, author: string, cookie: string, reason = "fotos inapropiadas") => json("/reports", cookie, {
    userId: author, reason, messageId: id, messageKind: "group",
  });
  async function reportIdFor(messageId: string) {
    const [row] = await db.select({ id: schema.report.id }).from(schema.report)
      .where(and(eq(schema.report.messageId, messageId), eq(schema.report.status, "open"))).limit(1);
    assert.ok(row);
    return row.id;
  }

  // ---- Solo en los grupos del piloto, nunca en el General, y solo para integrantes ----
  assert.equal((await submitPhoto("otro", sender.cookie)).status, 404);
  assert.equal((await submitPhoto("general", sender.cookie)).status, 404);
  assert.equal((await submitPhoto("piloto", outsider.cookie)).status, 404);

  // ---- Las cuentas nuevas no mandan fotos, aunque el grupo baje la regla de cuenta nueva ----
  const fresh = await submitPhoto("piloto", d.cookie);
  assert.equal(fresh.status, 403);
  assert.match(await fresh.text(), /cuentas nuevas no pueden mandar fotos/);
  const [pilot] = await db.select({ rules: schema.group.spamRules }).from(schema.group).where(eq(schema.group.id, "piloto"));
  await db.update(schema.group).set({ spamRules: { ...pilot.rules, newAccountHours: 0 } }).where(eq(schema.group.id, "piloto"));
  assert.equal((await submitPhoto("piloto", d.cookie)).status, 403);
  await db.update(schema.group).set({ spamRules: pilot.rules }).where(eq(schema.group.id, "piloto"));

  // ---- Acceso privado, sin caché ----
  const uploaded = await submitPhoto("piloto", sender.cookie);
  assert.equal(uploaded.status, 200);
  const { message } = await uploaded.json();
  assert.equal(message.photo, "available");
  assert.equal("photoKey" in message, false);
  assert.equal((await open(message.id, outsider.cookie)).status, 404);
  const first = await open(message.id, a.cookie);
  assert.equal(first.status, 200);
  assert.match(first.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(first.headers.get("content-type"), "image/webp");

  // ---- Motivo no urgente: la ocultan tres cuentas distintas con antigüedad ----
  assert.equal((await flag(message.id, sender.id, outsider.cookie)).status, 400);
  for (let n = 0; n < 3; n++) assert.equal((await flag(message.id, sender.id, a.cookie)).status, 200);
  assert.equal((await open(message.id, a.cookie)).status, 200);
  const reports = await Promise.all([flag(message.id, sender.id, b.cookie), flag(message.id, sender.id, c.cookie)]);
  assert.deepEqual(reports.map((r) => r.status), [200, 200]);
  assert.equal((await open(message.id, a.cookie)).status, 404);
  const current = await app.request("/groups/piloto/messages", { headers: { cookie: a.cookie } });
  assert.equal((await current.json()).messages[0].photo, "hidden");
  const admin = await app.request("/admin/reports", { headers: { cookie: staff.cookie } });
  assert.equal(admin.status, 200);
  const pending = await admin.json();
  assert.equal(pending.length, 3);
  assert.equal(new Set(pending.map((r: { subject: string }) => r.subject)).size, 1);
  assert.ok(pending.every((r: { urgent: boolean; message: { hidden: boolean } }) => r.urgent && r.message.hidden));

  // Sin reportes urgentes, alcanza con el permiso Reportes para restaurarla
  const restore = (reportId: string, cookie: string) => json(`/admin/reports/${reportId}/restore-group-photo`, cookie, {});
  assert.equal((await restore(pending[0].id, a.cookie)).status, 403);
  assert.equal((await restore(pending[0].id, mod.cookie)).status, 200);
  assert.equal((await open(message.id, a.cookie)).status, 200);

  // ---- Las cuentas nuevas no suman para ocultar, y quien tiene los reportes silenciados tampoco oculta con uno urgente ----
  const quiet = await publish(b.cookie);
  for (const who of [d, e, f]) assert.equal((await flag(quiet, b.id, who.cookie)).status, 200);
  assert.equal((await open(quiet, a.cookie)).status, 200);
  assert.equal((await flag(quiet, b.id, muted.cookie, "amenazas o violencia")).status, 200);
  assert.equal((await open(quiet, a.cookie)).status, 200);
  // Por menor de edad cuenta siempre: se oculta con ese primer reporte urgente
  assert.equal((await flag(quiet, b.id, c.cookie, "menor de edad")).status, 200);
  assert.equal((await open(quiet, a.cookie)).status, 404);

  // ---- Un reporte urgente la oculta al instante, aunque venga de una cuenta nueva ----
  const urgent = await publish(a.cookie);
  assert.equal((await open(urgent, b.cookie)).status, 200);
  assert.equal((await flag(urgent, a.id, d.cookie, "contenido íntimo sin consentimiento")).status, 200);
  assert.equal((await open(urgent, b.cookie)).status, 404);
  const listed = await app.request("/groups/piloto/messages", { headers: { cookie: b.cookie } });
  assert.equal((await listed.json()).messages.find((m: { id: string }) => m.id === urgent).photo, "hidden");

  // ---- Restaurar con un reporte urgente abierto pide Suspensiones, y el registro dice qué reportes se cerraron ----
  const urgentReport = await reportIdFor(urgent);
  const refused = await restore(urgentReport, mod.cookie);
  assert.equal(refused.status, 403);
  assert.match(await refused.text(), /Suspensiones/);
  assert.equal((await open(urgent, b.cookie)).status, 404);
  const [stillOpen] = await db.select({ status: schema.report.status }).from(schema.report).where(eq(schema.report.id, urgentReport));
  assert.equal(stillOpen.status, "open");
  assert.equal((await restore(urgentReport, staff.cookie)).status, 200);
  assert.equal((await open(urgent, b.cookie)).status, 200);
  const [log] = await db.select().from(schema.modAction)
    .where(and(eq(schema.modAction.action, "Restauró una foto de grupo"), eq(schema.modAction.targetId, urgent)));
  assert.equal(log.actorId, staff.id);
  assert.match(log.details ?? "", new RegExp(`${urgentReport} \\(contenido íntimo sin consentimiento\\)`));

  // ---- Pausa de subidas ----
  assert.equal((await json("/groups/piloto/photo-pilot", a.cookie, { paused: true }, "PUT")).status, 403);
  assert.equal((await json("/groups/piloto/photo-pilot", sender.cookie, { paused: true }, "PUT")).status, 200);
  assert.equal((await submitPhoto("piloto", sender.cookie)).status, 409);
});
