import { useMemo, useRef, useSyncExternalStore } from "react";
import { RefreshIcon, TrashIcon } from "../../components/Icons";
import { ApiError, type Dm, type GroupMessage } from "../../api";

export function newMessageKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // En una IP local por HTTP solo está disponible getRandomValues.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

type Entry<M> = {
  scope: string;
  message: M;
  waitForConfirmation?: boolean;
  submit?: () => Promise<M | null>;
  release?: () => void;
  failure?: { retryable: boolean; message?: string };
};

class Outbox<M extends { id: string; idempotencyKey?: string | null }> {
  private entries: Entry<M>[] = [];
  private listeners = new Set<() => void>();
  private confirmations = new Set<(scope: string, message: M) => void>();

  private update(entries: Entry<M>[]) {
    this.entries = entries;
    this.listeners.forEach((notify) => notify());
  }

  subscribe = (notify: () => void) => {
    this.listeners.add(notify);
    return () => { this.listeners.delete(notify); };
  };

  snapshot = () => this.entries;

  add(entry: Entry<M> & { submit: () => Promise<M | null> }) {
    this.update([...this.entries, entry]);
    void this.send(entry);
  }

  retry(entry: Entry<M>) {
    if (!entry.failure?.retryable || !this.entries.includes(entry)) return;
    const next = { ...entry, failure: undefined };
    this.update(this.entries.map((e) => e === entry ? next : e));
    void this.send(next);
  }

  acknowledge(scope: string, message: M) {
    const entry = this.entries.find((e) => e.scope === scope && e.message.idempotencyKey === message.idempotencyKey);
    if (!entry) return;
    this.dismiss(entry);
  }

  dismiss(entry: Entry<M>) {
    entry.release?.();
    this.update(this.entries.filter((e) => e !== entry));
  }

  watchConfirmations(scope: string, accept: (message: M) => void) {
    const onSaved = (savedScope: string, message: M) => {
      if (savedScope === scope) accept(message);
    };
    this.confirmations.add(onSaved);
    return () => { this.confirmations.delete(onSaved); };
  }

  clear() {
    this.entries.forEach((entry) => entry.release?.());
    this.update([]);
  }

  private async send(entry: Entry<M>) {
    if (!entry.submit) return;
    try {
      const saved = await entry.submit();
      if (!this.entries.includes(entry)) return;
      if (saved === null) {
        this.dismiss(entry);
        return;
      }
      this.confirmations.forEach((listener) => listener(entry.scope, saved));
      this.acknowledge(entry.scope, saved);
    } catch (error) {
      if (!this.entries.includes(entry)) return;
      const retryable = !(error instanceof ApiError) || error.status >= 500 || error.status === 408 || error.status === 429;
      if (!retryable) entry.release?.();
      const failed = retryable ? entry : { scope: entry.scope, message: entry.message };
      this.update(this.entries.map((e) => e === entry ? { ...failed, failure: { retryable, message: error instanceof ApiError && error.status === 429 ? error.message : undefined } } : e));
    }
  }
}

export const privateOutbox = new Outbox<Dm>();
export const groupOutbox = new Outbox<GroupMessage>();
window.addEventListener("mortero:session-ended", () => { privateOutbox.clear(); groupOutbox.clear(); });

export function usePending<M extends { id: string; idempotencyKey?: string | null }>(box: Outbox<M>, scope: string) {
  const entries = useSyncExternalStore(box.subscribe, box.snapshot);
  return useMemo(() => entries.filter((entry) => entry.scope === scope), [entries, scope]);
}

/** Conserva el lugar de cada envío local aunque las confirmaciones lleguen al revés. */
export function useTimeline<M extends Dm | GroupMessage>(
  confirmed: M[], pending: Entry<M>[], myId: string | undefined,
) {
  const localTimes = useRef(new Map<string, number>());
  const lastTime = useRef(0);
  const pendingByMessage = useMemo(() => new Map(pending.filter((entry) => !entry.waitForConfirmation || entry.failure).map((entry) => [entry.message, entry])), [pending]);
  const messages = useMemo(() => {
    function time(message: M) {
      const sender = "senderId" in message ? message.senderId : message.author.id;
      const local = sender === myId ? localTimes.current.get(message.idempotencyKey ?? message.id) : undefined;
      return local ?? Date.parse("createdAt" in message ? message.createdAt : message.scheduledAt);
    }
    return [...confirmed, ...pendingByMessage.keys()].sort((a, b) => time(a) - time(b));
  }, [confirmed, pendingByMessage, myId]);

  function remember(id: string) {
    // Dos envíos en el mismo milisegundo mantienen el orden en que se escribieron.
    lastTime.current = Math.max(Date.now(), lastTime.current + 0.001);
    localTimes.current.set(id, lastTime.current);
  }
  function forget(id: string) {
    localTimes.current.delete(id);
  }
  return { messages, pendingByMessage, remember, forget };
}

export function SendFailure({ failure, retry, dismiss }: { failure: Entry<unknown>["failure"]; retry: () => void; dismiss: () => void }) {
  if (!failure) return null;
  return <div className="send-failure small" role="alert">
    <span>{failure.message ?? "No se pudo enviar."}</span>
    {failure.retryable ? <button type="button" className="iconbtn" aria-label="Reintentar" title="Reintentar" onClick={retry}><RefreshIcon /></button> : null}
    {(!failure.retryable || failure.message) && <button type="button" className="iconbtn" aria-label="Descartar mensaje" title="Descartar mensaje" onClick={dismiss}><TrashIcon /></button>}
  </div>;
}

export function mergeHistory<M extends { id: string }>(history: M[], current: M[]) {
  const byId = new Map(history.map((message) => [message.id, message]));
  for (const message of current) byId.set(message.id, message);
  return [...byId.values()];
}
