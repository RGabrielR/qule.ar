import { ChatPresenceDot } from "../features/messages/chatPresence";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { useMe } from "../App";
import { BellOffIcon, FilterIcon } from "../components/Icons";
import { countFilters, EMPTY, FilterSheet, toQuery, type Filters } from "./Nearby";
import { albumNoticeKind, useAlbumNoticeTime } from "../features/messages/albumNotices";
import { Avatar } from "../components/Avatar";
import { useConversationActions } from "../features/messages/ConversationActions";
import { ConversationMenuRow } from "../features/messages/ConversationMenuRow";
import { usePullToRefresh } from "../features/navigation/pullToRefresh";
import { Skeleton, SkeletonRows } from "../components/Skeleton";
import { useArrival } from "../components/useArrival";
import { useTabData } from "../features/navigation/tabData";
import { useMessageMenuPosition } from "../useMessageMenuPosition";
import { useRememberScroll } from "../features/navigation/viewMemory";
import { useOlderChats } from "../features/messages/useOlderChats";
import { useTabTransition } from "../features/navigation/pageTransition";

function ago(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "ahora";
  if (diff < 3600) return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

// Los filtros de Mensajes duran lo que dura la pestaña: al volver a abrir la app se ven todos los chats
type InboxFilters = { unread: boolean; filters: Filters };
const STORE_KEY = "mortero:filtros-mensajes";

function loadInboxFilters(): InboxFilters {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "null") as Partial<InboxFilters> | null;
    return { unread: Boolean(saved?.unread), filters: { ...EMPTY, ...saved?.filters } };
  } catch {
    return { unread: false, filters: EMPTY };
  }
}

/**
 * Personas con chat que cumplen los filtros de perfil (los mismos de Gente). Los filtra el servidor;
 * "en línea" y "no leídos" se miran acá. `null`: no hay filtros de perfil. `undefined`: todavía no llegó.
 */
function useMatchingPeople(filters: Filters, people: string) {
  const query = toQuery({ ...filters, online: false });
  const [result, setResult] = useState<{ query: string; ids: Set<string> | null } | null>(null);
  useEffect(() => {
    if (!query) return;
    let live = true;
    api<{ ids: string[] | null }>(`/conversations/matching?${query}`)
      .then((r) => { if (live) setResult({ query, ids: r.ids && new Set(r.ids) }); })
      // Si falla, mejor ver todos los chats que una lista vacía
      .catch(() => { if (live) setResult({ query, ids: null }); });
    return () => { live = false; };
  }, [query, people]);
  if (!query) return null;
  return result?.query === query ? result.ids : undefined;
}

export function Inbox() {
  const { me } = useMe();
  const { conversations: live, refreshConversations } = useTabData();
  // Los 100 más recientes vienen en vivo; los anteriores se cargan a pedido
  const { chats: list, hasMore, loading: loadingMore, error: moreError, loadMore } = useOlderChats(live);
  const albumNoticeTime = useAlbumNoticeTime(list?.map(({ last }) => last) ?? []);
  const [query, setQuery] = useState("");
  const [{ unread, filters }, setView] = useState(loadInboxFilters);
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ unread, filters }));
    } catch {
      /* sin almacenamiento: los filtros duran mientras la pantalla esté abierta */
    }
  }, [unread, filters]);
  const setFilters = (f: Filters) => setView((v) => ({ ...v, filters: f }));
  const people = useMemo(() => [...new Set(list?.flatMap((c) => c.other ? [c.other.id] : []))].sort().join(","), [list]);
  const matching = useMatchingPeople(filters, people);
  // Los que no son atajos (favoritos y conectados ya tienen el suyo)
  const more = countFilters({ ...filters, favorites: false, online: false });
  const anyFilter = unread || countFilters(filters) > 0;
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const filtered = matching === undefined ? undefined : list?.filter((chat) => (!unread || chat.unread > 0)
    && (!filters.online || chat.other?.presence === "online")
    && (!matching || (chat.other != null && matching.has(chat.other.id)))
    && words.every((word) => normalize(chat.other?.name ?? "").includes(word)));
  const { act, dialog, errorNotice } = useConversationActions();
  const enter = useTabTransition();
  const pageRef = useRef<HTMLDivElement>(null);
  const positionMenu = useMessageMenuPosition(pageRef);
  useRememberScroll(pageRef, list != null);
  const pullRefresh = usePullToRefresh(pageRef, () => refreshConversations("refresh"));
  // Las filas entran escalonadas cuando llegan; las que ya estaban guardadas al volver a la pestaña, no
  const arrival = useArrival(filtered?.map((c) => c.id));

  return (
    <div className={`page ${enter}`} ref={pageRef}>
      <header className="topbar"><h1 className="topbar__title">Mensajes</h1></header>
      {errorNotice}
      {pullRefresh}
      {!!list?.length && (
        <div className="searchbar form">
          <input className="input" type="search" placeholder="Buscar por nombre" aria-label="Buscar por nombre" value={query} maxLength={60}
            onChange={(e) => setQuery(e.target.value)} />
          <div className="inbox-filters" role="group" aria-label="Filtros">
            <button type="button" className={`chip ${filters.favorites ? "chip--on" : ""}`} aria-pressed={filters.favorites}
              onClick={() => setFilters({ ...filters, favorites: !filters.favorites })}>Favoritos</button>
            <button type="button" className={`chip ${filters.online ? "chip--on" : ""}`} aria-pressed={filters.online}
              onClick={() => setFilters({ ...filters, online: !filters.online })}>Conectados</button>
            <button type="button" className={`chip ${unread ? "chip--on" : ""}`} aria-pressed={unread}
              onClick={() => setView((v) => ({ ...v, unread: !v.unread }))}>No leídos</button>
            <button type="button" className={`chip inbox-filters__more ${more ? "chip--on" : ""}`} onClick={() => setSheet(true)}
              aria-label={more ? `Todos los filtros (${more} ${more === 1 ? "activo" : "activos"})` : "Todos los filtros"} title="Todos los filtros">
              <FilterIcon />{more > 0 && <span>{more}</span>}
            </button>
          </div>
        </div>
      )}
      {list === null ? (
        <>
          <div className="searchbar form skeleton-wait" aria-hidden>
            <Skeleton className="skeleton--input" />
            <div className="inbox-filters"><Skeleton className="skeleton--chip" /><Skeleton className="skeleton--chip" /><Skeleton className="skeleton--chip" /></div>
          </div>
          <InboxSkeleton />
        </>
      ) : list.length === 0 ? (
        <div className="empty">
          <p className="empty__title">Sin mensajes por ahora</p>
          <p className="muted">Tocá la foto de alguien en el chat general para ver su perfil y escribirle.</p>
        </div>
      ) : filtered?.length === 0 ? (
        <div className="empty" role="status">
          <p className="empty__title">No hay conversaciones que coincidan.</p>
          {anyFilter && <button className="btn btn--small" onClick={() => setView({ unread: false, filters: EMPTY })}>Sacar filtros</button>}
        </div>
      ) : filtered === undefined ? (
        <InboxSkeleton />
      ) : (
        <ul className="inbox">
          {filtered.map((c) => {
            const mine = c.last.senderId === me?.user.id;
            const kind = albumNoticeKind(c.last, albumNoticeTime);
            const preview =
              kind === "album" ? "Álbum privado compartido"
              : kind === "album_revoked" ? (mine ? "Dejaste de compartir el álbum" : "Dejó de compartir el álbum")
              : kind === "album_expired" ? (mine ? "Venció lo que compartiste" : "Venció lo que te compartieron")
              : c.last.expiring ? "⏱ Foto temporal"
              : kind === "photo" || c.last.photo ? "📷 Foto"
              : c.last.body;
            const { className, style } = arrival(c.id);
            return (
              <ConversationMenuRow key={c.id} chat={c} className={className} style={style} positionMenu={positionMenu} onAction={(action) => void act(action, c)}
                avatar={c.other ? (
                  <Link to={`/perfil/${c.other.id}`} className="inbox__avatar" aria-label={`Ver perfil de ${c.other.name}`}>
                    <Avatar src={c.other.photo ?? null} name={c.other.name} size={52} appear />
                  </Link>
                ) : (
                  <span className="inbox__avatar"><Avatar src={null} name="?" size={52} /></span>
                )}>
                <div className="inbox__text">
                  <div className="inbox__top">
                    <b className="chat-contact-name"><ChatPresenceDot state={c.other?.presence} /><span>{c.other?.name ?? "Cuenta borrada"}</span></b>
                    <time>{ago(c.last.createdAt)}</time>
                  </div>
                  <p className="inbox__preview">{mine && "Vos: "}{preview}</p>
                </div>
                {c.muted && <span className="inbox__muted" role="img" aria-label="Chat silenciado"><BellOffIcon /></span>}
                {c.unread > 0 && <span className="badge badge--inline" key={c.unread}>{c.unread}</span>}
              </ConversationMenuRow>
            );
          })}
        </ul>
      )}
      {hasMore && (
        <div className="inbox__more">
          {moreError && <p className="muted small" role="status">No se pudieron cargar. Probá de nuevo.</p>}
          {(query.trim() || anyFilter) && <p className="muted small">Buscás entre los chats cargados. Puede haber más abajo.</p>}
          <button className="btn" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? "Cargando…" : "Cargar chats anteriores"}
          </button>
        </div>
      )}
      {sheet && <FilterSheet initial={filters} onClose={() => setSheet(false)} onApply={(f) => {
        setFilters(f);
        setSheet(false);
      }} />}
      {dialog}
    </div>
  );
}

/** Mientras llegan los chats: filas con la forma de las de Mensajes (foto de 52 y dos líneas). */
function InboxSkeleton() {
  return <SkeletonRows count={8} avatar={52} />;
}
