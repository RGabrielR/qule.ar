import { useMemo, useState } from "react";
import { Link } from "react-router";
import { api, type StaffAccess } from "../../api";
import { Avatar } from "../../components/Avatar";
import {
  filterGroups, groupReports, NO_FILTERS, type ReportedMessage, type ReportFilters, type ReportGroup, type ReportSort, type ReportType,
} from "./groupReports";
import type { Report } from "./types";

const PAGE = 30;
const MESSAGES_SHOWN = 3;

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const TYPES: { id: ReportType; label: string }[] = [
  { id: "todo", label: "Todo" },
  { id: "perfil", label: "Perfiles" },
  { id: "mensaje", label: "Mensajes" },
  { id: "grupo", label: "Grupos" },
];

const SORTS: { id: ReportSort; label: string }[] = [
  { id: "recientes", label: "Más recientes" },
  { id: "reportados", label: "Más reportados" },
  { id: "antiguos", label: "Esperando hace más" },
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Reportes agrupados por tema: si varias personas reportan a la misma persona o al mismo grupo, se ve una sola
 * tarjeta con todos los motivos, los mensajes reportados y las acciones. Se puede buscar, filtrar y ordenar.
 */
export function ReportGroups({ reports, status, has, act, onSuspend, onRemoveGroup }: {
  reports: Report[];
  status: "open" | "closed";
  has: (...need: StaffAccess[]) => boolean;
  act: (fn: () => Promise<unknown>) => void;
  onSuspend: (r: Report) => void;
  onRemoveGroup: (r: Report) => void;
}) {
  const [filters, setFilters] = useState<ReportFilters>(NO_FILTERS);
  const [shown, setShown] = useState(PAGE);
  const groups = useMemo(() => groupReports(reports), [reports]);
  const visible = useMemo(() => filterGroups(groups, filters), [groups, filters]);
  const reasons = useMemo(() => [...new Set(reports.map((r) => r.reason))].sort(), [reports]);
  const urgentCount = groups.filter((g) => g.urgent).length;
  const set = (patch: Partial<ReportFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setShown(PAGE);
  };
  const filtered = filters.q !== "" || filters.reason !== "" || filters.type !== "todo" || filters.urgentOnly;

  if (!reports.length) {
    return (
      <div className="empty">
        <p className="muted">{status === "open" ? "No hay reportes pendientes." : "Todavía no se resolvió ningún reporte."}</p>
      </div>
    );
  }

  return (
    <div className="modreports">
      {status === "open" && urgentCount > 0 && !filters.urgentOnly && (
        <button type="button" className="modreports__urgent" onClick={() => set({ urgentOnly: true })}>
          {urgentCount === 1 ? "Hay 1 tema urgente." : `Hay ${urgentCount} temas urgentes.`} <u>Ver solo esos</u>
        </button>
      )}

      <div className="modfilters" role="search">
        <input
          className="input"
          type="search"
          placeholder="Buscar por nombre, mensaje o comentario"
          aria-label="Buscar en los reportes"
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
        />
        <div className="modfilters__row">
          <select className="input" aria-label="Motivo" value={filters.reason} onChange={(e) => set({ reason: e.target.value })}>
            <option value="">Todos los motivos</option>
            {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className="input" aria-label="Orden" value={filters.sort} onChange={(e) => set({ sort: e.target.value as ReportSort })}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div className="chips" role="group" aria-label="Qué se reportó">
          {TYPES.map((t) => (
            <button key={t.id} type="button" className={`chip${filters.type === t.id ? " chip--on" : ""}`} aria-pressed={filters.type === t.id} onClick={() => set({ type: t.id })}>
              {t.label}
            </button>
          ))}
          <button type="button" className={`chip${filters.urgentOnly ? " chip--on" : ""}`} aria-pressed={filters.urgentOnly} onClick={() => set({ urgentOnly: !filters.urgentOnly })}>
            Solo urgentes
          </button>
        </div>
        <p className="muted small" role="status">
          {plural(visible.length, "tema", "temas")} · {plural(visible.reduce((n, g) => n + g.reports.length, 0), "reporte", "reportes")}
          {filtered && <> · <button type="button" className="linkbtn" onClick={() => set(NO_FILTERS)}>Sacar filtros</button></>}
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="empty"><p className="muted">Ningún reporte coincide con los filtros.</p></div>
      ) : (
        <ul className="reports">
          {visible.slice(0, shown).map((g) => (
            <GroupCard key={g.key} g={g} has={has} act={act} onSuspend={onSuspend} onRemoveGroup={onRemoveGroup} />
          ))}
        </ul>
      )}
      {visible.length > shown && (
        <div className="modreports__more">
          <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE)}>Ver más ({visible.length - shown})</button>
        </div>
      )}
    </div>
  );
}

function GroupCard({ g, has, act, onSuspend, onRemoveGroup }: {
  g: ReportGroup;
  has: (...need: StaffAccess[]) => boolean;
  act: (fn: () => Promise<unknown>) => void;
  onSuspend: (r: Report) => void;
  onRemoveGroup: (r: Report) => void;
}) {
  const r = g.first;
  const open = g.reports.filter((x) => x.status === "open");
  const isOpen = open.length > 0;
  // Los motivos de un perfil o un grupo (no de un mensaje) y los comentarios de quienes reportaron
  const notes = g.reports.filter((x) => x.details || !x.messageId);
  const resolutions = [...new Set(g.reports.filter((x) => x.status !== "open").map((x) => (x.status === "dismissed" ? "Descartado" : x.resolution ?? "Resuelto")))];
  const dismissAll = () => act(() => api("/admin/reports/dismiss", { method: "POST", json: { ids: open.map((x) => x.id) } }));

  return (
    <li className={`rcard${g.urgent && isOpen ? " rcard--urgent" : ""}`}>
      <div className="rcard__head">
        <span className="rcard__pills">
          {g.urgent && isOpen && <span className="pill pill--urgent">Urgente</span>}
          {r.group && <span className="pill">Grupo</span>}
          {g.reasons.map(([reason, n]) => (
            <span key={reason} className="pill pill--reason">{reason}{n > 1 && ` · ${n}`}</span>
          ))}
        </span>
        <time className="muted small" dateTime={g.latest}>{fmt(g.latest)}</time>
      </div>

      {r.group ? (
        <div className="rcard__who rcard__group">
          <span>
            <b>{r.group.name}</b>
            <span className="muted small rcard__count">
              {r.group.id ? plural(r.group.memberCount, "miembro", "miembros") : "ya borrado del todo"}
              {r.group.removedAt && " · dado de baja"}
              {r.group.autoHidden && !r.group.removedAt && " · oculto hasta revisar"}
            </span>
            {r.group.description && <span className="small rcard__groupdesc">{r.group.description}</span>}
          </span>
        </div>
      ) : r.target && (
        <Link to={r.target.id ? `/perfil/${r.target.id}` : "#"} className="rcard__who">
          <Avatar src={r.target.photo} name={r.target.name} size={40} />
          <span>
            <b>{r.target.name}</b> <span className="muted">{r.target.age || ""}</span>
            <span className="muted small rcard__count">
              {plural(r.targetReportCount, "reporte", "reportes")} en total
              {r.targetSuspendedAt && " · suspendida"}
              {r.targetAutoHidden && !r.targetSuspendedAt && " · oculta de la grilla hasta revisar"}
            </span>
          </span>
        </Link>
      )}

      <p className="small rcard__summary">
        <b>{plural(g.reports.length, "reporte", "reportes")}</b>
        {g.automatic ? " automáticos de la app" : ` de ${plural(g.reporters, "persona", "personas")}`}
        {g.reports.length > 1 && ` · el primero el ${fmt(g.oldest)}`}
        {g.reports.length === 1 && !r.automatic && !r.reporterHidden && ` · ${r.reporter?.name ?? "una cuenta borrada"}`}
      </p>

      {g.messages.slice(0, MESSAGES_SHOWN).map((m) => <MessageBlock key={m.key} m={m} has={has} act={act} />)}
      {g.messages.length > MESSAGES_SHOWN && (
        <details className="rcard__notes">
          <summary className="muted small">Ver {plural(g.messages.length - MESSAGES_SHOWN, "mensaje reportado más", "mensajes reportados más")}</summary>
          {g.messages.slice(MESSAGES_SHOWN).map((m) => <MessageBlock key={m.key} m={m} has={has} act={act} />)}
        </details>
      )}

      {g.reports.length === 1 ? (
        notes[0]?.details && <Note r={notes[0]} />
      ) : notes.length > 0 && (
        <details className="rcard__notes">
          <summary className="muted small">Ver {notes.length === 1 ? "el comentario" : `los ${notes.length} motivos y comentarios`}</summary>
          <ul>{notes.map((x) => <li key={x.id}><Note r={x} withMeta /></li>)}</ul>
        </details>
      )}

      {g.evidenceFiles > 0 && (
        <p className="muted small">
          {g.evidenceFiles === 1 ? "1 archivo guardado" : `${g.evidenceFiles} archivos guardados`} como prueba. No lo descargues: si hay que
          denunciar, lo pide la fiscalía (ver el protocolo).
        </p>
      )}
      {g.automatic && <p className="muted small">Alerta automática de la app: revisalo y decidí.</p>}

      {isOpen ? (
        <div className="rcard__actions">
          {has("reports") && (
            <button className="btn btn--small" onClick={dismissAll}>{open.length > 1 ? `Descartar los ${open.length}` : "Descartar"}</button>
          )}
          {has("owner") && r.group?.id && !r.group.removedAt && (
            <button className="btn btn--small btn--danger" onClick={() => onRemoveGroup(open[0])}>Dar de baja el grupo</button>
          )}
          {(has("sanctions") || (has("reports") && open.some((x) => x.reason === "menor de edad"))) && !r.group && r.target?.id && !r.targetSuspendedAt && (
            <button className="btn btn--small btn--danger" onClick={() => onSuspend(open.find((x) => x.reason === "menor de edad") ?? open[0])}>Suspender</button>
          )}
        </div>
      ) : (
        <p className="small rcard__resolution">{resolutions.join(" · ")}</p>
      )}
    </li>
  );
}

/** Un mensaje reportado (o el mismo texto en varios mensajes), con el botón para borrarlo. */
function MessageBlock({ m, has, act }: { m: ReportedMessage; has: (...need: StaffAccess[]) => boolean; act: (fn: () => Promise<unknown>) => void }) {
  // Un reporte abierto de cada mensaje: borrar el mensaje cierra todos sus reportes
  const toDelete = m.ids.flatMap((id) => {
    const r = m.reports.find((x) => x.messageId === id && x.status === "open");
    return r ? [r.id] : [];
  });
  const remove = () => act(async () => {
    for (const id of toDelete) await api(`/admin/reports/${id}/delete-message`, { method: "POST" });
  });
  return (
    <blockquote className="rcard__msg">
      <span className="muted small">
        {m.kind === "group" ? "Mensaje en un grupo" : "Mensaje privado"}
        {m.message.deleted && " (ya borrado)"}
        {m.ids.length > 1 ? ` · lo mandó en ${m.ids.length} ${m.kind === "group" ? "mensajes" : "charlas"}` : ""}
        {m.reports.length > 1 && ` · ${plural(m.reports.length, "reporte", "reportes")}`}
      </span>
      {m.message.body && <p>{m.message.body}</p>}
      {m.message.photo && <p className="muted">[foto]</p>}
      {m.message.deleted && m.message.body && <span className="muted small">Copia guardada al reportarlo</span>}
      {has("reports") && !m.message.deleted && toDelete.length > 0 && (
        <div className="rcard__actions">
          <button className="btn btn--small" onClick={remove}>{toDelete.length > 1 ? `Borrar los ${toDelete.length} mensajes` : "Borrar este mensaje"}</button>
        </div>
      )}
    </blockquote>
  );
}

/** Un motivo con su comentario. Con withMeta, también cuándo y (solo para la administración general) quién. */
function Note({ r, withMeta }: { r: Report; withMeta?: boolean }) {
  const who = r.automatic ? "la app" : r.reporterHidden ? null : r.reporter?.name ?? "una cuenta borrada";
  return (
    <p className="small rcard__note">
      {withMeta && <><b>{r.reason}</b> · <span className="muted">{fmt(r.createdAt)}{who && ` · ${who}`}</span>{r.details && <br />}</>}
      {r.details ? <span className="rcard__details">“{r.details}”</span> : !withMeta && <span className="muted">Sin comentario</span>}
    </p>
  );
}
