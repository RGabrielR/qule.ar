// Encuestas en el chat de los grupos (propuesta en la discusión 184).
// Una encuesta es un mensaje de grupo: la pregunta es el texto del mensaje y las opciones viven en group_poll.
// Así pasa por las mismas reglas que el resto del chat: antispam y cola, reportes, borrado por moderación y
// la limpieza al suspender una cuenta. Los votos solo se muestran como totales, nunca quién votó qué.
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db/index.js";

const { groupPoll, groupPollVote } = schema;

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 5;
export const POLL_OPTION_MAX = 80;
export const POLL_QUESTION_MAX = 200;

/** Las opciones que manda quien crea la encuesta: sin repetir (sin importar mayúsculas) y sin vacías. */
export const pollOptionsInput = z
  .array(z.string().trim().min(1, "Completá todas las opciones").max(POLL_OPTION_MAX, `Cada opción puede tener hasta ${POLL_OPTION_MAX} caracteres`))
  .min(POLL_MIN_OPTIONS, `Poné al menos ${POLL_MIN_OPTIONS} opciones`)
  .max(POLL_MAX_OPTIONS, `Podés poner hasta ${POLL_MAX_OPTIONS} opciones`)
  .refine((opts) => new Set(opts.map((o) => o.toLocaleLowerCase("es-AR"))).size === opts.length, "Hay opciones repetidas");

export type PollView = {
  options: string[];
  /** Votos por opción, en el mismo orden que options. */
  counts: number[];
  total: number;
  /** Solo cuando se pide para una persona: la opción que eligió (o null). En los eventos en vivo no viaja. */
  myVote?: number | null;
};

/** Las encuestas de estos mensajes, con sus totales (y el voto de viewerId, si se pasa). */
export async function pollsFor(messageIds: string[], viewerId?: string): Promise<Map<string, PollView>> {
  const out = new Map<string, PollView>();
  if (!messageIds.length) return out;
  const polls = await db.select().from(groupPoll).where(inArray(groupPoll.messageId, messageIds));
  if (!polls.length) return out;
  const ids = polls.map((p) => p.messageId);
  const [counts, mine] = await Promise.all([
    db.select({ messageId: groupPollVote.messageId, option: groupPollVote.option, n: sql<number>`count(*)::int` })
      .from(groupPollVote).where(inArray(groupPollVote.messageId, ids))
      .groupBy(groupPollVote.messageId, groupPollVote.option),
    viewerId
      ? db.select({ messageId: groupPollVote.messageId, option: groupPollVote.option }).from(groupPollVote)
          .where(and(inArray(groupPollVote.messageId, ids), eq(groupPollVote.userId, viewerId)))
      : Promise.resolve([]),
  ]);
  const myVotes = new Map(mine.map((v) => [v.messageId, v.option]));
  for (const p of polls) {
    const tally = p.options.map(() => 0);
    for (const c of counts) if (c.messageId === p.messageId && c.option < tally.length) tally[c.option] = c.n;
    const view: PollView = { options: p.options, counts: tally, total: tally.reduce((a, b) => a + b, 0) };
    if (viewerId) view.myVote = myVotes.get(p.messageId) ?? null;
    out.set(p.messageId, view);
  }
  return out;
}

/** Los totales de una encuesta, para mandar en vivo (sin el voto de nadie). */
export async function pollTotals(messageId: string) {
  const view = (await pollsFor([messageId])).get(messageId);
  return view ? { counts: view.counts, total: view.total } : null;
}

/**
 * Resultado para pasar una encuesta a la agenda de eventos del grupo (PR 107): las opciones de la más votada a la menos.
 * Con empate queda primero la que se escribió antes. No dice quién votó.
 */
export async function pollRanking(messageId: string) {
  const view = (await pollsFor([messageId])).get(messageId);
  if (!view) return null;
  return view.options
    .map((option, index) => ({ index, option, votes: view.counts[index] }))
    .sort((a, b) => b.votes - a.votes || a.index - b.index);
}

/** Texto de la encuesta para la copia de un reporte: la pregunta y las opciones. */
export async function pollReportText(messageId: string, question: string) {
  const [p] = await db.select({ options: groupPoll.options }).from(groupPoll).where(eq(groupPoll.messageId, messageId));
  return p ? [`Encuesta: ${question}`, ...p.options.map((o) => `- ${o}`)].join("\n") : question;
}

/** Al borrar o cancelar mensajes: se van sus encuestas y, en cascada, los votos. */
export async function dropPolls(messageIds: string[]) {
  if (messageIds.length) await db.delete(groupPoll).where(inArray(groupPoll.messageId, messageIds));
}
