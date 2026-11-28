import { groupTagsFromQuery } from "@mortero/shared/groupTags";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { loadedCount, useRememberScroll } from "../features/navigation/viewMemory";
import { api, getSocket, ROLE_LABEL, upload, type GroupListing } from "../api";
import { GroupAvatar } from "../components/GroupAvatar";
import { PhotoPicker } from "../components/GroupPhoto";
import { preparePhotoForUpload } from "../features/photos/preparePhoto";
import { GROUP_EVENTS, useTabData } from "../features/navigation/tabData";
import { usePullToRefresh } from "../features/navigation/pullToRefresh";
import { HashIcon, PlusIcon } from "../components/Icons";
import { MyInvites } from "../components/Invite";
import { JoinButton } from "../components/JoinButton";
import { GroupTagEditor, GroupTagFilter, GroupTagList } from "../features/groups/GroupTags";
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
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // La búsqueda y las etiquetas van en la dirección para recuperarlas al volver de un grupo.
  const q = params.get("q") ?? "";
  const tags = groupTagsFromQuery(params.get("tags"));
  const tagQuery = tags.join(",");
  const query = new URLSearchParams({ q, ...(tagQuery && { tags: tagQuery }) }).toString();
  const searchKey = `grupos:${query}`;
  const currentKey = useRef(searchKey);
  currentKey.current = searchKey;
  const visible = resultKey === searchKey ? all : null;
  const shown = visible?.length ?? 0;

  function setSearch(text: string, selectedTags: string[]) {
    setParams({ ver: "todos", ...(text && { q: text }), ...(selectedTags.length && { tags: selectedTags.join(",") }) }, { replace: true });
  }

  const enter = useTabTransition();
  const pageRef = useRef<HTMLDivElement>(null);
  useRememberScroll(pageRef, tab === "mine" ? mine != null : visible != null);
  const [creating, setCreating] = useState(false);
  const [returning] = useState(() => loadedCount.get(searchKey) > 0);
  const arriveMine = useArrival(mine?.map((g) => g.id));
  const arriveAll = useArrival(visible?.map((g) => g.id), { quietFirst: returning });

  // Al recargar por un evento o al unirse, se conserva lo que ya estaba cargado.
  const loadAll = useCallback((keep = 0) => {
    const limit = Math.max(GROUPS_PAGE, Math.min(300, keep));
    return api<GroupPage>(`/groups/all?${query}&limit=${limit}`)
      .then((r) => {
        if (currentKey.current !== searchKey) return;
        setAll(r.groups);
        setNextOffset(r.nextOffset);
        setResultKey(searchKey);
      }).catch(() => {});
  }, [query, searchKey]);

  async function loadMore() {
    if (resultKey !== searchKey || nextOffset == null || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api<GroupPage>(`/groups/all?${query}&offset=${nextOffset}`);
      if (currentKey.current !== searchKey) return;
      setAll((prev) => {
        const seen = new Set((prev ?? []).map((g) => g.id));
        return [...(prev ?? []), ...r.groups.filter((g) => !seen.has(g.id))];
      });
      setNextOffset(r.nextOffset);
    } catch {
      // Se puede volver a tocar
    } finally {
      setLoadingMore(false);
    }
  }

  const pullRefresh = usePullToRefresh(pageRef, () =>
    Promise.all([refreshGroups("refresh"), tab === "all" ? loadAll(shown) : undefined]),
  );

  useEffect(() => {
    if (tab !== "all") return;
    const s = getSocket();
    const refresh = () => loadAll(shown);
    for (const ev of GROUP_EVENTS) s.on(ev, refresh);
    return () => {
      for (const ev of GROUP_EVENTS) s.off(ev, refresh);
    };
  }, [loadAll, tab, shown]);

  useEffect(() => {
    if (visible) loadedCount.set(searchKey, visible.length);
  }, [visible, searchKey]);

  useEffect(() => {
    if (tab !== "all") return;
    const t = setTimeout(() => loadAll(loadedCount.get(searchKey)), 250);
    return () => clearTimeout(t);
  }, [tab, searchKey, loadAll]);

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
                  <GroupTagList tags={g.tags} />
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
          <div className="searchbar group-search">
            <input className="input" type="search" placeholder="Buscar grupos…" value={q} onChange={(e) => setSearch(e.target.value, tags)} aria-label="Buscar grupos" />
            <button type="button" className={tags.length ? "btn btn--primary" : "btn"} aria-haspopup="dialog"
              aria-label={tags.length ? `Filtrar por etiquetas · ${tags.length}` : "Filtrar por etiquetas"} onClick={() => setTagFilterOpen(true)}>
              <HashIcon />{tags.length > 0 && <span>{tags.length}</span>}
            </button>
          </div>
          {tags.length > 0 && <div className="searchbar"><GroupTagList tags={tags} /></div>}
          {visible == null ? <GroupsSkeleton /> : visible.length === 0 ? (
            <div className="empty">
              <p className="empty__title">{q || tags.length ? "No encontramos grupos con esos filtros" : "Todavía no hay grupos"}</p>
              {!q && tags.length === 0 && <p className="muted">¿Por qué no creás el primero?</p>}
            </div>
          ) : (
            <ul className="glist">
              {visible.map((g) => {
                const { className, style } = arriveAll(g.id);
                return (
                <li key={g.id} className={`gcard gcard--static ${className}`} style={style}>
                  <GroupAvatar name={g.name} photo={g.photo} appear />
                  <div className="gcard__text">
                    <Link className="gcard__details" to={`/grupos/${g.id}${g.role ? "/info" : ""}`}>
                      <b>{g.name}</b>
                      {g.description && <p className="gcard__desc">{g.description}</p>}
                      <GroupTagList tags={g.tags} />
                    </Link>
                    <p className="gcard__meta">
                      {g.memberCount} {g.memberCount === 1 ? "miembro" : "miembros"}
                    </p>
                  </div>
                  <div className="gcard__action">
                    <JoinButton g={g} onChange={() => { loadAll(shown); refreshGroups("refresh"); }} />
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

      {tab === "all" && tagFilterOpen && (
        <GroupTagFilter initial={tags} onClose={() => setTagFilterOpen(false)} onApply={(next) => {
          setSearch(q, next);
          setTagFilterOpen(false);
        }} />
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
  const [tags, setTags] = useState<string[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { id } = await api<{ id: string }>("/groups", { method: "POST", json: { name, description: description || null, tags } });
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
      <form className="sheet sheet--tall" role="dialog" aria-modal aria-labelledby="create-title" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <DialogFocus onClose={onClose} />
        <div className="sheet__head">
          <h2 id="create-title">Crear un grupo</h2>
        </div>
        <div className="sheet__body form">
          <PhotoPicker name={name || "?"} file={photo} onPick={setPhoto} />
          <label className="field">
            <span>Nombre</span>
            <input className="input" required minLength={3} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span>Descripción</span>
            <textarea className="input" rows={3} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="¿De qué va el grupo?" />
          </label>
          <GroupTagEditor tags={tags} onChange={setTags} />
          <p className="muted small">Vas a ser el dueño. Se entra pidiendo ingreso o aceptando una invitación tuya o de tus moderadores.</p>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
        <div className="row sheet__foot">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy || name.trim().length < 3}>{busy ? "Creando…" : "Crear grupo"}</button>
        </div>
      </form>
    </div>
  );
}
