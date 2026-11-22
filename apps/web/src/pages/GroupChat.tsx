import { historyUpdates, refreshPage, watchHistory } from "../features/messages/history";
import { groupOutbox, mergeHistory, SendFailure, usePending, useTimeline } from "../features/messages/outbox";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, getSocket, type GroupInfo, type GroupMessage, type ReactionEvent } from "../api";
import { myReaction, ReactionBar, ReactionPicker } from "../components/Reactions";
import { useMe } from "../App";
import { Avatar } from "../components/Avatar";
import { GroupAvatar } from "../components/GroupAvatar";
import { BackIcon, ClockIcon, DotsIcon, InfoIcon, SendIcon } from "../components/Icons";
import { JoinButton } from "../components/JoinButton";
import { ReportDialog } from "../components/ReportDialog";
import { slowModeText } from "../features/groups/groupRules";
import { SavedPhrasesButton, SavedPhrasesMenu } from "../features/phrases/SavedPhrases";

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function GroupChat() {
  const { id = "general" } = useParams();
  return <GroupChatThread key={id} id={id} />;
}

function GroupChatThread({ id }: { id: string }) {
  const { me } = useMe();
  const scope = JSON.stringify([me?.user.id, id]);
  const pending = usePending(groupOutbox, scope);
  const nav = useNavigate();
  const [info, setInfo] = useState<GroupInfo | null>(null);
  const [infoTick, setInfoTick] = useState(0);
  const [confirmed, setMessages] = useState<GroupMessage[]>([]);
  const { messages, pendingByMessage, remember, forget } = useTimeline(confirmed, pending, me?.user.id);
  const [queued, setQueued] = useState<GroupMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState("");
  const [phrasesOpen, setPhrasesOpen] = useState(false);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<GroupMessage | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function startReply(m: GroupMessage) {
    setMenuFor(null);
    setEditing(null);
    setReplyTo(m);
    inputRef.current?.focus();
  }

  /** Al tocar una cita, va al mensaje original (si está cargado) y lo resalta un momento. */
  function jumpTo(messageId: string) {
    const el = document.getElementById(`gm-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("gmsg--flash");
    setTimeout(() => el.classList.remove("gmsg--flash"), 1400);
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
    const history = historyUpdates(setMessages);
    const queue = historyUpdates(setQueued);
    setMessages([]);
    setQueued([]);
    const stopHistory = watchHistory(async (signal) => {
      history.begin();
      queue.begin();
      const d = await api<{ messages: GroupMessage[]; queued: GroupMessage[]; hasMore: boolean }>(
        `/groups/${id}/messages`, { signal },
      );
      if (signal.aborted) return;
      for (const m of [...d.messages, ...d.queued]) {
        if (m.author.id === me?.user.id) groupOutbox.acknowledge(scope, m);
      }
      for (const m of d.queued) forget(m.idempotencyKey ?? m.id);
      history.finish((list) => refreshPage(list, d.messages, d.hasMore));
      queue.finish(() => d.queued);
      setHasMore(d.hasMore);
    }, (error) => {
      history.stop();
      queue.stop();
      setNotice({ kind: "error", text: error.message });
    });

    const s = getSocket();
    const onMessage = (m: GroupMessage) => {
      if (m.groupId !== id) return;
      if (m.author.id === me?.user.id) groupOutbox.acknowledge(scope, m);
      queue.update((q) => q.filter((x) => x.id !== m.id));
      history.update((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
    };
    const onQueued = (m: GroupMessage) => {
      if (m.groupId !== id) return;
      if (m.author.id === me?.user.id) forget(m.idempotencyKey ?? m.id);
      if (m.author.id === me?.user.id) groupOutbox.acknowledge(scope, m);
      queue.update((q) => {
        const rest = q.filter((x) => x.id !== m.id);
        return [...rest, m].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
      });
    };
    const onCancelled = (p: { id: string; groupId: string }) => {
      if (p.groupId !== id) return;
      queue.update((q) => q.filter((x) => x.id !== p.id));
    };
    const onDeleted = (p: { id: string; groupId: string }) => {
      if (p.groupId !== id) return;
      history.update((list) => list.filter((x) => x.id !== p.id));
    };
    const stopWatching = groupOutbox.watchConfirmations(scope, (m) => {
      if (m.status === "queued") onQueued(m);
      if (m.status === "published") onMessage(m);
    });
    s.on("group:message", onMessage);
    s.on("group:queued", onQueued);
    s.on("group:cancelled", onCancelled);
    s.on("group:deleted", onDeleted);
    const onReaction = (p: ReactionEvent) => {
      if (p.scope !== "group" || p.groupId !== id) return;
      history.update((list) => list.map((x) => (x.id === p.messageId ? { ...x, reactions: p.reactions } : x)));
    };
    s.on("reaction", onReaction);
    return () => {
      stopWatching();
      stopHistory();
      s.off("group:message", onMessage);
      s.off("group:queued", onQueued);
      s.off("group:cancelled", onCancelled);
      s.off("group:deleted", onDeleted);
      s.off("reaction", onReaction);
    };
  }, [id, isMember, scope]);

  // Reloj para las cuentas regresivas de la cola
  useEffect(() => {
    if (!queued.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [queued.length]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [confirmed, pending, queued]);

  function onScroll() {
    const el = listRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function loadOlder() {
    const first = confirmed[0];
    if (!first) return;
    const el = listRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const d = await api<{ messages: GroupMessage[]; hasMore: boolean }>(
      `/groups/${id}/messages?before=${encodeURIComponent(first.scheduledAt)}`,
    );
    stickToBottom.current = false;
    setMessages((list) => mergeHistory(d.messages, list));
    setHasMore(d.hasMore);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - prevHeight;
    });
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || !me) return;
    setNotice(null);
    setText("");
    const quote = replyTo;
    setReplyTo(null);
    if (editing) {
      setEditing(null);
      try {
        await api(`/groups/${id}/messages/${editing}`, { method: "PATCH", json: { body } });
      } catch (err) {
        setText((draft) => draft || body);
        setEditing(editing);
        setReplyTo(quote);
        setNotice({ kind: "error", text: (err as Error).message });
      }
      return;
    }

    const idempotencyKey = crypto.randomUUID();
    remember(idempotencyKey);
    stickToBottom.current = true;
    groupOutbox.add({
      scope,
      message: {
        id: idempotencyKey, idempotencyKey, groupId: id, body, status: "published", scheduledAt: new Date().toISOString(),
        author: { id: me.user.id, name: me.profile?.displayName ?? me.user.name, photo: me.photos.find((p) => !p.isPrivate)?.thumb ?? null },
        replyTo: quote ? { id: quote.id, authorName: quote.author.name, body: quote.body?.slice(0, 160) ?? null } : null,
        reactions: [],
      },
      submit: async () => {
        const result = await api<{ message: GroupMessage }>(`/groups/${id}/messages`, {
          method: "POST", headers: { "Idempotency-Key": idempotencyKey }, json: { body, replyToId: quote?.id },
        });
        return result.message;
      },
    });
  }

  async function cancel(m: GroupMessage) {
    await api(`/groups/${id}/messages/${m.id}`, { method: "DELETE" }).catch(() => {});
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
      setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, reactions } : x)));
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    }
  }

  async function remove(m: GroupMessage) {
    setMenuFor(null);
    await api(`/groups/${id}/messages/${m.id}`, { method: "DELETE" }).catch(() => {});
    setMessages((list) => list.filter((x) => x.id !== m.id));
  }

  if (!info) return <div className="chat" />;
  const rulesText = slowModeText(info.rules);

  // Vista previa para quien todavía no es miembro del grupo
  if (!isMember) {
    return (
      <div className="page">
        <header className="topbar topbar--thread">
          <button className="iconbtn" onClick={() => nav("/grupos?ver=todos")} aria-label="Volver"><BackIcon /></button>
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
        <GroupAvatar name={info.name} photo={info.photo} general={info.isGeneral} size="sm" />
        <div className="topbar__grow">
          <h1 className="topbar__title topbar__title--sm"><Link to={`/grupos/${id}/info`}>{info.isGeneral ? "# " : ""}{info.name}</Link></h1>
          <p className="topbar__sub"><ClockIcon /> {rulesText}</p>
        </div>
        <Link to={`/grupos/${id}/info`} className="btn btn--small group-details-link" aria-label={`Ver detalles${info.pendingCount ? `, ${info.pendingCount} solicitudes pendientes` : ""}`}>
          <InfoIcon /> Ver detalles
          {info.pendingCount > 0 && <b className="badge">{info.pendingCount}</b>}
        </Link>
      </header>

      <div className="chat__list" role="log" aria-label="Mensajes del grupo" ref={listRef} onScroll={onScroll}>
        {hasMore && (
          <button className="btn btn--ghost btn--small chat__older" onClick={loadOlder}>Ver mensajes anteriores</button>
        )}
        {!messages.length && !queued.length && (
          <div className="empty">
            <p className="empty__title">Todavía no habló nadie</p>
            <p className="muted">Rompé el hielo. Acá cada uno habla a su turno, así nadie copa el chat.</p>
          </div>
        )}
        {messages.map((m, i) => {
          const entry = pendingByMessage.get(m);
          const prev = messages[i - 1];
          const grouped =
            prev && prev.author.id === m.author.id &&
            new Date(m.scheduledAt).getTime() - new Date(prev.scheduledAt).getTime() < 5 * 60_000;
          const mine = m.author.id === me?.user.id;
          return (
            <div key={m.idempotencyKey ?? m.id} id={`gm-${m.id}`} className={`gmsg ${grouped && !m.replyTo ? "gmsg--grouped" : ""}`}>
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
                  <button type="button" className="quote" onClick={() => jumpTo(m.replyTo!.id)}>
                    <span className="quote__name">{m.replyTo.authorName}</span>
                    <span className="quote__body">{m.replyTo.body ?? "Mensaje borrado"}</span>
                  </button>
                )}
                <p className="gmsg__body">{m.body}</p>
                <ReactionBar reactions={m.reactions ?? []} myId={me?.user.id} onToggle={(k) => react(m, k)} />
              </div>
              {!entry && <button className="iconbtn gmsg__more" aria-label="Opciones del mensaje" onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}>
                <DotsIcon />
              </button>}
              {menuFor === m.id && (
                <div className="menu" role="menu">
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
                    </>
                  )}
                </div>
              )}
              {entry && <SendFailure failure={entry.failure} retry={() => groupOutbox.retry(entry)} dismiss={() => groupOutbox.dismiss(entry)} />}
            </div>
          );
        })}

        {queued.map((m) => {
          const ms = new Date(m.scheduledAt).getTime() - now;
          return (
            <div key={m.idempotencyKey ?? m.id} className="queued">
              <div className="queued__head">
                <ClockIcon /> En cola · sale en <b>{fmtCountdown(ms)}</b>
              </div>
              <p className="queued__body">{m.body}</p>
              <div className="queued__actions">
                <button className="linkbtn" onClick={() => { setReplyTo(null); setEditing(m.id); setText(m.body ?? ""); }}>Editar</button>
                <button className="linkbtn linkbtn--danger" onClick={() => cancel(m)}>Cancelar</button>
              </div>
            </div>
          );
        })}
      </div>

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
          <SavedPhrasesMenu text={text} onClose={() => setPhrasesOpen(false)} onPick={(p) => { setText(p); setPhrasesOpen(false); inputRef.current?.focus(); }} />
        )}
        <div className="composer__row">
          <SavedPhrasesButton open={phrasesOpen} onToggle={() => setPhrasesOpen((v) => !v)} />
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
          <button className="sendbtn" aria-label="Mandar" disabled={!text.trim()}>
            <SendIcon />
          </button>
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
