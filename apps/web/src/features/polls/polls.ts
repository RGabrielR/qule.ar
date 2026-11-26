import type { GroupMessage, Poll, PollEvent } from "../../api";

// Los mismos límites que el API (apps/api/src/polls.ts)
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 5;
export const POLL_OPTION_MAX = 80;
export const POLL_QUESTION_MAX = 200;

/** Aplica los totales que llegan en vivo, sin tocar mi voto (los eventos no lo traen). */
export function applyPollTotals(list: GroupMessage[], e: PollEvent): GroupMessage[] {
  return list.map((m) => (m.id === e.messageId && m.poll ? { ...m, poll: { ...m.poll, counts: e.counts, total: e.total } } : m));
}

/** Pone mi voto y los totales que devolvió el API. */
export function applyMyVote(list: GroupMessage[], messageId: string, result: Required<Pick<Poll, "counts" | "total" | "myVote">>): GroupMessage[] {
  return list.map((m) => (m.id === messageId && m.poll ? { ...m, poll: { ...m.poll, ...result } } : m));
}

export const votesLabel = (n: number) => (n === 1 ? "1 voto" : `${n} votos`);
export const percent = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);
