// Notificaciones push y panel de moderación.
import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { authorsFor, newId, requireProfile, requireUser, type AppEnv } from "../lib.js";
import { pushEnabled, pushTo, vapidPublicKey } from "../push.js";
import { APP_NAME } from "../brand.js";
import { disconnectUser, emitToGroup } from "../realtime.js";
import { deleteImage } from "../storage.js";
import { AUTO_DETAILS_PREFIX, autoHiddenGroups, autoHiddenUsers, deleteImageUnlessEvidence, isUrgent, releaseEvidence, REMOVED_GROUP_DAYS } from "../moderation.js";
import { removeGroup } from "./groups.js";

const { report, profile, session, groupMessage, directMessage, pushSubscription, user, group } = schema;

/**
 * ¿Puede entrar al panel de moderación? Por el ID de la cuenta (ADMIN_USER_IDS), o por el mail (ADMIN_EMAILS)
 * solo si está verificado: si no, cualquiera podría registrarse con un mail de la lista que todavía no tenga cuenta.
 */
export const isAdmin = (u: { id: string; email: string; emailVerified: boolean }) =>
  env.ADMIN_USER_IDS.includes(u.id) || (u.emailVerified && env.ADMIN_EMAILS.includes(u.email.toLowerCase()));

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
  const sent = await pushTo(u.id, { title: APP_NAME, body: "¡Listo! Así te van a llegar los avisos.", url: "/yo", tag: "prueba", always: true });
  return c.json({ sent });
});

adminRoutes.delete("/push/subscribe", requireUser, async (c) => {
  const u = c.get("user");
  const { endpoint } = z.object({ endpoint: z.string() }).parse(await c.req.json());
  await db.delete(pushSubscription).where(and(eq(pushSubscription.endpoint, endpoint), eq(pushSubscription.userId, u.id)));
  return c.json({ ok: true });
});

// ---------- Moderación ----------

const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!isAdmin(c.get("user"))) throw new HTTPException(403, { message: "Solo moderación" });
  await next();
});
adminRoutes.use("/admin/*", requireUser, requireAdmin);

adminRoutes.get("/admin/stats", async (c) => {
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  return c.json({
    users: await count(db.select({ n: sql<number>`count(*)::int` }).from(profile)),
    groups: await count(db.select({ n: sql<number>`count(*)::int` }).from(group)),
    openReports: await count(db.select({ n: sql<number>`count(*)::int` }).from(report).where(eq(report.status, "open"))),
    suspended: await count(db.select({ n: sql<number>`count(*)::int` }).from(profile).where(isNotNull(profile.suspendedAt))),
  });
});

/** Reportes, con el mensaje reportado (si hay) y el historial de la persona reportada. */
adminRoutes.get("/admin/reports", async (c) => {
  const status = c.req.query("status") === "closed" ? "closed" : "open";
  const rows = await db
    .select()
    .from(report)
    .where(status === "open" ? eq(report.status, "open") : inArray(report.status, ["dismissed", "actioned"]))
    .orderBy(desc(report.createdAt))
    .limit(100);
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
  const out = [];
  for (const r of rows) {
    // El mensaje reportado: si ya se borró, se muestra la copia que guardó el reporte
    let message: { body: string | null; photo: boolean; deleted: boolean } | null = null;
    if (r.messageId && r.messageKind === "group") {
      const [m] = await db.select().from(groupMessage).where(eq(groupMessage.id, r.messageId));
      const deleted = !m || m.status === "deleted";
      message = { body: deleted ? r.messageBody : m.body, photo: false, deleted };
    } else if (r.messageId && r.messageKind === "dm") {
      const [m] = await db.select().from(directMessage).where(eq(directMessage.id, r.messageId));
      message = m
        ? { body: m.body, photo: Boolean(m.photoKey) || r.evidenceKeys.length > 0, deleted: false }
        : { body: r.messageBody, photo: r.evidenceKeys.length > 0, deleted: true };
    }
    const tid = r.targetUserId ?? "";
    out.push({
      id: r.id,
      reason: r.reason,
      details: r.details,
      status: r.status,
      resolution: r.resolution,
      createdAt: r.createdAt.toISOString(),
      messageId: r.messageId,
      messageKind: r.messageKind,
      message,
      reporter: (r.reporterId && people.get(r.reporterId)) || null,
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
    });
  }
  // Lo urgente primero (menores, contenido íntimo sin consentimiento, amenazas); dentro de cada grupo, lo más nuevo
  out.sort((a, b) => Number(b.urgent) - Number(a.urgent));
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

adminRoutes.post("/admin/reports/:id/dismiss", async (c) => {
  await closeReports([c.req.param("id")], c.get("user").id, "dismissed", "Descartado");
  return c.json({ ok: true });
});

/** Borrar el mensaje reportado. */
adminRoutes.post("/admin/reports/:id/delete-message", async (c) => {
  const [r] = await db.select().from(report).where(eq(report.id, c.req.param("id")));
  if (!r?.messageId) throw new HTTPException(400, { message: "Este reporte no tiene mensaje" });
  if (r.messageKind === "group") {
    const [m] = await db.update(groupMessage).set({ status: "deleted", body: "" }).where(eq(groupMessage.id, r.messageId)).returning();
    if (m) await emitToGroup(m.groupId, m.userId, "group:deleted", { id: m.id, groupId: m.groupId });
  } else {
    const [m] = await db.delete(directMessage).where(eq(directMessage.id, r.messageId)).returning();
    // La foto queda como prueba del reporte (que termina en una medida); si no, se borra
    if (m?.photoKey) await deleteImageUnlessEvidence(m.photoKey);
  }
  await closeReports([r.id], c.get("user").id, "actioned", "Mensaje borrado");
  return c.json({ ok: true });
});

/** Suspender una cuenta: se cierran sus sesiones y deja de aparecer. Cierra sus reportes abiertos. */
adminRoutes.post("/admin/users/:id/suspend", async (c) => {
  const admin = c.get("user");
  const target = c.req.param("id");
  if (target === admin.id) throw new HTTPException(400, { message: "No podés suspenderte a vos" });
  const { reason } = z.object({ reason: z.string().trim().min(3, "Escribí un motivo").max(300) }).parse(await c.req.json());
  const [p] = await db.update(profile).set({ suspendedAt: new Date(), suspendReason: reason })
    .where(eq(profile.userId, target)).returning();
  if (!p) throw new HTTPException(404, { message: "Esa cuenta no existe" });
  await db.delete(session).where(eq(session.userId, target));
  disconnectUser(target);
  const open = await db.select({ id: report.id }).from(report)
    .where(and(eq(report.targetUserId, target), eq(report.status, "open")));
  await closeReports(open.map((r) => r.id), admin.id, "actioned", `Cuenta suspendida: ${reason}`);
  return c.json({ ok: true });
});

adminRoutes.post("/admin/users/:id/unsuspend", async (c) => {
  await db.update(profile).set({ suspendedAt: null, suspendReason: null }).where(eq(profile.userId, c.req.param("id")));
  return c.json({ ok: true });
});

// ---------- Grupos ----------

/** Dar de baja un grupo: desaparece para todo el mundo y queda guardado como prueba. Cierra sus reportes abiertos. */
adminRoutes.post("/admin/groups/:id/remove", async (c) => {
  const admin = c.get("user");
  const { reason } = z.object({ reason: z.string().trim().min(3, "Escribí un motivo").max(300) }).parse(await c.req.json());
  const [g] = await db.select().from(group).where(eq(group.id, c.req.param("id")));
  if (!g) throw new HTTPException(404, { message: "Ese grupo no existe" });
  if (g.isGeneral) throw new HTTPException(400, { message: "El chat general no se puede dar de baja" });
  if (g.removedAt) throw new HTTPException(409, { message: "Ese grupo ya está dado de baja" });
  await removeGroup(g.id, `Moderación: ${reason}`);
  const open = await db.select({ id: report.id }).from(report).where(and(eq(report.groupId, g.id), eq(report.status, "open")));
  await closeReports(open.map((r) => r.id), admin.id, "actioned", `Grupo dado de baja: ${reason}`);
  return c.json({ ok: true });
});

/** Volver a activar un grupo dado de baja (si fue un error). Los miembros siguen siendo los mismos. */
adminRoutes.post("/admin/groups/:id/restore", async (c) => {
  const [g] = await db.update(group).set({ removedAt: null, removedReason: null })
    .where(and(eq(group.id, c.req.param("id")), isNotNull(group.removedAt))).returning();
  if (!g) throw new HTTPException(404, { message: "Ese grupo no está dado de baja" });
  return c.json({ ok: true });
});

/** Grupos dados de baja, con cuántos días les quedan antes de borrarse del todo. */
adminRoutes.get("/admin/groups/removed", async (c) => {
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

adminRoutes.get("/admin/suspended", async (c) => {
  const rows = await db
    .select({ id: profile.userId, reason: profile.suspendReason, at: profile.suspendedAt, email: user.email })
    .from(profile)
    .innerJoin(user, eq(user.id, profile.userId))
    .where(isNotNull(profile.suspendedAt))
    .orderBy(desc(profile.suspendedAt));
  const people = await authorsFor(rows.map((r) => r.id));
  return c.json(rows.map((r) => ({ ...people.get(r.id)!, reason: r.reason, suspendedAt: r.at!.toISOString() })));
});
