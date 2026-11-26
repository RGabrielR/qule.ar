import { createHmac } from "node:crypto";
import { and, desc, eq, gte, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { dataKey } from "./crypt.js";
import { db, schema } from "./db/index.js";
import { URGENT_REASONS } from "./moderation.js";

/**
 * Alerta de "spam de reportes": una cuenta que reporta a muchas personas distintas en poco tiempo.
 *
 * Los reportes son la herramienta más importante para cuidar a la comunidad, pero una sola cuenta que reporta a todo el
 * mundo tapa los reportes de verdad y llena de avisos a moderación (el 24/11 una cuenta mandó 56 reportes en 4 horas
 * contra 50 personas). Ver la discusión #219.
 *
 * - La alerta salta si alguien reporta a REPORT_SPAM_TARGETS personas (o grupos) distintas en REPORT_SPAM_WINDOW_MS.
 *   Reportar varias veces a la misma persona no suma.
 * - No esconde nada: los reportes siguen entrando. Pero desde que salta, los de esa cuenta no disparan avisos urgentes.
 * - Moderación decide: suspender a quien reporta, descartar sus reportes de la última hora o ignorar la alerta.
 *   La app no suspende sola a nadie.
 * - Ignorar la alerta devuelve los avisos urgentes de esa cuenta (si eran reportes de verdad, que avisen).
 * - Descartar en bloque nunca toca los reportes urgentes ni los de antes de la ventana: esos se revisan de a uno.
 * - Quién reporta no se le muestra al equipo (solo a la administración general): cada alerta tiene un identificador
 *   propio y la cuenta se resuelve en el servidor.
 */
export const REPORT_SPAM_TARGETS = 5;
export const REPORT_SPAM_WINDOW_MS = 60 * 60 * 1000;
/** Acción en el registro de moderación con la que se ignora una alerta (hasta que vuelva a saltar). */
export const REPORT_SPAM_IGNORED = "Ignoró una alerta de spam de reportes";

const { report, profile, modAction } = schema;
/** Sobre qué es un reporte: una persona o un grupo. */
const subject = sql`coalesce(${report.targetUserId}, 'g:' || ${report.groupId})`;

/** A cuántas personas o grupos distintos reportó esta cuenta en la última ventana. */
export async function recentReportTargets(reporterId: string, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - REPORT_SPAM_WINDOW_MS);
  const [r] = await db.select({ n: sql<number>`count(distinct ${subject})::int` }).from(report)
    .where(and(eq(report.reporterId, reporterId), gte(report.createdAt, since)));
  return r?.n ?? 0;
}

/** Cuentas cuya alerta alguien ignoró desde `since`. */
async function ignoredSince(ids: string[], since: Date): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.select({ id: modAction.targetId }).from(modAction)
    .where(and(eq(modAction.action, REPORT_SPAM_IGNORED), inArray(modAction.targetId, ids), gte(modAction.createdAt, since)));
  return new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
}

/**
 * Si esta cuenta está en alerta de spam de reportes: sobre el umbral y sin que nadie haya ignorado la alerta en la
 * ventana. Mientras lo está, sus reportes urgentes no mandan aviso al instante.
 */
export async function reportSpamStatus(reporterId: string, now = new Date()): Promise<{ targets: number; flagged: boolean }> {
  const targets = await recentReportTargets(reporterId, now);
  if (targets < REPORT_SPAM_TARGETS) return { targets, flagged: false };
  const ignored = await ignoredSince([reporterId], new Date(now.getTime() - REPORT_SPAM_WINDOW_MS));
  return { targets, flagged: !ignored.has(reporterId) };
}

/** Identificador de la alerta, que no deja saber de qué cuenta es (el equipo no ve quién reporta). */
export const alertKey = (reporterId: string) =>
  createHmac("sha256", dataKey()).update(`report-spam:${reporterId}`).digest("base64url").slice(0, 22);

/** La cuenta detrás de una alerta activa, o null si la alerta ya no está. */
export async function resolveAlert(key: string, now = new Date()): Promise<string | null> {
  const alerts = await reportSpamAlerts(now);
  return alerts.find((a) => alertKey(a.reporterId) === key)?.reporterId ?? null;
}

/** Los reportes que se descartan en bloque: abiertos, de la ventana de la alerta y no urgentes. */
export async function dismissableReportsBy(reporterId: string, now = new Date()): Promise<string[]> {
  const since = new Date(now.getTime() - REPORT_SPAM_WINDOW_MS);
  const rows = await db.select({ id: report.id }).from(report)
    .where(and(
      eq(report.reporterId, reporterId),
      eq(report.status, "open"),
      gte(report.createdAt, since),
      notInArray(report.reason, [...URGENT_REASONS]),
    ))
    .orderBy(desc(report.createdAt));
  return rows.map((r) => r.id);
}

export type ReportSpamAlert = {
  reporterId: string;
  /** Personas o grupos distintos que reportó en la última hora. */
  targets: number;
  /** Reportes que mandó en la última hora. */
  lastHour: number;
  since: string;
  /** Reportes que se descartarían en bloque (abiertos, de la última hora, no urgentes). */
  dismissable: number;
  /** Su historial completo: cómo terminaron sus reportes. */
  history: { total: number; open: number; dismissed: number; actioned: number };
};

/** Las alertas activas: cuentas sobre el umbral, que no están suspendidas y cuya alerta nadie ignoró en esta ventana. */
export async function reportSpamAlerts(now = new Date()): Promise<ReportSpamAlert[]> {
  const since = new Date(now.getTime() - REPORT_SPAM_WINDOW_MS);
  const rows = await db.select({
    reporterId: report.reporterId,
    targets: sql<number>`count(distinct ${subject})::int`,
    lastHour: sql<number>`count(*)::int`,
    since: sql<string>`min(${report.createdAt})`,
  }).from(report)
    .where(and(isNotNull(report.reporterId), gte(report.createdAt, since)))
    .groupBy(report.reporterId)
    .having(sql`count(distinct ${subject}) >= ${REPORT_SPAM_TARGETS}`);
  const ids = rows.flatMap((r) => (r.reporterId ? [r.reporterId] : []));
  if (!ids.length) return [];
  const [suspended, ignored, history, dismissable] = await Promise.all([
    db.select({ id: profile.userId }).from(profile).where(and(inArray(profile.userId, ids), isNotNull(profile.suspendedAt))),
    ignoredSince(ids, since),
    db.select({ id: report.reporterId, status: report.status, n: sql<number>`count(*)::int` }).from(report)
      .where(inArray(report.reporterId, ids)).groupBy(report.reporterId, report.status),
    db.select({ id: report.reporterId, n: sql<number>`count(*)::int` }).from(report)
      .where(and(
        inArray(report.reporterId, ids),
        eq(report.status, "open"),
        gte(report.createdAt, since),
        notInArray(report.reason, [...URGENT_REASONS]),
      ))
      .groupBy(report.reporterId),
  ]);
  const out: ReportSpamAlert[] = [];
  for (const r of rows) {
    const id = r.reporterId!;
    if (suspended.some((s) => s.id === id)) continue;
    // Ignorada hace poco: no vuelve a aparecer hasta que pase la ventana y vuelva a superar el umbral
    if (ignored.has(id)) continue;
    const mine = history.filter((h) => h.id === id);
    const count = (s: string) => mine.find((h) => h.status === s)?.n ?? 0;
    out.push({
      reporterId: id,
      targets: r.targets,
      lastHour: r.lastHour,
      since: new Date(r.since).toISOString(),
      dismissable: dismissable.find((d) => d.id === id)?.n ?? 0,
      history: { total: mine.reduce((a, h) => a + h.n, 0), open: count("open"), dismissed: count("dismissed"), actioned: count("actioned") },
    });
  }
  return out.sort((a, b) => b.targets - a.targets);
}
