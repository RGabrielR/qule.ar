import { createHmac } from "node:crypto";
import { and, desc, eq, gte, inArray, isNotNull, notInArray, sql, type SQL } from "drizzle-orm";
import { dataKey } from "./crypt.js";
import { db, schema } from "./db/index.js";
import { URGENT_REASONS } from "./moderation.js";

/**
 * Reportes de mala fe: cuentas que reportan de una forma que vale la pena mirar.
 *
 * Los reportes son la herramienta más importante para cuidar a la comunidad, pero una cuenta (o varias que se ponen de
 * acuerdo) puede usarlos para tapar los reportes de verdad, llenar de avisos a moderación o intentar que oculten o
 * suspendan a alguien. El 24/11 una cuenta mandó 56 reportes en 4 horas contra 50 personas. Ver las discusiones #219
 * y la de moderación.
 *
 * Señales (ninguna decide sola: todas terminan en una tarjeta para que una persona mire y decida):
 * - "burst": reportó a REPORT_SPAM_TARGETS personas o grupos distintos en REPORT_SPAM_WINDOW_MS.
 * - "dismissed": de sus reportes ya revisados en los últimos HISTORY_DAYS, al menos DISMISSED_RATIO se descartaron.
 * - "noAction": mandó NO_ACTION_MIN_REPORTS reportes en los últimos HISTORY_DAYS (revisados o no) y ninguno terminó en
 *   una medida. Atrapa a quien reporta mucho sin llegar a la ráfaga de una hora (por ejemplo, 4 por hora todo el día)
 *   antes de que moderación llegue a revisarlos. Si ya salta "dismissed", no se repite.
 * - "pileOn": junto con otras cuentas reportó a la misma persona o grupo en PILE_ON_WINDOW_MS, y varias de esas
 *   cuentas son nuevas (menos de NEW_ACCOUNT_DAYS) o se crearon casi juntas (SIGNUP_CLUSTER_MS). Se marca solo a las
 *   cuentas nuevas o creadas juntas: quien reportó lo mismo desde una cuenta vieja no aparece.
 *
 * Qué puede hacer moderación: suspender a quien reporta, hacer que sus reportes dejen de contar (tabla report_mute),
 * descartar sus reportes de la última hora o ignorar la tarjeta. La app no suspende sola a nadie.
 * - Con la ráfaga ("burst"), los reportes urgentes de esa cuenta dejan de mandar avisos al instante. Ignorar la tarjeta
 *   los devuelve (si eran reportes de verdad, que avisen).
 * - Descartar en bloque nunca toca los reportes urgentes ni los de antes de la última hora: esos se revisan de a uno.
 * - Quién reporta no se le muestra al equipo (solo a la administración general): cada tarjeta tiene un identificador
 *   propio (alertKey) y la cuenta se resuelve en el servidor.
 *
 * Los reportes de una cuenta que no cuenta siguen entrando y se ven en el panel, pero no ocultan perfiles ni grupos,
 * no mandan avisos urgentes, no suman personas en las tarjetas y no alcanzan para una suspensión preventiva.
 * A quien reporta no se le dice nada: ni a quien reporta de buena fe ni a quien quedó marcado.
 */
export const REPORT_SPAM_TARGETS = 5;
export const REPORT_SPAM_WINDOW_MS = 60 * 60 * 1000;
export const HISTORY_DAYS = 90;
export const DISMISSED_MIN_RESOLVED = 5;
export const DISMISSED_RATIO = 0.8;
export const NO_ACTION_MIN_REPORTS = 15;
export const PILE_ON_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PILE_ON_REPORTERS = 3;
export const NEW_ACCOUNT_DAYS = 7;
export const SIGNUP_CLUSTER_MS = 60 * 60 * 1000;

/**
 * Acción en el registro de moderación con la que se ignora una tarjeta. Vuelve cuando pasó la ventana de una hora, la
 * cuenta mandó reportes nuevos y sigue habiendo alguna señal.
 */
export const REPORT_SPAM_IGNORED = "Ignoró una alerta de spam de reportes";
export const REPORTS_MUTED = "Hizo que los reportes de una cuenta dejen de contar";
export const REPORTS_UNMUTED = "Hizo que los reportes de una cuenta vuelvan a contar";

const { report, profile, modAction, reportMute, user } = schema;
/** Sobre qué es un reporte: una persona o un grupo. */
const subject = sql`coalesce(${report.targetUserId}, 'g:' || ${report.groupId})`;
const DAY = 86_400_000;

// ---------- Reportes que no cuentan ----------

/** Condición SQL: el reporte cuenta (lo mandó la app o una cuenta cuyos reportes no se silenciaron). */
export const reportCounts: SQL = sql`(${report.reporterId} is null or ${report.reporterId} not in (select ${reportMute.userId} from ${reportMute}))`;

/** Cuentas cuyos reportes dejaron de contar. */
export async function mutedReporters(): Promise<Set<string>> {
  const rows = await db.select({ id: reportMute.userId }).from(reportMute);
  return new Set(rows.map((r) => r.id));
}

export async function isMutedReporter(userId: string): Promise<boolean> {
  const [r] = await db.select({ id: reportMute.userId }).from(reportMute).where(eq(reportMute.userId, userId)).limit(1);
  return Boolean(r);
}

// ---------- Señales ----------

/** A cuántas personas o grupos distintos reportó esta cuenta en la última ventana. */
export async function recentReportTargets(reporterId: string, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - REPORT_SPAM_WINDOW_MS);
  const [r] = await db.select({ n: sql<number>`count(distinct ${subject})::int` }).from(report)
    .where(and(eq(report.reporterId, reporterId), gte(report.createdAt, since)));
  return r?.n ?? 0;
}

/** Cuentas cuya tarjeta alguien ignoró desde `since`. */
async function ignoredSince(ids: string[], since: Date): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.select({ id: modAction.targetId }).from(modAction)
    .where(and(eq(modAction.action, REPORT_SPAM_IGNORED), inArray(modAction.targetId, ids), gte(modAction.createdAt, since)));
  return new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
}

/**
 * Si esta cuenta está en ráfaga de reportes: sobre el umbral y sin que nadie haya ignorado la tarjeta en la ventana.
 * Mientras lo está, sus reportes urgentes no mandan aviso al instante.
 */
export async function reportSpamStatus(reporterId: string, now = new Date()): Promise<{ targets: number; flagged: boolean }> {
  const targets = await recentReportTargets(reporterId, now);
  if (targets < REPORT_SPAM_TARGETS) return { targets, flagged: false };
  const ignored = await ignoredSince([reporterId], new Date(now.getTime() - REPORT_SPAM_WINDOW_MS));
  return { targets, flagged: !ignored.has(reporterId) };
}

/** Identificador de una tarjeta (o de una cuenta cuyos reportes no cuentan), que no deja saber de qué cuenta es. */
export const alertKey = (reporterId: string) =>
  createHmac("sha256", dataKey()).update(`report-spam:${reporterId}`).digest("base64url").slice(0, 22);

/** La cuenta detrás de una tarjeta activa, o null si la tarjeta ya no está. */
export async function resolveAlert(key: string, now = new Date()): Promise<string | null> {
  const alerts = await reportSpamAlerts(now);
  return alerts.find((a) => alertKey(a.reporterId) === key)?.reporterId ?? null;
}

/** La cuenta detrás de un identificador de la lista de reportes que no cuentan, o null si ya volvieron a contar. */
export async function resolveMuted(key: string): Promise<string | null> {
  const ids = await mutedReporters();
  return [...ids].find((id) => alertKey(id) === key) ?? null;
}

/** Condición SQL: los reportes que se descartan en bloque (abiertos, de la última hora y no urgentes). */
const dismissableSince = (since: Date): SQL => and(
  eq(report.status, "open"),
  gte(report.createdAt, since),
  notInArray(report.reason, [...URGENT_REASONS]),
)!;

/** Los reportes que se descartan en bloque: abiertos, de la última hora y no urgentes. */
export async function dismissableReportsBy(reporterId: string, now = new Date()): Promise<string[]> {
  const since = new Date(now.getTime() - REPORT_SPAM_WINDOW_MS);
  const rows = await db.select({ id: report.id }).from(report)
    .where(and(eq(report.reporterId, reporterId), dismissableSince(since)))
    .orderBy(desc(report.createdAt));
  return rows.map((r) => r.id);
}

export type ReporterSignal =
  | { kind: "burst"; targets: number; lastHour: number }
  | { kind: "dismissed"; dismissed: number; resolved: number }
  | { kind: "noAction"; total: number }
  | { kind: "pileOn"; reporters: number; newAccounts: number; closeSignups: number };

export type ReporterHistory = { total: number; open: number; dismissed: number; actioned: number };

export type ReportSpamAlert = {
  reporterId: string;
  signals: ReporterSignal[];
  /** Personas o grupos distintos que reportó en la última hora. */
  targets: number;
  /** Reportes que mandó en la última hora. */
  lastHour: number;
  /** Su primer reporte de la última hora (o el último que mandó, si no hay de la última hora). */
  since: string;
  /** Reportes que se descartarían en bloque (abiertos, de la última hora, no urgentes). */
  dismissable: number;
  /** Cómo terminaron sus reportes de los últimos HISTORY_DAYS días. */
  history: ReporterHistory;
};

/** Cómo terminaron los reportes de estas cuentas en los últimos HISTORY_DAYS días. */
async function historyOf(ids: string[], now: Date): Promise<Map<string, ReporterHistory>> {
  const out = new Map<string, ReporterHistory>();
  if (!ids.length) return out;
  const rows = await db.select({ id: report.reporterId, status: report.status, n: sql<number>`count(*)::int` }).from(report)
    .where(and(inArray(report.reporterId, ids), gte(report.createdAt, new Date(now.getTime() - HISTORY_DAYS * DAY))))
    .groupBy(report.reporterId, report.status);
  for (const id of ids) out.set(id, { total: 0, open: 0, dismissed: 0, actioned: 0 });
  for (const r of rows) {
    const h = out.get(r.id!)!;
    h.total += r.n;
    if (r.status === "open" || r.status === "dismissed" || r.status === "actioned") h[r.status] += r.n;
  }
  return out;
}

/**
 * Reportes contra una misma persona o grupo, de varias cuentas en poco tiempo, donde varias son nuevas o se crearon
 * casi juntas. Devuelve, por cuenta marcada, el tamaño del grupo que reportó (si está en varios, el más grande).
 */
async function pileOns(now: Date): Promise<Map<string, Extract<ReporterSignal, { kind: "pileOn" }>>> {
  const rows = await db.select({
    subject: sql<string>`${subject}`,
    reporterId: report.reporterId,
    reportedAt: report.createdAt,
    signedUpAt: user.createdAt,
  }).from(report)
    .innerJoin(user, eq(user.id, report.reporterId))
    .where(and(isNotNull(report.reporterId), gte(report.createdAt, new Date(now.getTime() - PILE_ON_WINDOW_MS))));
  const bySubject = new Map<string, Map<string, { reportedAt: Date; signedUpAt: Date }>>();
  for (const r of rows) {
    const m = bySubject.get(r.subject) ?? new Map();
    const prev = m.get(r.reporterId!);
    if (!prev || r.reportedAt < prev.reportedAt) m.set(r.reporterId!, { reportedAt: r.reportedAt, signedUpAt: r.signedUpAt });
    bySubject.set(r.subject, m);
  }
  const out = new Map<string, Extract<ReporterSignal, { kind: "pileOn" }>>();
  for (const reporters of bySubject.values()) {
    if (reporters.size < PILE_ON_REPORTERS) continue;
    const list = [...reporters.entries()];
    const isNew = new Set(list.filter(([, x]) => x.reportedAt.getTime() - x.signedUpAt.getTime() < NEW_ACCOUNT_DAYS * DAY).map(([id]) => id));
    const close = new Set(list.filter(([id, x]) => list.some(([other, y]) =>
      other !== id && Math.abs(x.signedUpAt.getTime() - y.signedUpAt.getTime()) < SIGNUP_CLUSTER_MS)).map(([id]) => id));
    if (isNew.size < 2 && close.size < 2) continue;
    const signal = { kind: "pileOn" as const, reporters: reporters.size, newAccounts: isNew.size, closeSignups: close.size };
    for (const id of new Set([...(isNew.size >= 2 ? isNew : []), ...(close.size >= 2 ? close : [])])) {
      const prev = out.get(id);
      if (!prev || prev.reporters < signal.reporters) out.set(id, signal);
    }
  }
  return out;
}

/**
 * Las tarjetas activas: cuentas con alguna señal, que no están suspendidas, cuyos reportes todavía cuentan y cuya
 * tarjeta nadie ignoró después de su último reporte.
 */
export async function reportSpamAlerts(now = new Date()): Promise<ReportSpamAlert[]> {
  const hourAgo = new Date(now.getTime() - REPORT_SPAM_WINDOW_MS);
  const [bursts, resolved, piles] = await Promise.all([
    db.select({
      reporterId: report.reporterId,
      targets: sql<number>`count(distinct ${subject})::int`,
      lastHour: sql<number>`count(*)::int`,
      since: sql<string>`min(${report.createdAt})`,
    }).from(report)
      .where(and(isNotNull(report.reporterId), gte(report.createdAt, hourAgo)))
      .groupBy(report.reporterId),
    // Solo quienes tienen suficientes reportes (revisados, o en total) como para que la proporción diga algo
    db.select({ id: report.reporterId }).from(report)
      .where(and(isNotNull(report.reporterId), gte(report.createdAt, new Date(now.getTime() - HISTORY_DAYS * DAY))))
      .groupBy(report.reporterId)
      .having(sql`count(*) filter (where ${report.status} in ('dismissed', 'actioned')) >= ${DISMISSED_MIN_RESOLVED}
        or count(*) >= ${NO_ACTION_MIN_REPORTS}`),
    pileOns(now),
  ]);
  const burstBy = new Map(bursts.map((b) => [b.reporterId!, b]));
  const candidates = [...new Set([
    ...bursts.filter((b) => b.targets >= REPORT_SPAM_TARGETS).map((b) => b.reporterId!),
    ...resolved.map((r) => r.id!),
    ...piles.keys(),
  ])];
  if (!candidates.length) return [];

  const [suspended, muted, ignored, latest, history, dismissable] = await Promise.all([
    db.select({ id: profile.userId }).from(profile).where(and(inArray(profile.userId, candidates), isNotNull(profile.suspendedAt))),
    db.select({ id: reportMute.userId }).from(reportMute).where(inArray(reportMute.userId, candidates)),
    db.select({ id: modAction.targetId, at: sql<string>`max(${modAction.createdAt})` }).from(modAction)
      .where(and(eq(modAction.action, REPORT_SPAM_IGNORED), inArray(modAction.targetId, candidates)))
      .groupBy(modAction.targetId),
    db.select({ id: report.reporterId, at: sql<string>`max(${report.createdAt})` }).from(report)
      .where(inArray(report.reporterId, candidates)).groupBy(report.reporterId),
    historyOf(candidates, now),
    db.select({ id: report.reporterId, n: sql<number>`count(*)::int` }).from(report)
      .where(and(inArray(report.reporterId, candidates), dismissableSince(hourAgo)))
      .groupBy(report.reporterId),
  ]);
  const skip = new Set([...suspended, ...muted].map((x) => x.id));
  const ignoredAt = new Map(ignored.map((x) => [x.id!, new Date(x.at).getTime()]));
  const latestAt = new Map(latest.map((x) => [x.id!, new Date(x.at).getTime()]));

  const out: ReportSpamAlert[] = [];
  for (const id of candidates) {
    if (skip.has(id)) continue;
    // Ignorada: no vuelve hasta que pase la ventana, la cuenta mande un reporte nuevo y siga habiendo alguna señal
    const ig = ignoredAt.get(id);
    if (ig !== undefined && (ig >= hourAgo.getTime() || ig >= (latestAt.get(id) ?? 0))) continue;
    const h = history.get(id)!;
    const b = burstBy.get(id);
    const signals: ReporterSignal[] = [];
    if (b && b.targets >= REPORT_SPAM_TARGETS) signals.push({ kind: "burst", targets: b.targets, lastHour: b.lastHour });
    const done = h.dismissed + h.actioned;
    if (done >= DISMISSED_MIN_RESOLVED && h.dismissed / done >= DISMISSED_RATIO) signals.push({ kind: "dismissed", dismissed: h.dismissed, resolved: done });
    else if (h.total >= NO_ACTION_MIN_REPORTS && h.actioned === 0) signals.push({ kind: "noAction", total: h.total });
    const pile = piles.get(id);
    if (pile) signals.push(pile);
    if (!signals.length) continue;
    out.push({
      reporterId: id,
      signals,
      targets: b?.targets ?? 0,
      lastHour: b?.lastHour ?? 0,
      since: new Date(b?.since ?? latestAt.get(id) ?? now).toISOString(),
      dismissable: dismissable.find((d) => d.id === id)?.n ?? 0,
      history: h,
    });
  }
  // Primero las que tienen más señales; después, las que reportaron a más gente en la última hora
  return out.sort((a, b) => b.signals.length - a.signals.length || b.targets - a.targets || b.history.total - a.history.total);
}

export type MutedReporter = { reporterId: string; mutedAt: string; reason: string | null; history: ReporterHistory };

/** Las cuentas cuyos reportes no cuentan, de la más reciente a la más vieja. */
export async function mutedReporterList(now = new Date()): Promise<MutedReporter[]> {
  const rows = await db.select().from(reportMute).orderBy(desc(reportMute.createdAt)).limit(200);
  const history = await historyOf(rows.map((r) => r.userId), now);
  return rows.map((r) => ({ reporterId: r.userId, mutedAt: r.createdAt.toISOString(), reason: r.reason, history: history.get(r.userId)! }));
}
