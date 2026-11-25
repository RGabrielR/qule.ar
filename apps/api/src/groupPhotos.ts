import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "./db/index.js";
import { env } from "./env.js";
import { deleteImageUnlessEvidence } from "./moderation.js";

export const GROUP_PHOTO_REPORTERS = 3;

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
    .innerJoin(profile, and(eq(profile.userId, m.userId), isNull(profile.suspendedAt)))
    .where(and(eq(m.groupId, groupId), eq(m.id, messageId), eq(m.status, "published"), isNull(m.photoHiddenAt), isNotNull(m.photoKey)));
  if (!row?.key) return null;
  const [blocked] = await db.select({ id: block.blockerId }).from(block).where(
    and(inArray(block.blockerId, [row.author, viewer]), inArray(block.blockedId, [row.author, viewer])),
  ).limit(1);
  return blocked ? null : row.key;
}
