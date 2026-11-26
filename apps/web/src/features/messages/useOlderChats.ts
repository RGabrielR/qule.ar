import { DM_EVENTS, INBOX_LIMIT, type DmSettingsChange } from "@mortero/shared/realtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getSocket, type ConversationSummary } from "../../api";

type Older = { items: ConversationSummary[]; more: boolean };
const NONE: Older = { items: [], more: true };

const byRecent = (a: ConversationSummary, b: ConversationSummary) =>
  b.lastMessageAt.localeCompare(a.lastMessageAt) || b.id.localeCompare(a.id);

/**
 * Los chats más viejos que la primera página de la bandeja. La bandeja en vivo trae los INBOX_LIMIT más recientes;
 * estos se piden de a una página cuando la persona toca "Cargar chats anteriores". Si un chat viejo recibe un mensaje,
 * pasa a la lista en vivo y deja de mostrarse acá. Cuando la lista en vivo se vacía (bloqueo, reconexión), se
 * empieza de nuevo.
 */
export function useOlderChats(live: ConversationSummary[] | null) {
  const [older, setOlder] = useState<Older>(NONE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    if (live !== null) return;
    generation.current++;
    setOlder(NONE);
    setLoading(false);
    setError(false);
  }, [live]);

  // Un chat que eliminaste desaparece también de los anteriores (si te vuelven a escribir, vuelve a la lista en vivo)
  useEffect(() => {
    const socket = getSocket();
    const onSettings = ({ conversationId, change }: DmSettingsChange) => {
      if (change !== "cleared") return;
      setOlder((current) => current.items.some((c) => c.id === conversationId)
        ? { ...current, items: current.items.filter((c) => c.id !== conversationId) }
        : current);
    };
    socket.on(DM_EVENTS.settings, onSettings);
    return () => { socket.off(DM_EVENTS.settings, onSettings); };
  }, []);

  const chats = useMemo(() => {
    if (!live) return live;
    if (!older.items.length) return live;
    const shown = new Set(live.map((c) => c.id));
    return [...live, ...older.items.filter((c) => !shown.has(c.id))].sort(byRecent);
  }, [live, older.items]);

  // Hay más si la primera página vino completa y la última que pedimos también.
  const hasMore = !!live && live.length >= INBOX_LIMIT && older.more;

  const loadMore = useCallback(async () => {
    const last = chats?.at(-1);
    if (!last || loading) return;
    const mine = generation.current;
    setLoading(true);
    setError(false);
    try {
      const query = new URLSearchParams({ before: last.lastMessageAt, beforeId: last.id });
      const page = await api<ConversationSummary[]>(`/conversations?${query}`, { cache: "no-store" });
      if (mine !== generation.current) return;
      setOlder((current) => {
        const known = new Set(current.items.map((c) => c.id));
        return { items: [...current.items, ...page.filter((c) => !known.has(c.id))], more: page.length >= INBOX_LIMIT };
      });
    } catch {
      if (mine === generation.current) setError(true);
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [chats, loading]);

  return { chats, hasMore, loading, error, loadMore };
}
