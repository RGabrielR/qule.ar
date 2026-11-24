import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { api, ApiError, getSocket, type ConversationSummary, type MyGroup, type MyInvite } from "../../api";
import { useLiveInbox } from "../messages/useLiveInbox";

const FRESH_MS = 15_000;
export const GROUP_EVENTS = ["group:request", "group:accepted", "group:rejected", "group:removed", "group:gone", "group:role", "group:invite"] as const;
const NO_CONVERSATIONS: ConversationSummary[] = [];
type Refresh = "recent" | "refresh" | "clear";

function useTabResource<T>(path: string, onUnauthorized: () => void, fallback?: T) {
  const [data, setData] = useState<T | null>(null);
  const currentData = useRef<T | null>(null);
  const updatedAt = useRef<number | null>(null);
  const inFlight = useRef<{ controller: AbortController; again: boolean } | null>(null);
  const update = useCallback((value: T | null) => {
    currentData.current = value;
    setData(value);
  }, []);
  const invalidatePendingLoad = useCallback(() => {
    if (!inFlight.current) return false;
    inFlight.current.again = true;
    return true;
  }, []);

  const load = useCallback((mode: Refresh = "recent") => {
    if (mode === "clear") {
      inFlight.current?.controller.abort();
      inFlight.current = null;
      updatedAt.current = null;
      update(null);
    }
    if (mode === "recent") {
      // Si la lista tiene más de 15 segundos, se sigue mostrando mientras llega la nueva: así cambiar de pestaña
      // nunca deja la pantalla vacía esperando al servidor. Los eventos en vivo ya la mantienen al día.
      if (updatedAt.current !== null && Date.now() - updatedAt.current < FRESH_MS) return;
    }
    if (inFlight.current) {
      if (mode === "refresh") inFlight.current.again = true;
      return;
    }

    function fetchData() {
      const request = { controller: new AbortController(), again: false };
      inFlight.current = request;
      const { signal } = request.controller;
      api<T>(path, { signal, cache: "no-store" }).then((value) => {
        if (signal.aborted || request.again) return;
        updatedAt.current = Date.now();
        update(value);
      }).catch((error: unknown) => {
        if (signal.aborted) return;
        if (error instanceof ApiError && [401, 403].includes(error.status)) {
          updatedAt.current = null;
          update(null);
          onUnauthorized();
        } else if (fallback !== undefined && currentData.current === null) {
          update(fallback);
        }
      }).finally(() => {
        if (inFlight.current !== request) return;
        inFlight.current = null;
        if (request.again) fetchData();
      });
    }
    fetchData();
  }, [path, onUnauthorized, fallback, update]);

  useLayoutEffect(() => () => {
    inFlight.current?.controller.abort();
    inFlight.current = null;
  }, []);

  return [data, load, { currentData, invalidatePendingLoad, update }] as const;
}

type TabData = {
  groups: MyGroup[] | null;
  invites: MyInvite[] | null;
  conversations: ConversationSummary[] | null;
  refreshGroups: (mode?: Refresh) => void;
  refreshAfterBlock: () => void;
};

const TabDataContext = createContext<TabData | null>(null);

export function useTabData() {
  const data = useContext(TabDataContext);
  if (!data) throw new Error("Faltan los datos de las pestañas");
  return data;
}

export function TabDataProvider({ children, onUnauthorized, userId }: { children: ReactNode; onUnauthorized: () => void; userId: string }) {
  const { pathname } = useLocation();
  const [groups, loadGroups] = useTabResource<MyGroup[]>("/groups", onUnauthorized);
  const [invites, loadInvites] = useTabResource<MyInvite[]>("/invites", onUnauthorized);
  const [conversations, loadConversations, inbox] = useTabResource("/conversations", onUnauthorized, NO_CONVERSATIONS);
  const resetInbox = useLiveInbox(userId, inbox, loadConversations, onUnauthorized);
  const refreshGroups = useCallback((mode?: Refresh) => {
    loadGroups(mode);
    loadInvites(mode);
  }, [loadGroups, loadInvites]);

  useLayoutEffect(() => {
    if (pathname === "/grupos") refreshGroups();
    if (pathname === "/mensajes") loadConversations();
  }, [pathname, refreshGroups, loadConversations]);

  useEffect(() => {
    refreshGroups();
    loadConversations();
    const socket = getSocket();
    const groupsChanged = () => refreshGroups("refresh");
    const groupAccessLost = () => refreshGroups("clear");
    const onReconnect = () => refreshGroups("clear");

    for (const event of GROUP_EVENTS) {
      socket.on(event, event === "group:removed" || event === "group:gone" ? groupAccessLost : groupsChanged);
    }
    socket.io.on("reconnect", onReconnect);
    return () => {
      for (const event of GROUP_EVENTS) {
        socket.off(event, event === "group:removed" || event === "group:gone" ? groupAccessLost : groupsChanged);
      }
      socket.io.off("reconnect", onReconnect);
    };
  }, [loadConversations, refreshGroups]);

  function refreshAfterBlock() {
    loadInvites("clear");
    resetInbox();
  }

  return (
    <TabDataContext.Provider value={{ groups, invites, conversations, refreshGroups, refreshAfterBlock }}>
      {children}
    </TabDataContext.Provider>
  );
}
