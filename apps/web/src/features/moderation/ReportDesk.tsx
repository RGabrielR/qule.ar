import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api, type StaffAccess } from "../../api";
import { Avatar } from "../../components/Avatar";
import { ChevronLeftIcon, ChevronRightIcon } from "../../components/Icons";
import { GroupCard, NoReports, ReportFilterBar, useReportFilters } from "./ReportGroups";
import type { ReportGroup } from "./groupReports";
import type { Report } from "./types";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

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

  // Reportes ya resueltos, para ver si el tema elegido ya tuvo reportes antes
  const [closed, setClosed] = useState<Report[] | null>(null);
  useEffect(() => {
    if (status !== "open") return;
    let alive = true;
    api<Report[]>("/admin/reports?status=closed").then((r) => alive && setClosed(r)).catch(() => alive && setClosed([]));
    return () => { alive = false; };
  }, [status, reports]);

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
            <History g={selected} closed={status === "open" ? closed : null} />
          </>
        ) : (
          <div className="empty"><p className="muted">Elegí un tema de la lista.</p></div>
        )}
      </div>
    </div>
  );
}

/** Lo que ya se sabe del tema: estado de la cuenta o del grupo y reportes anteriores ya resueltos. */
function History({ g, closed }: { g: ReportGroup; closed: Report[] | null }) {
  const r = g.first;
  const before = closed?.filter((x) => x.subject === g.key) ?? [];
  return (
    <section className="rcard desk__history" aria-label="Historial">
      <h2 className="small"><b>Historial</b></h2>
      {r.target && (
        <ul className="desk__facts small">
          <li>{plural(r.targetReportCount, "reporte", "reportes")} en total sobre esta cuenta</li>
          <li>
            {r.targetSuspendedAt ? `Suspendida desde el ${fmt(r.targetSuspendedAt)}`
              : r.targetAutoHidden ? "Oculta de la grilla hasta que alguien lo revise"
              : "La cuenta está activa"}
          </li>
          {r.targetAutoSuspendAt && !r.targetSuspendedAt && <li><b>Se suspende sola el {fmt(r.targetAutoSuspendAt)} si nadie lo revisa</b></li>}
        </ul>
      )}
      {r.group && (
        <ul className="desk__facts small">
          <li>{r.group.id ? plural(r.group.memberCount, "miembro", "miembros") : "Ya se borró del todo"}</li>
          {r.group.removedAt && <li>Dado de baja el {fmt(r.group.removedAt)}</li>}
          {r.group.autoHidden && !r.group.removedAt && <li>Oculto hasta que alguien lo revise</li>}
        </ul>
      )}
      {closed && (
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
      {r.target?.id && (
        <div className="rcard__actions">
          <Link className="btn btn--small" to={`/perfil/${r.target.id}`} target="_blank" rel="noopener">Abrir el perfil en otra pestaña</Link>
        </div>
      )}
    </section>
  );
}
