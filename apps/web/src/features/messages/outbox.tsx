import { useMemo, useRef, useSyncExternalStore } from "react";
import { RefreshIcon } from "../../components/Icons";
import { ApiError, type Dm, type GroupMessage } from "../../api";

type Entry<M> = {
  scope: string;
  message: M;
  submit?: () => Promise<M>;
  release?: () => void;
  failure?: { retryable: boolean };
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

  add(entry: Entry<M> & { submit: () => Promise<M> }) {
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
      this.confirmations.forEach((listener) => listener(entry.scope, saved));
      this.acknowledge(entry.scope, saved);
    } catch (error) {
      if (!this.entries.includes(entry)) return;
      const retryable = !(error instanceof ApiError) || error.status >= 500 || error.status === 408 || error.status === 429;
      if (!retryable) entry.release?.();
      const failed = retryable ? entry : { scope: entry.scope, message: entry.message };
      this.update(this.entries.map((e) => e === entry ? { ...failed, failure: { retryable } } : e));
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
  const pendingByMessage = useMemo(() => new Map(pending.map((entry) => [entry.message, entry])), [pending]);
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
    <span>Error al enviar el mensaje.</span>
    {failure.retryable ? <button type="button" className="iconbtn send-failure__retry" aria-label="Reintentar" title="Reintentar" onClick={retry}><RefreshIcon /></button>
      : <button type="button" className="btn btn--small" onClick={dismiss}>Descartar</button>}
  </div>;
}

export function mergeHistory<M extends { id: string }>(history: M[], current: M[]) {
  const byId = new Map(history.map((message) => [message.id, message]));
  for (const message of current) byId.set(message.id, message);
  return [...byId.values()];
}
