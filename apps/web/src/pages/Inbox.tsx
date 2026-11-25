import { ChatPresenceDot } from "../features/messages/chatPresence";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { useMe } from "../App";
import { albumNoticeKind, useAlbumNoticeTime } from "../features/messages/albumNotices";
import { Avatar } from "../components/Avatar";
import { usePullToRefresh } from "../features/navigation/pullToRefresh";
import { useTabData } from "../features/navigation/tabData";
import { useRememberScroll } from "../features/navigation/viewMemory";

function ago(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "ahora";
  if (diff < 3600) return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

export function Inbox() {
  const { me } = useMe();
  const { conversations: list, refreshConversations } = useTabData();
  const albumNoticeTime = useAlbumNoticeTime(list?.map(({ last }) => last) ?? []);
  const [query, setQuery] = useState("");
  const [unread, setUnread] = useState(false);
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const filtered = list?.filter((chat) => (!unread || chat.unread > 0)
    && words.every((word) => normalize(chat.other?.name ?? "").includes(word)));
  const pageRef = useRef<HTMLDivElement>(null);
  useRememberScroll(pageRef, list != null);
  const pullRefresh = usePullToRefresh(pageRef, () => refreshConversations("refresh"));

  return (
    <div className="page" ref={pageRef}>
      <header className="topbar"><h1 className="topbar__title">Mensajes</h1></header>
      {pullRefresh}
      {!!list?.length && (
        <div className="searchbar form">
          <label className="field">
            <span>Buscar por nombre</span>
            <input className="input" type="search" value={query} maxLength={60} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} />
            <span>Solo no leídas</span>
          </label>
        </div>
      )}
      {list === null ? null : list.length === 0 ? (
        <div className="empty">
          <p className="empty__title">Sin mensajes por ahora</p>
          <p className="muted">Tocá la foto de alguien en el chat general para ver su perfil y escribirle.</p>
        </div>
      ) : filtered?.length === 0 ? (
        <div className="empty" role="status"><p className="empty__title">No hay conversaciones que coincidan.</p></div>
      ) : (
        <ul className="inbox">
          {filtered?.map((c) => {
            const mine = c.last.senderId === me?.user.id;
            const kind = albumNoticeKind(c.last, albumNoticeTime);
            const preview =
              kind === "album" ? "Álbum privado compartido"
              : kind === "album_revoked" ? (mine ? "Dejaste de compartir el álbum" : "Dejó de compartir el álbum")
              : kind === "album_expired" ? (mine ? "Venció lo que compartiste" : "Venció lo que te compartieron")
              : c.last.expiring ? "⏱ Foto temporal"
              : kind === "photo" || c.last.photo ? "📷 Foto"
              : c.last.body;
            return (
              <li key={c.id}>
                <Link to={`/mensajes/${c.id}`} className={`inbox__item ${c.unread ? "inbox__item--unread" : ""}`}>
                  <Avatar src={c.other?.photo ?? null} name={c.other?.name ?? "?"} size={52} />
                  <div className="inbox__text">
                    <div className="inbox__top">
                      <b className="chat-contact-name"><ChatPresenceDot state={c.other?.presence} /><span>{c.other?.name ?? "Cuenta borrada"}</span></b>
                      <time>{ago(c.last.createdAt)}</time>
                    </div>
                    <p className="inbox__preview">{mine && "Vos: "}{preview}</p>
                  </div>
                  {c.unread > 0 && <span className="badge badge--inline">{c.unread}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
