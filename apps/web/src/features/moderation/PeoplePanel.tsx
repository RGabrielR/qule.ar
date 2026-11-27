import { SuspensionTiming } from "./SuspensionTiming";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type Author } from "../../api";
import { Avatar } from "../../components/Avatar";
import { StaffDialog } from "../../components/StaffDialog";
import { PERMISSION_LABELS } from "../../staff";

export type Person = Author & {
  joinedAt: string;
  /** Administración general (desde la configuración del servidor). */
  owner: boolean;
  permissions: string[];
  suspendedAt: string | null;
  suspendedUntil: string | null;
  suspendReason: string | null;
  /** Oculta de la app por reportes urgentes de varias personas, mientras nadie los revise. */
  hidden: boolean;
  openReports: number;
};
type Filter = "all" | "staff" | "suspended" | "hidden";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "staff", label: "Equipo" },
  { id: "suspended", label: "Suspendidas" },
  { id: "hidden", label: "Ocultas por reportes" },
];

const day = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });

/**
 * Personas (solo administración general): buscar a cualquiera por nombre, ID o mail, ver su rol y su estado,
 * darle o sacarle permisos, suspenderla o reactivarla.
 */
export function PeoplePanel({ onSuspend }: { onSuspend: (p: Person, done: () => void) => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [result, setResult] = useState<{ people: Person[]; more: boolean } | null>(null);
  const [error, setError] = useState("");
  const [staffing, setStaffing] = useState<Person | null>(null);
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      // Por POST, para que un mail buscado no quede en la URL ni en los registros del servidor
      api<{ people: Person[]; more: boolean }>("/admin/people", { method: "POST", json: { filter, q: q.trim() }, signal: ctrl.signal })
        .then((r) => { setResult(r); setError(""); })
        .catch((e) => { if (!ctrl.signal.aborted) setError((e as Error).message); });
    }, q ? 300 : 0);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, filter, version]);

  async function unsuspend(p: Person) {
    setError("");
    try {
      await api(`/admin/users/${p.id}/unsuspend`, { method: "POST" });
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="stack admin__team">
      <p className="muted small">
        Solo lo ve la administración general. Buscá por nombre, ID de la cuenta, código de una captura o mail exacto. El mail no se muestra.
      </p>
      <label className="field">
        <span>Buscar</span>
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoCapitalize="off" autoCorrect="off" placeholder="Nombre, ID, código o mail" />
      </label>
      <div className="chips" role="group" aria-label="Mostrar">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={`chip${filter === f.id ? " chip--on" : ""}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {result && (result.people.length === 0 ? (
        <p className="muted">No encontramos a nadie.</p>
      ) : (
        <ul className="reports" aria-label="Personas">
          {result.people.map((p) => (
            <li key={p.id} className="rcard">
              <div className="rcard__who">
                <Avatar src={p.photo} name={p.name} size={40} />
                <span>
                  <b>{p.name}</b>
                  <span className="muted small rcard__count">En qule.ar desde {day(p.joinedAt)}</span>
                </span>
              </div>
              {(p.owner || p.permissions.length > 0 || p.suspendedAt || p.hidden || p.openReports > 0) && <div className="rcard__pills">
                {p.owner && <span className="pill pill--role">Administración general</span>}
                {!p.owner && p.permissions.length > 0 && (
                  <span className="pill pill--role">
                    Moderación: {PERMISSION_LABELS.filter((x) => p.permissions.includes(x.id)).map((x) => x.label).join(", ")}
                  </span>
                )}
                {p.suspendedAt && <span className="pill pill--urgent">Suspendida desde {day(p.suspendedAt)}</span>}
                {p.hidden && <span className="pill pill--urgent">Oculta por reportes</span>}
                {p.openReports > 0 && <span className="pill">{p.openReports === 1 ? "1 reporte abierto" : `${p.openReports} reportes abiertos`}</span>}
              </div>}
              {p.suspendedAt && <p className="small"><SuspensionTiming suspendedAt={p.suspendedAt} suspendedUntil={p.suspendedUntil} /></p>}
              {p.suspendReason && p.suspendedAt && <p className="rcard__details">{p.suspendReason}</p>}
              <div className="rcard__actions">
                {!p.suspendedAt && <Link className="btn btn--small" to={`/perfil/${p.id}`}>Ver perfil</Link>}
                {!p.owner && !p.suspendedAt && <button className="btn btn--small" onClick={() => setStaffing(p)}>Permisos</button>}
                {!p.owner && !p.suspendedAt && <button className="btn btn--small btn--danger" onClick={() => onSuspend(p, reload)}>Suspender</button>}
                {p.suspendedAt && <button className="btn btn--small" onClick={() => void unsuspend(p)}>Reactivar cuenta</button>}
              </div>
            </li>
          ))}
        </ul>
      ))}
      {result?.more && <p className="muted small">Hay más resultados: afiná la búsqueda.</p>}
      {staffing && <StaffDialog userId={staffing.id} name={staffing.name} onClose={() => { setStaffing(null); reload(); }} />}
    </div>
  );
}
