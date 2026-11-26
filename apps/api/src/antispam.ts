import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db/index.js";
import type { SpamRules } from "./db/schema.js";

const { groupMessage } = schema;

export type Slot =
  | { ok: true; at: Date; intervalSeconds: number; reasons: string[] }
  | { ok: false; error: string };

/**
 * Decide cuándo sale el próximo mensaje de alguien en un grupo.
 *
 * 1. Modo lento: como máximo `burst` mensajes cada `burst × intervalo`.
 *    Si te pasás, el mensaje no se rechaza: queda en cola hasta que te toque.
 * 2. Rotación: si tenés `rotationMax` o más de los últimos `rotationWindow`
 *    mensajes del grupo, tu intervalo se duplica.
 * 3. Cuentas nuevas: durante las primeras `newAccountHours`, el intervalo se triplica.
 */
export async function nextSlot(opts: {
  groupId: string;
  userId: string;
  userCreatedAt: Date;
  rules: SpamRules;
  now?: Date;
}, reader: Pick<typeof db, "select"> = db): Promise<Slot> {
  const { groupId, userId, rules } = opts;
  const now = opts.now ?? new Date();

  const [{ queued }] = await reader
    .select({ queued: sql<number>`count(*)::int` })
    .from(groupMessage)
    .where(and(eq(groupMessage.groupId, groupId), eq(groupMessage.userId, userId), eq(groupMessage.status, "queued")));
  if (queued >= rules.maxQueued) {
    return { ok: false, error: `Ya tenés ${queued} mensajes en cola. Esperá a que salgan o cancelá alguno.` };
  }

  let interval = rules.intervalSeconds;
  const reasons: string[] = [];

  const ageHours = (now.getTime() - opts.userCreatedAt.getTime()) / 3_600_000;
  if (ageHours < rules.newAccountHours) {
    interval *= 3;
    reasons.push("cuenta nueva");
  }

  const recentInGroup = await reader
    .select({ userId: groupMessage.userId })
    .from(groupMessage)
    .where(and(eq(groupMessage.groupId, groupId), eq(groupMessage.status, "published")))
    .orderBy(desc(groupMessage.scheduledAt))
    .limit(rules.rotationWindow);
  const mine = recentInGroup.filter((m) => m.userId === userId).length;
  if (mine >= rules.rotationMax) {
    interval *= 2;
    reasons.push("hablaste mucho últimamente");
  }

  // Los borrados también cuentan, para que borrar y volver a mandar no sirva para saltarse el límite.
  const myRecent = await reader
    .select({ scheduledAt: groupMessage.scheduledAt })
    .from(groupMessage)
    .where(and(
      eq(groupMessage.groupId, groupId),
      eq(groupMessage.userId, userId),
      inArray(groupMessage.status, ["queued", "published", "deleted"]),
    ))
    .orderBy(desc(groupMessage.scheduledAt))
    .limit(rules.burst);

  let at = now;
  if (myRecent.length >= rules.burst) {
    const oldest = myRecent[myRecent.length - 1].scheduledAt;
    const free = new Date(oldest.getTime() + rules.burst * interval * 1000);
    if (free > at) at = free;
  }
  return { ok: true, at, intervalSeconds: interval, reasons };
}
