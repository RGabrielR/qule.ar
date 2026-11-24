import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { api, ApiError, type Author, type StaffAccess } from "../api";
import { useMe } from "../App";
import { Avatar } from "../components/Avatar";
import { BackIcon } from "../components/Icons";
import { DialogFocus } from "../components/DialogFocus";
import { PERMISSION_LABELS } from "../staff";
import { ModerationNotices } from "../features/moderation/ModerationNotices";
import { ReportGroups } from "../features/moderation/ReportGroups";
import type { Report } from "../features/moderation/types";

type Suspended = Author & {
  reason: string | null;
  suspendedAt: string;
  /** Suspensión preventiva (por menor de edad, con el permiso Reportes) que falta revisar. */
  preventive: boolean;
  suspendedByMe: boolean;
};
type RemovedGroup = { id: string; name: string; description: string | null; removedAt: string; reason: string | null; purgeAt: string };
type Stats = { users: number; groups: number; openReports: number; suspended: number; openAppeals: number };
type Tab = "open" | "closed" | "suspended" | "appeals" | "groups" | "team" | "log";

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
  { id: "appeals", label: "Revisiones", need: ["appeals"] },
  { id: "suspended", label: "Suspendidas", need: ["sanctions", "appeals"] },
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
  const [suspended, setSuspended] = useState<Suspended[] | null>(null);
  const [removed, setRemoved] = useState<RemovedGroup[] | null>(null);
  const [suspending, setSuspending] = useState<Report | null>(null);
  const [removing, setRemoving] = useState<Report | null>(null);
  const [error, setError] = useState("");
  // Hasta que termina la primera carga no se muestra el panel; si el servidor dice que no hay permiso, se sale.
  const [loaded, setLoaded] = useState(false);
  const [denied, setDenied] = useState(false);

  // Un 403 al cargar es que esta cuenta ya no puede ver el panel (o nunca pudo): se va a la portada.
  // Un 403 de una acción (por ejemplo, tocar los permisos de la administración general) es solo un error.
  const load = useCallback(async () => {
    try {
      setStats(await api<Stats>("/admin/stats"));
      if (tab === "suspended") setSuspended(await api<Suspended[]>("/admin/suspended"));
      else if (tab === "appeals") setAppeals(await api<AdminAppeal[]>(`/admin/appeals?status=${appealsClosed ? "closed" : "open"}`));
      else if (tab === "team") setTeam(await api<TeamMember[]>("/admin/team"));
      else if (tab === "log") setLog(await api<LogEntry[]>("/admin/log"));
      else if (tab === "groups") setRemoved(await api<RemovedGroup[]>("/admin/groups/removed"));
      else setReports(await api<Report[]>(`/admin/reports?status=${tab}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setDenied(true);
      else setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [tab, appealsClosed]);

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
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {error && <div className="notice notice--error" role="alert">{error}</div>}

      {(tab === "open" || tab === "closed") && reports && (
        <ReportGroups
          key={tab}
          reports={reports}
          status={tab}
          has={has}
          act={act}
          onSuspend={setSuspending}
          onRemoveGroup={setRemoving}
        />
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
                  <span><b>{s.name}</b><span className="muted small rcard__count">desde {fmt(s.suspendedAt)}</span></span>
                </div>
                {s.reason && <p className="rcard__details">{s.reason}</p>}
                {s.preventive && (
                  <p className="small">
                    <b>Preventiva, falta revisarla.</b> La hizo alguien con el permiso Reportes por un caso de menor de edad.
                    {s.suspendedByMe ? " La hiciste vos, así que la revisa otra persona del equipo." : " Mantenela o reactivá la cuenta."}
                  </p>
                )}
                {has("sanctions") && (
                  <div className="rcard__actions">
                    {s.preventive && !s.suspendedByMe && (
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
                      <b>{a.person.name}</b> <span className="muted">{a.person.age || ""}</span>
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

      {tab === "team" && team && <Team team={team} onChange={load} />}

      {tab === "log" && log && (
        log.length === 0 ? (
          <div className="empty"><p className="muted">Todavía no hay nada registrado.</p></div>
        ) : (
          <ul className="modlog">
            {log.map((l) => (
              <li key={l.id}>
                <span className="muted small">{fmt(l.createdAt)}</span><br />
                <b>{l.actor}</b> · {l.action}
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
          report={suspending}
          preventive={!has("sanctions")}
          onClose={() => setSuspending(null)}
          onDone={() => { setSuspending(null); load(); }}
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

function SuspendDialog({ report, preventive, onClose, onDone }: { report: Report; preventive: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(`Reportes por ${report.reason}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api(`/admin/users/${report.target?.id}/suspend`, { method: "POST", json: { reason } });
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
        <h2 id="suspend-title">Suspender a {report.target?.name}</h2>
        <p className="muted small">Se cierran sus sesiones, deja de aparecer en la app y se cierran sus reportes abiertos. Se puede reactivar después.</p>
        {preventive && (
          <p className="small">Es una <b>suspensión preventiva</b>: hacela si hay indicios de que es menor de edad. Después alguien con el permiso Suspensiones la revisa y decide si se mantiene.</p>
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
        <h2 id="appeal-title">{lift ? `Levantar la suspensión de ${appeal.person.name}` : `Mantener la suspensión de ${appeal.person.name}`}</h2>
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
function Team({ team, onChange }: { team: TeamMember[]; onChange: () => void }) {
  const [account, setAccount] = useState("");
  const [perms, setPerms] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(acc: string, list: string[]) {
    setBusy(true);
    setError("");
    try {
      await api("/admin/team", { method: "POST", json: { account: acc, permissions: list } });
      setAccount("");
      setPerms([]);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }
  const toggle = (list: string[], p: string) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]);
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
                <span><b>{m.name}</b><span className="muted small rcard__count">desde {fmt(m.since)}</span></span>
              </div>
              <div className="team__perms">
                {PERMISSION_LABELS.map((p) => (
                  <label key={p.id} className="field--inline small">
                    <input type="checkbox" disabled={busy} checked={m.permissions.includes(p.id)} onChange={() => save(m.id, toggle(m.permissions, p.id))} />
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
      <div className="rcard">
        <h2 className="small"><b>Sumar a alguien</b></h2>
        <label className="field">
          <span>ID de la cuenta o mail</span>
          <input className="input" value={account} onChange={(e) => setAccount(e.target.value)} autoCapitalize="off" autoCorrect="off" />
        </label>
        {PERMISSION_LABELS.map((p) => (
          <label key={p.id} className="field--inline small">
            <input type="checkbox" checked={perms.includes(p.id)} onChange={() => setPerms(toggle(perms, p.id))} />
            <span><b>{p.label}</b> <span className="muted">· {p.hint}</span></span>
          </label>
        ))}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn--primary" disabled={busy || account.trim().length < 3 || perms.length === 0} onClick={() => save(account.trim(), perms)}>
          Dar permisos
        </button>
      </div>
    </div>
  );
}
