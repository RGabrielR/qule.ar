import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { loadedCount, useRememberScroll } from "../features/navigation/viewMemory";
import { api, getSocket, ROLE_LABEL, upload, type GroupListing } from "../api";
import { GroupAvatar } from "../components/GroupAvatar";
import { PhotoPicker } from "../components/GroupPhoto";
import { preparePhotoForUpload } from "../features/photos/preparePhoto";
import { GROUP_EVENTS, useTabData } from "../features/navigation/tabData";
import { usePullToRefresh } from "../features/navigation/pullToRefresh";
import { PlusIcon } from "../components/Icons";
import { MyInvites } from "../components/Invite";
import { JoinButton } from "../components/JoinButton";
import { useGroupOrder } from "../features/groups/useGroupOrder";
import { useMe } from "../App";
import { DialogFocus } from "../components/DialogFocus";
import { useTabTransition } from "../features/navigation/pageTransition";
import { SkeletonRows } from "../components/Skeleton";
import { useArrival } from "../components/useArrival";

/** Tiene que coincidir con EXPLORE_PAGE en apps/api/src/routes/groups.ts */
const GROUPS_PAGE = 60;
type GroupPage = { groups: GroupListing[]; nextOffset: number | null };

export function Groups() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("ver") === "todos" ? "all" : "mine";
  const { groups: mine, invites, refreshGroups } = useTabData();
  const { me } = useMe();
  const { ordered, move, reset } = useGroupOrder(me?.user.id ?? "", mine);
  const [ordering, setOrdering] = useState(false);
  const [all, setAll] = useState<GroupListing[] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // La búsqueda va en la dirección: al volver de un grupo sigue ahí
  const q = params.get("q") ?? "";
  const setQ = (value: string) => setParams(value ? { ver: "todos", q: value } : { ver: "todos" }, { replace: true });
  const enter = useTabTransition();
  const pageRef = useRef<HTMLDivElement>(null);
  useRememberScroll(pageRef, tab === "mine" ? mine != null : all != null);
  const [creating, setCreating] = useState(false);
  const shown = all?.length ?? 0;
  // Las tarjetas entran escalonadas cuando llegan. Al volver a "Todos los grupos" (ya se habían visto) no se
  // anima la primera tanda: la lista vuelve a estar donde estaba.
  const [returning] = useState(() => loadedCount.get(`grupos:${q}`) > 0);
  const arriveMine = useArrival(mine?.map((g) => g.id));
  const arriveAll = useArrival(all?.map((g) => g.id), { quietFirst: returning });

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

  const pullRefresh = usePullToRefresh(pageRef, () =>
    Promise.all([refreshGroups("refresh"), tab === "all" ? loadAll(q, shown) : undefined]),
  );

  useEffect(() => {
    if (tab !== "all") return;
    const s = getSocket();
    const refresh = () => loadAll(q, shown);
    for (const ev of GROUP_EVENTS) s.on(ev, refresh);
    return () => {
      for (const ev of GROUP_EVENTS) s.off(ev, refresh);
    };
  }, [loadAll, tab, q, shown]);

  // Cuántos grupos había cargados con esta búsqueda, para volver a mostrarlos todos
  useEffect(() => {
    if (all) loadedCount.set(`grupos:${q}`, all.length);
  }, [all, q]);

  useEffect(() => {
    if (tab !== "all") return;
    const t = setTimeout(() => loadAll(q, loadedCount.get(`grupos:${q}`)), 250);
    return () => clearTimeout(t);
  }, [tab, q, loadAll]);

  return (
    <div className={`page ${enter}`} ref={pageRef}>
      <header className="topbar">
        <h1 className="topbar__title">Grupos</h1>
        <button className="btn btn--small btn--primary" onClick={() => setCreating(true)}><PlusIcon /> Crear</button>
      </header>
      {pullRefresh}

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "mine"} onClick={() => setParams({})}>Mis grupos</button>
        <button role="tab" aria-selected={tab === "all"} onClick={() => setParams({ ver: "todos" })}>Todos los grupos</button>
      </div>

      {tab === "mine" ? (
        <>
        <MyInvites invites={invites ?? []} onChange={() => refreshGroups("refresh")} />
        {mine == null ? <GroupsSkeleton /> : (
        <>
        {(ordered?.length ?? 0) > 1 && (
          <div className="row searchbar">
            <button type="button" className="btn btn--small" aria-pressed={ordering} onClick={() => setOrdering(!ordering)}>
              {ordering ? "Listo" : "Reordenar mis grupos"}
            </button>
            {ordering && <button type="button" className="btn btn--small" onClick={reset}>Restablecer orden</button>}
          </div>
        )}
        <ul className="glist">
          {ordered?.map((g, index) => (
            <li key={g.id} {...arriveMine(g.id)}>
              <Link to={`/grupos/${g.id}`} className="gcard">
                <GroupAvatar name={g.name} photo={g.photo} general={g.isGeneral} appear />
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
              {ordering && (
                <div className="row searchbar">
                  <button type="button" className="btn btn--small" aria-label={`Subir ${g.name}`} disabled={index === 0} onClick={() => move(index, -1)}>Subir</button>
                  <button type="button" className="btn btn--small" aria-label={`Bajar ${g.name}`} disabled={index === ordered.length - 1} onClick={() => move(index, 1)}>Bajar</button>
                </div>
              )}
            </li>
          ))}
          {mine.length <= 1 && (
            <li className="empty empty--inline">
              <p className="muted">Todavía estás solo en el general. Mirá <button className="linkbtn" onClick={() => setParams({ ver: "todos" })}>todos los grupos</button> o creá uno.</p>
            </li>
          )}
        </ul>
        </>
        )}
        </>
      ) : (
        <>
          <div className="searchbar">
            <input className="input" type="search" placeholder="Buscar grupos…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar grupos" />
          </div>
          {all == null ? <GroupsSkeleton /> : all.length === 0 ? (
            <div className="empty">
              <p className="empty__title">{q ? "No encontramos grupos con eso" : "Todavía no hay grupos"}</p>
              <p className="muted">¿Por qué no creás el primero?</p>
            </div>
          ) : (
            <ul className="glist">
              {all.map((g) => {
                const { className, style } = arriveAll(g.id);
                return (
                <li key={g.id} className={`gcard gcard--static ${className}`} style={style}>
                  <GroupAvatar name={g.name} photo={g.photo} appear />
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
                );
              })}
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

/** Mientras llegan los grupos: tarjetas con la forma de las de la lista (imagen de 48 y tres líneas). */
function GroupsSkeleton() {
  return <SkeletonRows count={7} avatar={48} square lines={3} className="glist" />;
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
