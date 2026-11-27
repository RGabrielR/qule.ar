import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { api, type StaffAccess } from "../../api";
import { Avatar } from "../../components/Avatar";
import { ChevronLeftIcon, ChevronRightIcon } from "../../components/Icons";
import { GroupCard, NoReports, ReportFilterBar, useReportFilters } from "./ReportGroups";
import type { ReportGroup } from "./groupReports";
import type { AccountHistory, Report } from "./types";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });

/** "hace 5 min", "hace 3 h", o la fecha si pasó más de un día. */
function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  if (min < 24 * 60) return `hace ${Math.round(min / 60)} h`;
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const kindOf = (g: ReportGroup) => (g.first.group ? "Grupo" : g.messages.length ? "Mensajes" : "Perfil");

/** Lo que tiene el foco no es para moverse por la lista: se escribe, se elige o hay una hoja abierta. */
function typing(target: EventTarget | null) {
  if (document.querySelector("[role=dialog]")) return true;
  return target instanceof Element && !!target.closest("input, textarea, select, [contenteditable]");
}

/**
 * Moderación en compu: a la izquierda, todos los temas en una lista densa con los filtros arriba; a la derecha, el tema
 * elegido con la evidencia (mensajes, fotos para verificar, comentarios), el historial y las acciones. Se pasa de un
 * tema a otro con las flechas o con J y K, sin entrar y salir de cada caso. Al resolver uno, queda elegido el siguiente.
 */
export function ReportDesk({ reports, status, has, act, onSuspend, onRemoveGroup, onRefresh }: {
  reports: Report[];
  status: "open" | "closed";
  has: (...need: StaffAccess[]) => boolean;
  act: (fn: () => Promise<unknown>) => void;
  onSuspend: (r: Report) => void;
  onRefresh: () => void;
  onRemoveGroup: (r: Report) => void;
}) {
  const state = useReportFilters(reports);
  const { visible } = state;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Si el tema elegido se resolvió (y salió de la lista), queda elegido el que estaba en su lugar
  const lastIndex = useRef(0);
  const found = visible.findIndex((g) => g.key === selectedKey);
  const index = found >= 0 ? found : Math.min(lastIndex.current, visible.length - 1);
  const selected = index >= 0 ? visible[index] : undefined;
  const list = useRef<HTMLUListElement>(null);
  const detail = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (index >= 0) lastIndex.current = index;
  });

  // Los temas borrados conservan los reportes resueltos que todavía se pueden asociar.
  const [closed, setClosed] = useState<Report[] | null>(null);
  const needsClosed = status === "open" && !!selected && !selected.first.target?.id && !selected.first.group?.id;
  useEffect(() => {
    if (!needsClosed) return;
    let alive = true;
    api<Report[]>("/admin/reports?status=closed").then((r) => alive && setClosed(r)).catch(() => alive && setClosed([]));
    return () => { alive = false; };
  }, [needsClosed, reports]);

  function select(i: number) {
    const g = visible[i];
    if (!g) return;
    setSelectedKey(g.key);
    detail.current?.scrollTo({ top: 0 });
    list.current?.querySelector(`[data-key="${CSS.escape(g.key)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); select(index + 1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); select(index - 1); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!reports.length) return <NoReports status={status} />;

  return (
    <div className="desk">
      <section className="desk__list" aria-label="Temas reportados">
        <ReportFilterBar state={state} status={status} />
        {visible.length === 0 ? (
          <div className="empty"><p className="muted">Ningún reporte coincide con los filtros.</p></div>
        ) : (
          <>
            <div className="desk__cols muted small" aria-hidden>
              <span>Tema</span><span>Motivos</span><span>Reportes</span><span>Último</span>
            </div>
            <ul className="desk__rows" ref={list}>
              {visible.map((g, i) => {
                const name = g.first.group?.name ?? g.first.target?.name ?? "Cuenta borrada";
                const open = g.reports.some((r) => r.status === "open");
                return (
                  <li key={g.key}>
                    <button
                      type="button"
                      data-key={g.key}
                      className={`desk__row${g.urgent && open ? " desk__row--urgent" : ""}`}
                      aria-current={i === index ? "true" : undefined}
                      onClick={() => select(i)}
                    >
                      <span className="desk__who">
                        <Avatar src={g.first.target?.photo ?? null} name={name} size={32} />
                        <span className="desk__name">
                          <b>{name}</b>
                          <span className="muted small">
                            {g.urgent && open ? "Urgente · " : ""}{kindOf(g)}{g.first.targetSuspendedAt ? " · suspendida" : ""}
                          </span>
                        </span>
                      </span>
                      <span className="desk__reasons">
                        {g.reasons.slice(0, 2).map(([reason, n]) => (
                          <span key={reason} className="pill pill--reason">{reason}{n > 1 && ` · ${n}`}</span>
                        ))}
                        {g.reasons.length > 2 && <span className="muted small">+{g.reasons.length - 2}</span>}
                      </span>
                      <span className="desk__count">
                        <b>{g.reports.length}</b>
                        <span className="muted small">{g.automatic ? "de la app" : plural(g.reporters, "persona", "personas")}</span>
                      </span>
                      <time className="desk__time muted small" dateTime={g.latest}>{ago(g.latest)}</time>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <div className="desk__detail" ref={detail} aria-label="Tema elegido" role="region">
        {selected ? (
          <>
            <div className="desk__nav">
              <span className="muted small">Tema {index + 1} de {visible.length}</span>
              <span className="desk__keys muted small">Flechas o J y K para moverte</span>
              <button type="button" className="iconbtn" aria-label="Tema anterior" aria-keyshortcuts="ArrowUp K" disabled={index <= 0} onClick={() => select(index - 1)}>
                <ChevronLeftIcon />
              </button>
              <button type="button" className="iconbtn" aria-label="Tema siguiente" aria-keyshortcuts="ArrowDown J" disabled={index >= visible.length - 1} onClick={() => select(index + 1)}>
                <ChevronRightIcon />
              </button>
            </div>
            <GroupCard key={selected.key} g={selected} as="section" has={has} act={act} onSuspend={onSuspend} onRemoveGroup={onRemoveGroup} onRefresh={onRefresh} />
            <History g={selected} closed={status === "open" ? closed : null} version={reports} showSent={has("owner")} />
          </>
        ) : (
          <div className="empty"><p className="muted">Elegí un tema de la lista.</p></div>
        )}
      </div>
    </div>
  );
}

/** Lo que ya se sabe del tema: el historial completo de la cuenta o, si es un grupo, su estado y los reportes resueltos. */
function History({ g, closed, version, showSent }: { g: ReportGroup; closed: Report[] | null; version: unknown; showSent: boolean }) {
  const id = g.first.target?.id;
  return id ? <AccountHistoryCard key={id} id={id} g={g} version={version} showSent={showSent} /> : <SubjectHistory g={g} closed={closed} />;
}

const TIMELINE_START = 12;

const appealStatus = { open: "Sin responder todavía", upheld: "Se mantuvo la suspensión", lifted: "Se levantó la suspensión" } as const;

/**
 * El historial de una cuenta (GET /admin/users/:id/history): cuándo se creó, cómo está, los reportes que recibió y los
 * que hizo, y una línea de tiempo con los reportes ya resueltos, lo que hizo moderación y sus pedidos de revisión.
 * Se vuelve a pedir cuando cambia la lista (por ejemplo, después de suspender o descartar).
 */
function AccountHistoryCard({ id, g, version, showSent }: { id: string; g: ReportGroup; version: unknown; showSent: boolean }) {
  const [h, setHistory] = useState<AccountHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    api<AccountHistory>(`/admin/users/${encodeURIComponent(id)}/history`)
      .then((data) => { if (alive) { setHistory(data); setFailed(false); } })
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [id, version, retry]);

  const r = g.first;

  const current = new Set(g.reports.map((report) => report.id));
  const timeline = h ? buildTimeline(h) : [];
  const shown = all ? timeline : timeline.slice(0, TIMELINE_START);
  const open = h?.reports.filter((x) => x.status === "open").length ?? 0;

  return (
    <section className="rcard desk__history" aria-label="Historial" aria-busy={!h && !failed}>
      <h2 className="small"><b>Historial</b></h2>
      <ul className="desk__facts small">
        {h && <li>Cuenta creada el {fmtDay(h.createdAt)}</li>}
        <li>
          {plural(h?.reportCount ?? r.targetReportCount, "reporte", "reportes")} en total sobre esta cuenta
          {open > 0 && `, ${plural(open, "abierto", "abiertos")}`}
        </li>
        <li>
          {r.targetSuspendedAt ? `Suspendida desde el ${fmt(r.targetSuspendedAt)}${h?.suspendReason ? `: ${h.suspendReason}` : ""}`
            : r.targetAutoHidden ? "Oculta de la grilla hasta que alguien lo revise"
            : "La cuenta está activa"}
        </li>
        {r.targetAutoSuspendAt && !r.targetSuspendedAt && <li><b>Se suspende sola el {fmt(r.targetAutoSuspendAt)} si nadie lo revisa</b></li>}
        {h && (
          <li>
            {h.reportsMade.total === 0 ? "No reportó a nadie"
              : `Hizo ${plural(h.reportsMade.total, "reporte", "reportes")}${h.reportsMade.dismissed ? `, ${h.reportsMade.dismissed} descartados` : ""}`}
            {h.reportsMade.mutedAt && <b>. Sus reportes no cuentan desde el {fmtDay(h.reportsMade.mutedAt)}</b>}
          </li>
        )}
      </ul>

      {failed && !h ? (
        <div className="desk__state">
          <p className="muted small">No pudimos traer el historial.</p>
          <button type="button" className="btn btn--small" onClick={() => setRetry((n) => n + 1)}>Probar de nuevo</button>
        </div>
      ) : !h ? (
        <p className="muted small">Trayendo el historial…</p>
      ) : timeline.length === 0 ? (
        <p className="muted small">Nada más: no tiene reportes resueltos, medidas ni pedidos de revisión.</p>
      ) : (
        <>
          <ol className="desk__timeline small">
            {shown.map((item) => (
              <li key={item.key} className={`desk__event desk__event--${item.kind}`}>
                <time className="muted" dateTime={item.at}>{fmt(item.at)}</time>
                {item.body}
              </li>
            ))}
          </ol>
          {timeline.length > TIMELINE_START && (
            <button type="button" className="btn btn--small btn--ghost" aria-expanded={all} onClick={() => setAll((v) => !v)}>
              {all ? "Ver menos" : `Ver todo el historial (${timeline.length})`}
            </button>
          )}
          {all && h.more && <p className="muted small">Se ven los últimos 100 reportes y las últimas 100 medidas.</p>}
        </>
      )}

      <details key={r.id} className="rcard__notes">
        <summary className="muted small">Ver reportes recibidos</summary>
        <HistoryList reportId={r.id} direction="received" current={current} />
      </details>
      {showSent && <HistoryList key={r.id} reportId={r.id} direction="sent" current={current} />}

      <div className="rcard__actions">
        <Link className="btn btn--small" to={`/perfil/${id}`} target="_blank" rel="noopener">Abrir el perfil en otra pestaña</Link>
      </div>
    </section>
  );
}

type TimelineItem = { key: string; at: string; kind: "report" | "action" | "appeal"; body: ReactNode };

/** Junta reportes resueltos, medidas y pedidos de revisión en una sola línea, de lo más nuevo a lo más viejo. */
function buildTimeline(h: AccountHistory): TimelineItem[] {
  const byReport = new Map<string, AccountHistory["actions"]>();
  for (const a of h.actions) if (a.reportId) byReport.set(a.reportId, [...(byReport.get(a.reportId) ?? []), a]);
  const by = (actor: string | null) => (actor ? ` · por ${actor}` : "");
  const items: TimelineItem[] = [];
  // Los abiertos son el tema de arriba
  for (const x of h.reports) {
    if (x.status === "open") continue;
    const done = byReport.get(x.id) ?? [];
    items.push({
      key: `r:${x.id}`, at: x.createdAt, kind: "report",
      body: (
        <div>
          <span className="desk__what">
            <span className="pill pill--reason">{x.reason}</span>
            {x.automatic ? "Alerta de la app" : x.messageKind ? "Reporte de un mensaje" : "Reporte"}
          </span>
          {x.details && <q className="muted">{x.details}</q>}
          <span className={x.status === "actioned" ? "rcard__resolution" : "muted"}>
            {x.status === "dismissed" ? "Descartado" : x.resolution ?? "Resuelto"}
            {done.map((a) => a.details && a.action !== "Descartó un reporte" ? ` · ${a.details}` : "").join("")}
            {done[0]?.actor && by(done[0].actor)}
          </span>
        </div>
      ),
    });
  }
  for (const a of h.actions) {
    if (a.reportId) continue;
    items.push({
      key: `a:${a.id}`, at: a.createdAt, kind: "action",
      body: (
        <div>
          <b>{a.action}</b>
          {a.details && <span className="muted">{a.details}</span>}
          {a.actor && <span className="muted">Por {a.actor}</span>}
        </div>
      ),
    });
  }
  for (const ap of h.appeals) {
    items.push({
      key: `p:${ap.id}`, at: ap.createdAt, kind: "appeal",
      body: (
        <div>
          <b>Pidió revisar la suspensión</b>
          {ap.body && <q>{ap.body}</q>}
          {ap.extra && <q>{ap.extra}</q>}
          <span className={ap.status === "lifted" ? "rcard__resolution" : "muted"}>
            {appealStatus[ap.status]}{ap.reviewedAt ? ` el ${fmtDay(ap.reviewedAt)}` : ""}
          </span>
          {ap.response && <span className="muted">Respuesta: {ap.response}</span>}
        </div>
      ),
    });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

/** Un grupo o una cuenta borrada: lo que dice el reporte y los reportes anteriores ya resueltos sobre lo mismo. */
function SubjectHistory({ g, closed }: { g: ReportGroup; closed: Report[] | null }) {
  const r = g.first;
  const before = closed?.filter((x) => x.subject === g.key) ?? [];
  const current = new Set(g.reports.map((report) => report.id));
  return (
    <section className="rcard desk__history" aria-label="Historial">
      <h2 className="small"><b>Historial</b></h2>
      {r.group && (
        <ul className="desk__facts small">
          <li>{r.group.id ? plural(r.group.memberCount, "miembro", "miembros") : "Ya se borró del todo"}</li>
          {r.group.removedAt && <li>Dado de baja el {fmt(r.group.removedAt)}</li>}
          {r.group.autoHidden && !r.group.removedAt && <li>Oculto hasta que alguien lo revise</li>}
        </ul>
      )}
      {r.target && !r.target.id && <p className="muted small">La cuenta se borró: queda lo que guardaron los reportes.</p>}
      {r.group?.id ? (
        <HistoryList key={r.id} reportId={r.id} direction="received" current={current} />
      ) : closed && (
        before.length === 0 ? (
          <p className="muted small">No tiene reportes anteriores ya resueltos.</p>
        ) : (
          <>
            <p className="muted small">{plural(before.length, "reporte anterior ya resuelto", "reportes anteriores ya resueltos")}</p>
            <ul className="desk__before small">
              {before.slice(0, 8).map((x) => (
                <li key={x.id}>
                  <span className="pill pill--reason">{x.reason}</span>
                  <span className="muted">{fmt(x.createdAt)}</span>
                  <span>{x.status === "dismissed" ? "Descartado" : x.resolution ?? "Resuelto"}</span>
                </li>
              ))}
            </ul>
          </>
        )
      )}
    </section>
  );
}

type HistoryEntry = Pick<Report, "id" | "reason" | "details" | "status" | "resolution" | "createdAt"> & {
  targetName: string | null;
};
type HistoryPage = { items: HistoryEntry[]; next: string | null };

function HistoryList({ reportId, direction, current }: {
  reportId: string;
  direction: "received" | "sent";
  current: Set<string>;
}) {
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [request, setRequest] = useState<{ before: string | null; failed: boolean } | null>(null);
  const active = useRef<AbortController | null>(null);
  const load = useCallback(async (before: string | null) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setRequest({ before, failed: false });
    const params = new URLSearchParams({ direction });
    if (before) params.set("before", before);
    try {
      const next = await api<HistoryPage>(`/admin/reports/${encodeURIComponent(reportId)}/history?${params}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setPage((prev) => before && prev ? { items: [...prev.items, ...next.items], next: next.next } : next);
      setRequest(null);
    } catch {
      if (!controller.signal.aborted) setRequest({ before, failed: true });
    }
  }, [direction, reportId]);
  useEffect(() => {
    void load(null);
    return () => active.current?.abort();
  }, [load]);

  return (
    <div className="desk__history-list">
      <h3 className="small">{direction === "received" ? "Reportes recibidos" : "Reportes enviados por esta cuenta"}</h3>
      {page && (page.items.length ? (
        <ul className="desk__before small">
          {page.items.map((entry) => (
            <li key={entry.id}>
              <div className="desk__history-entry">
                <span className="pill pill--reason">{entry.reason}</span>
                <time className="muted" dateTime={entry.createdAt}>{fmt(entry.createdAt)}</time>
                <span>{entry.status === "open" ? "Abierto" : entry.status === "dismissed" ? "Descartado" : entry.resolution ?? "Resuelto"}</span>
                {direction === "received" && current.has(entry.id) && <span className="muted">En este tema</span>}
              </div>
              {entry.targetName && <p><b>{entry.targetName}</b></p>}
              {entry.details && <p className="muted">{entry.details}</p>}
            </li>
          ))}
        </ul>
      ) : <p className="muted small">No hay reportes.</p>)}
      {request?.failed ? (
        <button type="button" className="btn btn--small" onClick={() => void load(request.before)}>No se pudo cargar. Reintentar</button>
      ) : request ? <p className="muted small" role="status">Cargando reportes…</p>
        : page?.next && <button type="button" className="btn btn--small" onClick={() => void load(page.next)}>Mostrar más</button>}
    </div>
  );
}
