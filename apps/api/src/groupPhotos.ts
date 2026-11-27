import { activeSuspension } from "./suspensionStatus.js";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db/index.js";
import { env } from "./env.js";
import { deleteImageUnlessEvidence, isUrgent, REPORT_REASONS } from "./moderation.js";
import { ALWAYS_COUNTS_REASON, isMutedReporter, reportCounts } from "./reportSpam.js";

/** Cuántas cuentas distintas (con antigüedad y cuyos reportes cuentan) ocultan una foto por un motivo no urgente. */
export const GROUP_PHOTO_REPORTERS = 3;
/** Antigüedad mínima de una cuenta para sumar a ese número. Es el mismo criterio de la suspensión automática. */
export const GROUP_PHOTO_REPORTER_MIN_AGE_HOURS = 48;
/** Copia que guarda el reporte de una foto del piloto. El panel la usa para agruparlos (ver subjectOf en admin.ts). */
export const GROUP_PHOTO_REPORT_BODY = "Foto del grupo (piloto)";

export function groupPhotoPilot(group: { id: string; isGeneral: boolean }) {
  return !group.isGeneral && env.GROUP_PHOTO_PILOT_IDS.includes(group.id);
}

/** Retira las referencias antes de liberar los archivos. La evidencia pertenece al reporte. */
export async function releaseGroupPhotos(userId: string) {
  const { groupMessage: m } = schema;
  const rows = await db.select({ id: m.id, key: m.photoKey }).from(m)
    .where(and(isNotNull(m.photoKey), eq(m.userId, userId)));
  if (!rows.length) return;
  await db.update(m).set({ photoKey: null }).where(inArray(m.id, rows.map((row) => row.id)));
  for (const row of rows) if (row.key) await deleteImageUnlessEvidence(row.key);
}

export async function canOpenGroupPhoto(groupId: string, messageId: string, viewer: string) {
  const { group, groupMember, groupMessage: m, block, profile } = schema;
  const [row] = await db.select({ author: m.userId, key: m.photoKey }).from(m)
    .innerJoin(group, and(eq(group.id, m.groupId), isNull(group.removedAt), eq(group.isGeneral, false)))
    .innerJoin(groupMember, and(eq(groupMember.groupId, group.id), eq(groupMember.userId, viewer)))
    .innerJoin(profile, and(eq(profile.userId, m.userId), sql`not ${activeSuspension()}`))
    .where(and(eq(m.groupId, groupId), eq(m.id, messageId), eq(m.status, "published"), isNull(m.photoHiddenAt), isNotNull(m.photoKey)));
  if (!row?.key) return null;
  const [blocked] = await db.select({ id: block.blockerId }).from(block).where(
    and(inArray(block.blockerId, [row.author, viewer]), inArray(block.blockedId, [row.author, viewer])),
  ).limit(1);
  return blocked ? null : row.key;
}

/**
 * Guarda el reporte de una foto del piloto y decide si se oculta para todo el grupo.
 * - Un motivo urgente (menor de edad, contenido íntimo sin consentimiento, amenazas) la oculta con el primer reporte:
 *   en estos grupos cada minuto visible es más gente que la puede guardar. Se puede restaurar desde Moderación.
 *   No pasa si moderación decidió que los reportes de esa cuenta no cuentan, salvo por menor de edad, que cuenta siempre.
 * - Por otro motivo, la ocultan GROUP_PHOTO_REPORTERS cuentas distintas con al menos GROUP_PHOTO_REPORTER_MIN_AGE_HOURS
 *   horas y cuyos reportes cuentan.
 * Devuelve null si la foto ya no está disponible para quien reporta.
 */
export async function reportGroupPhoto(input: {
  messageId: string;
  groupId: string;
  reporterId: string;
  targetUserId: string;
  reason: (typeof REPORT_REASONS)[number];
  details?: string;
}): Promise<{ hidden: boolean; fresh: boolean } | null> {
  const { groupMessage, group, groupMember, report, profile, user } = schema;
  const muted = input.reason !== ALWAYS_COUNTS_REASON && await isMutedReporter(input.reporterId).catch(() => false);
  const [reporter] = await db.select({ createdAt: user.createdAt }).from(user).where(eq(user.id, input.reporterId));
  const seasoned = Boolean(reporter && Date.now() - reporter.createdAt.getTime() >= GROUP_PHOTO_REPORTER_MIN_AGE_HOURS * 3_600_000);
  const [target] = await db.select({ name: profile.displayName }).from(profile).where(eq(profile.userId, input.targetUserId));
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(groupMessage).where(eq(groupMessage.id, input.messageId)).for("update");
    if (!current?.photoKey || current.status !== "published") return null;
    const [active] = await tx.select({ id: group.id }).from(group)
      .innerJoin(groupMember, and(eq(groupMember.groupId, group.id), eq(groupMember.userId, input.reporterId)))
      .where(and(eq(group.id, input.groupId), isNull(group.removedAt)));
    if (!active) return null;
    const open = and(eq(report.messageId, input.messageId), eq(report.messageKind, "group"), eq(report.status, "open"));
    const existing = await tx.select({
      reporterId: report.reporterId,
      counts: sql<boolean>`coalesce(${reportCounts} and ${user.createdAt} <= ${report.createdAt} - make_interval(hours => ${GROUP_PHOTO_REPORTER_MIN_AGE_HOURS}), false)`,
    }).from(report).leftJoin(user, eq(user.id, report.reporterId)).where(open);
    if (existing.some((x) => x.reporterId === input.reporterId)) return { hidden: false, fresh: false };
    await tx.insert(report).values({
      id: crypto.randomUUID(), reporterId: input.reporterId, targetUserId: input.targetUserId,
      reason: input.reason, details: input.details, messageId: input.messageId, messageKind: "group",
      targetName: target?.name ?? null, messageBody: GROUP_PHOTO_REPORT_BODY, evidenceKeys: [current.photoKey],
    });
    const reporters = new Set(existing.flatMap((x) => (x.counts && x.reporterId ? [x.reporterId] : [])));
    if (seasoned && !muted) reporters.add(input.reporterId);
    const urgent = isUrgent(input.reason) && !muted;
    const hide = !current.photoHiddenAt && (urgent || reporters.size >= GROUP_PHOTO_REPORTERS);
    if (hide) await tx.update(groupMessage).set({ photoHiddenAt: new Date() }).where(eq(groupMessage.id, input.messageId));
    return { hidden: hide, fresh: true };
  });
}
