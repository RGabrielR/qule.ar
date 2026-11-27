import { UserName } from "../components/UserName";
import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { api, ApiError, type Author, type StaffAccess } from "../api";
import { useMe } from "../App";
import { Avatar } from "../components/Avatar";
import { BackIcon } from "../components/Icons";
import { DialogFocus } from "../components/DialogFocus";
import { PERMISSION_LABELS, toggleStaffPermission } from "../staff";
import { AccountSearch } from "../features/moderation/AccountSearch";
import { PeoplePanel } from "../features/moderation/PeoplePanel";
import { ModerationNotices } from "../features/moderation/ModerationNotices";
import { ReportSpamAlerts, type ReportSpamData } from "../features/moderation/ReportSpamAlerts";
import { ReportGroups } from "../features/moderation/ReportGroups";
import { ExplicitReviews } from "../features/moderation/ExplicitReviews";
import type { Report } from "../features/moderation/types";

type Suspended = Author & {
  reason: string | null;
  suspendedAt: string;
  /** Suspensión preventiva (por menor de edad, con el permiso Reportes) que falta revisar. */
  preventive: boolean;
  /** Suspensión automática (varias personas la reportaron por lo mismo y nadie lo revisó a tiempo) que falta revisar. */
  automatic: boolean;
  suspendedByMe: boolean;
};
type RemovedGroup = { id: string; name: string; description: string | null; removedAt: string; reason: string | null; purgeAt: string };
type Stats = { users: number; groups: number; openReports: number; suspended: number; openAppeals: number };
type Tab = "open" | "closed" | "reporters" | "suspended" | "appeals" | "explicit" | "people" | "groups" | "team" | "log";

type AdminAppeal = {
  id: string;
  person: Author;
  suspendReason: string | null;
  suspendedAt: string;
  suspendedByMe: boolean;
  /** Hay otra persona con el permiso Revisiones: si la suspendiste vos, la revisa ella. */
  othersCanReview: boolean;
  body: string;
  extra: string | null;
  status: "open" | "upheld" | "lifted";
  response: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reports: { reason: string; details: string | null; message: string | null; createdAt: string }[];
};
type TeamMember = Author & { permissions: string[]; since: string };
type LogEntry = { id: string; actor: string; action: string; targetId: string | null; details: string | null; createdAt: string };

/** Pestañas y qué permiso pide cada una (el servidor lo vuelve a chequear). */
const TABS: { id: Tab; label: string; need: StaffAccess[] }[] = [
  { id: "open", label: "Abiertos", need: ["reports", "sanctions"] },
  { id: "closed", label: "Resueltos", need: ["reports", "sanctions"] },
  // Aparte de Abiertos: quien reporta de mala fe es un caso raro y no tiene que tapar los reportes
  { id: "reporters", label: "Quién reporta", need: ["owner", "sanctions"] },
  { id: "appeals", label: "Revisiones", need: ["appeals"] },
  { id: "suspended", label: "Suspendidas", need: ["sanctions", "appeals"] },
  { id: "explicit", label: "Fotos tapadas", need: ["reports"] },
  { id: "people", label: "Personas", need: ["owner"] },
  { id: "groups", label: "Grupos de baja", need: ["owner"] },
  { id: "team", label: "Equipo", need: ["owner"] },
  { id: "log", label: "Registro", need: ["owner"] },
];


const fmt = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Admin() {
  const nav = useNavigate();
  const { me } = useMe();
  const access = me?.user.access ?? [];
  const has = (...need: StaffAccess[]) => need.some((a) => access.includes(a));
  const tabs = TABS.filter((t) => has(...t.need));
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? "open");
  const [appeals, setAppeals] = useState<AdminAppeal[] | null>(null);
  const [appealsClosed, setAppealsClosed] = useState(false);
  const [resolving, setResolving] = useState<{ appeal: AdminAppeal; decision: "uphold" | "lift" } | null>(null);
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [log, setLog] = useState<LogEntry[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [reports, setReports] = useState<Report[] | null>(null);
  /** Quién reporta: se carga siempre, para mostrar en la pestaña cuántas cuentas hay para mirar. */
  const [reporters, setReporters] = useState<ReportSpamData | null>(null);
  const seesReporters = has("owner", "sanctions");
  const [suspended, setSuspended] = useState<Suspended[] | null>(null);
  const [removed, setRemoved] = useState<RemovedGroup[] | null>(null);
  const [suspending, setSuspending] = useState<SuspendTarget | null>(null);
  const [searchVersion, setSearchVersion] = useState(0);
  const [removing, setRemoving] = useState<Report | null>(null);
  const [error, setError] = useState("");
  // Hasta que termina la primera carga no se muestra el panel; si el servidor dice que no hay permiso, se sale.
  const [loaded, setLoaded] = useState(false);
  const [denied, setDenied] = useState(false);

  // Un 403 al cargar es que esta cuenta ya no puede ver el panel (o nunca pudo): se va a la portada.
  // Un 403 de una acción (por ejemplo, tocar los permisos de la administración general) es solo un error.
  const load = useCallback(async () => {
    try {
      const [nextStats, nextReporters] = await Promise.all([
        api<Stats>("/admin/stats"),
        seesReporters ? api<ReportSpamData>("/admin/report-spam").catch(() => null) : null,
      ]);
      setStats(nextStats);
      setReporters(nextReporters);
      if (tab === "suspended") setSuspended(await api<Suspended[]>("/admin/suspended"));
      else if (tab === "appeals") setAppeals(await api<AdminAppeal[]>(`/admin/appeals?status=${appealsClosed ? "closed" : "open"}`));
      else if (tab === "team") setTeam(await api<TeamMember[]>("/admin/team"));
      else if (tab === "log") setLog(await api<LogEntry[]>("/admin/log"));
      else if (tab === "people") { /* La pestaña Personas carga sus propios datos */ }
      else if (tab === "explicit") { /* Fotos tapadas también */ }
      else if (tab === "groups") setRemoved(await api<RemovedGroup[]>("/admin/groups/removed"));
      else if (tab === "reporters") { /* Ya se cargó arriba */ }
      else setReports(await api<Report[]>(`/admin/reports?status=${tab}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setDenied(true);
      else setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [tab, appealsClosed, seesReporters]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (denied) return <Navigate to="/" replace />;

  const topbar = (
    <header className="topbar topbar--thread">
      <button className="iconbtn" onClick={() => nav("/yo")} aria-label="Volver"><BackIcon /></button>
      <h1 className="topbar__title topbar__title--sm">Moderación</h1>
    </header>
  );

  if (!loaded || !stats) {
    return (
      <div className="page">
        {topbar}
        {!loaded ? (
          <div className="empty"><p className="muted" role="status">Cargando…</p></div>
        ) : (
          <div className="empty">
            <p className="notice notice--error" role="alert">No pudimos cargar el panel.</p>
            <button type="button" className="btn" onClick={() => { setError(""); load(); }}>Reintentar</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page">
      {topbar}

      <dl className="kpis">
        <div><dt>Perfiles</dt><dd>{stats.users}</dd></div>
        <div><dt>Grupos</dt><dd>{stats.groups}</dd></div>
        <div className={stats.openReports ? "kpi--alert" : ""}><dt>Reportes abiertos</dt><dd>{stats.openReports}</dd></div>
        <div><dt>Suspendidas</dt><dd>{stats.suspended}</dd></div>
        {has("appeals") && <div className={stats.openAppeals ? "kpi--alert" : ""}><dt>Revisiones pedidas</dt><dd>{stats.openAppeals}</dd></div>}
      </dl>

      <ModerationNotices owner={has("owner")} />

      <div className="tabs tabs--scroll" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "reporters" && reporters?.alerts.length ? (
              <b className="badge tabs__badge" aria-label={`${reporters.alerts.length} para mirar`}>{reporters.alerts.length}</b>
            ) : null}
          </button>
        ))}
      </div>

      {error && <div className="notice notice--error" role="alert">{error}</div>}

      {tab === "reporters" && reporters && (
        <ReportSpamAlerts data={reporters} act={act} onSuspend={(t) => setSuspending({ ...t, preventive: false })} />
      )}

      {(tab === "open" || tab === "closed") && reports && (
        <ReportGroups
          key={tab}
          reports={reports}
          status={tab}
          has={has}
          act={act}
          onSuspend={(r) => r.target?.id && setSuspending({
            url: `/admin/users/${r.target.id}/suspend`, name: r.target.name, reason: `Reportes por ${r.reason}`, preventive: !has("sanctions"),
          })}
          onRefresh={load}
          onRemoveGroup={setRemoving}
        />
      )}

      {tab === "suspended" && has("sanctions") && (
        <section className="rcard" aria-label="Buscar cuenta por ID">
          <h2 className="small">Buscar cuenta por ID</h2>
          <p className="muted small">El código de una captura sirve para buscar la cuenta. Revisá el contexto antes de suspender.</p>
          <AccountSearch key={searchVersion} onSelect={(a) => setSuspending({
            url: `/admin/users/${encodeURIComponent(a.id)}/suspend`, name: a.name, reason: "", preventive: false, done: () => setSearchVersion((v) => v + 1),
          })} />
        </section>
      )}

      {tab === "suspended" && suspended && (
        suspended.length === 0 ? (
          <div className="empty"><p className="muted">No hay cuentas suspendidas.</p></div>
        ) : (
          <ul className="reports">
            {suspended.map((s) => (
              <li key={s.id} className="rcard">
                <div className="rcard__who">
                  <Avatar src={s.photo} name={s.name} size={40} />
                  <span><b><UserName name={s.name} /></b><span className="muted small rcard__count">desde {fmt(s.suspendedAt)}</span></span>
                </div>
                {s.reason && <p className="rcard__details">{s.reason}</p>}
                {s.preventive && (
                  <p className="small">
                    <b>Preventiva, falta revisarla.</b> La hizo alguien con el permiso Reportes por un caso de menor de edad.
                    {s.suspendedByMe ? " La hiciste vos, así que la revisa otra persona del equipo." : " Mantenela o reactivá la cuenta."}
                  </p>
                )}
                {s.automatic && (
                  <p className="small">
                    <b>Automática, falta revisarla.</b> Varias personas la reportaron por lo mismo y nadie lo revisó a tiempo. Mantenela o reactivá la cuenta.
                  </p>
                )}
                {has("sanctions") && (
                  <div className="rcard__actions">
                    {(s.preventive || s.automatic) && !s.suspendedByMe && (
                      <button className="btn btn--small btn--danger" onClick={() => act(() => api(`/admin/users/${s.id}/confirm-suspension`, { method: "POST" }))}>Mantener</button>
                    )}
                    <button className="btn btn--small" onClick={() => act(() => api(`/admin/users/${s.id}/unsuspend`, { method: "POST" }))}>Reactivar cuenta</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )
      )}

      {tab === "groups" && removed && (
        removed.length === 0 ? (
          <div className="empty"><p className="muted">No hay grupos dados de baja.</p></div>
        ) : (
          <ul className="reports">
            {removed.map((g) => (
              <li key={g.id} className="rcard">
                <div className="rcard__who rcard__group">
                  <span>
                    <b>{g.name}</b>
                    <span className="muted small rcard__count">De baja desde {fmt(g.removedAt)} · se borra del todo el {fmt(g.purgeAt)}</span>
                    {g.description && <span className="small rcard__groupdesc">{g.description}</span>}
                  </span>
                </div>
                {g.reason && <p className="rcard__details">{g.reason}</p>}
                <div className="rcard__actions">
                  <button className="btn btn--small" onClick={() => act(() => api(`/admin/groups/${g.id}/restore`, { method: "POST" }))}>Volver a activarlo</button>
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === "appeals" && (
        <>
          <div className="rcard__actions admin__subtabs">
            <button className={`btn btn--small${appealsClosed ? "" : " btn--primary"}`} onClick={() => setAppealsClosed(false)}>Pendientes</button>
            <button className={`btn btn--small${appealsClosed ? " btn--primary" : ""}`} onClick={() => setAppealsClosed(true)}>Respondidas</button>
          </div>
          {appeals && (appeals.length === 0 ? (
            <div className="empty"><p className="muted">{appealsClosed ? "Todavía no se respondió ningún pedido." : "No hay pedidos de revisión pendientes."}</p></div>
          ) : (
            <ul className="reports">
              {appeals.map((a) => (
                <li key={a.id} className="rcard">
                  <div className="rcard__head">
                    <span className="rcard__pills"><span className="pill pill--reason">Revisión</span></span>
                    <time className="muted small">{fmt(a.createdAt)}</time>
                  </div>
                  <div className="rcard__who">
                    <Avatar src={a.person.photo} name={a.person.name} size={40} />
                    <span>
                      <b><UserName name={a.person.name} /></b> <span className="muted">{a.person.age || ""}</span>
                      <span className="muted small rcard__count">Suspendida desde {fmt(a.suspendedAt)}</span>
                    </span>
                  </div>
                  {a.suspendReason && <p className="small"><b>Motivo de la suspensión:</b> {a.suspendReason}</p>}
                  {a.reports.length > 0 && (
                    <details>
                      <summary className="muted small">{a.reports.length === 1 ? "1 reporte" : `${a.reports.length} reportes`} que terminaron en una medida</summary>
                      {a.reports.map((r, i) => (
                        <p key={i} className="small appeal__text">
                          <b>{r.reason}</b> · {fmt(r.createdAt)}{r.details && ` · “${r.details}”`}{r.message && <><br />Mensaje: {r.message}</>}
                        </p>
                      ))}
                    </details>
                  )}
                  <blockquote className="rcard__msg">
                    <span className="muted small">Lo que escribió</span>
                    <p>{a.body}</p>
                    {a.extra && <><span className="muted small">Lo que sumó después</span><p>{a.extra}</p></>}
                  </blockquote>
                  {a.status === "open" ? (
                    <>
                      {a.suspendedByMe && a.othersCanReview ? (
                        <p className="small appeal__warn">Esta suspensión la hiciste vos, así que la revisa otra persona del equipo.</p>
                      ) : (
                        <>
                          {a.suspendedByMe && (
                            <p className="small appeal__warn">Esta suspensión la hiciste vos y no hay nadie más con el permiso Revisiones. Si la resolvés, queda registrado.</p>
                          )}
                          <div className="rcard__actions">
                            <button className="btn btn--small" onClick={() => setResolving({ appeal: a, decision: "uphold" })}>Mantener la suspensión</button>
                            <button className="btn btn--small btn--primary" onClick={() => setResolving({ appeal: a, decision: "lift" })}>Levantar la suspensión</button>
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <p className="small rcard__resolution">
                      {a.status === "lifted" ? "Se levantó la suspensión" : "Se mantuvo la suspensión"}{a.reviewedAt && ` · ${fmt(a.reviewedAt)}`}
                      {a.response && <><br />{a.response}</>}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ))}
        </>
      )}

      {tab === "explicit" && <ExplicitReviews />}

      {tab === "people" && (
        <PeoplePanel onSuspend={(p, done) => setSuspending({ url: `/admin/users/${p.id}/suspend`, name: p.name, reason: "", preventive: false, done })} />
      )}

      {tab === "team" && team && <Team team={team} onChange={load} onPeople={() => setTab("people")} />}

      {tab === "log" && log && (
        log.length === 0 ? (
          <div className="empty"><p className="muted">Todavía no hay nada registrado.</p></div>
        ) : (
          <ul className="modlog">
            {log.map((l) => (
              <li key={l.id}>
                <span className="muted small">{fmt(l.createdAt)}</span><br />
                <b><UserName name={l.actor} /></b> · {l.action}
                {l.details && <span className="muted"> · {l.details}</span>}
              </li>
            ))}
          </ul>
        )
      )}

      {resolving && (
        <ResolveAppealDialog
          appeal={resolving.appeal}
          decision={resolving.decision}
          onClose={() => setResolving(null)}
          onDone={() => { setResolving(null); load(); }}
        />
      )}
      {suspending && (
        <SuspendDialog
          target={suspending}
          onClose={() => setSuspending(null)}
          onDone={() => { suspending.done?.(); setSuspending(null); load(); }}
        />
      )}
      {removing && (
        <RemoveGroupDialog
          report={removing}
          onClose={() => setRemoving(null)}
          onDone={() => { setRemoving(null); load(); }}
        />
      )}
    </div>
  );
}

/**
 * A quién se suspende: la persona reportada, o quien satura el canal de reportes (ver ReportSpamAlerts). `url` es la
 * ruta que suspende: en la alerta va con su identificador, porque el equipo no ve de qué cuenta es.
 */
type SuspendTarget = { url: string; name: string; reason: string; preventive: boolean; done?: () => void };

function SuspendDialog({ target, onClose, onDone }: { target: SuspendTarget; onClose: () => void; onDone: () => void }) {
  const { preventive } = target;
  const [reason, setReason] = useState(target.reason);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api(target.url, { method: "POST", json: { reason } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal aria-labelledby="suspend-title" onClick={(e) => e.stopPropagation()}>
        <DialogFocus onClose={onClose} />
        <h2 id="suspend-title">Suspender a <UserName name={target.name} /></h2>
        <p className="muted small">Se cierran sus sesiones, deja de aparecer en la app y se cierran sus reportes abiertos. También se borran sus mensajes en grupos y todo lo que subió: fotos, álbumes, videos y fotos que mandó por privado. Lo que sea prueba de un reporte queda guardado. La cuenta se puede reactivar después, pero lo borrado no vuelve.</p>
        {preventive && (
          <p className="small">Es una <b>suspensión preventiva</b>: hacela si hay indicios de que es menor de edad. Después alguien con el permiso Suspensiones la revisa y decide si se mantiene.</p>
        )}
        {!preventive && (
          <button type="button" className="btn btn--small" disabled={busy} onClick={() => setReason("Filtración de fotos de álbum")}>
            Usar motivo «Filtración de fotos de álbum»
          </button>
        )}
        <label className="field">
          <span>Motivo (la persona lo va a ver)</span>
          <textarea className="input" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn--danger" disabled={busy || reason.trim().length < 3} onClick={submit}>{busy ? "Suspendiendo…" : "Suspender"}</button>
        </div>
      </div>
    </div>
  );
}

function RemoveGroupDialog({ report, onClose, onDone }: { report: Report; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(`Reportes por ${report.reason}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api(`/admin/groups/${report.group?.id}/remove`, { method: "POST", json: { reason } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal aria-labelledby="remove-title" onClick={(e) => e.stopPropagation()}>
        <DialogFocus onClose={onClose} />
        <h2 id="remove-title">Dar de baja «{report.group?.name}»</h2>
        <p className="muted small">
          El grupo desaparece para todo el mundo y nadie de la app lo puede ver. Queda guardado 90 días como prueba y después se borra del todo. Se
          cierran sus reportes abiertos. Si fue un error, se puede volver a activar desde «Grupos de baja».
        </p>
        <label className="field">
          <span>Motivo (queda registrado)</span>
          <textarea className="input" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn--danger" disabled={busy || reason.trim().length < 3} onClick={submit}>{busy ? "Dando de baja…" : "Dar de baja"}</button>
        </div>
      </div>
    </div>
  );
}

function ResolveAppealDialog({ appeal, decision, onClose, onDone }: {
  appeal: AdminAppeal; decision: "uphold" | "lift"; onClose: () => void; onDone: () => void;
}) {
  const lift = decision === "lift";
  const [response, setResponse] = useState(lift ? "Revisamos tu caso y levantamos la suspensión. Perdón por las molestias." : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api(`/admin/appeals/${appeal.id}/resolve`, { method: "POST", json: { decision, response } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal aria-labelledby="appeal-title" onClick={(e) => e.stopPropagation()}>
        <DialogFocus onClose={onClose} />
        <h2 id="appeal-title">{lift ? "Levantar" : "Mantener"} la suspensión de <UserName name={appeal.person.name} /></h2>
        <p className="muted small">
          {lift
            ? "La cuenta vuelve a funcionar enseguida y le avisamos por mail."
            : "La cuenta sigue suspendida. Le avisamos por mail que hay una respuesta y la lee en la app."}{" "}
          Queda registrado quién la resolvió.
        </p>
        <label className="field">
          <span>{lift ? "Respuesta (queda registrada)" : "Respuesta (la persona la va a leer)"}</span>
          <textarea className="input" rows={4} maxLength={1000} value={response} onChange={(e) => setResponse(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className={`btn ${lift ? "btn--primary" : "btn--danger"}`} disabled={busy || response.trim().length < 10} onClick={submit}>
            {busy ? "Guardando…" : lift ? "Levantar" : "Mantener"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Equipo de moderación: dar, cambiar y sacar permisos chicos. Solo la administración general. */
function Team({ team, onChange, onPeople }: { team: TeamMember[]; onChange: () => void; onPeople: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(acc: string, list: string[]) {
    setBusy(true);
    setError("");
    try {
      await api("/admin/team", { method: "POST", json: { account: acc, permissions: list } });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }
  return (
    <div className="stack admin__team">
      <p className="muted small">
        Vos tenés todos los permisos. Acá le das a otras personas solo lo que necesitan. Nadie del equipo ve mails ni datos de salud, ni puede dar de
        baja grupos o cambiar permisos. También podés darlos desde el perfil de cada persona.
      </p>
      {team.length === 0 ? (
        <p className="muted">Todavía no sumaste a nadie.</p>
      ) : (
        <ul className="reports">
          {team.map((m) => (
            <li key={m.id} className="rcard">
              <div className="rcard__who">
                <Avatar src={m.photo} name={m.name} size={40} />
                <span><b><UserName name={m.name} /></b><span className="muted small rcard__count">desde {fmt(m.since)}</span></span>
              </div>
              <div className="team__perms">
                {PERMISSION_LABELS.map((p) => (
                  <label key={p.id} className="field--inline small">
                    <input type="checkbox" disabled={busy || (p.id === "photoVerification" && !m.permissions.includes("reports"))} checked={m.permissions.includes(p.id)} onChange={() => save(m.id, toggleStaffPermission(m.permissions, p.id))} />
                    {p.label}
                  </label>
                ))}
              </div>
              <div className="rcard__actions">
                <button className="btn btn--small btn--danger" disabled={busy} onClick={() => save(m.id, [])}>Sacar todos los permisos</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="rcard">
        <h2 className="small"><b>Sumar a alguien</b></h2>
        <p className="muted small">Buscala en Personas por nombre, ID o mail y tocá Permisos.</p>
        <div className="rcard__actions">
          <button className="btn btn--small btn--primary" onClick={onPeople}>Ir a Personas</button>
        </div>
      </div>
    </div>
  );
}
