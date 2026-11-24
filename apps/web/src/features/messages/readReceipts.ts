import { READ_RECEIPT_LIMIT } from "@mortero/shared/realtime";
import { api, ApiError } from "../../api";

const READ_BATCH_MS = 250;
const READ_RETRY_DELAYS_MS = [500, 1_000];
type ReadBatch = { messageIds: string[]; beforeId?: string };

export function batchReadReceipts(conversationId: string) {
  const pendingIds = new Set<string>();
  let beforeId: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sending = false;
  let closed = false;
  let deferredBatch: ReadBatch | undefined;

  async function sendBatch(batch: ReadBatch) {
    for (const delay of [...READ_RETRY_DELAYS_MS, null]) {
      try {
        const result = await api<{ changed?: boolean; receiptId?: string | null }>(`/conversations/${conversationId}/read`, {
          method: "POST", json: batch, keepalive: true,
        });
        window.dispatchEvent(new CustomEvent("mortero:read", { detail: { conversationId, ...result } }));
        return;
      } catch (error) {
        const retryable = !(error instanceof ApiError) || error.status >= 500 || [408, 429].includes(error.status);
        if (!retryable) return;
        if (delay === null) return batch;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (sending || (!beforeId && !pendingIds.size)) return;

    const messageIds = [...pendingIds].slice(0, READ_RECEIPT_LIMIT);
    for (const id of messageIds) pendingIds.delete(id);
    const read = { messageIds, beforeId };
    beforeId = undefined;
    sending = true;
    const startedBeforeClose = !closed;
    void sendBatch(read).then((failedBatch) => {
      deferredBatch = failedBatch;
      sending = false;
      if (closed) {
        if (startedBeforeClose) restoreDeferredBatch();
        flush();
      } else if (beforeId || pendingIds.size) {
        restoreDeferredBatch();
        armTimer();
      }
    });
  }

  function restoreDeferredBatch() {
    if (!deferredBatch) return;
    const queuedIds = [...pendingIds];
    pendingIds.clear();
    for (const id of [...deferredBatch.messageIds, ...queuedIds]) pendingIds.add(id);
    beforeId ??= deferredBatch.beforeId;
    deferredBatch = undefined;
  }

  function armTimer() {
    if (!sending && timer === undefined && (beforeId || pendingIds.size)) {
      timer = setTimeout(flush, READ_BATCH_MS);
    }
  }

  return {
    schedule(...messageIds: string[]) {
      restoreDeferredBatch();
      for (const id of messageIds) pendingIds.add(id);
      armTimer();
    },
    includeOlderMessages(oldestLoadedId: string) {
      restoreDeferredBatch();
      beforeId = oldestLoadedId;
      armTimer();
    },
    close() {
      if (closed) return;
      closed = true;
      restoreDeferredBatch();
      flush();
    },
  };
}
