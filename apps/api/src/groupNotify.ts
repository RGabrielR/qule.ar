import { and, eq, exists, ne, notExists, or, sql } from "drizzle-orm";
import { db, schema } from "./db/index.js";
import { pushTo } from "./push.js";
import { hit } from "./shared.js";

const { block, groupMember, groupMessage, pushSubscription } = schema;

/** Como mucho un aviso de "mensajes nuevos" por grupo y persona cada este tiempo, para no saturar. */
const GROUP_PUSH_EVERY_MS = 10 * 60_000;

/**
 * Avisa por push que hay un mensaje nuevo en un grupo (ya publicado, no en cola).
 * - A quien le respondieron: siempre, aunque tenga el grupo silenciado.
 * - Al resto: si no silenció el grupo, como mucho una vez cada 10 minutos.
 * Los textos no dicen el grupo ni quién escribió: se ven en la pantalla bloqueada.
 */
export async function notifyGroupMessage(msg: typeof groupMessage.$inferSelect) {
  let repliedTo: string | null = null;
  if (msg.replyToId) {
    const [orig] = await db.select({ userId: groupMessage.userId }).from(groupMessage).where(eq(groupMessage.id, msg.replyToId));
    repliedTo = orig?.userId ?? null;
  }

  const members = await groupPushRecipients(msg, repliedTo);

  const url = `/grupos/${msg.groupId}`;
  for (const m of members) {
    // Se cuenta para todos los procesos del API juntos (ver shared.ts)
    const key = `grppush:${m.userId}:${msg.groupId}`;
    if (m.userId === repliedTo) {
      await hit(key, 1, GROUP_PUSH_EVERY_MS, true);
      pushTo(m.userId, { title: "Te respondieron en un grupo", body: "Abrí el grupo para ver la respuesta.", url, kind: "respuestas", tag: `grp-${msg.groupId}` }).catch(() => {});
      continue;
    }
    if (!(await hit(key, 1, GROUP_PUSH_EVERY_MS))) continue;
    pushTo(m.userId, { title: "Mensajes nuevos en un grupo", body: "Abrí el grupo para leerlos.", url, kind: "grupos", tag: `grp-${msg.groupId}` }).catch(() => {});
  }
}

/**
 * A quiénes les puede llegar el aviso de un mensaje de grupo.
 * El filtro va en la base: el grupo General tiene decenas de miles de miembros y traerlos a todos para
 * quedarse con unos pocos cargaba mucho el servidor con cada mensaje.
 * Quedan quienes tienen alguna suscripción, no silenciaron el grupo (salvo a quien le respondieron)
 * y no tienen un bloqueo con quien escribió, en ningún sentido.
 */
export function groupPushRecipients(msg: { groupId: string; userId: string }, repliedTo: string | null) {
  return db
    .select({ userId: groupMember.userId })
    .from(groupMember)
    .where(and(
      eq(groupMember.groupId, msg.groupId),
      ne(groupMember.userId, msg.userId),
      repliedTo ? or(eq(groupMember.muted, false), eq(groupMember.userId, repliedTo)) : eq(groupMember.muted, false),
      exists(db.select({ one: sql`1` }).from(pushSubscription).where(eq(pushSubscription.userId, groupMember.userId))),
      notExists(db.select({ one: sql`1` }).from(block)
        .where(and(eq(block.blockerId, msg.userId), eq(block.blockedId, groupMember.userId)))),
      notExists(db.select({ one: sql`1` }).from(block)
        .where(and(eq(block.blockerId, groupMember.userId), eq(block.blockedId, msg.userId)))),
    ));
}
