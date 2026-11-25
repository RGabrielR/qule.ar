import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { DM_EVENTS } from "@mortero/shared/realtime";
import { db, schema } from "./db/index.js";
import { reactionsFor, serializeDm } from "./lib.js";
import { deleteImageUnlessEvidence, URGENT_REASONS } from "./moderation.js";
import { emitToGroupRoom, emitToUser } from "./realtime.js";

const { report, photo, album, groupMessage, directMessage, conversation, reaction } = schema;

/** Suma archivos a la prueba de estos reportes, sin repetir. */
async function addEvidence(where: SQL | undefined, keys: string[]) {
  if (!keys.length) return;
  await db.update(report)
    .set({ evidenceKeys: sql`(select coalesce(jsonb_agg(distinct k), '[]'::jsonb) from jsonb_array_elements_text(${report.evidenceKeys} || ${JSON.stringify(keys)}::jsonb) k)` })
    .where(where);
}

/**
 * Antes de borrar lo que subió una persona suspendida, se guarda la prueba que los reportes necesitan:
 * - Si tiene un reporte urgente (menor de edad, contenido íntimo sin consentimiento, amenazas) abierto o que
 *   terminó en una medida, **todos** sus archivos (perfil, álbumes, videos y fotos por privado) pasan a ser
 *   prueba de ese reporte. Desaparecen de la app, pero no del servidor: pueden hacer falta para una denuncia
 *   (ver docs/MODERACION.md, "Contenido sexual de menores").
 * - Los demás reportes sobre su perfil (sin mensaje ni grupo) suman sus fotos públicas: es lo que vio quien reportó.
 * Los reportes de un mensaje ya tienen su copia (el texto y la foto) desde que se hicieron.
 */
export async function keepEvidence(userId: string) {
  const pics = await db.select({ key: photo.key, posterKey: photo.posterKey, isPrivate: photo.isPrivate }).from(photo)
    .where(eq(photo.userId, userId));
  const sent = await db.select({ key: directMessage.photoKey }).from(directMessage)
    .where(and(eq(directMessage.senderId, userId), isNotNull(directMessage.photoKey)));
  const all = [...pics.flatMap((p) => (p.posterKey ? [p.key, p.posterKey] : [p.key])), ...sent.map((m) => m.key!)];
  const kept = and(eq(report.targetUserId, userId), inArray(report.status, ["open", "actioned"]));
  await addEvidence(and(kept, inArray(report.reason, [...URGENT_REASONS])), all);
  await addEvidence(and(kept, isNull(report.messageId), isNull(report.groupId)), pics.filter((p) => !p.isPrivate).map((p) => p.key));
}

/**
 * Al suspender: se borra lo público de la persona. Sus mensajes en grupos (también los que tenía en cola), sus
 * reacciones en grupos, todas sus fotos y videos (perfil y álbumes privados, con sus miniaturas) y las fotos que
 * mandó por privado. Los archivos que son prueba de un reporte quedan guardados para moderación
 * (deleteImageUnlessEvidence). Quienes tienen los grupos o las charlas abiertas lo ven desaparecer en vivo.
 * Los textos de sus mensajes privados quedan: son privados y son la prueba de quien los recibió.
 * No se puede deshacer: si después se reactiva la cuenta, esto no vuelve.
 */
export async function purgeSuspendedContent(userId: string) {
  // ---- Mensajes en grupos ----
  const msgs = await db.update(groupMessage)
    .set({ status: sql`case when ${groupMessage.status} = 'queued' then 'cancelled' else 'deleted' end`, body: "" })
    .where(and(eq(groupMessage.userId, userId), inArray(groupMessage.status, ["published", "queued"])))
    .returning({ id: groupMessage.id, groupId: groupMessage.groupId, status: groupMessage.status });
  const deleted = msgs.filter((m) => m.status === "deleted");
  if (deleted.length) {
    await db.delete(reaction).where(inArray(reaction.messageId, deleted.map((m) => m.id)));
    // Sin filtrar bloqueos: quien tenía bloqueada a la persona nunca tuvo esos mensajes, y no le cambia nada
    for (const m of deleted) emitToGroupRoom(m.groupId, "group:deleted", { id: m.id, groupId: m.groupId });
  }

  // ---- Sus reacciones a mensajes de otras personas en grupos ----
  const reacted = await db.delete(reaction)
    .where(and(eq(reaction.userId, userId), eq(reaction.scope, "group")))
    .returning({ messageId: reaction.messageId });
  if (reacted.length) {
    const ids = [...new Set(reacted.map((r) => r.messageId))];
    const rows = await db.select({ id: groupMessage.id, groupId: groupMessage.groupId }).from(groupMessage)
      .where(and(inArray(groupMessage.id, ids), eq(groupMessage.status, "published")));
    const now = await reactionsFor(rows.map((r) => r.id));
    for (const r of rows) {
      emitToGroupRoom(r.groupId, "reaction", { scope: "group", groupId: r.groupId, messageId: r.id, reactions: now.get(r.id) ?? [] });
    }
  }

  // ---- Fotos y videos (perfil y álbumes) ----
  const { removed, notices } = await db.transaction(async (tx) => {
    // Los avisos de álbum en sus charlas pasan a "ya no está compartido", como cuando se borra un álbum
    const notices = await tx.update(directMessage).set({ kind: "album_revoked" })
      .where(and(eq(directMessage.senderId, userId), inArray(directMessage.kind, ["album", "album_expired"])))
      .returning();
    const removed = await tx.delete(photo).where(eq(photo.userId, userId))
      .returning({ key: photo.key, posterKey: photo.posterKey });
    await tx.delete(album).where(eq(album.userId, userId)); // los accesos compartidos se borran en cascada
    return { removed, notices };
  });
  const files = removed.flatMap((p) => (p.posterKey ? [p.key, p.posterKey] : [p.key]));

  // ---- Fotos que mandó por privado ----
  const dmPhotos = await db.delete(directMessage)
    .where(and(eq(directMessage.senderId, userId), isNotNull(directMessage.photoKey)))
    .returning();
  const convIds = [...new Set([...dmPhotos, ...notices].map((m) => m.conversationId))];
  const peers = new Map<string, string>();
  if (convIds.length) {
    const convs = await db.select().from(conversation).where(inArray(conversation.id, convIds));
    for (const conv of convs) peers.set(conv.id, conv.userA === userId ? conv.userB : conv.userA);
  }
  for (const m of dmPhotos) {
    const other = peers.get(m.conversationId);
    if (other) emitToUser(other, DM_EVENTS.deleted, { conversationId: m.conversationId, id: m.id });
    files.push(m.photoKey!);
  }
  if (notices.length) {
    const reactions = await reactionsFor(notices.map((n) => n.id));
    for (const n of notices) {
      const other = peers.get(n.conversationId);
      if (other) emitToUser(other, DM_EVENTS.updated, serializeDm(n, reactions.get(n.id)));
    }
  }

  // Lo que es prueba de un reporte queda guardado y desde ahora solo lo ve moderación; el resto se borra
  for (const key of new Set(files)) await deleteImageUnlessEvidence(key);
  return { groupMessages: msgs.length, files: new Set(files).size, directPhotos: dmPhotos.length };
}
