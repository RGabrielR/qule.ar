import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, getSocket, ROLE_LABEL, type GroupListing, type MyGroup, type MyInvite } from "../api";
import { PlusIcon } from "../components/Icons";
import { MyInvites } from "../components/Invite";
import { JoinButton } from "../components/JoinButton";
import { ReportDialog } from "../components/ReportDialog";

export function Groups() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("ver") === "todos" ? "all" : "mine";
  const [mine, setMine] = useState<MyGroup[] | null>(null);
  const [all, setAll] = useState<GroupListing[] | null>(null);
  // Grupo que se está reportando desde la lista (se puede reportar sin ser parte)
  const [reporting, setReporting] = useState<GroupListing | null>(null);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);

  const [invites, setInvites] = useState<MyInvite[]>([]);
  const loadMine = useCallback(() => {
    api<MyGroup[]>("/groups").then(setMine).catch(() => {});
    api<MyInvite[]>("/invites").then(setInvites).catch(() => {});
  }, []);
  const loadAll = useCallback(
    (query = q) => api<GroupListing[]>(`/groups/all?q=${encodeURIComponent(query)}`).then(setAll).catch(() => {}),
    [q],
  );

  useEffect(() => {
    loadMine();
    const s = getSocket();
    const refresh = () => {
      loadMine();
      if (tab === "all") loadAll();
    };
    for (const ev of ["group:request", "group:accepted", "group:rejected", "group:removed", "group:gone", "group:role", "group:invite"]) s.on(ev, refresh);
    return () => {
      for (const ev of ["group:request", "group:accepted", "group:rejected", "group:removed", "group:gone", "group:role", "group:invite"]) s.off(ev, refresh);
    };
  }, [loadMine, loadAll, tab]);

  useEffect(() => {
    if (tab !== "all") return;
    const t = setTimeout(() => loadAll(q), 250);
    return () => clearTimeout(t);
  }, [tab, q, loadAll]);

  return (
    <div className="page">
      <header className="topbar">
        <h1 className="topbar__title">Grupos</h1>
        <button className="btn btn--small btn--primary" onClick={() => setCreating(true)}><PlusIcon /> Crear</button>
      </header>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "mine"} onClick={() => setParams({})}>Mis grupos</button>
        <button role="tab" aria-selected={tab === "all"} onClick={() => setParams({ ver: "todos" })}>Todos los grupos</button>
      </div>

      {tab === "mine" ? (
        <>
        <MyInvites invites={invites} onChange={loadMine} />
        <ul className="glist">
          {mine?.map((g) => (
            <li key={g.id}>
              <Link to={`/grupos/${g.id}`} className="gcard">
                <span className={`gcard__icon ${g.isGeneral ? "gcard__icon--general" : ""}`} aria-hidden>{g.isGeneral ? "#" : g.name.charAt(0).toUpperCase()}</span>
                <div className="gcard__text">
                  <div className="gcard__top">
                    <b>{g.name}</b>
                    {g.role !== "member" && <span className="pill">{ROLE_LABEL[g.role]}</span>}
                  </div>
                  <p className="gcard__desc">{g.description}</p>
                  <p className="gcard__meta">{g.memberCount} {g.memberCount === 1 ? "miembro" : "miembros"}</p>
                </div>
                {g.pendingCount > 0 && <span className="badge badge--inline" title="Solicitudes pendientes">{g.pendingCount}</span>}
              </Link>
            </li>
          ))}
          {mine && mine.length <= 1 && (
            <li className="empty empty--inline">
              <p className="muted">Todavía estás solo en el general. Mirá <button className="linkbtn" onClick={() => setParams({ ver: "todos" })}>todos los grupos</button> o creá uno.</p>
            </li>
          )}
        </ul>
        </>
      ) : (
        <>
          <div className="searchbar">
            <input className="input" type="search" placeholder="Buscar grupos…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar grupos" />
          </div>
          {all && all.length === 0 ? (
            <div className="empty">
              <p className="empty__title">{q ? "No encontramos grupos con eso" : "Todavía no hay grupos"}</p>
              <p className="muted">¿Por qué no creás el primero?</p>
            </div>
          ) : (
            <ul className="glist">
              {all?.map((g) => (
                <li key={g.id} className="gcard gcard--static">
                  <span className="gcard__icon" aria-hidden>{g.name.charAt(0).toUpperCase()}</span>
                  <div className="gcard__text">
                    <b>{g.name}</b>
                    {g.description && <p className="gcard__desc">{g.description}</p>}
                    <p className="gcard__meta">
                      {g.memberCount} {g.memberCount === 1 ? "miembro" : "miembros"} ·{" "}
                      <button type="button" className="gcard__report" onClick={() => setReporting(g)}>Reportar</button>
                    </p>
                  </div>
                  <div className="gcard__action">
                    <JoinButton g={g} onChange={() => { loadAll(); loadMine(); }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {creating && <CreateGroup onClose={() => setCreating(false)} />}
      {reporting && <ReportDialog groupId={reporting.id} name={reporting.name} onClose={() => setReporting(null)} />}
    </div>
  );
}

function CreateGroup({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { id } = await api<{ id: string }>("/groups", { method: "POST", json: { name, description: description || null } });
      nav(`/grupos/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet" role="dialog" aria-modal aria-labelledby="create-title" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 id="create-title">Crear un grupo</h2>
        <label className="field">
          <span>Nombre</span>
          <input className="input" required minLength={3} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Descripción</span>
          <textarea className="input" rows={3} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="¿De qué va el grupo?" />
        </label>
        <p className="muted small">Vas a ser el dueño. Se entra pidiendo ingreso o aceptando una invitación tuya o de tus moderadores.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy || name.trim().length < 3}>{busy ? "Creando…" : "Crear grupo"}</button>
        </div>
      </form>
    </div>
  );
}
