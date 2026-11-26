import { ChatPresenceDot } from "../features/messages/chatPresence";
import { compareDmOrder, DM_EVENTS, type DmReadReceipt, type DmSettingsChange } from "@mortero/shared/realtime";
import { privateOutbox, newMessageKey, SendFailure, usePending, useTimeline } from "../features/messages/outbox";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate, useParams } from "react-router";
import { api, getSocket, upload, type ChatContact, type Dm, type ReactionEvent } from "../api";
import { myReaction, ReactionBar, ReactionPicker } from "../components/Reactions";
import { useMe } from "../App";
import { Avatar } from "../components/Avatar";
import { BackIcon, DotsIcon, ImageIcon, LockIcon, SendIcon, TimerIcon } from "../components/Icons";
import { useSectionBack } from "../useSectionBack";
import { useMessageActions } from "../features/chat/useMessageActions";
import { useMessageMenuPosition } from "../useMessageMenuPosition";
import { SavedPhrasesButton, SavedPhrasesMenu } from "../features/phrases/SavedPhrases";
import { useDraft } from "../features/chat/useDraft";
import { useKeyboardAfterSend } from "../features/chat/useKeyboardAfterSend";
import { MessageText } from "../features/chat/MessageText";
import { batchReadReceipts } from "../features/messages/readReceipts";
import { albumExpiryLabel, albumNoticeKind, useAlbumNoticeTime } from "../features/messages/albumNotices";
import { ShareAlbumMenu } from "../features/chat/ShareAlbumMenu";
import { Watermark } from "../features/photos/Watermark";
import { ChatPhotoViewer } from "../features/messages/ChatPhotoViewer";
import { useConversationActions } from "../features/messages/ConversationActions";
import { ConversationHeaderMenu } from "../features/messages/ConversationHeaderMenu";
import { chatDateFormat, chatDay, useChatToday } from "../features/messages/chatDates";

function addMessage(list: Dm[], message: Dm) {
  return list.some((m) => m.id === message.id) ? list : [...list, message].sort(compareDmOrder);
}

/** Texto corto para la cita en el composer y en la burbuja. */
function replyPreview(m: Dm) {
  const body = m.body?.trim() || null;
  if (m.kind === "album") return body ? `Álbum privado · ${body}` : "Álbum privado";
  if (m.expiring) return body ? `Foto temporal · ${body}` : "Foto temporal";
  if (m.kind === "photo" || m.photo) return body ?? "Foto";
  return body ?? "Mensaje borrado";
}

export function Conversation() {
  const { id = "" } = useParams();
  return <ConversationThread key={id} id={id} />;
}

function ConversationThread({ id }: { id: string }) {
  const { me } = useMe();
  const scope = JSON.stringify([me?.user.id, id]);
  const pending = usePending(privateOutbox, scope);
  const nav = useNavigate();
  const goBack = useSectionBack("/mensajes");
  const [details, setDetails] = useState<{ id: string; other?: ChatContact; muted: boolean }>();
  const other = details?.id === id ? details.other : undefined;
  const muted = details?.id === id && details.muted;
  const { act, dialog, errorNotice } = useConversationActions(() => nav("/mensajes", { replace: true }));
  const [confirmed, setMessages] = useState<Dm[]>([]);
  /** Si hay mensajes más viejos que los cargados (se piden con "Ver mensajes anteriores"). */
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const { messages, pendingByMessage, remember } = useTimeline(confirmed, pending, me?.user.id);
  const [seen, setSeen] = useState<{ conversationId: string; readAtById: Map<string, string>; through?: Pick<Dm, "createdAt" | "id"> }>();
  const [text, setText] = useDraft(`dm:${me?.user.id ?? ""}:${id}`);
  const [phrasesOpen, setPhrasesOpen] = useState(false);
  const [error, setError] = useState("");
  const [typing, setTyping] = useState(false);
  const [photoMenu, setPhotoMenu] = useState<false | "options" | "album">(false);
  const [msgMenu, setMsgMenu] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Dm | null>(null);
  const [photoMessageId, setPhotoMessageId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ src: string; seconds: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const messageActions = useMessageActions(msgMenu, setMsgMenu);
  const positionMessageMenu = useMessageMenuPosition(listRef, setMsgMenu);
  const stickToBottom = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const keyboard = useKeyboardAfterSend(inputRef);
  const expiringNext = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const myId = me?.user.id;
  const albumNoticeTime = useAlbumNoticeTime(messages);
  const today = useChatToday();

  useEffect(() => {
    setPhotoMessageId(null);
    let alive = true;
    setReplyTo(null);
    setMessages([]);
    let beforeHistory: Array<(messages: Dm[]) => Dm[]> | null = [];
    const receipts = batchReadReceipts(id);
    const applyMessageUpdate = (update: (messages: Dm[]) => Dm[]) => {
      beforeHistory?.push(update);
      setMessages(update);
    };
    api<{ id: string; other?: ChatContact; muted: boolean }>(`/conversations/${id}`)
      .then((c) => alive && setDetails(c))
      .catch(() => nav("/mensajes", { replace: true }));
    api<{ messages: Dm[]; hasMore: boolean }>(`/conversations/${id}/messages`).then((d) => {
      if (!alive) return;
      for (const m of d.messages) {
        if (m.senderId === myId) privateOutbox.acknowledge(scope, m);
      }
      const history = beforeHistory?.reduce((list, update) => update(list), d.messages) ?? d.messages;
      const loaded = [...history].sort(compareDmOrder);
      beforeHistory = null;
      setMessages(loaded);
      setHasMore(d.hasMore);
      // Al abrir el chat, marcá también los mensajes anteriores a la página de historial.
      const oldestLoaded = d.messages[0];
      if (oldestLoaded && d.hasMore) receipts.includeOlderMessages(oldestLoaded.id);
      receipts.schedule(...loaded.filter((message) => message.senderId !== myId && !message.readAt).map(({ id }) => id));
    }).catch(() => { beforeHistory = null; if (alive) setError("No se pudo cargar la charla."); });
    const s = getSocket();
    const onMsg = (m: Dm) => {
      if (m.conversationId !== id) return;
      if (m.senderId === myId) privateOutbox.acknowledge(scope, m);
      setTyping(false);
      applyMessageUpdate((list) => addMessage(list, m));
      if (m.senderId !== myId && !m.readAt) receipts.schedule(m.id);
    };
    // Un mensaje que cambió (el aviso de álbum muestra siempre el estado actual; al reactivarse sube al final).
    const onUpdated = (m: Dm) => {
      if (m.conversationId !== id) return;
      applyMessageUpdate((list) => (list.some((x) => x.id === m.id)
        ? list.map((x) => (x.id === m.id ? m : x)).sort(compareDmOrder)
        : [...list, m].sort(compareDmOrder)));
      if (m.senderId !== myId && !m.readAt) receipts.schedule(m.id);
    };
    const onRead = (p: DmReadReceipt) => {
      if (p.audience === "reader" || p.conversationId !== id || !p.messageIds) return;
      setSeen((previous) => {
        const current = previous?.conversationId === id ? previous : undefined;
        const through = p.through && (!current?.through || compareDmOrder(p.through, current.through) > 0)
          ? p.through : current?.through;
        const readAtById = new Map(current?.readAtById);
        for (const messageId of p.messageIds) {
          if ((readAtById.get(messageId) ?? "") < p.readAt) readAtById.set(messageId, p.readAt);
        }
        return { conversationId: id, readAtById, through };
      });
    };
    const onDeleted = (p: { conversationId: string; id: string }) => {
      if (p.conversationId !== id) return;
      setReplyTo((r) => (r?.id === p.id ? null : r));
      applyMessageUpdate((list) => list
        .filter((m) => m.id !== p.id)
        .map((m) => (m.replyTo?.id === p.id ? { ...m, replyTo: { ...m.replyTo, authorName: null, body: null } } : m)));
    };
    const onSettings = (event: DmSettingsChange) => {
      if (event.conversationId !== id) return;
      if (event.change === "cleared") nav("/mensajes", { replace: true });
      else setDetails((current) => current?.id === id ? { ...current, muted: event.muted } : current);
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
    const stopWatching = privateOutbox.watchConfirmations(scope, onMsg);
    s.on("reaction", onReaction);
    s.on(DM_EVENTS.message, onMsg);
    s.on(DM_EVENTS.updated, onUpdated);
    s.on(DM_EVENTS.read, onRead);
    s.on(DM_EVENTS.deleted, onDeleted);
    s.on(DM_EVENTS.settings, onSettings);
    s.on(DM_EVENTS.opened, onOpened);
    s.on(DM_EVENTS.typing, onTyping);
    return () => {
      stopWatching();
      alive = false;
      receipts.close();
      s.off("reaction", onReaction);
      s.off(DM_EVENTS.message, onMsg);
      s.off(DM_EVENTS.updated, onUpdated);
      s.off(DM_EVENTS.read, onRead);
      s.off(DM_EVENTS.deleted, onDeleted);
      s.off(DM_EVENTS.settings, onSettings);
      s.off(DM_EVENTS.opened, onOpened);
      s.off(DM_EVENTS.typing, onTyping);
      clearTimeout(typingTimer.current);
    };
  }, [id, myId, nav, scope]);

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

  /** Trae la página anterior y deja a la vista el mismo mensaje que estabas mirando. */
  async function loadOlder() {
    const oldest = confirmed[0];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const query = new URLSearchParams({ before: oldest.createdAt, beforeId: oldest.id });
      const page = await api<{ messages: Dm[]; hasMore: boolean }>(`/conversations/${id}/messages?${query}`);
      const list = listRef.current;
      const anchor = document.getElementById(`dm-${oldest.id}`);
      const top = anchor?.getBoundingClientRect().top;
      stickToBottom.current = false;
      flushSync(() => {
        setMessages((current) => {
          const known = new Set(current.map((m) => m.id));
          return [...page.messages.filter((m) => !known.has(m.id)), ...current].sort(compareDmOrder);
        });
        setHasMore(page.hasMore);
      });
      if (list && anchor && top !== undefined) list.scrollTop += anchor.getBoundingClientRect().top - top;
    } catch {
      setError("No se pudieron cargar los mensajes anteriores.");
    } finally {
      setLoadingOlder(false);
    }
  }

  function followLatestMessage() {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }

  useLayoutEffect(followLatestMessage, [messages, typing]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(followLatestMessage);
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

  function startReply(m: Dm) {
    setMsgMenu(null);
    setPhotoMenu(false);
    setPhrasesOpen(false);
    setReplyTo(m);
    inputRef.current?.focus();
  }

  function jumpTo(messageId: string) {
    const el = document.getElementById(`dm-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("bubble--flash");
    setTimeout(() => el.classList.remove("bubble--flash"), 1400);
  }

  function send(e?: React.FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;
    // Mandar con el botón le saca el foco al campo y cierra el teclado. Se lo devolvemos.
    keyboard.restore();
    setError("");
    setText("");
    enqueue(body);
  }

  function enqueue(body: string | null, file?: File) {
    if (!myId) return;
    const quote = replyTo;
    setReplyTo(null);
    stickToBottom.current = true;
    const idempotencyKey = newMessageKey();
    remember(idempotencyKey);
    const headers = { "Idempotency-Key": idempotencyKey };
    const expiring = Boolean(file && expiringNext.current);
    const photo = file && !expiring ? URL.createObjectURL(file) : null;
    const path = `/conversations/${id}/messages`;
    const extra: Record<string, string> = expiring ? { expiring: "1" } : {};
    if (quote) extra.replyToId = quote.id;
    privateOutbox.add({
      scope,
      message: {
        id: idempotencyKey, idempotencyKey, conversationId: id, senderId: myId, body, photo,
        replyTo: quote ? { id: quote.id, authorName: quote.senderId === myId ? me?.profile?.displayName ?? me?.user.name ?? null : other?.name ?? null, body: quote.body ?? (quote.photo ? "Foto" : null) } : null,
        kind: file ? "photo" : "text", expiring, opened: false, readAt: null, createdAt: new Date().toISOString(), reactions: [],
      },
      submit: () => file ? upload<Dm>(path, file, extra, headers)
        : api<Dm>(path, { method: "POST", headers, json: { body, replyToId: quote?.id } }),
      release: photo ? () => URL.revokeObjectURL(photo) : undefined,
    });
  }

  function pickPhoto(expiring: boolean) {
    expiringNext.current = expiring;
    setPhotoMenu(false);
    fileRef.current?.click();
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
    setError("");
    try {
      await api(`/conversations/${id}/messages/${m.id}`, { method: "DELETE" });
    } catch {
      setError("No se pudo confirmar el desenvío. Probá de nuevo.");
      return;
    }
    setReplyTo((r) => (r?.id === m.id ? null : r));
    setMessages((list) => list
      .filter((x) => x.id !== m.id)
      .map((x) => (x.replyTo?.id === m.id ? { ...x, replyTo: { ...x.replyTo, authorName: null, body: null } } : x)));
  }

  const loadedMessageIds = new Set(messages.map((m) => m.id));
  const lastMine = [...messages].reverse().find((m) => m.senderId === myId && !pendingByMessage.has(m));
  const openPhotoMessage = messages.find((m) => m.id === photoMessageId && m.conversationId === id);
  const openPhoto = openPhotoMessage?.photo;
  let previousDay: string | undefined;

  const lastSeen = lastMine && (lastMine.readAt || (seen?.conversationId === id &&
    ((seen.readAtById.get(lastMine.id) ?? "") >= lastMine.createdAt || (seen.through && compareDmOrder(lastMine, seen.through) <= 0))));

  return (
    <div className="chat">
      <header className="topbar topbar--thread topbar--linked">
        <button className="iconbtn" onClick={goBack} aria-label="Volver"><BackIcon /></button>
        {other && (
          <Link to={`/perfil/${other.id}`} className="topbar__who topbar__link">
            <Avatar src={other.photo} name={other.name} size={36} />
            <span>
              <span className="chat-contact-name">
                <ChatPresenceDot state={other.presence} />
                <b>{other.name}</b>
              </span>
              {typing && <span className="typing-label">escribiendo…</span>}
            </span>
          </Link>
        )}
        {other && (
          <ConversationHeaderMenu key={id} muted={muted} onAction={(action) => void act(action, { id, other, muted }, (next) => {
            setDetails((current) => current?.id === id ? { ...current, muted: next } : current);
          })} />
        )}
      </header>

      {errorNotice}

      <div className="chat__list chat__list--dm" role="log" aria-label="Mensajes" ref={listRef} onScroll={onListScroll}>
        {hasMore && (
          <button className="btn btn--ghost btn--small chat__older" disabled={loadingOlder} onClick={() => void loadOlder()}>
            {loadingOlder ? "Cargando…" : "Ver mensajes anteriores"}
          </button>
        )}
        {messages.map((m) => {
          const entry = pendingByMessage.get(m);
          const sentAt = new Date(m.createdAt);
          const day = chatDay(sentAt);
          const startsDay = day !== previousDay;
          previousDay = day;
          const mine = m.senderId === myId;
          const kind = albumNoticeKind(m, albumNoticeTime);
          const albumNotice = kind === "album" || kind === "album_revoked" || kind === "album_expired";
          const albumText = <><LockIcon /> {mine ? "Le compartiste tu álbum privado" : "Te compartió su álbum privado"}{m.body ? ` por ${m.body}` : ""}</>;
          const expiry = albumExpiryLabel(m, albumNoticeTime);
          const quoted = m.replyTo;
          // Mantener apretado (o clic derecho) abre las acciones. Los avisos de álbum y lo que todavía se está mandando no.
          const gesture = !albumNotice && !entry;
          const bubble = (
            <div id={`dm-${m.id}`} className={`bubble ${mine ? "bubble--mine" : ""} ${albumNotice ? "bubble--album" : ""} ${gesture ? "message-gesture" : ""}`} {...(gesture && messageActions(m.id))}>
              {quoted && (quoted.authorName && loadedMessageIds.has(quoted.id) ? (
                <button
                  type="button"
                  className="quote"
                  aria-label={`Ir al mensaje citado de ${quoted.authorName}`}
                  onClick={() => jumpTo(quoted.id)}
                >
                  <span className="quote__name">{quoted.authorName}</span>
                  <span className="quote__body">{quoted.body ?? "Mensaje borrado"}</span>
                </button>
              ) : (
                <div className="quote">
                  <span className="quote__name">{quoted.authorName ?? "Mensaje borrado"}</span>
                  {quoted.authorName && quoted.body && <span className="quote__body">{quoted.body}</span>}
                </div>
              ))}
              {kind === "album" || kind === "album_expired" ? (
                kind === "album" && !mine ? (
                  <Link to={`/perfil/${m.senderId}${m.albumId ? `?album=${encodeURIComponent(m.albumId)}` : ""}`} state={{ fromChat: true }} className="album-msg">
                    {albumText} · <u>Ver</u>
                  </Link>
                ) : <p>{albumText}</p>
              ) : kind === "album_revoked" ? (
                mine ? (
                  <p><LockIcon /> Le dejaste de compartir tu álbum privado</p>
                ) : (
                  <p><LockIcon /> Te dejó de compartir su álbum privado</p>
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
                  {entry?.failure && !entry.failure.retryable && m.kind === "photo" ? <p>Foto</p> : m.photo && (
                    <button type="button" className={`bubble__photo-button${mine ? "" : " private-media"}`} aria-label="Abrir foto" onClick={() => setPhotoMessageId(m.id)}>
                      <img className="bubble__photo" src={m.photo} alt="" loading="lazy" onLoad={followLatestMessage} />
                      {!mine && <Watermark />}
                    </button>
                  )}
                  {m.body && <p>{m.canOpenLinks ? <MessageText text={m.body} /> : m.body}</p>}
                </>
              )}
              <div className="bubble__meta">
                {expiry && `${expiry} · `}
                <time dateTime={m.createdAt}>{sentAt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</time>
              </div>
              {entry && <SendFailure failure={entry.failure} retry={() => privateOutbox.retry(entry)} dismiss={() => privateOutbox.dismiss(entry)} />}
              {!entry && <ReactionBar reactions={m.reactions ?? []} myId={myId} mine={mine} onToggle={(k) => react(m, k)} />}
              {!entry && (
                <>
                  {albumNotice && (
                    <button
                      className="iconbtn bubble__more"
                      aria-label="Reaccionar u opciones del mensaje" aria-expanded={msgMenu === m.id} aria-controls={msgMenu === m.id ? `message-options-${m.id}` : undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        setMsgMenu(msgMenu === m.id ? null : m.id);
                      }}
                    >
                      <DotsIcon />
                    </button>
                  )}
                  {msgMenu === m.id && (
                    <div className={`menu menu--bubble ${mine ? "" : "menu--bubble-theirs"}`} id={`message-options-${m.id}`} role="menu" ref={positionMessageMenu} onClick={(e) => e.stopPropagation()}>
                      <ReactionPicker current={myReaction(m.reactions ?? [], myId)} onPick={(k) => react(m, k)} />
                      {!albumNotice && <button role="menuitem" onClick={() => startReply(m)}>Responder</button>}
                      {mine && !albumNotice && <button role="menuitem" className="danger" onClick={() => unsend(m)}>Desenviar (se borra para los dos)</button>}
                    </div>
                  )}
                </>
              )}
            </div>
          );
          return (
            <Fragment key={m.idempotencyKey ?? m.id}>
              {startsDay && <time className="chat__date" dateTime={day}>{day === today ? "Hoy" : chatDateFormat.format(sentAt)}</time>}
              {bubble}
            </Fragment>
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
        {replyTo && (
          <div className="composer__reply">
            <div className="quote quote--static">
              <span className="quote__name">Respondiendo a {replyTo.senderId === myId ? "tu mensaje" : other?.name ?? "ese mensaje"}</span>
              <span className="quote__body">{replyPreview(replyTo)}</span>
            </div>
            <button
              type="button"
              className="iconbtn"
              aria-label="Cancelar respuesta"
              onClick={() => {
                setReplyTo(null);
                inputRef.current?.focus();
              }}
            >✕</button>
          </div>
        )}
        <div className="composer__row">
          <div className="composer__action">
            <button type="button" className="iconbtn" aria-label="Mandar foto" aria-expanded={Boolean(photoMenu)} onClick={() => { setPhotoMenu((v) => (v ? false : "options")); setPhrasesOpen(false); }}>
              <ImageIcon />
            </button>
          </div>
          <div className="composer__action">
            <SavedPhrasesButton open={phrasesOpen} onToggle={() => { setPhrasesOpen((v) => !v); setPhotoMenu(false); }} />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) enqueue(null, f);
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
              if (e.key === "Escape" && replyTo) {
                e.preventDefault();
                setReplyTo(null);
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="composer__action">
            <button className="sendbtn" aria-label="Mandar" disabled={!text.trim()} onPointerDown={keyboard.onPointerDown} onMouseDown={(e) => e.preventDefault()}><SendIcon /></button>
          </div>
        </div>
      </form>

      {openPhoto && <ChatPhotoViewer src={openPhoto} watermark={openPhotoMessage?.senderId !== myId} onClose={() => setPhotoMessageId(null)} />}
      {dialog}
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
    <div className="viewer private-media" role="dialog" aria-modal aria-label="Foto temporal" onClick={onClose}>
      <div className="viewer__bar"><span style={{ width: `${(left / seconds) * 100}%` }} /></div>
      <div className="viewer__photo">
        <img src={src} alt="Foto temporal" onContextMenu={(e) => e.preventDefault()} draggable={false} />
        <Watermark />
      </div>
      <p className="viewer__note">Se cierra en {Math.max(left, 0)} s y no se puede volver a abrir. Tocá para cerrar.</p>
    </div>
  );
}
