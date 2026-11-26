import { DM_EVENTS } from "@mortero/shared/realtime";
// Notificaciones push y panel de moderación.
import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { authorsFor, newId, requireProfile, requireUser, type AppEnv } from "../lib.js";
import { pushEnabled, pushTo, vapidPublicKey } from "../push.js";
import { disconnectUser, emitToGroup, emitToUser } from "../realtime.js";
import { deleteImage } from "../storage.js";
import { AUTO_DETAILS_PREFIX, autoHiddenGroups, autoHiddenUsers, deleteImageUnlessEvidence, isUrgent, releaseEvidence, REMOVED_GROUP_DAYS } from "../moderation.js";
import { removeGroup } from "./groups.js";
import { alertKey, dismissableReportsBy, mutedReporterList, mutedReporters, REPORT_SPAM_IGNORED, reportCounts, REPORTS_MUTED, REPORTS_UNMUTED, reportSpamAlerts, resolveAlert, resolveMuted } from "../reportSpam.js";
import { AUTO_SUSPENDED, pendingAutoSuspensions } from "../autoSuspend.js";
import { keepEvidence, purgeSuspendedContent } from "../suspension.js";
import { appealReviewedMail, sendMail, suspendedMail } from "../mail.js";
import { accessFor, grant, isOwner, logAction, notifyStaff, ownerIds, requireAccess, STAFF_PERMISSIONS, staffIdsWith } from "../staff.js";
import { dropPolls } from "../polls.js";

const { report, profile, session, groupMessage, directMessage, conversation, pushSubscription, user, group, appeal, staffPermission, modAction, reportMute } = schema;

export const adminRoutes = new Hono<AppEnv>();

// ---------- Push ----------

adminRoutes.get("/push/key", requireUser, (c) => c.json({ enabled: pushEnabled, key: vapidPublicKey }));

const subInput = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});

adminRoutes.post("/push/subscribe", requireUser, requireProfile, async (c) => {
  const u = c.get("user");
  const r = subInput.safeParse(await c.req.json());
  if (!r.success) throw new HTTPException(400, { message: "Suscripción inválida" });
  const { endpoint, keys } = r.data;
  const origin = new URL(env.APP_URL).origin;
  await db
    .insert(pushSubscription)
    .values({ id: newId(), userId: u.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, origin })
    .onConflictDoUpdate({ target: pushSubscription.endpoint, set: { userId: u.id, p256dh: keys.p256dh, auth: keys.auth, origin } });
  // Las suscripciones son por dominio: si esta persona las había activado en una dirección anterior
  // (el link provisorio), esas se borran para que no le lleguen los avisos repetidos.
  await db.delete(pushSubscription).where(and(
    eq(pushSubscription.userId, u.id),
    or(isNull(pushSubscription.origin), ne(pushSubscription.origin, origin)),
  ));
  return c.json({ ok: true });
});

/** Manda una notificación de prueba a todos tus dispositivos. Devuelve a cuántos llegó. */
adminRoutes.post("/push/test", requireUser, async (c) => {
  const u = c.get("user");
  const sent = await pushTo(u.id, { title: "Notificación de prueba", body: "¡Listo! Así te van a llegar los avisos.", url: "/yo", tag: "prueba", always: true });
  return c.json({ sent });
});

adminRoutes.delete("/push/subscribe", requireUser, async (c) => {
  const u = c.get("user");
  const { endpoint } = z.object({ endpoint: z.string() }).parse(await c.req.json());
  await db.delete(pushSubscription).where(and(eq(pushSubscription.endpoint, endpoint), eq(pushSubscription.userId, u.id)));
  return c.json({ ok: true });
});

// ---------- Moderación ----------
// Cada ruta pide su permiso (ver staff.ts). Para entrar al panel alcanza con tener alguno.

adminRoutes.use("/admin/*", requireUser, requireAccess("owner", ...STAFF_PERMISSIONS));

adminRoutes.get("/admin/stats", async (c) => {
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  return c.json({
    users: await count(db.select({ n: sql<number>`count(*)::int` }).from(profile)),
    groups: await count(db.select({ n: sql<number>`count(*)::int` }).from(group)),
    openReports: await count(db.select({ n: sql<number>`count(*)::int` }).from(report).where(eq(report.status, "open"))),
    suspended: await count(db.select({ n: sql<number>`count(*)::int` }).from(profile).where(isNotNull(profile.suspendedAt))),
    openAppeals: await count(db.select({ n: sql<number>`count(*)::int` }).from(appeal).where(eq(appeal.status, "open"))),
  });
});

/** Reportes, con el mensaje reportado (si hay) y el historial de la persona reportada. */
adminRoutes.get("/admin/reports", requireAccess("reports", "sanctions"), async (c) => {
  // Quién reportó solo lo ve la administración general: al resto no le hace falta para decidir
  const owner = (await accessFor(c.get("user"))).includes("owner");
  const status = c.req.query("status") === "closed" ? "closed" : "open";
  const rows = await db
    .select()
    .from(report)
    .where(status === "open" ? eq(report.status, "open") : inArray(report.status, ["dismissed", "actioned"]))
    .orderBy(desc(report.createdAt))
    // Los abiertos van todos (el panel los agrupa y filtra); de los resueltos, los últimos 300
    .limit(status === "open" ? 1000 : 300);
  // Quien reportó o fue reportado puede haber borrado su cuenta: el reporte queda, sin la cuenta
  const ids = (xs: (string | null)[]) => xs.filter((x): x is string => x != null);
  const people = await authorsFor(ids(rows.flatMap((r) => [r.reporterId, r.targetUserId])));
  const targets = [...new Set(ids(rows.map((r) => r.targetUserId)))];
  const profiles = targets.length ? await db.select().from(profile).where(inArray(profile.userId, targets)) : [];
  const suspended = new Map(profiles.map((p) => [p.userId, p.suspendedAt?.toISOString() ?? null]));
  const totals = targets.length
    ? await db.select({ id: report.targetUserId, n: sql<number>`count(*)::int` }).from(report)
        .where(inArray(report.targetUserId, targets)).groupBy(report.targetUserId)
    : [];
  const totalBy = new Map(totals.map((t) => [t.id ?? "", t.n]));

  const hidden = await autoHiddenUsers();
  const autoSuspend = await pendingAutoSuspensions();
  const hiddenGroups = await autoHiddenGroups();
  // Grupos reportados (pueden estar dados de baja: moderación los sigue viendo)
  const gids = [...new Set(rows.flatMap((r) => (r.groupId ? [r.groupId] : [])))];
  const groupRows = gids.length ? await db.select().from(group).where(inArray(group.id, gids)) : [];
  const groupCounts = gids.length
    ? await db.select({ id: schema.groupMember.groupId, n: sql<number>`count(*)::int` }).from(schema.groupMember)
        .where(inArray(schema.groupMember.groupId, gids)).groupBy(schema.groupMember.groupId)
    : [];
  const groupsById = new Map(groupRows.map((g) => [g.id, g]));
  const groupMembers = new Map(groupCounts.map((x) => [x.id, x.n]));
  // Sobre qué es cada reporte: un grupo, una persona o (si la cuenta se borró) solo ese reporte.
  // El panel junta los reportes con el mismo tema, así varios reportes de lo mismo se ven en una sola tarjeta.
  const subjectOf = (r: typeof rows[number]) => r.groupId ? `g:${r.groupId}` : r.targetUserId ? `u:${r.targetUserId}` : `r:${r.id}`;
  // Cuántas personas distintas reportaron cada tema (sin decir quiénes: eso solo lo ve la administración general)
  // Las cuentas cuyos reportes no cuentan (ver reportSpam.ts) no suman: sus reportes se ven, marcados
  const muted = await mutedReporters();
  const reportersBySubject = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.reporterId && muted.has(r.reporterId)) continue;
    const key = subjectOf(r);
    const set = reportersBySubject.get(key) ?? new Set<string>();
    set.add(r.reporterId ?? `auto:${r.id}`);
    reportersBySubject.set(key, set);
  }
  // Los mensajes reportados, de una sola vez (no uno por reporte)
  const msgIds = (kind: string) => [...new Set(rows.flatMap((r) => (r.messageId && r.messageKind === kind ? [r.messageId] : [])))];
  const gmIds = msgIds("group");
  const dmIds = msgIds("dm");
  const groupMsgs = new Map((gmIds.length ? await db.select().from(groupMessage).where(inArray(groupMessage.id, gmIds)) : []).map((m) => [m.id, m]));
  const directMsgs = new Map((dmIds.length ? await db.select().from(directMessage).where(inArray(directMessage.id, dmIds)) : []).map((m) => [m.id, m]));
  const out = [];
  for (const r of rows) {
    // El mensaje reportado: si ya se borró, se muestra la copia que guardó el reporte
    let message: { body: string | null; photo: boolean; deleted: boolean } | null = null;
    if (r.messageId && r.messageKind === "group") {
      const m = groupMsgs.get(r.messageId);
      const deleted = !m || m.status === "deleted";
      message = { body: deleted || !m ? r.messageBody : m.body, photo: false, deleted };
    } else if (r.messageId && r.messageKind === "dm") {
      const m = directMsgs.get(r.messageId);
      message = m
        ? { body: m.body, photo: Boolean(m.photoKey) || r.evidenceKeys.length > 0, deleted: false }
        : { body: r.messageBody, photo: r.evidenceKeys.length > 0, deleted: true };
    }
    const tid = r.targetUserId ?? "";
    out.push({
      id: r.id,
      subject: subjectOf(r),
      subjectReporters: reportersBySubject.get(subjectOf(r))?.size ?? 0,
      reporterMuted: Boolean(r.reporterId && muted.has(r.reporterId)),
      reason: r.reason,
      details: r.details,
      status: r.status,
      resolution: r.resolution,
      createdAt: r.createdAt.toISOString(),
      messageId: r.messageId,
      messageKind: r.messageKind,
      message,
      reporter: owner ? (r.reporterId && people.get(r.reporterId)) || null : null,
      reporterHidden: !owner,
      // Cuenta borrada: id null (no se puede suspender) y el nombre que tenía al reportarla
      target: r.groupId
        ? null
        : people.get(tid) ?? { id: null, name: r.targetName ? `${r.targetName} (cuenta borrada)` : "Cuenta borrada", age: 0, photo: null },
      // Reporte de un grupo: cómo está ahora (puede estar dado de baja)
      group: r.groupId
        ? (() => {
            const g = r.groupId ? groupsById.get(r.groupId) : undefined;
            return {
              id: g?.id ?? null,
              name: g?.name ?? r.targetName ?? "Grupo borrado",
              description: g?.description ?? null,
              memberCount: g ? groupMembers.get(g.id) ?? 0 : 0,
              removedAt: g?.removedAt?.toISOString() ?? null,
              autoHidden: g ? hiddenGroups.has(g.id) : false,
            };
          })()
        : null,
      // Sin persona que lo mande: lo generó la app (palabras que sugieren menores)
      automatic: !r.reporterId && (r.details ?? "").startsWith(AUTO_DETAILS_PREFIX),
      targetSuspendedAt: suspended.get(tid) ?? null,
      targetReportCount: totalBy.get(tid) ?? 0,
      evidenceFiles: r.evidenceKeys.length,
      urgent: isUrgent(r.reason),
      targetAutoHidden: hidden.has(tid),
      // Varias personas la reportaron por lo mismo: si nadie lo revisa, se suspende sola en esta fecha
      targetAutoSuspendAt: autoSuspend.get(tid)?.at ?? null,
    });
  }
  // Lo más nuevo primero; el panel agrupa, ordena y filtra (y avisa arriba si hay urgentes)
  return c.json(out);
});

async function closeReports(ids: string[], adminId: string, status: "dismissed" | "actioned", resolution: string) {
  if (!ids.length) return;
  await db
    .update(report)
    .set({ status, resolvedBy: adminId, resolvedAt: new Date(), resolution })
    .where(and(inArray(report.id, ids), eq(report.status, "open")));
  // Descartado: la copia del mensaje y los archivos guardados como prueba se liberan
  if (status === "dismissed") await releaseEvidence(ids);
}

// ---------- Alerta de spam de reportes (ver reportSpam.ts y la discusión #219) ----------
// Quién reporta solo lo ve con nombre la administración general (como en los reportes). El resto del equipo con el
// permiso Suspensiones ve la alerta con los números y puede actuar igual.

adminRoutes.get("/admin/report-spam", requireAccess("owner", "sanctions"), async (c) => {
  const owner = (await accessFor(c.get("user"))).includes("owner");
  const [alerts, muted] = await Promise.all([reportSpamAlerts(), mutedReporterList()]);
  const people = owner ? await authorsFor([...alerts, ...muted].map((a) => a.reporterId)) : new Map();
  // Sin el id de la cuenta: con él se podría ver quién reporta. Se actúa con el identificador de la tarjeta.
  return c.json({
    alerts: alerts.map(({ reporterId, ...a }) => ({ ...a, id: alertKey(reporterId), reporter: owner ? people.get(reporterId) ?? null : null })),
    muted: muted.map(({ reporterId, ...m }) => ({ ...m, id: alertKey(reporterId), reporter: owner ? people.get(reporterId) ?? null : null })),
  });
});

/** La cuenta detrás de una alerta activa (ver resolveAlert). */
async function alertReporter(key: string) {
  const reporterId = await resolveAlert(key);
  if (!reporterId) throw new HTTPException(404, { message: "Esta alerta ya no está activa" });
  return reporterId;
}

/** Descarta en bloque sus reportes de la ventana de la alerta. Los urgentes y los anteriores quedan para revisar de a uno. */
adminRoutes.post("/admin/report-spam/:id/dismiss", requireAccess("owner", "sanctions"), async (c) => {
  const admin = c.get("user");
  const reporterId = await alertReporter(c.req.param("id"));
  const ids = await dismissableReportsBy(reporterId);
  await closeReports(ids, admin.id, "dismissed", "Descartado en bloque: reportes de mala fe");
  await logAction(admin.id, "Descartó en bloque los reportes de una cuenta (reportes de mala fe)", reporterId, `${ids.length} reportes`);
  return c.json({ ok: true, dismissed: ids.length });
});

adminRoutes.post("/admin/report-spam/:id/ignore", requireAccess("owner", "sanctions"), async (c) => {
  const reporterId = await alertReporter(c.req.param("id"));
  await logAction(c.get("user").id, REPORT_SPAM_IGNORED, reporterId);
  return c.json({ ok: true });
});

adminRoutes.post("/admin/report-spam/:id/suspend", requireAccess("owner", "sanctions"), async (c) => {
  const reporterId = await alertReporter(c.req.param("id"));
  const { reason } = z.object({ reason: z.string().trim().min(3, "Escribí un motivo").max(300) }).parse(await c.req.json());
  await suspendAccount(c.get("user"), reporterId, reason);
  return c.json({ ok: true });
});

/**
 * Que los reportes de una cuenta dejen de contar: siguen entrando, pero no ocultan, no avisan, no suman y no alcanzan
 * para una suspensión preventiva. Es una decisión de moderación, nunca automática. A la persona no se le avisa.
 */
adminRoutes.post("/admin/report-spam/:id/mute", requireAccess("owner", "sanctions"), async (c) => {
  const admin = c.get("user");
  const target = await alertReporter(c.req.param("id"));
  const { reason } = z.object({ reason: z.string().trim().max(300).optional() }).parse(await c.req.json().catch(() => ({})));
  if (target === admin.id) throw new HTTPException(400, { message: "No podés hacer esto con tu propia cuenta" });
  const added = await db.insert(reportMute).values({ userId: target, mutedBy: admin.id, reason: reason || null })
    .onConflictDoNothing().returning({ id: reportMute.userId });
  if (added.length) await logAction(admin.id, REPORTS_MUTED, target, reason || null);
  return c.json({ ok: true });
});

/** Que vuelvan a contar. El identificador es el de la lista de cuentas cuyos reportes no cuentan. */
adminRoutes.post("/admin/report-spam/:id/unmute", requireAccess("owner", "sanctions"), async (c) => {
  const target = await resolveMuted(c.req.param("id"));
  if (!target) return c.json({ ok: true });
  const gone = await db.delete(reportMute).where(eq(reportMute.userId, target)).returning({ id: reportMute.userId });
  if (gone.length) await logAction(c.get("user").id, REPORTS_UNMUTED, target);
  return c.json({ ok: true });
});

/** Descartar varios reportes de una vez (todos los de una misma persona o grupo). */
adminRoutes.post("/admin/reports/dismiss", requireAccess("reports"), async (c) => {
  const { ids } = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(500) }).parse(await c.req.json());
  const open = await db.select({ id: report.id }).from(report).where(and(inArray(report.id, ids), eq(report.status, "open")));
  await closeReports(open.map((r) => r.id), c.get("user").id, "dismissed", "Descartado");
  for (const r of open) await logAction(c.get("user").id, "Descartó un reporte", r.id);
  return c.json({ ok: true, dismissed: open.length });
});

adminRoutes.post("/admin/reports/:id/dismiss", requireAccess("reports"), async (c) => {
  const id = c.req.param("id");
  await closeReports([id], c.get("user").id, "dismissed", "Descartado");
  await logAction(c.get("user").id, "Descartó un reporte", id);
  return c.json({ ok: true });
});

/** Borrar el mensaje reportado. */
adminRoutes.post("/admin/reports/:id/delete-message", requireAccess("reports"), async (c) => {
  const [r] = await db.select().from(report).where(eq(report.id, c.req.param("id")));
  if (!r?.messageId) throw new HTTPException(400, { message: "Este reporte no tiene mensaje" });
  if (r.messageKind === "group") {
    const [m] = await db.update(groupMessage).set({ status: "deleted", body: "" }).where(eq(groupMessage.id, r.messageId)).returning();
    if (m) {
      await dropPolls([m.id]);
      await emitToGroup(m.groupId, m.userId, "group:deleted", { id: m.id, groupId: m.groupId });
    }
  } else {
    const [m] = await db.delete(directMessage).where(eq(directMessage.id, r.messageId)).returning();
    if (m) {
      const [conv] = await db
        .select({ userA: conversation.userA, userB: conversation.userB })
        .from(conversation)
        .where(eq(conversation.id, m.conversationId));
      if (conv) {
        const payload = { conversationId: m.conversationId, id: m.id };
        emitToUser(conv.userA, DM_EVENTS.deleted, payload);
        emitToUser(conv.userB, DM_EVENTS.deleted, payload);
      }
      // La foto queda como prueba del reporte (que termina en una medida); si no, se borra
      if (m.photoKey) await deleteImageUnlessEvidence(m.photoKey);
    }
  }
  // Se cierran todos los reportes abiertos de ese mismo mensaje (varias personas pueden haberlo reportado)
  const same = await db.select({ id: report.id }).from(report)
    .where(and(eq(report.messageId, r.messageId), eq(report.status, "open")));
  await closeReports([r.id, ...same.map((x) => x.id)], c.get("user").id, "actioned", "Mensaje borrado");
  await logAction(c.get("user").id, "Borró un mensaje reportado", r.id);
  return c.json({ ok: true });
});

// Suspensión preventiva: quien tiene solo el permiso Reportes puede suspender ante un reporte abierto por menor de edad,
// para no dejar la cuenta activa hasta que aparezca alguien con Suspensiones. Después otra persona la confirma o la levanta.
// Se marca en el registro (sin migración): está pendiente si la última de estas acciones sobre la cuenta es la preventiva.
type StaffUser = Parameters<typeof accessFor>[0] & { id: string };
const SUSPENDED = "Suspendió una cuenta";
const PREVENTIVE = "Suspendió una cuenta de forma preventiva (menor de edad)";
const CONFIRMED = "Confirmó una suspensión preventiva";
const KEPT_ON_APPEAL = "Mantuvo una suspensión al revisarla";

/**
 * De estas cuentas suspendidas, cuáles tienen una suspensión que nadie revisó todavía: la preventiva (menor de edad)
 * o la automática (reportes de varias personas, ver autoSuspend.ts). Devuelve cuál de las dos.
 */
async function pendingReview(ids: string[]): Promise<Map<string, "preventive" | "automatic">> {
  if (!ids.length) return new Map();
  const rows = await db.select({ targetId: modAction.targetId, action: modAction.action }).from(modAction)
    .where(and(inArray(modAction.targetId, ids), inArray(modAction.action, [SUSPENDED, PREVENTIVE, AUTO_SUSPENDED, CONFIRMED, KEPT_ON_APPEAL])))
    .orderBy(desc(modAction.createdAt));
  const last = new Map<string, string>();
  for (const r of rows) if (r.targetId && !last.has(r.targetId)) last.set(r.targetId, r.action);
  const out = new Map<string, "preventive" | "automatic">();
  for (const id of ids) {
    if (last.get(id) === PREVENTIVE) out.set(id, "preventive");
    else if (last.get(id) === AUTO_SUSPENDED) out.set(id, "automatic");
  }
  return out;
}

/** Suspender una cuenta: se cierran sus sesiones, deja de aparecer y se borra lo que publicó. Cierra sus reportes abiertos. */
adminRoutes.post("/admin/users/:id/suspend", requireAccess("sanctions", "reports"), async (c) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, "Escribí un motivo").max(300) }).parse(await c.req.json());
  await suspendAccount(c.get("user"), c.req.param("id"), reason);
  return c.json({ ok: true });
});

/** Suspende una cuenta: desde un reporte, o desde una alerta de spam de reportes (ver /admin/report-spam). */
async function suspendAccount(admin: StaffUser, target: string, reason: string) {
  if (target === admin.id) throw new HTTPException(400, { message: "No podés suspenderte a vos" });
  const mine = await accessFor(admin);
  const preventive = !mine.includes("sanctions");
  if (preventive) {
    const [minor] = await db.select({ id: report.id }).from(report)
      .where(and(eq(report.targetUserId, target), eq(report.status, "open"), eq(report.reason, "menor de edad"))).limit(1);
    if (!minor) throw new HTTPException(403, { message: "Con el permiso Reportes solo podés suspender ante un reporte abierto por menor de edad" });
    // Tiene que haber al menos uno que cuente: los de cuentas cuyos reportes no cuentan (reportSpam.ts) no alcanzan
    const [counts] = await db.select({ id: report.id }).from(report)
      .where(and(eq(report.targetUserId, target), eq(report.status, "open"), eq(report.reason, "menor de edad"), reportCounts)).limit(1);
    if (!counts) throw new HTTPException(403, { message: "Estos reportes vienen de cuentas cuyos reportes no cuentan. Lo decide alguien con el permiso Suspensiones." });
  }
  // Que una cuenta de moderación (o una robada) no pueda dejar afuera del panel a quien administra.
  const [t] = await db.select({ id: user.id, email: user.email, emailVerified: user.emailVerified }).from(user).where(eq(user.id, target));
  if (!t) throw new HTTPException(404, { message: "Esa cuenta no existe" });
  if (isOwner(t)) throw new HTTPException(403, { message: "No se puede suspender a la administración general" });
  if ((await accessFor(t)).length > 0 && !mine.includes("owner")) {
    throw new HTTPException(403, { message: "Solo la administración general puede suspender a alguien del equipo" });
  }
  const [p] = await db.update(profile).set({ suspendedAt: new Date(), suspendReason: reason, suspendedBy: admin.id })
    .where(eq(profile.userId, target)).returning();
  if (!p) throw new HTTPException(404, { message: "Esa cuenta no existe" });
  await db.delete(session).where(eq(session.userId, target));
  disconnectUser(target);
  // Primero la prueba: los reportes guardan los archivos que necesitan antes de que se borren (ver suspension.ts)
  await keepEvidence(target);
  const open = await db.select({ id: report.id }).from(report)
    .where(and(eq(report.targetUserId, target), eq(report.status, "open")));
  await closeReports(open.map((r) => r.id), admin.id, "actioned", `Cuenta suspendida: ${reason}`);
  // Después se borra lo público: mensajes en grupos, fotos, álbumes, videos y fotos por privado (ver suspension.ts)
  const purged = await purgeSuspendedContent(target);
  await logAction(admin.id, preventive ? PREVENTIVE : SUSPENDED, target,
    `${reason} · Se borraron ${purged.groupMessages} mensajes en grupos y ${purged.files} archivos`);
  if (preventive) {
    await notifyStaff(
      "sanctions",
      { title: "Suspensión para revisar", body: "Hay una suspensión preventiva esperando que alguien la revise.", url: "/admin", tag: "suspension-preventiva" },
      { ownersAlways: true },
    );
  }
  // Aviso por mail (sin el motivo: se lee en la app, donde también se pide la revisión)
  const [u] = await db.select({ email: user.email }).from(user).where(eq(user.id, target));
  if (u) void sendMail(suspendedMail(u.email), "account");
}

/** Reactivar una cuenta. Si tenía un pedido de revisión abierto, queda resuelto a su favor. */
adminRoutes.post("/admin/users/:id/unsuspend", requireAccess("sanctions"), async (c) => {
  const admin = c.get("user");
  const target = c.req.param("id");
  await db.update(profile).set({ suspendedAt: null, suspendReason: null, suspendedBy: null }).where(eq(profile.userId, target));
  await db.update(appeal)
    .set({ status: "lifted", response: "Reactivamos tu cuenta.", reviewedBy: admin.id, reviewedAt: new Date() })
    .where(and(eq(appeal.userId, target), eq(appeal.status, "open")));
  await logAction(admin.id, "Reactivó una cuenta", target);
  return c.json({ ok: true });
});

/** Mantener una suspensión preventiva. La tiene que revisar alguien distinto de quien la hizo. */
adminRoutes.post("/admin/users/:id/confirm-suspension", requireAccess("sanctions"), async (c) => {
  const me = c.get("user");
  const target = c.req.param("id");
  const [p] = await db.select({ by: profile.suspendedBy, at: profile.suspendedAt }).from(profile).where(eq(profile.userId, target));
  const kind = p?.at ? (await pendingReview([target])).get(target) : undefined;
  if (!kind) throw new HTTPException(409, { message: "No hay una suspensión para revisar" });
  if (p.by === me.id) throw new HTTPException(403, { message: "Esta suspensión la hiciste vos: la tiene que revisar otra persona del equipo" });
  // La automática no borró lo público (podía ser un ataque): se borra ahora que una persona la mantiene
  const purged = kind === "automatic" ? await purgeSuspendedContent(target) : null;
  await logAction(me.id, CONFIRMED, target,
    purged ? `Se borraron ${purged.groupMessages} mensajes en grupos y ${purged.files} archivos` : null);
  return c.json({ ok: true });
});

adminRoutes.get("/admin/suspended", requireAccess("sanctions", "appeals"), async (c) => {
  const me = c.get("user");
  const rows = await db
    .select({ id: profile.userId, reason: profile.suspendReason, at: profile.suspendedAt, by: profile.suspendedBy })
    .from(profile)
    .where(isNotNull(profile.suspendedAt))
    .orderBy(desc(profile.suspendedAt));
  const people = await authorsFor(rows.map((r) => r.id));
  const pending = await pendingReview(rows.map((r) => r.id));
  return c.json(rows.map((r) => ({
    ...people.get(r.id)!,
    reason: r.reason,
    suspendedAt: r.at!.toISOString(),
    preventive: pending.get(r.id) === "preventive",
    automatic: pending.get(r.id) === "automatic",
    suspendedByMe: r.by === me.id,
  })));
});

// ---------- Pedidos de revisión de suspensiones ----------

/** Pedidos de revisión, con el contexto mínimo: el motivo y los reportes que terminaron en la suspensión. */
adminRoutes.get("/admin/appeals", requireAccess("appeals"), async (c) => {
  const me = c.get("user");
  const closed = c.req.query("status") === "closed";
  const rows = await db.select().from(appeal)
    .where(closed ? inArray(appeal.status, ["upheld", "lifted"]) : eq(appeal.status, "open"))
    .orderBy(closed ? desc(appeal.reviewedAt) : appeal.createdAt)
    .limit(100);
  const people = await authorsFor(rows.map((a) => a.userId));
  const othersCanReview = (await staffIdsWith("appeals")).some((id) => id !== me.id);
  const out = [];
  for (const a of rows) {
    // Los reportes que se cerraron con esta suspensión. Sin quién reportó.
    const reps = await db.select({ reason: report.reason, details: report.details, messageBody: report.messageBody, createdAt: report.createdAt })
      .from(report)
      .where(and(eq(report.targetUserId, a.userId), eq(report.status, "actioned")))
      .orderBy(desc(report.createdAt))
      .limit(10);
    out.push({
      id: a.id,
      person: people.get(a.userId) ?? { id: a.userId, name: "Cuenta sin perfil", age: 0, photo: null },
      suspendReason: a.suspendReason,
      suspendedAt: a.suspendedAt.toISOString(),
      // Si la suspendiste vos y hay otra persona con el permiso Revisiones, la tiene que revisar ella
      suspendedByMe: a.suspendedBy === me.id,
      othersCanReview,
      body: a.body,
      extra: a.extra,
      status: a.status,
      response: a.response,
      createdAt: a.createdAt.toISOString(),
      reviewedAt: a.reviewedAt?.toISOString() ?? null,
      reports: reps.map((r) => ({ reason: r.reason, details: r.details, message: r.messageBody, createdAt: r.createdAt.toISOString() })),
    });
  }
  return c.json(out);
});

/** Resolver un pedido: mantener la suspensión o levantarla, siempre con una respuesta que la persona lee. */
adminRoutes.post("/admin/appeals/:id/resolve", requireAccess("appeals"), async (c) => {
  const me = c.get("user");
  const { decision, response } = z.object({
    decision: z.enum(["uphold", "lift"]),
    response: z.string().trim().min(10, "Escribí una respuesta para la persona").max(1000),
  }).parse(await c.req.json());
  const [a] = await db.select().from(appeal).where(eq(appeal.id, c.req.param("id")));
  if (!a) throw new HTTPException(404, { message: "Ese pedido no existe" });
  if (a.status !== "open") throw new HTTPException(409, { message: "Ese pedido ya se resolvió" });
  if (a.suspendedBy === me.id && (await staffIdsWith("appeals")).some((id) => id !== me.id)) {
    throw new HTTPException(403, { message: "Esta suspensión la hiciste vos: la tiene que revisar otra persona del equipo" });
  }
  await db.update(appeal)
    .set({ status: decision === "lift" ? "lifted" : "upheld", response, reviewedBy: me.id, reviewedAt: new Date() })
    .where(eq(appeal.id, a.id));
  // Si era una suspensión automática sin revisar, mantenerla también borra lo público (ver confirm-suspension)
  if (decision === "uphold" && (await pendingReview([a.userId])).get(a.userId) === "automatic") await purgeSuspendedContent(a.userId);
  if (decision === "lift") {
    // Solo si sigue siendo la misma suspensión
    await db.update(profile).set({ suspendedAt: null, suspendReason: null, suspendedBy: null })
      .where(and(eq(profile.userId, a.userId), eq(profile.suspendedAt, a.suspendedAt)));
  }
  const same = a.suspendedBy === me.id ? " (la revisó la misma persona que suspendió)" : "";
  await logAction(me.id, decision === "lift" ? "Levantó una suspensión al revisarla" : "Mantuvo una suspensión al revisarla", a.userId, response + same);
  const [u] = await db.select({ email: user.email }).from(user).where(eq(user.id, a.userId));
  if (u) void sendMail(appealReviewedMail(u.email, decision === "lift"), "account");
  return c.json({ ok: true });
});

// ---------- Grupos (solo administración general) ----------

/** Dar de baja un grupo: desaparece para todo el mundo y queda guardado como prueba. Cierra sus reportes abiertos. */
adminRoutes.post("/admin/groups/:id/remove", requireAccess("owner"), async (c) => {
  const admin = c.get("user");
  const { reason } = z.object({ reason: z.string().trim().min(3, "Escribí un motivo").max(300) }).parse(await c.req.json());
  const [g] = await db.select().from(group).where(eq(group.id, c.req.param("id")));
  if (!g) throw new HTTPException(404, { message: "Ese grupo no existe" });
  if (g.isGeneral) throw new HTTPException(400, { message: "El chat general no se puede dar de baja" });
  if (g.removedAt) throw new HTTPException(409, { message: "Ese grupo ya está dado de baja" });
  await removeGroup(g.id, `Moderación: ${reason}`);
  const open = await db.select({ id: report.id }).from(report).where(and(eq(report.groupId, g.id), eq(report.status, "open")));
  await closeReports(open.map((r) => r.id), admin.id, "actioned", `Grupo dado de baja: ${reason}`);
  await logAction(admin.id, "Dio de baja un grupo", g.id, reason);
  return c.json({ ok: true });
});

/** Volver a activar un grupo dado de baja (si fue un error). Los miembros siguen siendo los mismos. */
adminRoutes.post("/admin/groups/:id/restore", requireAccess("owner"), async (c) => {
  const [g] = await db.update(group).set({ removedAt: null, removedReason: null })
    .where(and(eq(group.id, c.req.param("id")), isNotNull(group.removedAt))).returning();
  if (!g) throw new HTTPException(404, { message: "Ese grupo no está dado de baja" });
  await logAction(c.get("user").id, "Volvió a activar un grupo", g.id);
  return c.json({ ok: true });
});

/** Grupos dados de baja, con cuántos días les quedan antes de borrarse del todo. */
adminRoutes.get("/admin/groups/removed", requireAccess("owner"), async (c) => {
  const rows = await db.select().from(group).where(isNotNull(group.removedAt)).orderBy(desc(group.removedAt));
  return c.json(rows.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    removedAt: g.removedAt!.toISOString(),
    reason: g.removedReason,
    purgeAt: new Date(g.removedAt!.getTime() + REMOVED_GROUP_DAYS * 86_400_000).toISOString(),
  })));
});

// Se usa POST para que los mails y códigos queden fuera de la URL (y de los registros del servidor).
const accountName = sql<string>`coalesce(${profile.displayName}, ${user.name})`;
/** El código de ocho caracteres de la marca visible: el comienzo del ID de la cuenta. */
const SHORT_CODE = /^[a-zA-Z0-9_-]{8}$/;

adminRoutes.post("/admin/accounts/search", requireAccess("sanctions"), async (c) => {
  const query = z.object({ query: z.string().trim().regex(/^[a-zA-Z0-9_-]{8,64}$/) }).parse(await c.req.json()).query;
  const fields = { id: user.id, name: accountName, suspendedAt: profile.suspendedAt };
  // Una cadena de ocho caracteres puede ser también el ID completo de otra cuenta.
  const matches = await db.select(fields).from(user).innerJoin(profile, eq(profile.userId, user.id))
    .where(query.length === 8 ? sql`left(${user.id}, 8) = ${query}` : eq(user.id, query)).limit(2);
  const account = matches.length === 1 ? matches[0] : null;
  c.header("Cache-Control", "no-store");
  return c.json({ account, ambiguous: matches.length > 1 });
});

// ---------- Equipo y registro (solo administración general) ----------

/** Quiénes tienen permisos chicos. */
adminRoutes.get("/admin/team", requireAccess("owner"), async (c) => {
  const rows = await db.select().from(staffPermission).orderBy(staffPermission.createdAt);
  const people = await authorsFor(rows.map((r) => r.userId));
  const byUser = new Map<string, { permissions: string[]; since: string }>();
  for (const r of rows) {
    const x = byUser.get(r.userId) ?? { permissions: [], since: r.createdAt.toISOString() };
    x.permissions.push(r.permission);
    byUser.set(r.userId, x);
  }
  return c.json([...byUser].map(([id, x]) => ({ ...(people.get(id) ?? { id, name: "Cuenta sin perfil", age: 0, photo: null }), ...x })));
});

/** Los permisos de una persona, para darlos o sacarlos desde su perfil. */
adminRoutes.get("/admin/team/:userId", requireAccess("owner"), async (c) => {
  const [u] = await db.select({ id: user.id, email: user.email, emailVerified: user.emailVerified }).from(user)
    .where(eq(user.id, c.req.param("userId")));
  if (!u) throw new HTTPException(404, { message: "No encontramos esa cuenta" });
  if (isOwner(u)) return c.json({ owner: true, permissions: [...STAFF_PERMISSIONS] });
  const rows = await db.select({ p: staffPermission.permission }).from(staffPermission).where(eq(staffPermission.userId, u.id));
  return c.json({ owner: false, permissions: rows.map((r) => r.p) });
});

/** Dar o cambiar permisos. La cuenta se busca por su ID o por su mail. Una lista vacía saca todos. */
adminRoutes.post("/admin/team", requireAccess("owner"), async (c) => {
  const me = c.get("user");
  const { account, permissions } = z.object({
    account: z.string().trim().min(3).max(200),
    permissions: z.array(z.enum(STAFF_PERMISSIONS)).max(STAFF_PERMISSIONS.length),
  }).parse(await c.req.json());
  const [u] = await db.select({ id: user.id, email: user.email, emailVerified: user.emailVerified }).from(user)
    .where(account.includes("@") ? sql`lower(${user.email}) = ${account.toLowerCase()}` : eq(user.id, account));
  if (!u) throw new HTTPException(404, { message: "No encontramos esa cuenta" });
  if (u.id === me.id) throw new HTTPException(400, { message: "Ya tenés todos los permisos" });
  if (isOwner(u)) throw new HTTPException(400, { message: "Esa cuenta ya tiene administración general" });
  const perms = [...new Set(permissions)];
  await grant(u.id, perms, me.id);
  const names: Record<string, string> = { reports: "Reportes", sanctions: "Suspensiones", appeals: "Revisiones" };
  await logAction(me.id, perms.length ? "Cambió permisos" : "Sacó todos los permisos", u.id, perms.map((p) => names[p]).join(", ") || null);
  return c.json({ ok: true });
});

/**
 * Personas: buscar cuentas por nombre (o por ID, código de la marca visible o mail exacto) y ver de un vistazo si tienen administración general,
 * permisos, una suspensión o si están ocultas por reportes urgentes. Solo para la administración general.
 * Sin búsqueda, cada filtro muestra su lista: equipo, suspendidas, ocultas o las cuentas más nuevas.
 */
adminRoutes.post("/admin/people", requireAccess("owner"), async (c) => {
  const { q, filter } = z.object({
    q: z.string().trim().max(100).default(""),
    filter: z.enum(["all", "staff", "suspended", "hidden"]).default("all"),
  }).parse(await c.req.json().catch(() => ({})));
  const LIMIT = 40;
  const [owners, staffRows, hidden] = await Promise.all([
    ownerIds(),
    db.select({ id: staffPermission.userId, p: staffPermission.permission }).from(staffPermission),
    autoHiddenUsers(),
  ]);
  const perms = new Map<string, string[]>();
  for (const r of staffRows) perms.set(r.id, [...(perms.get(r.id) ?? []), r.p]);

  const conds = [];
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    conds.push(or(
      sql`${profile.displayName} ilike ${like}`, eq(user.id, q), sql`lower(${user.email}) = ${q.toLowerCase()}`,
      ...(SHORT_CODE.test(q) ? [sql`left(${user.id}, 8) = ${q}`] : []),
    )!);
  }
  if (filter === "staff") conds.push(inArray(user.id, [...new Set([...owners, ...perms.keys()])].concat("")));
  if (filter === "suspended") conds.push(isNotNull(profile.suspendedAt));
  if (filter === "hidden") conds.push(inArray(user.id, [...hidden].concat("")));
  const rows = await db
    .select({ id: user.id, createdAt: user.createdAt, suspendedAt: profile.suspendedAt, suspendReason: profile.suspendReason })
    .from(user).innerJoin(profile, eq(profile.userId, user.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(user.createdAt)).limit(LIMIT + 1);
  const page = rows.slice(0, LIMIT);
  const ids = page.map((r) => r.id);
  const [people, open] = await Promise.all([
    authorsFor(ids),
    ids.length
      ? db.select({ id: report.targetUserId, n: sql<number>`count(*)::int` }).from(report)
        .where(and(inArray(report.targetUserId, ids), eq(report.status, "open"))).groupBy(report.targetUserId)
      : Promise.resolve([]),
  ]);
  const openBy = new Map(open.map((r) => [r.id, r.n]));
  c.header("Cache-Control", "no-store");
  return c.json({
    people: page.flatMap((r) => {
      const a = people.get(r.id);
      return a ? [{
        ...a,
        joinedAt: r.createdAt.toISOString(),
        owner: owners.includes(r.id),
        permissions: perms.get(r.id) ?? [],
        suspendedAt: r.suspendedAt?.toISOString() ?? null,
        suspendReason: r.suspendReason,
        hidden: hidden.has(r.id),
        openReports: openBy.get(r.id) ?? 0,
      }] : [];
    }),
    more: rows.length > LIMIT,
  });
});

/** Lo último que hizo moderación. */
adminRoutes.get("/admin/log", requireAccess("owner"), async (c) => {
  const rows = await db.select().from(modAction).orderBy(desc(modAction.createdAt)).limit(200);
  const people = await authorsFor(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])));
  return c.json(rows.map((r) => ({
    id: r.id,
    actor: r.actorId ? people.get(r.actorId)?.name ?? "Cuenta sin perfil" : r.action.startsWith(AUTO_SUSPENDED) ? "La app" : "Cuenta borrada",
    action: r.action,
    targetId: r.targetId,
    details: r.details,
    createdAt: r.createdAt.toISOString(),
  })));
});
