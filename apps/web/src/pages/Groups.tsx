import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, getSocket, ROLE_LABEL, upload, type GroupListing } from "../api";
import { GroupAvatar } from "../components/GroupAvatar";
import { PhotoPicker } from "../components/GroupPhoto";
import { preparePhotoForUpload } from "../features/photos/preparePhoto";
import { GROUP_EVENTS, useTabData } from "../features/navigation/tabData";
import { PlusIcon } from "../components/Icons";
import { MyInvites } from "../components/Invite";
import { JoinButton } from "../components/JoinButton";
import { DialogFocus } from "../components/DialogFocus";

/** Tiene que coincidir con EXPLORE_PAGE en apps/api/src/routes/groups.ts */
const GROUPS_PAGE = 60;
type GroupPage = { groups: GroupListing[]; nextOffset: number | null };

export function Groups() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("ver") === "todos" ? "all" : "mine";
  const { groups: mine, invites, refreshGroups } = useTabData();
  const [all, setAll] = useState<GroupListing[] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const shown = all?.length ?? 0;

  // Los grupos con más gente primero, de a páginas. Al recargar (por un evento o al unirse) se pide de una vez
  // todo lo que ya se estaba viendo, para no volver a la primera página.
  const loadAll = useCallback(
    (query = q, keep = 0) => {
      const limit = Math.max(GROUPS_PAGE, Math.min(300, keep));
      return api<GroupPage>(`/groups/all?q=${encodeURIComponent(query)}&limit=${limit}`)
        .then((r) => { setAll(r.groups); setNextOffset(r.nextOffset); })
        .catch(() => {});
    },
    [q],
  );

  async function loadMore() {
    if (nextOffset == null) return;
    setLoadingMore(true);
    try {
      const r = await api<GroupPage>(`/groups/all?q=${encodeURIComponent(q)}&offset=${nextOffset}`);
      setAll((prev) => {
        const seen = new Set((prev ?? []).map((g) => g.id));
        return [...(prev ?? []), ...r.groups.filter((g) => !seen.has(g.id))];
      });
      setNextOffset(r.nextOffset);
    } catch {
      // Se puede volver a tocar
    }
    setLoadingMore(false);
  }

  useEffect(() => {
    if (tab !== "all") return;
    const s = getSocket();
    const refresh = () => loadAll(q, shown);
    for (const ev of GROUP_EVENTS) s.on(ev, refresh);
    return () => {
      for (const ev of GROUP_EVENTS) s.off(ev, refresh);
    };
  }, [loadAll, tab, q, shown]);

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
        <MyInvites invites={invites ?? []} onChange={() => refreshGroups("refresh")} />
        <ul className="glist">
          {mine?.map((g) => (
            <li key={g.id}>
              <Link to={`/grupos/${g.id}`} className="gcard">
                <GroupAvatar name={g.name} photo={g.photo} general={g.isGeneral} />
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
                  <GroupAvatar name={g.name} photo={g.photo} />
                  <div className="gcard__text">
                    <Link className="gcard__details" to={`/grupos/${g.id}${g.role ? "/info" : ""}`}>
                      <b>{g.name}</b>
                      {g.description && <p className="gcard__desc">{g.description}</p>}
                    </Link>
                    <p className="gcard__meta">
                      {g.memberCount} {g.memberCount === 1 ? "miembro" : "miembros"}
                    </p>
                  </div>
                  <div className="gcard__action">
                    <JoinButton g={g} onChange={() => { loadAll(q, shown); refreshGroups("refresh"); }} />
                  </div>
                </li>
              ))}
              {nextOffset != null && (
                <li className="glist__more">
                  <button className="btn" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "Cargando…" : "Ver más grupos"}</button>
                </li>
              )}
            </ul>
          )}
        </>
      )}

      {creating && <CreateGroup onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateGroup({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const { refreshGroups } = useTabData();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { id } = await api<{ id: string }>("/groups", { method: "POST", json: { name, description: description || null } });
      // El grupo ya está creado: si la foto falla, se puede volver a poner desde la info del grupo
      if (photo) await upload(`/groups/${id}/photo`, await preparePhotoForUpload(photo)).catch(() => {});
      refreshGroups("refresh");
      nav(`/grupos/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet" role="dialog" aria-modal aria-labelledby="create-title" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <DialogFocus onClose={onClose} />
        <h2 id="create-title">Crear un grupo</h2>
        <PhotoPicker name={name || "?"} file={photo} onPick={setPhoto} />
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
