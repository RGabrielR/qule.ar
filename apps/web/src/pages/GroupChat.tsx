import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate, useParams } from "react-router";
import { api, ApiError, getSocket, type GroupInfo, type GroupMessage, type ReactionEvent } from "../api";
import { myReaction, ReactionBar, ReactionPicker } from "../components/Reactions";
import { useMe } from "../App";
import { Avatar } from "../components/Avatar";
import { MessageText } from "../features/chat/MessageText";
import { GroupAvatar } from "../components/GroupAvatar";
import { BackIcon, ChevronDownIcon, ClockIcon, DotsIcon, SendIcon } from "../components/Icons";
import { JoinButton } from "../components/JoinButton";
import { ReportDialog } from "../components/ReportDialog";
import { GroupActions } from "../features/groups/GroupActions";
import { slowModeText } from "../features/groups/groupRules";
import { SavedPhrasesButton, SavedPhrasesMenu } from "../features/phrases/SavedPhrases";
import { useDraft } from "../features/chat/useDraft";
import { useMessageMenuPosition } from "../useMessageMenuPosition";
import { useSectionBack } from "../useSectionBack";

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type HistoryPage = { messages: GroupMessage[]; hasMore: boolean };
type QuoteWindow = HistoryPage & { hasNewer: boolean };

export function GroupChat() {
  const { id = "general" } = useParams();
  const { me } = useMe();
  const nav = useNavigate();
  const goBack = useSectionBack("/grupos");
  const [info, setInfo] = useState<GroupInfo | null>(null);
  const [infoTick, setInfoTick] = useState(0);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [quoteWindow, setQuoteWindow] = useState<QuoteWindow | null>(null);
  const visibleMessages = quoteWindow?.messages ?? messages;
  const [queued, setQueued] = useState<GroupMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useDraft(`group:${me?.user.id ?? ""}:${id}`, editing === null);
  const [phrasesOpen, setPhrasesOpen] = useState(false);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<GroupMessage | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function startReply(m: GroupMessage) {
    setMenuFor(null);
    setEditing(null);
    setReplyTo(m);
    inputRef.current?.focus({ preventScroll: true });
  }

  function highlightMessage(messageId: string) {
    const el = document.getElementById(`gm-${messageId}`);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("gmsg--flash");
    setTimeout(() => el.classList.remove("gmsg--flash"), 1400);
    return true;
  }

  function cancelHistoryRequest() {
    historyRequest.current?.abort();
    historyRequest.current = null;
    setFindingQuote(false);
  }

  function jumpToEnd() {
    cancelHistoryRequest();
    stickToBottom.current = true;
    flushSync(() => setQuoteWindow(null));
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }

  function resumeLiveHistory(history: GroupMessage[], moreBefore: boolean) {
    const last = history.at(-1)!;
    setMessages(live => [...history, ...live.filter(message =>
      message.scheduledAt > last.scheduledAt ||
      (message.scheduledAt === last.scheduledAt && message.id > last.id)
    )]);
    setHasMore(moreBefore);
    setQuoteWindow(null);
  }

  async function jumpTo(quote: NonNullable<GroupMessage["replyTo"]>) {
    cancelHistoryRequest();
    if (highlightMessage(quote.id)) return;
    if (quote.body === null) {
      setNotice({ kind: "info", text: "El mensaje citado ya no está disponible." });
      return;
    }
    setFindingQuote(true);
    await requestHistory<QuoteWindow>(new URLSearchParams({ around: quote.id }), page => {
      stickToBottom.current = false;
      flushSync(() => {
        if (page.hasNewer) setQuoteWindow(page);
        else resumeLiveHistory(page.messages, page.hasMore);
      });
      highlightMessage(quote.id);
    });
  }

  async function requestHistory<T>(query: URLSearchParams, apply: (page: T) => void) {
    if (historyRequest.current) return;
    const request = new AbortController();
    historyRequest.current = request;
    try {
      const page = await api<T>(`/groups/${id}/messages?${query}`, { signal: request.signal });
      if (!request.signal.aborted) apply(page);
    } catch (err) {
      if (!request.signal.aborted) setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      if (historyRequest.current === request) {
        historyRequest.current = null;
        setFindingQuote(false);
      }
    }
  }

  function updatePublished(update: (list: GroupMessage[]) => GroupMessage[]) {
    setMessages(update);
    setQuoteWindow(page => page && { ...page, messages: update(page.messages) });
  }

  /** Abre (o crea) la charla privada con quien escribió el mensaje. */
  async function writePrivately(userId: string) {
    setMenuFor(null);
    try {
      const { id: convId } = await api<{ id: string }>("/conversations", { method: "POST", json: { userId } });
      nav(`/mensajes/${convId}`);
    } catch {
      alert("No se pudo abrir la charla. Probá de nuevo.");
    }
  }
  const [reporting, setReporting] = useState<GroupMessage | null>(null);
  const [reportingGroupId, setReportingGroupId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const listRef = useRef<HTMLDivElement>(null);
  const positionMessageMenu = useMessageMenuPosition(listRef, setMenuFor);
  const [findingQuote, setFindingQuote] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const [showJumpToEnd, setShowJumpToEnd] = useState(false);
  const historyRequest = useRef<AbortController | null>(null);
  const stickToBottom = useRef(true);

  const isMember = Boolean(info?.role);
  const isMod = info?.role === "owner" || info?.role === "moderator";

  // Info del grupo (se recarga cuando cambian solicitudes o roles)
  useEffect(() => {
    let alive = true;
    api<GroupInfo>(`/groups/${id}`)
      .then((g) => alive && setInfo(g))
      .catch(() => nav("/grupos", { replace: true }));
    return () => {
      alive = false;
    };
  }, [id, infoTick, nav]);

  useEffect(() => {
    const s = getSocket();
    const bump = (p: { groupId: string }) => p.groupId === id && setInfoTick((t) => t + 1);
    const kicked = (p: { groupId: string }) => {
      if (p.groupId !== id) return;
      nav("/grupos", { replace: true });
    };
    for (const ev of ["group:request", "group:role", "group:accepted", "group:rejected"]) s.on(ev, bump);
    s.on("group:removed", kicked);
    s.on("group:gone", kicked);
    return () => {
      for (const ev of ["group:request", "group:role", "group:accepted", "group:rejected"]) s.off(ev, bump);
      s.off("group:removed", kicked);
      s.off("group:gone", kicked);
    };
  }, [id, nav]);

  useEffect(() => {
    if (!isMember) return;
    let request: AbortController | undefined;
    let firstLoad = true;
    type Update = (list: GroupMessage[]) => GroupMessage[];
    // Mientras se pide el historial, los eventos que llegan se guardan para aplicarlos sobre la respuesta
    let publishedChanges: Update[] | null = [];
    let queuedChanges: Update[] | null = [];
    function livePublished(change: Update, alsoQuoteWindow = false) {
      publishedChanges?.push(change);
      if (alsoQuoteWindow) updatePublished(change);
      else setMessages(change);
    }
    function liveQueued(change: Update) {
      queuedChanges?.push(change);
      setQueued(change);
    }
    setFindingQuote(false);
    setQuoteWindow(null);
    setMessages([]);
    setQueued([]);

    /** Pide el historial y la cola. */
    async function refreshHistory() {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const published: Update[] = [];
      const queuedUpdates: Update[] = [];
      publishedChanges = published;
      queuedChanges = queuedUpdates;
      try {
        const d = await api<{ messages: GroupMessage[]; queued: GroupMessage[]; hasMore: boolean }>(
          `/groups/${id}/messages`, { signal: controller.signal, cache: "no-store" },
        );
        if (controller.signal.aborted) return;
        if (firstLoad) stickToBottom.current = true;
        firstLoad = false;
        const oldest = d.messages[0];
        setMessages((current) => {
          const overlap = oldest && current.some((m) => m.id === oldest.id);
          const older = d.hasMore && overlap ? current.filter((m) => m.scheduledAt < oldest.scheduledAt) : [];
          return published.reduce((list, change) => change(list), [...older, ...d.messages]);
        });
        setQueued(queuedUpdates.reduce((list, change) => change(list), d.queued));
        setHasMore(d.hasMore);
      } catch (error) {
        if (!controller.signal.aborted) setNotice({ kind: "error", text: (error as Error).message });
      } finally {
        if (request === controller) {
          publishedChanges = null;
          queuedChanges = null;
        }
      }
    }

    const s = getSocket();
    // Al volver la conexión después de un corte, se pide todo de nuevo por si se perdieron eventos
    let lostConnection = false;
    const onDisconnect = () => { lostConnection = true; };
    const onReconnect = () => {
      if (!lostConnection) return;
      lostConnection = false;
      void refreshHistory();
    };
    s.on("disconnect", onDisconnect);
    s.on("connect", onReconnect);
    void refreshHistory();
    const onMessage = (m: GroupMessage) => {
      if (m.groupId !== id) return;
      liveQueued((q) => q.filter((x) => x.id !== m.id));
      livePublished((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
    };
    const onQueued = (m: GroupMessage) => {
      if (m.groupId !== id) return;
      liveQueued((q) => {
        const rest = q.filter((x) => x.id !== m.id);
        return [...rest, m].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
      });
    };
    const onCancelled = (p: { id: string; groupId: string }) => {
      if (p.groupId === id) liveQueued((q) => q.filter((x) => x.id !== p.id));
    };
    const onDeleted = (p: { id: string; groupId: string }) => {
      if (p.groupId === id) livePublished((list) => list.filter((x) => x.id !== p.id), true);
    };
    s.on("group:message", onMessage);
    s.on("group:queued", onQueued);
    s.on("group:cancelled", onCancelled);
    s.on("group:deleted", onDeleted);
    const onReaction = (p: ReactionEvent) => {
      if (p.scope !== "group" || p.groupId !== id) return;
      livePublished((list) => list.map((x) => (x.id === p.messageId ? { ...x, reactions: p.reactions } : x)), true);
    };
    s.on("reaction", onReaction);
    return () => {
      request?.abort();
      s.off("disconnect", onDisconnect);
      s.off("connect", onReconnect);
      historyRequest.current?.abort();
      historyRequest.current = null;
      s.off("group:message", onMessage);
      s.off("group:queued", onQueued);
      s.off("group:cancelled", onCancelled);
      s.off("group:deleted", onDeleted);
      s.off("reaction", onReaction);
    };
  }, [id, isMember]);

  // Reloj para las cuentas regresivas de la cola
  useEffect(() => {
    if (!queued.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [queued.length]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && !quoteWindow && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, queued, quoteWindow]);

  useEffect(() => {
    const end = endRef.current;
    const root = listRef.current;
    if (!end || !root) return;
    const observer = new IntersectionObserver(([entry]) => setShowJumpToEnd(!entry.isIntersecting), {
      root, rootMargin: "0px 0px 240px 0px",
    });
    observer.observe(end);
    return () => observer.disconnect();
  }, [id, isMember]);

  function onScroll() {
    const el = listRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function loadHistory(direction: "before" | "after") {
    const older = direction === "before";
    const edge = older ? visibleMessages[0] : visibleMessages.at(-1);
    if (!edge) return;
    const query = new URLSearchParams({ [direction]: edge.scheduledAt, cursorId: edge.id });
    await requestHistory<HistoryPage>(query, page => {
      const list = listRef.current;
      if (!list) return;
      const anchor = document.getElementById(`gm-${edge.id}`)?.querySelector(".gmsg__body");
      const top = anchor?.getBoundingClientRect().top;
      stickToBottom.current = false;
      flushSync(() => {
        if (quoteWindow && !older && !page.hasMore) {
          resumeLiveHistory([...quoteWindow.messages, ...page.messages], quoteWindow.hasMore);
        } else if (quoteWindow) {
          setQuoteWindow(current => {
            if (!current) return null;
            return older
              ? { ...current, messages: [...page.messages, ...current.messages], hasMore: page.hasMore }
              : { ...current, messages: [...current.messages, ...page.messages], hasNewer: page.hasMore };
          });
        } else {
          setMessages(current => [...page.messages, ...current]);
          setHasMore(page.hasMore);
        }
      });
      if (anchor && top !== undefined) list.scrollTop += anchor.getBoundingClientRect().top - top;
    });
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;
    // Mandar con el botón le saca el foco al campo y cierra el teclado. Se lo devolvemos.
    inputRef.current?.focus({ preventScroll: true });
    setNotice(null);
    // Se vacía al toque; si falla, se devuelve el texto
    setText("");
    const wasEditing = editing;
    const wasReplying = replyTo;
    setReplyTo(null);
    try {
      if (wasEditing) {
        setEditing(null);
        await api(`/groups/${id}/messages/${wasEditing}`, { method: "PATCH", json: { body } });
        return;
      }
      const r = await api<{ message: GroupMessage; reasons: string[] }>(`/groups/${id}/messages`, {
        method: "POST",
        json: { body, replyToId: wasReplying?.id },
      });
      jumpToEnd();
      if (r.message.status === "queued") {
        setQueued((q) => (q.some((x) => x.id === r.message.id) ? q : [...q, r.message]));
        const why = r.reasons.length ? ` (${r.reasons.join(", ")})` : "";
        setNotice({ kind: "info", text: `Tu mensaje quedó en cola${why}. Sale solo cuando te toque.` });
      } else {
        setMessages((list) => (list.some((x) => x.id === r.message.id) ? list : [...list, r.message]));
      }
    } catch (err) {
      setText((t) => t || body);
      if (wasEditing) setEditing(wasEditing);
      if (wasReplying) setReplyTo(wasReplying);
      setNotice({ kind: "error", text: (err as Error).message });
    }
  }

  async function cancel(m: GroupMessage) {
    setNotice(null);
    try {
      await api(`/groups/${id}/messages/${m.id}?onlyQueued=1`, { method: "DELETE" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setNotice({ kind: "info", text: error.message });
        setQueued((q) => q.filter((x) => x.id !== m.id));
        return;
      }
      setNotice({ kind: "error", text: "No se pudo confirmar la cancelación. Probá de nuevo." });
      return;
    }
    setQueued((q) => q.filter((x) => x.id !== m.id));
    if (editing === m.id) {
      setEditing(null);
      setText("");
    }
  }

  /** Poner, cambiar o sacar mi reacción (si toco la que ya tenía, se saca). */
  async function react(m: GroupMessage, kind: string) {
    setMenuFor(null);
    try {
      const { reactions } = await api<{ reactions: GroupMessage["reactions"] }>(`/reactions/group/${m.id}`, { method: "PUT", json: { kind } });
      updatePublished((list) => list.map((x) => (x.id === m.id ? { ...x, reactions } : x)));
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    }
  }

  async function remove(m: GroupMessage) {
    setMenuFor(null);
    setNotice(null);
    try {
      await api(`/groups/${id}/messages/${m.id}`, { method: "DELETE" });
    } catch {
      setNotice({ kind: "error", text: "No se pudo confirmar el borrado. Probá de nuevo." });
      return;
    }
    updatePublished((list) => list.filter((x) => x.id !== m.id));
  }

  /** Expulsar desde el chat, sin buscar a la persona en la lista de integrantes. El servidor decide si se puede. */
  async function kick(m: GroupMessage) {
    setMenuFor(null);
    if (!confirm(`¿Expulsar a ${m.author.name} del grupo? Va a tener que esperar para volver a pedir entrar.`)) return;
    setNotice(null);
    try {
      await api(`/groups/${id}/members/${m.author.id}`, { method: "DELETE" });
      setNotice({ kind: "info", text: `${m.author.name} ya no está en el grupo.` });
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    }
  }

  if (!info) return <div className="chat" />;
  const rulesText = slowModeText(info.rules);

  // Vista previa para quien todavía no es miembro del grupo
  if (!isMember) {
    return (
      <div className="page">
        <header className="topbar topbar--thread">
          <button className="iconbtn" onClick={() => (window.history.state?.idx > 0 ? nav(-1) : nav("/grupos?ver=todos"))} aria-label="Volver"><BackIcon /></button>
          <h1 className="topbar__title topbar__title--sm">{info.name}</h1>
        </header>
        <div className="preview">
          <GroupAvatar name={info.name} photo={info.photo} general={info.isGeneral} size="big" />
          <h2>{info.name}</h2>
          {info.description && <p className="muted group-description">{info.description}</p>}
          <p className="muted small">{info.memberCount} {info.memberCount === 1 ? "miembro" : "miembros"} · {rulesText}</p>
          <div className="preview__request">
            {info.pending && info.pendingMessage && (
              <div className="preview__request-message">
                <h3 className="small muted">Tu mensaje</h3>
                <p className="group-description">{info.pendingMessage}</p>
              </div>
            )}
            <JoinButton g={info} onChange={() => setInfoTick((t) => t + 1)} />
          </div>
          <p className="small">Los mensajes de este grupo solo los ven sus miembros.</p>
          {!info.isGeneral && (
            <button type="button" className="btn btn--small btn--ghost btn--dangertext" onClick={() => setReportingGroupId(info.id)}>
              Reportar este grupo
            </button>
          )}
        </div>
        {reportingGroupId === id && (
          <ReportDialog groupId={info.id} name={info.name} onClose={() => setReportingGroupId(null)} />
        )}
      </div>
    );
  }

  return (
    <div className="chat">
      <header className="topbar">
        <button type="button" className="iconbtn" onClick={goBack} aria-label="Volver a Grupos"><BackIcon /></button>
        <GroupAvatar name={info.name} photo={info.photo} general={info.isGeneral} size="sm" />
        <div className="topbar__grow">
          <h1 className="topbar__title topbar__title--sm"><Link to={`/grupos/${id}/info`} state={{ fromGroupChat: true }}>{info.isGeneral ? "# " : ""}{info.name}</Link></h1>
          <p className="topbar__sub"><ClockIcon /> {rulesText}</p>
        </div>
        <GroupActions
          key={id}
          group={info}
          onMutedChange={(muted) => setInfo((current) => current?.id === id ? { ...current, muted } : current)}
          onError={(message) => setNotice({ kind: "error", text: message })}
        />
      </header>

      <div className="chat__list" role="log" aria-label="Mensajes del grupo" ref={listRef} onScroll={onScroll}>
        {(quoteWindow?.hasMore ?? hasMore) && (
          <button className="btn btn--ghost btn--small chat__older" onClick={() => void loadHistory("before")}>Ver mensajes anteriores</button>
        )}
        {!visibleMessages.length && !queued.length && (
          <div className="empty">
            <p className="empty__title">Todavía no habló nadie</p>
            <p className="muted">Rompé el hielo. Acá cada uno habla a su turno, así nadie copa el chat.</p>
          </div>
        )}
        {visibleMessages.map((m, i) => {
          const prev = visibleMessages[i - 1];
          const grouped =
            prev && prev.author.id === m.author.id &&
            new Date(m.scheduledAt).getTime() - new Date(prev.scheduledAt).getTime() < 5 * 60_000;
          const mine = m.author.id === me?.user.id;
          return (
            <div key={m.id} id={`gm-${m.id}`} className={`gmsg ${grouped && !m.replyTo ? "gmsg--grouped" : ""}`}>
              <div className="gmsg__avatar">
                {!(grouped && !m.replyTo) && (
                  <Link to={`/perfil/${m.author.id}`} aria-label={`Ver perfil de ${m.author.name}`}>
                    <Avatar src={m.author.photo} name={m.author.name} size={36} />
                  </Link>
                )}
              </div>
              <div className="gmsg__content">
                {!(grouped && !m.replyTo) && (
                  <div className="gmsg__meta">
                    <Link to={`/perfil/${m.author.id}`} className="gmsg__name">{m.author.name}</Link>
                    <time className="gmsg__time">{fmtTime(m.scheduledAt)}</time>
                  </div>
                )}
                {m.replyTo && (
                  <button type="button" className="quote" onClick={() => jumpTo(m.replyTo!)}>
                    <span className="quote__name">{m.replyTo.authorName}</span>
                    <span className="quote__body">{m.replyTo.body ?? "Mensaje borrado"}</span>
                  </button>
                )}
                <p className="gmsg__body">{m.canOpenLinks ? <MessageText text={m.body} /> : m.body}</p>
                <ReactionBar reactions={m.reactions ?? []} myId={me?.user.id} onToggle={(k) => react(m, k)} />
              </div>
              <button className="iconbtn gmsg__more" aria-label="Opciones del mensaje" aria-expanded={menuFor === m.id} aria-controls={menuFor === m.id ? `message-options-${m.id}` : undefined} onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}>
                <DotsIcon />
              </button>
              {menuFor === m.id && (
                <div className="menu" id={`message-options-${m.id}`} role="menu" ref={positionMessageMenu}>
                  {m.status === "published" && <ReactionPicker current={myReaction(m.reactions ?? [], me?.user.id)} onPick={(k) => react(m, k)} />}
                  {m.status === "published" && <button role="menuitem" onClick={() => startReply(m)}>Responder</button>}
                  {mine ? (
                    <button role="menuitem" onClick={() => remove(m)}>Borrar mensaje</button>
                  ) : (
                    <>
                      <button role="menuitem" onClick={() => writePrivately(m.author.id)}>Escribir por privado</button>
                      <Link role="menuitem" to={`/perfil/${m.author.id}`}>Ver perfil</Link>
                      <button role="menuitem" onClick={() => { setMenuFor(null); setReporting(m); }}>Reportar mensaje</button>
                      {isMod && <button role="menuitem" className="danger" onClick={() => remove(m)}>Borrar (moderación)</button>}
                      {isMod && !info.isGeneral && <button role="menuitem" className="danger" onClick={() => void kick(m)}>Expulsar del grupo</button>}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {quoteWindow?.hasNewer && (
          <button className="btn btn--ghost btn--small chat__older" onClick={() => void loadHistory("after")}>Ver mensajes siguientes</button>
        )}
        {!quoteWindow && queued.map((m) => {
          const ms = new Date(m.scheduledAt).getTime() - now;
          return (
            <div key={m.id} className="queued">
              <p className="queued__body">{m.body}</p>
              <div className="queued__footer">
                <span className="queued__time"><ClockIcon /> Sale en {fmtCountdown(ms)}</span>
                <div className="queued__actions">
                  <button className="linkbtn" onClick={() => { setReplyTo(null); setEditing(m.id); setText(m.body ?? ""); }}>Editar</button>
                  <button className="linkbtn linkbtn--danger" onClick={() => cancel(m)}>Cancelar</button>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} aria-hidden="true" />
      </div>
      {(showJumpToEnd || quoteWindow || findingQuote) && (
        <div className="chat__jump">
          <button type="button" className="iconbtn chat__jump-button" aria-label="Ir al último mensaje"
            onClick={jumpToEnd}>
            <ChevronDownIcon />
          </button>
        </div>
      )}

      {findingQuote && <p className="notice" role="status">Buscando el mensaje citado…</p>}
      {notice && (
        <div className={`notice notice--${notice.kind}`} role="status">
          <span>{notice.text}</span>
          <button className="linkbtn" onClick={() => setNotice(null)} aria-label="Cerrar aviso">✕</button>
        </div>
      )}

      <form className="composer" onSubmit={send}>
        {editing && (
          <div className="composer__editing">
            Editando un mensaje en cola
            <button type="button" className="linkbtn" onClick={() => { setEditing(null); setText(""); }}>Cancelar</button>
          </div>
        )}
        {replyTo && !editing && (
          <div className="composer__reply">
            <div className="quote quote--static">
              <span className="quote__name">Respondiendo a {replyTo.author.name}</span>
              <span className="quote__body">{replyTo.body}</span>
            </div>
            <button type="button" className="iconbtn" aria-label="Cancelar respuesta" onClick={() => setReplyTo(null)}>✕</button>
          </div>
        )}
        {phrasesOpen && (
          <SavedPhrasesMenu text={text} onClose={() => setPhrasesOpen(false)} onPick={(p) => { setText(p); setPhrasesOpen(false); inputRef.current?.focus({ preventScroll: true }); }} />
        )}
        <div className="composer__row">
          <div className="composer__action">
            <SavedPhrasesButton open={phrasesOpen} onToggle={() => setPhrasesOpen((v) => !v)} />
          </div>
          <textarea
            ref={inputRef}
            className="composer__input"
            aria-label={`Mensaje para #${info?.name ?? "el grupo"}`}
            rows={1}
            maxLength={1000}
            placeholder={`Escribí en #${info?.name ?? ""}…`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="composer__action">
            <button className="sendbtn" aria-label="Mandar" disabled={!text.trim()} onMouseDown={(e) => e.preventDefault()}>
              <SendIcon />
            </button>
          </div>
        </div>
      </form>

      {reporting && (
        <ReportDialog
          userId={reporting.author.id}
          name={reporting.author.name}
          messageId={reporting.id}
          messageKind="group"
          onClose={() => setReporting(null)}
        />
      )}
    </div>
  );
}
