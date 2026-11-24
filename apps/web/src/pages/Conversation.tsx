import { compareDmOrder, DM_EVENTS, type DmReadReceipt } from "@mortero/shared/realtime";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, getSocket, upload, type Author, type Dm, type ReactionEvent } from "../api";
import { myReaction, ReactionBar, ReactionPicker } from "../components/Reactions";
import { useMe } from "../App";
import { Avatar } from "../components/Avatar";
import { BackIcon, ImageIcon, LockIcon, SendIcon, TimerIcon } from "../components/Icons";
import { useSectionBack } from "../useSectionBack";
import { useMessageMenuPosition } from "../useMessageMenuPosition";
import { SavedPhrasesButton, SavedPhrasesMenu } from "../features/phrases/SavedPhrases";
import { useDraft } from "../features/chat/useDraft";
import { MessageText } from "../features/chat/MessageText";
import { batchReadReceipts } from "../features/messages/readReceipts";
import { ShareAlbumMenu } from "../features/chat/ShareAlbumMenu";

export function Conversation() {
  const { id = "" } = useParams();
  const { me } = useMe();
  const nav = useNavigate();
  const goBack = useSectionBack("/mensajes");
  const [other, setOther] = useState<Author | null>(null);
  const [messages, setMessages] = useState<Dm[]>([]);
  const [seen, setSeen] = useState<{ conversationId: string; ids: Set<string>; through?: Pick<Dm, "createdAt" | "id"> }>();
  const [text, setText] = useDraft(`dm:${me?.user.id ?? ""}:${id}`);
  const [phrasesOpen, setPhrasesOpen] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [photoMenu, setPhotoMenu] = useState<false | "options" | "album">(false);
  const [msgMenu, setMsgMenu] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ src: string; seconds: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const positionMessageMenu = useMessageMenuPosition(listRef);
  const stickToBottom = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const expiringNext = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const myId = me?.user.id;

  useEffect(() => {
    let alive = true;
    let beforeHistory: Array<(messages: Dm[]) => Dm[]> | null = [];
    const receipts = batchReadReceipts(id);
    const applyMessageUpdate = (update: (messages: Dm[]) => Dm[]) => {
      beforeHistory?.push(update);
      setMessages(update);
    };
    api<{ other: Author }>(`/conversations/${id}`)
      .then((c) => alive && setOther(c.other))
      .catch(() => nav("/mensajes", { replace: true }));
    api<{ messages: Dm[]; hasMore: boolean }>(`/conversations/${id}/messages`).then((d) => {
      if (!alive) return;
      const history = beforeHistory?.reduce((list, update) => update(list), d.messages) ?? d.messages;
      const loaded = [...history].sort(compareDmOrder);
      beforeHistory = null;
      setMessages(loaded);
      // Al abrir el chat, marcá también los mensajes anteriores a la página de historial.
      const oldestLoaded = d.messages[0];
      if (oldestLoaded && d.hasMore) receipts.includeOlderMessages(oldestLoaded.id);
      receipts.schedule(...loaded.filter((message) => message.senderId !== myId && !message.readAt).map(({ id }) => id));
    }).catch(() => { beforeHistory = null; });
    const s = getSocket();
    const onMsg = (m: Dm) => {
      if (m.conversationId !== id) return;
      setTyping(false);
      applyMessageUpdate((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
      if (m.senderId !== myId && !m.readAt) receipts.schedule(m.id);
    };
    const onRead = (p: DmReadReceipt) => {
      if (p.audience === "reader" || p.conversationId !== id || !p.messageIds) return;
      setSeen((previous) => {
        const current = previous?.conversationId === id ? previous : undefined;
        const through = p.through && (!current?.through || compareDmOrder(p.through, current.through) > 0)
          ? p.through : current?.through;
        return { conversationId: id, ids: new Set([...(current?.ids ?? []), ...p.messageIds]), through };
      });
    };
    const onDeleted = (p: { conversationId: string; id: string }) => {
      if (p.conversationId === id) applyMessageUpdate((list) => list.filter((m) => m.id !== p.id));
    };
    const onOpened = (p: { conversationId: string; id: string }) => {
      if (p.conversationId === id) applyMessageUpdate((list) => list.map((m) => (m.id === p.id ? { ...m, opened: true } : m)));
    };
    const onTyping = (p: { conversationId: string }) => {
      if (p.conversationId !== id) return;
      setTyping(true);
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(false), 3500);
    };
    const onReaction = (p: ReactionEvent) => {
      if (p.scope !== "dm" || p.conversationId !== id) return;
      applyMessageUpdate((list) => list.map((m) => (m.id === p.messageId ? { ...m, reactions: p.reactions } : m)));
    };
    s.on("reaction", onReaction);
    s.on(DM_EVENTS.message, onMsg);
    s.on(DM_EVENTS.read, onRead);
    s.on(DM_EVENTS.deleted, onDeleted);
    s.on(DM_EVENTS.opened, onOpened);
    s.on(DM_EVENTS.typing, onTyping);
    return () => {
      alive = false;
      receipts.close();
      s.off("reaction", onReaction);
      s.off(DM_EVENTS.message, onMsg);
      s.off(DM_EVENTS.read, onRead);
      s.off(DM_EVENTS.deleted, onDeleted);
      s.off(DM_EVENTS.opened, onOpened);
      s.off(DM_EVENTS.typing, onTyping);
      clearTimeout(typingTimer.current);
    };
  }, [id, myId, nav]);

  /** Poner, cambiar o sacar mi reacción a un mensaje (si toco la que ya tenía, se saca). */
  async function react(m: Dm, kind: string) {
    setMsgMenu(null);
    try {
      const { reactions } = await api<{ reactions: Dm["reactions"] }>(`/reactions/dm/${m.id}`, { method: "PUT", json: { kind } });
      setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, reactions } : x)));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) list.scrollTop = list.scrollHeight;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  function onListScroll(event: React.UIEvent<HTMLDivElement>) {
    const list = event.currentTarget;
    stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 2;
  }

  function onType(v: string) {
    setText(v);
    if (v.trim()) getSocket().emit(DM_EVENTS.typing, { conversationId: id });
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;
    // Mandar con el botón le saca el foco al campo y cierra el teclado. Se lo devolvemos.
    inputRef.current?.focus();
    setError("");
    setText("");
    try {
      const m = await api<Dm>(`/conversations/${id}/messages`, { method: "POST", json: { body } });
      setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
    } catch (err) {
      setText((t) => t || body);
      setError((err as Error).message);
    }
  }

  function pickPhoto(expiring: boolean) {
    expiringNext.current = expiring;
    setPhotoMenu(false);
    fileRef.current?.click();
  }

  async function sendPhoto(file: File) {
    setSending(true);
    setError("");
    try {
      const m = await upload<Dm>(`/conversations/${id}/messages`, file, expiringNext.current ? { expiring: "1" } : {});
      setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function openExpiring(m: Dm) {
    try {
      const r = await api<{ photo: string; seconds: number }>(`/conversations/${id}/messages/${m.id}/open`, { method: "POST" });
      setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, opened: true } : x)));
      setViewer({ src: r.photo, seconds: r.seconds });
    } catch (err) {
      setError((err as Error).message);
      setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, opened: true } : x)));
    }
  }

  async function unsend(m: Dm) {
    setMsgMenu(null);
    await api(`/conversations/${id}/messages/${m.id}`, { method: "DELETE" }).catch(() => {});
    setMessages((list) => list.filter((x) => x.id !== m.id));
  }

  const lastMine = [...messages].reverse().find((m) => m.senderId === myId);

  const lastSeen = lastMine && (lastMine.readAt || (seen?.conversationId === id &&
    (seen.ids.has(lastMine.id) || (seen.through && compareDmOrder(lastMine, seen.through) <= 0))));

  return (
    <div className="chat">
      <header className="topbar topbar--thread">
        <button className="iconbtn" onClick={goBack} aria-label="Volver"><BackIcon /></button>
        {other && (
          <Link to={`/perfil/${other.id}`} className="topbar__who">
            <Avatar src={other.photo} name={other.name} size={36} />
            <span>
              <b>{other.name}</b> <span className="muted">{other.age}</span>
              {typing && <span className="typing-label">escribiendo…</span>}
            </span>
          </Link>
        )}
      </header>

      <div className="chat__list chat__list--dm" role="log" aria-label="Mensajes" ref={listRef} onScroll={onListScroll} onClick={() => setMsgMenu(null)}>
        {messages.map((m) => {
          const mine = m.senderId === myId;
          return (
            <div key={m.id} className={`bubble ${mine ? "bubble--mine" : ""} ${m.kind === "album" ? "bubble--album" : ""}`}>
              {m.kind === "album" ? (
                mine ? (
                  <p><LockIcon /> Le compartiste tu álbum privado{m.body ? ` por ${m.body}` : ""}</p>
                ) : (
                  <Link to={`/perfil/${m.senderId}?album=1`} className="album-msg">
                    <LockIcon /> Te compartió su álbum privado{m.body ? ` por ${m.body}` : ""} · <u>Ver</u>
                  </Link>
                )
              ) : m.expiring ? (
                mine ? (
                  <p className="expiring"><TimerIcon /> Foto temporal · {m.opened ? "ya la vio" : "sin abrir"}</p>
                ) : m.opened ? (
                  <p className="expiring"><TimerIcon /> Foto temporal · ya la viste</p>
                ) : (
                  <button className="expiring expiring--btn" onClick={() => openExpiring(m)}>
                    <TimerIcon /> Foto temporal · tocá para ver
                  </button>
                )
              ) : (
                <>
                  {m.photo && <img className="bubble__photo" src={m.photo} alt="Foto enviada" loading="lazy" />}
                  {m.body && <p>{m.canOpenLinks ? <MessageText text={m.body} /> : m.body}</p>}
                </>
              )}
              <time>{new Date(m.createdAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</time>
              <ReactionBar reactions={m.reactions ?? []} myId={myId} mine={mine} onToggle={(k) => react(m, k)} />
              {m.kind !== "album" && (
                <>
                  <button
                    className="bubble__more"
                    aria-label="Reaccionar u opciones del mensaje"
                    onClick={(e) => { e.stopPropagation(); setMsgMenu(msgMenu === m.id ? null : m.id); }}
                  >
                    ⋯
                  </button>
                  {msgMenu === m.id && (
                    <div className={`menu menu--bubble ${mine ? "" : "menu--bubble-theirs"}`} role="menu" ref={positionMessageMenu} onClick={(e) => e.stopPropagation()}>
                      <ReactionPicker current={myReaction(m.reactions ?? [], myId)} onPick={(k) => react(m, k)} />
                      {mine && <button role="menuitem" className="danger" onClick={() => unsend(m)}>Desenviar (se borra para los dos)</button>}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
        {lastSeen && messages[messages.length - 1]?.id === lastMine.id && <p className="seen">Visto</p>}
        {typing && <div className="bubble typing" aria-label="Está escribiendo"><i /><i /><i /></div>}
      </div>

      {error && <div className="notice notice--error" role="alert">{error}</div>}

      <form className="composer" onSubmit={send}>
        {photoMenu === "album" && other && (
          <ShareAlbumMenu userId={other.id} name={other.name} onBack={() => setPhotoMenu("options")} />
        )}
        {photoMenu === "options" && (
          <div className="photo-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => pickPhoto(false)}><ImageIcon /> Foto</button>
            <button type="button" role="menuitem" onClick={() => pickPhoto(true)}>
              <TimerIcon /> Foto temporal <span className="muted small">se ve una vez, {10} s</span>
            </button>
            <button type="button" role="menuitem" onClick={() => setPhotoMenu("album")}>
              <LockIcon /> Álbum privado <span className="muted small">compartilo</span>
            </button>
          </div>
        )}
        {phrasesOpen && (
          <SavedPhrasesMenu text={text} onClose={() => setPhrasesOpen(false)} onPick={(p) => { onType(p); setPhrasesOpen(false); }} />
        )}
        <div className="composer__row">
          <button type="button" className="iconbtn" aria-label="Mandar foto" aria-expanded={Boolean(photoMenu)} disabled={sending} onClick={() => { setPhotoMenu((v) => (v ? false : "options")); setPhrasesOpen(false); }}>
            <ImageIcon />
          </button>
          <SavedPhrasesButton open={phrasesOpen} onToggle={() => { setPhrasesOpen((v) => !v); setPhotoMenu(false); }} />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) sendPhoto(f);
              e.target.value = "";
            }}
          />
          <textarea
            ref={inputRef}
            className="composer__input"
            aria-label="Mensaje"
            rows={1}
            maxLength={2000}
            placeholder="Escribí un mensaje…"
            value={text}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="sendbtn" aria-label="Mandar" disabled={!text.trim()} onMouseDown={(e) => e.preventDefault()}><SendIcon /></button>
        </div>
      </form>

      {viewer && <ExpiringViewer src={viewer.src} seconds={viewer.seconds} onClose={() => setViewer(null)} />}
    </div>
  );
}

function ExpiringViewer({ src, seconds, onClose }: { src: string; seconds: number; onClose: () => void }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const t = setInterval(() => setLeft((l) => l - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left <= 0) onClose();
  }, [left, onClose]);
  return (
    <div className="viewer" role="dialog" aria-modal aria-label="Foto temporal" onClick={onClose}>
      <div className="viewer__bar"><span style={{ width: `${(left / seconds) * 100}%` }} /></div>
      <img src={src} alt="Foto temporal" onContextMenu={(e) => e.preventDefault()} draggable={false} />
      <p className="viewer__note">Se cierra en {Math.max(left, 0)} s y no se puede volver a abrir. Tocá para cerrar.</p>
    </div>
  );
}
