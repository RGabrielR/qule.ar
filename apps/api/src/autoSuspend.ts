import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { db, schema } from "./db/index.js";
import { sendMail, suspendedMail } from "./mail.js";
import { disconnectUser } from "./realtime.js";
import { accessFor, isOwner, notifyStaff } from "./staff.js";

/**
 * Suspensión automática: cuando muchas personas distintas reportan a la misma cuenta por lo mismo y moderación no
 * llega a revisarlo, la app la suspende sola. Muchas personas diciendo lo mismo es motivo suficiente para frenar la
 * cuenta hasta que alguien la mire. Después, una persona del equipo la mantiene o reactiva la cuenta.
 *
 * - Cuenta si AUTO_SUSPEND_REPORTERS personas distintas la reportan por el mismo motivo en AUTO_SUSPEND_DAYS días,
 *   y esos reportes siguen abiertos. Si moderación los descarta, dejan de contar.
 * - No cuenta el motivo "otro" (es demasiado vago para decir que es "lo mismo").
 * - Para que no sirva para atacar a alguien con cuentas recién creadas, solo cuentan las personas cuya cuenta tenía
 *   al menos AUTO_SUSPEND_REPORTER_MIN_AGE_HOURS horas al reportar y que no están suspendidas.
 * - Al llegar al número, moderación recibe un aviso y tiene AUTO_SUSPEND_GRACE_HOURS horas para revisarlo.
 *   Si nadie descarta los reportes ni actúa, la cuenta se suspende sola.
 * - A la administración general y al equipo no se los suspende solos: se avisa a la administración general.
 */
export const AUTO_SUSPEND_REPORTERS = 5;
export const AUTO_SUSPEND_DAYS = 21;
export const AUTO_SUSPEND_GRACE_HOURS = 24;
export const AUTO_SUSPEND_REPORTER_MIN_AGE_HOURS = 48;
/** Motivos que no cuentan para la suspensión automática. */
const NOT_COUNTED = "otro";
/** Acción en el registro (sin persona: la hizo la app). La suspensión queda pendiente de revisión, como la preventiva. */
export const AUTO_SUSPENDED = "Suspensión automática por reportes de varias personas";

const { report, profile, user, session, modAction } = schema;
const HOUR = 3_600_000;

type Candidate = { targetId: string; reason: string; reporters: number; reachedAt: Date };

/**
 * Cuentas que llegaron al número de personas distintas por el mismo motivo (con reportes abiertos y que cuentan).
 * reachedAt: cuándo llegó el reporte de la quinta persona. Con `until`, solo cuentan los reportes hasta esa fecha.
 */
export async function autoSuspendCandidates(now = new Date(), until?: Date): Promise<Candidate[]> {
  const since = new Date(now.getTime() - AUTO_SUSPEND_DAYS * 24 * HOUR);
  // El primer reporte de cada persona, por cuenta reportada y motivo
  const firsts = db
    .select({
      targetId: report.targetUserId,
      reason: report.reason,
      reporterId: report.reporterId,
      first: sql<Date>`min(${report.createdAt})`.as("first"),
    })
    .from(report)
    .innerJoin(user, eq(user.id, report.reporterId))
    .innerJoin(profile, eq(profile.userId, report.reporterId))
    .where(and(
      eq(report.status, "open"),
      ne(report.reason, NOT_COUNTED),
      gte(report.createdAt, since),
      until ? lte(report.createdAt, until) : undefined,
      isNull(profile.suspendedAt),
      sql`${user.createdAt} <= ${report.createdAt} - make_interval(hours => ${AUTO_SUSPEND_REPORTER_MIN_AGE_HOURS})`,
      sql`${report.targetUserId} is not null`,
      sql`${report.targetUserId} <> ${report.reporterId}`,
    ))
    .groupBy(report.targetUserId, report.reason, report.reporterId)
    .as("firsts");
  const rows = await db
    .select({
      targetId: firsts.targetId,
      reason: firsts.reason,
      reporters: sql<number>`count(*)::int`,
      // La quinta persona en llegar (orden de su primer reporte)
      reachedAt: sql<string>`(array_agg(${firsts.first} order by ${firsts.first}))[${AUTO_SUSPEND_REPORTERS}]`,
    })
    .from(firsts)
    .groupBy(firsts.targetId, firsts.reason)
    .having(sql`count(*) >= ${AUTO_SUSPEND_REPORTERS}`);
  return rows.flatMap((r) => (r.targetId ? [{ targetId: r.targetId, reason: r.reason, reporters: r.reporters, reachedAt: new Date(r.reachedAt) }] : []));
}

/**
 * Para el panel: las cuentas que se van a suspender solas si nadie las revisa, con cuándo (una por cuenta: la primera
 * que vence). Las que ya están suspendidas no aparecen.
 */
export async function pendingAutoSuspensions(now = new Date()): Promise<Map<string, { reason: string; at: string }>> {
  const out = new Map<string, { reason: string; at: string }>();
  for (const c of await autoSuspendCandidates(now)) {
    const at = new Date(c.reachedAt.getTime() + AUTO_SUSPEND_GRACE_HOURS * HOUR).toISOString();
    const prev = out.get(c.targetId);
    if (!prev || at < prev.at) out.set(c.targetId, { reason: c.reason, at });
  }
  if (!out.size) return out;
  const suspended = await db.select({ id: profile.userId }).from(profile)
    .where(and(inArray(profile.userId, [...out.keys()]), isNotNull(profile.suspendedAt)));
  for (const s of suspended) out.delete(s.id);
  return out;
}

/**
 * Después de guardar un reporte de una cuenta: si con este se llega al número, le avisa a moderación que tiene
 * AUTO_SUSPEND_GRACE_HOURS horas para revisarlo. Avisa una sola vez (cuando llega la quinta persona).
 */
export async function warnIfReachingAutoSuspend(targetId: string, reason: string, reporterId: string, now = new Date()) {
  if (reason === NOT_COUNTED) return;
  const c = (await autoSuspendCandidates(now)).find((x) => x.targetId === targetId && x.reason === reason);
  if (!c || c.reporters !== AUTO_SUSPEND_REPORTERS) return;
  // Solo si la quinta persona es la que acaba de reportar (y es su primer reporte de esto)
  const [mine] = await db.select({ n: sql<number>`count(*)::int` }).from(report).where(and(
    eq(report.reporterId, reporterId), eq(report.targetUserId, targetId), eq(report.reason, reason), eq(report.status, "open"),
  ));
  if (mine?.n !== 1 || now.getTime() - c.reachedAt.getTime() > 60_000) return;
  await notifyStaff(
    "sanctions",
    {
      title: "Una cuenta se suspende sola en 24 h",
      body: `${AUTO_SUSPEND_REPORTERS} personas la reportaron por lo mismo. Si nadie lo revisa, se suspende sola.`,
      url: "/admin",
      tag: "suspension-automatica",
    },
    { ownersAlways: true },
  );
}

/**
 * Suspende las cuentas que llegaron al número hace más de AUTO_SUSPEND_GRACE_HOURS horas sin que nadie lo revise.
 * Corre cada tanto en el proceso líder. Devuelve cuántas suspendió.
 */
export async function runAutoSuspensions(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - AUTO_SUSPEND_GRACE_HOURS * HOUR);
  const due = new Map<string, Candidate>();
  for (const c of await autoSuspendCandidates(now, cutoff)) if (!due.has(c.targetId)) due.set(c.targetId, c);
  let n = 0;
  for (const c of due.values()) {
    const [t] = await db.select({ id: user.id, email: user.email, emailVerified: user.emailVerified }).from(user).where(eq(user.id, c.targetId));
    if (!t) continue;
    // A la administración general y al equipo no los suspende la app: lo decide la administración general
    if (isOwner(t) || (await accessFor(t)).length > 0) {
      const [warned] = await db.select({ id: modAction.id }).from(modAction)
        .where(and(eq(modAction.action, `${AUTO_SUSPENDED} (no aplicada: es del equipo)`), eq(modAction.targetId, t.id), gte(modAction.createdAt, c.reachedAt)))
        .limit(1);
      if (!warned) {
        await db.insert(modAction).values({ id: crypto.randomUUID(), actorId: null, action: `${AUTO_SUSPENDED} (no aplicada: es del equipo)`, targetId: t.id, details: c.reason });
        await notifyStaff("sanctions", { title: "Reportes sobre alguien del equipo", body: "Varias personas reportaron a alguien del equipo. Revisalo en Moderación.", url: "/admin", tag: "suspension-automatica" }, { ownersAlways: true });
      }
      continue;
    }
    const reason = `Suspensión automática: ${c.reporters} personas distintas te reportaron por «${c.reason}» y la cuenta queda frenada hasta que el equipo la revise.`;
    // Solo si sigue activa (si dos procesos corren a la vez, la suspende uno solo)
    const [p] = await db.update(profile).set({ suspendedAt: now, suspendReason: reason, suspendedBy: null })
      .where(and(eq(profile.userId, t.id), isNull(profile.suspendedAt))).returning({ id: profile.userId });
    if (!p) continue;
    await db.delete(session).where(eq(session.userId, t.id));
    disconnectUser(t.id);
    // Como al suspender a mano: los reportes abiertos quedan cerrados con la medida (y se conservan como prueba)
    await db.update(report)
      .set({ status: "actioned", resolvedBy: null, resolvedAt: now, resolution: "Cuenta suspendida automáticamente" })
      .where(and(eq(report.targetUserId, t.id), eq(report.status, "open")));
    await db.insert(modAction).values({ id: crypto.randomUUID(), actorId: null, action: AUTO_SUSPENDED, targetId: t.id, details: `${c.reporters} personas, «${c.reason}»` });
    await notifyStaff(
      "sanctions",
      { title: "Suspensión para revisar", body: "La app suspendió una cuenta por reportes de varias personas. Mantenela o reactivala.", url: "/admin", tag: "suspension-automatica" },
      { ownersAlways: true },
    );
    void sendMail(suspendedMail(t.email), "account");
    n++;
  }
  return n;
}
