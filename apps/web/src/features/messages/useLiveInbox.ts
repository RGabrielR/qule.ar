import { compareDmOrder, DM_EVENTS, INBOX_LIMIT, type DmReadReceipt } from "@mortero/shared/realtime";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { api, ApiError, getSocket, type ConversationSummary, type Dm } from "../../api";

type InboxResource = {
  currentData: RefObject<ConversationSummary[] | null>;
  invalidatePendingLoad: () => boolean;
  update: (data: ConversationSummary[] | null) => void;
};

type SummaryRequest = {
  controller: AbortController;
  refreshAgain: boolean;
  backfill: boolean;
};

function compareConversations(a: ConversationSummary, b: ConversationSummary) {
  return a.lastMessageAt.localeCompare(b.lastMessageAt) || a.id.localeCompare(b.id);
}

function replaceConversation(list: ConversationSummary[], id: string, summary: ConversationSummary | null) {
  const next = list.filter((chat) => chat.id !== id);
  if (!summary) return next;
  const index = next.findIndex((chat) => compareConversations(summary, chat) > 0);
  if (index === -1) next.push(summary);
  else next.splice(index, 0, summary);
  return next.slice(0, INBOX_LIMIT);
}

function addMessage(chat: ConversationSummary, message: Dm, userId: string): ConversationSummary {
  return {
    ...chat,
    last: message,
    lastMessageAt: message.createdAt > chat.lastMessageAt ? message.createdAt : chat.lastMessageAt,
    unread: chat.unread + Number(message.senderId !== userId && !message.readAt),
  };
}

export function useLiveInbox(
  userId: string,
  { currentData, invalidatePendingLoad, update }: InboxResource,
  load: (mode: "refresh" | "clear") => void,
  onUnauthorized: () => void,
) {
  const requests = useRef(new Map<string, SummaryRequest>());
  const initialChanges = useRef(new Set<string>());
  const reconcileInitialChanges = useRef<() => void>(() => {});
  const cancelRequests = useCallback(() => {
    for (const { controller } of requests.current.values()) controller.abort();
    requests.current.clear();
    initialChanges.current.clear();
  }, []);
  const reset = useCallback(() => {
    cancelRequests();
    load("clear");
  }, [cancelRequests, load]);

  useEffect(() => {
    const socket = getSocket();
    const pending = requests.current;

    async function refreshConversation(id: string, backfill = false) {
      const active = pending.get(id);
      if (active) {
        active.refreshAgain = true;
        active.backfill ||= backfill;
        return;
      }
      if (!currentData.current) {
        initialChanges.current.add(id);
        return;
      }
      if (invalidatePendingLoad()) return;

      const request: SummaryRequest = {
        controller: new AbortController(), refreshAgain: false, backfill,
      };
      pending.set(id, request);
      const { signal } = request.controller;
      try {
        const summary = await api<ConversationSummary | null>(`/conversations/${id}/summary`, { signal, cache: "no-store" });
        const list = currentData.current;
        if (signal.aborted || request.refreshAgain || !list || invalidatePendingLoad()) return;
        update(replaceConversation(list, id, summary));
        if (!summary && request.backfill) load("refresh");
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof ApiError && [401, 403].includes(error.status)) {
          cancelRequests();
          update(null);
          onUnauthorized();
        } else if (request.refreshAgain) {
          return;
        } else if (error instanceof ApiError && error.status === 404) {
          const list = currentData.current;
          if (list && !invalidatePendingLoad()) update(replaceConversation(list, id, null));
          if (request.backfill) load("refresh");
        } else {
          load("refresh");
        }
      } finally {
        if (pending.get(id) === request) {
          pending.delete(id);
          if (request.refreshAgain) void refreshConversation(id, request.backfill);
        }
      }
    }

    function onMessage(message: Dm) {
      const id = message.conversationId;
      const list = currentData.current;
      const chat = list?.find((item) => item.id === id);
      if (chat?.last.id === message.id) return;
      if (!list || !chat || compareDmOrder(message, chat.last) <= 0) {
        void refreshConversation(id);
        return;
      }

      const active = pending.get(id);
      if (active) active.refreshAgain = true;
      invalidatePendingLoad();
      update(replaceConversation(list, id, addMessage(chat, message, userId)));
    }

    function onDeleted({ conversationId, id }: { conversationId: string; id: string }) {
      const list = currentData.current;
      const hidesPreview = list?.some((chat) => chat.id === conversationId && chat.last.id === id);
      if (list && hidesPreview) update(replaceConversation(list, conversationId, null));
      void refreshConversation(conversationId, Boolean(hidesPreview && list?.length === INBOX_LIMIT));
    }

    // El socket y la respuesta HTTP pueden confirmar la misma escritura en cualquier orden.
    const recentReceipts = new Set<string>();
    function refreshAfterRead(conversationId: string, receiptId?: string) {
      if (receiptId) {
        if (recentReceipts.has(receiptId)) return;
        recentReceipts.add(receiptId);
        if (recentReceipts.size > 256) recentReceipts.delete(recentReceipts.values().next().value!);
      }
      void refreshConversation(conversationId);
    }

    function onRead(receipt: DmReadReceipt) {
      if (receipt.audience === "reader") refreshAfterRead(receipt.conversationId, receipt.receiptId);
    }

    reconcileInitialChanges.current = () => {
      if (!currentData.current) return;
      for (const id of initialChanges.current) void refreshConversation(id);
      initialChanges.current.clear();
    };

    function onLocalRead(event: Event) {
      if (event instanceof CustomEvent && event.detail?.changed === false) return;
      const id = event instanceof CustomEvent && event.detail?.conversationId;
      if (typeof id === "string") refreshAfterRead(id, event instanceof CustomEvent ? event.detail?.receiptId : undefined);
      else load("refresh");
    }

    window.addEventListener("mortero:read", onLocalRead);
    socket.on(DM_EVENTS.message, onMessage);
    socket.on(DM_EVENTS.read, onRead);
    socket.on(DM_EVENTS.deleted, onDeleted);
    socket.on(DM_EVENTS.access, reset);
    socket.io.on("reconnect", reset);
    return () => {
      window.removeEventListener("mortero:read", onLocalRead);
      socket.off(DM_EVENTS.message, onMessage);
      socket.off(DM_EVENTS.read, onRead);
      socket.off(DM_EVENTS.deleted, onDeleted);
      socket.off(DM_EVENTS.access, reset);
      socket.io.off("reconnect", reset);
      cancelRequests();
    };
  }, [cancelRequests, currentData, invalidatePendingLoad, load, onUnauthorized, reset, update, userId]);

  useEffect(() => {
    if (initialChanges.current.size) reconcileInitialChanges.current();
  });

  return reset;
}
