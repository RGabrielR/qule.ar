import { getSocket } from "../../api";

/** Carga al entrar y una vez por reconexión. Una respuesta vieja no pisa la nueva. */
export function watchHistory(load: (signal: AbortSignal) => Promise<void>, onError: (error: Error) => void) {
  const socket = getSocket();
  let controller: AbortController;
  let needsRefresh = false;
  const refresh = () => {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    load(signal).catch((error) => {
      if (!signal.aborted) onError(error);
    });
  };
  const disconnected = () => { needsRefresh = true; };
  const connected = () => {
    if (needsRefresh) refresh();
    needsRefresh = false;
  };
  socket.on("disconnect", disconnected);
  socket.on("connect_error", disconnected);
  socket.on("connect", connected);
  refresh();
  return () => {
    controller.abort();
    socket.off("disconnect", disconnected);
    socket.off("connect_error", disconnected);
    socket.off("connect", connected);
  };
}

type Update<M> = (list: M[]) => M[];

/** Reaplica los eventos recibidos mientras el servidor preparaba la página de historial. */
export function historyUpdates<M>(setList: (update: Update<M>) => void) {
  let changes: Update<M>[] | undefined;
  return {
    begin() { changes = []; },
    update(change: Update<M>) {
      changes?.push(change);
      setList(change);
    },
    finish(snapshot: Update<M>) {
      const live = changes ?? [];
      changes = undefined;
      setList((list) => live.reduce((updated, change) => change(updated), snapshot(list)));
    },
    stop() { changes = undefined; },
  };
}

/** Conserva páginas anteriores solo si se solapan con el historial recién recibido. */
export function refreshPage<M extends { id: string }>(current: M[], recent: M[], hasMore: boolean) {
  if (!hasMore || !recent.length) return recent;
  const first = current.findIndex((message) => message.id === recent[0].id);
  return first > 0 ? [...current.slice(0, first), ...recent] : recent;
}
