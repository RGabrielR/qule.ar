import { useCallback, useEffect, useLayoutEffect, useRef, useState, type TouchEvent } from "react";
import { InstallBanner } from "../components/InstallBanner";
import { Link, useLocation, useNavigate } from "react-router";
import { api, type NearbyPerson } from "../api";
import { useMe } from "../App";
import { CheckIcon, FilterIcon, PinIcon, RefreshIcon, StarIcon } from "../components/Icons";
import { LOCATION_EVENT, shareLocation } from "../location";
import { BODY_TYPES, LOOKING_FOR, POSITIONS, RELATIONSHIP, TRIBES } from "../options";
import { DialogFocus } from "../components/DialogFocus";
import { useSheetExit } from "../components/useSheetExit";
import { getGridList, saveGridList, toGridPerson } from "../features/profileSwipe/gridList";
import { HasPlaceChips, type HasPlace } from "../features/place/hasPlace";
import { useTabTransition } from "../features/navigation/pageTransition";
import { photoAppear } from "../components/photoAppear";
import { motionMs } from "../motion";
import { Skeleton, SkeletonGrid } from "../components/Skeleton";
import { useArrival } from "../components/useArrival";

export type Filters = {
  ageMin?: number; ageMax?: number;
  heightMin?: number; heightMax?: number;
  weightMin?: number; weightMax?: number;
  bodyType: string[]; position: string[]; tribes: string[]; lookingFor: string[]; relationship: string[]; hasPlace: HasPlace[];
  online: boolean; withPhoto: boolean; favorites: boolean;
};

export const EMPTY: Filters = { bodyType: [], position: [], tribes: [], lookingFor: [], relationship: [], hasPlace: [], online: false, withPhoto: false, favorites: false };
const STORE_KEY = "mortero:filtros";

function loadFilters(): Filters {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function saveFilters(f: Filters) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(f));
  } catch {
    /* sin almacenamiento: los filtros duran lo que dura la pestaña */
  }
}

export function toQuery(f: Filters, offset: number) {
  const q = new URLSearchParams();
  for (const k of ["ageMin", "ageMax", "heightMin", "heightMax", "weightMin", "weightMax"] as const) {
    if (f[k] != null) q.set(k, String(f[k]));
  }
  for (const k of ["bodyType", "position", "tribes", "lookingFor", "relationship", "hasPlace"] as const) {
    if (f[k].length) q.set(k, f[k].join(","));
  }
  if (f.online) q.set("online", "1");
  if (f.withPhoto) q.set("withPhoto", "1");
  if (f.favorites) q.set("favorites", "1");
  if (offset) q.set("offset", String(offset));
  return q.toString();
}

export function countFilters(f: Filters) {
  let n = 0;
  if (f.ageMin != null || f.ageMax != null) n++;
  if (f.heightMin != null || f.heightMax != null) n++;
  if (f.weightMin != null || f.weightMax != null) n++;
  n += [f.bodyType, f.position, f.tribes, f.lookingFor, f.relationship, f.hasPlace].filter((x) => x.length).length;
  if (f.online) n++;
  if (f.withPhoto) n++;
  if (f.favorites) n++;
  return n;
}

type Status = "loading" | "ready" | "error";
type LocState = "none" | "asking" | "denied" | "unsupported" | "ok";
const REFRESH_DISTANCE = 100;
type NearbyPage = { hasLocation: boolean; people: NearbyPerson[]; hasMore: boolean };
type NearbyPosition = { userId: string; query: string; top: number; count: number };

// Guarda las posiciones recientes por entrada del historial, sin guardar los perfiles.
const positions = new Map<string, NearbyPosition>();
const POSITION_LIMIT = 20;

// Lo último que mostró la grilla. Al volver a la pestaña aparece al instante, sin esqueleto ni la entrada completa,
// y se revalida por detrás: solo las personas nuevas entran animadas (como Instagram y las apps nativas).
type GridCache = { userId: string; query: string; people: NearbyPerson[]; hasMore: boolean };
let gridCache: GridCache | null = null;
// Las fotos de esa grilla quedan referenciadas, así el navegador las mantiene decodificadas en memoria y al volver
// se dibujan en el primer cuadro (sobre todo en iPhone, que si no las vuelve a leer del disco).
const keptPhotos = new Map<string, HTMLImageElement>();
function keepPhotos(people: NearbyPerson[]) {
  const urls = new Set(people.flatMap((p) => (p.photo ? [p.photo] : [])));
  for (const url of keptPhotos.keys()) if (!urls.has(url)) keptPhotos.delete(url);
  for (const url of urls) {
    if (keptPhotos.has(url)) continue;
    const img = new Image();
    img.src = url;
    keptPhotos.set(url, img);
  }
}

/** Espera a que las fotos que se ven estén listas para dibujar, con un tope para no trabar la pantalla. */
function photosReady(root: HTMLElement, max: number) {
  const visible = [...root.querySelectorAll<HTMLImageElement>(".grid img")].filter((img) => img.getBoundingClientRect().top < window.innerHeight);
  const ready = visible.map((img) => (img.complete ? img.decode() : new Promise((done) => {
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
  })).catch(() => {}));
  return Promise.race([Promise.all(ready), new Promise((done) => setTimeout(done, max))]);
}

export function Nearby() {
  const { me, reload } = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = location;
  const filtersEntry = typeof state?.filtersEntry === "string" ? state.filtersEntry : undefined;
  const showFilters = filtersEntry !== undefined;
  // La hoja tiene su propia entrada del historial y comparte la posición de la grilla.
  const entry = filtersEntry ?? location.key;
  const userId = me?.user.id;
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [cached] = useState(() => (gridCache && gridCache.userId === userId && gridCache.query === toQuery(filters, 0) ? gridCache : null));
  const [people, setPeople] = useState<NearbyPerson[]>(() => cached?.people ?? []);
  // Con qué filtros se pidió la grilla que se ve: si cambian, la grilla nueva entra entera
  const [peopleQuery, setPeopleQuery] = useState<string | undefined>(cached?.query);
  // Sube cada vez que se tira para actualizar: la grilla renovada vuelve a entrar entera
  const [refreshes, setRefreshes] = useState(0);
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? false);
  const [status, setStatus] = useState<Status>(cached ? "ready" : "loading");
  // Al volver con la grilla guardada, la pantalla espera a sus fotos para aparecer todo junto (ver .page--hold)
  const [holding, setHolding] = useState(Boolean(cached));
  const [loc, setLoc] = useState<LocState>("ok");
  const [updating, setUpdating] = useState<"idle" | "busy" | "done">("idle");
  const [refreshDistance, setRefreshDistance] = useState(0);
  const [refreshError, setRefreshError] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const enter = useTabTransition();
  const pageRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const pull = useRef<{ x: number; y: number; distance: number } | null>(null);
  // Al volver de un perfil, la grilla vuelve a la misma posición (y carga las páginas que hagan falta)
  const [returnPosition] = useState(() => {
    const previousEntry = typeof state?.nearbyEntry === "string" ? state.nearbyEntry : entry;
    const saved = positions.get(entry) ?? positions.get(previousEntry);
    if (!saved || saved.userId !== userId || saved.query !== toQuery(filters, 0)) return undefined;
    // Si desde el perfil pasaste a personas de páginas que la grilla no había cargado, se cargan también.
    const list = getGridList(positions.has(entry) ? entry : previousEntry, userId);
    const swiped = list && list.query === saved.query ? list.people.length : 0;
    return { ...saved, count: Math.max(saved.count, swiped) };
  });
  const pendingRestore = useRef(returnPosition);
  // Las fotos entran escalonadas en cada tanda ("Ver más", actualizar). Al volver de un perfil a la misma
  // posición, no: la grilla tiene que verse como estaba.
  const arrival = useArrival(status === "ready" ? people.map((p) => p.id) : null, {
    quietFirst: returnPosition != null, batch: `${peopleQuery}#${refreshes}`, columns: 3,
  });
  const visible = useRef({ count: 0, ready: false });
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // El perfil usa esta lista para pasar al anterior o al siguiente, con el mismo orden y los mismos filtros.
  useLayoutEffect(() => {
    if (status !== "ready" || !userId) return;
    saveGridList(entry, { userId, query: toQuery(filtersRef.current, 0), people: people.map(toGridPerson), hasMore });
    gridCache = { userId, query: toQuery(filtersRef.current, 0), people, hasMore };
    keepPhotos(people);
  }, [entry, userId, people, hasMore, status]);

  useLayoutEffect(() => {
    if (!holding || !pageRef.current) return;
    let live = true;
    void photosReady(pageRef.current, motionMs("--dur-page")).then(() => { if (live) setHolding(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    visible.current = { count: people.length, ready: status === "ready" };
    if (status === "ready" && pendingRestore.current && pageRef.current) {
      pageRef.current.scrollTop = pendingRestore.current.top;
      pendingRestore.current = undefined;
    }
  }, [people, status]);

  useLayoutEffect(() => {
    const page = pageRef.current;
    return () => {
      const { count, ready } = visible.current;
      if (page && userId && ready) {
        positions.delete(entry);
        positions.set(entry, { userId, query: toQuery(filtersRef.current, 0), top: page.scrollTop, count });
        if (positions.size > POSITION_LIMIT) {
          const oldest = positions.keys().next().value;
          if (oldest !== undefined) positions.delete(oldest);
        }
      }
    };
  }, [entry, userId]);

  const load = useCallback(async (f: Filters, offset = 0, releasedDistance = 0, restoreCount = 0) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const { signal } = controller;
    const fetchPage = (start: number) => api<NearbyPage>(`/nearby?${toQuery(f, start)}`, { signal });
    setRefreshDistance(releasedDistance);
    setRefreshError(false);
    try {
      const d = await fetchPage(offset);
      const loaded = [...d.people];
      let hasMore = d.hasMore;
      while (hasMore && loaded.length < restoreCount) {
        const next = await fetchPage(loaded.length);
        loaded.push(...next.people);
        hasMore = next.hasMore && next.people.length > 0;
      }
      if (signal.aborted) return;
      setLoc((prev) => (d.hasLocation ? "ok" : prev === "ok" ? "none" : prev));
      setPeople((prev) => (offset ? [...prev, ...loaded] : loaded));
      setPeopleQuery(toQuery(f, 0));
      if (releasedDistance > 0) setRefreshes((n) => n + 1);
      setHasMore(hasMore);
      setStatus("ready");
    } catch {
      if (controller.signal.aborted) return;
      if (releasedDistance > 0) setRefreshError(true);
      else setStatus("error");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setRefreshDistance(0);
      }
    }
  }, []);

  const cancelPull = useCallback(() => {
    pull.current = null;
    setPullDistance(0);
  }, []);

  function startPull(event: TouchEvent<HTMLDivElement>) {
    if (requestRef.current || showFilters || event.currentTarget.scrollTop > 0 || event.touches.length !== 1) {
      cancelPull();
      return;
    }
    const { clientX, clientY } = event.touches[0];
    pull.current = { x: clientX, y: clientY, distance: 0 };
  }

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    const movePull = (event: globalThis.TouchEvent) => {
      const start = pull.current;
      if (!start) return;
      if (event.touches.length !== 1 || page.scrollTop > 0) {
        cancelPull();
        return;
      }
      const { clientX, clientY } = event.touches[0];
      const down = clientY - start.y;
      const sideways = Math.abs(clientX - start.x);
      if (down < -8 || (sideways > 12 && sideways > down)) {
        cancelPull();
        return;
      }
      // Evita que el navegador convierta en scroll el movimiento de vuelta del mismo arrastre.
      if ((start.distance > 0 || down > sideways) && event.cancelable) event.preventDefault();
      start.distance = Math.max(0, Math.min(down, REFRESH_DISTANCE));
      setPullDistance(start.distance);
    };

    page.addEventListener("touchmove", movePull, { passive: false });
    return () => page.removeEventListener("touchmove", movePull);
  }, [cancelPull]);

  function endPull() {
    const gesture = pull.current;
    cancelPull();
    if (gesture?.distance === REFRESH_DISTANCE && !requestRef.current) void load(filters, 0, gesture.distance);
  }

  /** Pide la ubicación al navegador y manda solo lat/lng; el servidor la redondea a ~500 m. */
  async function share() {
    setLoc("asking");
    const r = await shareLocation();
    if (r === "ok") {
      setLoc("ok");
      if (!me?.profile?.hasLocation) reload();
    } else {
      setLoc(r === "error" ? "none" : r);
    }
  }

  /** Botón de la barra: vuelve a tomar la ubicación ahora (por si te moviste). */
  async function update() {
    setUpdating("busy");
    const r = await shareLocation();
    if (r === "ok") {
      setUpdating("done");
      setTimeout(() => setUpdating("idle"), 2500);
    } else {
      setUpdating("idle");
      if (r !== "error") setLoc(r);
    }
  }

  useEffect(() => {
    // Cada vez que se manda una ubicación nueva (a mano o sola), la grilla se reordena.
    // Si volvés de un perfil, carga tantas personas como había para poder volver a la misma posición.
    const onLocation = () => load(filtersRef.current, 0, 0, pendingRestore.current?.count ?? visible.current.count);
    onLocation();
    window.addEventListener(LOCATION_EVENT, onLocation);
    return () => {
      window.removeEventListener(LOCATION_EVENT, onLocation);
      const current = requestRef.current;
      requestRef.current = null;
      current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilters(f: Filters) {
    pendingRestore.current = undefined;
    if (pageRef.current) pageRef.current.scrollTop = 0;
    setFilters(f);
    saveFilters(f);
    load(f);
  }

  function closeFilters() {
    navigate(-1);
  }

  const active = countFilters(filters);
  const refreshing = refreshDistance > 0;
  const refreshHeight = refreshing ? refreshDistance : pullDistance;
  const pullProgress = pullDistance / REFRESH_DISTANCE;
  const readyToRefresh = pullDistance === REFRESH_DISTANCE;

  return (
    <div ref={pageRef} className={`page nearby-page ${enter}${holding ? " page--hold" : ""}`} onTouchStart={startPull} onTouchEnd={endPull} onTouchCancel={cancelPull}>
      <header className="topbar">
        <h1 className="topbar__title">Gente</h1>
        {status === "loading" && <Skeleton className="skeleton--btn-sm" />}
        {status === "ready" && (
          <div className="topbar__actions">
            {loc === "ok" && me?.profile?.hasLocation && (
              <button
                className={`iconbtn ${updating === "busy" ? "iconbtn--busy" : updating === "done" ? "iconbtn--done" : ""}`}
                disabled={updating === "busy"}
                onClick={update}
                aria-label="Actualizar mi ubicación"
                title="Actualizar mi ubicación"
              >
                <PinIcon size={20} />
              </button>
            )}
            <button className={`btn btn--small ${active ? "btn--primary" : ""}`} onClick={() => navigate(location, { state: { ...state, filtersEntry: entry } })}>
              <FilterIcon /> Filtros{active ? ` · ${active}` : ""}
            </button>
          </div>
        )}
      </header>

      <InstallBanner />

      <p className="sr-only" aria-live="polite">{updating === "done" ? "Ubicación actualizada" : ""}</p>

      {status === "ready" && loc !== "ok" && (
        <div className="notice locate-bar">
          <span className="locate-bar__icon"><PinIcon /></span>
          <div className="locate-bar__text">
            <p>Compartí tu ubicación para ver a qué distancia está cada persona.</p>
            <p className="muted small">Guardamos solo una zona de unos 500 m y la distancia se muestra en tramos.</p>
            {loc === "denied" && <p className="error">El navegador no nos dio permiso. Habilitalo en los ajustes del sitio.</p>}
            {loc === "unsupported" && <p className="error">Este navegador no permite compartir la ubicación.</p>}
          </div>
          {loc !== "unsupported" && (
            <button className="btn btn--small btn--primary" disabled={loc === "asking"} onClick={share}>
              {loc === "asking" ? "Buscando…" : "Compartir"}
            </button>
          )}
        </div>
      )}

      {status === "error" && <div className="notice notice--error">No pudimos cargar la grilla. Probá de nuevo en un rato.</div>}
      {refreshError && <p className="notice notice--error" role="alert">No pudimos actualizar la grilla. Probá de nuevo.</p>}

      <div
        className={`nearby-refresh${readyToRefresh || refreshing ? " nearby-refresh--ready" : ""}${pullDistance > 0 ? " nearby-refresh--pulling" : ""}`}
        aria-hidden="true"
        style={{ height: refreshHeight }}
      >
        <span
          className={refreshing ? "nearby-refresh__spin" : undefined}
          style={refreshing ? undefined : { transform: `rotate(${(pullProgress - 1) * 270}deg)` }}
        >
          {readyToRefresh ? <CheckIcon /> : <RefreshIcon />}
        </span>
      </div>
      <p className="sr-only" role="status">{refreshing ? "Actualizando…" : readyToRefresh ? "Soltá para actualizar" : ""}</p>

      {status === "loading" && <SkeletonGrid />}

      {status === "ready" && people.length === 0 && (
        <div className="empty">
          <p className="empty__title">{active ? "Nadie con esos filtros" : "Todavía no hay nadie más"}</p>
          {active ? (
            <button className="btn btn--small" onClick={() => applyFilters(EMPTY)}>Sacar filtros</button>
          ) : (
            <p className="muted">Pasate por el chat general o los grupos mientras tanto.</p>
          )}
        </div>
      )}

      {status === "ready" && people.length > 0 && (
        <>
          <ul className="grid">
            {people.map((p) => (
              <li key={p.id} {...arrival(p.id)}>
                <Link to={`/perfil/${p.id}`} state={{ nearbyEntry: entry }} className="tile" aria-label={`${p.name}${p.distance ? `, ${p.distance}` : ""}${p.online ? ", en línea" : ""}`}>
                  {p.photo ? <img src={p.photo} alt="" loading="lazy" {...photoAppear} /> : <span className="tile__empty">{p.name.charAt(0).toUpperCase()}</span>}
                  {p.favorite && <span className="tile__fav" aria-label="Favorito"><StarIcon filled size={14} /></span>}
                  <span className="tile__info">
                    <span className="tile__name">
                      {p.online ? <i className="dot dot--on" /> : p.recent ? <i className="dot dot--recent" /> : null}
                      {p.name}
                    </span>
                    {p.distance && <span className="tile__dist">{p.distance}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {hasMore && (
            <div className="center">
              <button className="btn btn--small" disabled={refreshing} onClick={() => {
                if (!requestRef.current) void load(filters, people.length);
              }}>Ver más</button>
            </div>
          )}
        </>
      )}

      {showFilters && <FilterSheet initial={filters} onClose={closeFilters} onApply={(f) => {
        applyFilters(f);
        closeFilters();
      }} />}
    </div>
  );
}

function RangeRow({ label, unit, min, max, onChange, lo, hi }: {
  label: string; unit?: string; min?: number; max?: number; lo: number; hi: number;
  onChange: (min?: number, max?: number) => void;
}) {
  const num = (s: string) => (s === "" ? undefined : Number(s));
  return (
    <fieldset className="field">
      <legend>{label}{unit ? ` (${unit})` : ""}</legend>
      <div className="range">
        <input className="input" type="number" inputMode="numeric" min={lo} max={hi} placeholder={`${lo}`} value={min ?? ""} onChange={(e) => onChange(num(e.target.value), max)} aria-label={`${label} mínimo`} />
        <span className="muted">a</span>
        <input className="input" type="number" inputMode="numeric" min={lo} max={hi} placeholder={`${hi}`} value={max ?? ""} onChange={(e) => onChange(min, num(e.target.value))} aria-label={`${label} máximo`} />
      </div>
    </fieldset>
  );
}

function Chips({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="field">
      <legend>{label}</legend>
      <div className="chips">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <button type="button" key={o} className={`chip ${on ? "chip--on" : ""}`} aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}>
              {o}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function FilterSheet({ initial, onApply, onClose }: { initial: Filters; onApply: (f: Filters) => void; onClose: () => void }) {
  const [f, setF] = useState<Filters>(initial);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF({ ...f, [k]: v });
  const { close, backdrop } = useSheetExit(onClose);

  return (
    <div className="sheet-backdrop" {...backdrop}>
      <div className="sheet sheet--tall" role="dialog" aria-modal aria-labelledby="filters-title" onClick={(e) => e.stopPropagation()}>
        <DialogFocus onClose={close} />
        <div className="sheet__head">
          <h2 id="filters-title">Filtros</h2>
          <button className="linkbtn" onClick={() => setF(EMPTY)}>Limpiar</button>
        </div>
        <div className="sheet__body form">
          <label className="check">
            <input type="checkbox" checked={f.online} onChange={(e) => set("online", e.target.checked)} />
            <span>Solo en línea ahora</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={f.favorites} onChange={(e) => set("favorites", e.target.checked)} />
            <span>Solo mis favoritos</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={f.withPhoto} onChange={(e) => set("withPhoto", e.target.checked)} />
            <span>Solo con foto</span>
          </label>
          <RangeRow label="Edad" lo={18} hi={99} min={f.ageMin} max={f.ageMax} onChange={(a, b) => setF({ ...f, ageMin: a, ageMax: b })} />
          <RangeRow label="Altura" unit="cm" lo={120} hi={230} min={f.heightMin} max={f.heightMax} onChange={(a, b) => setF({ ...f, heightMin: a, heightMax: b })} />
          <RangeRow label="Peso" unit="kg" lo={35} hi={250} min={f.weightMin} max={f.weightMax} onChange={(a, b) => setF({ ...f, weightMin: a, weightMax: b })} />
          <Chips label="Contextura" options={BODY_TYPES} value={f.bodyType} onChange={(v) => set("bodyType", v)} />
          <Chips label="Rol" options={POSITIONS} value={f.position} onChange={(v) => set("position", v)} />
          <Chips label="Tribus" options={TRIBES} value={f.tribes} onChange={(v) => set("tribes", v)} />
          <Chips label="Busca" options={LOOKING_FOR} value={f.lookingFor} onChange={(v) => set("lookingFor", v)} />
          <Chips label="Relación" options={RELATIONSHIP} value={f.relationship} onChange={(v) => set("relationship", v)} />
          <HasPlaceChips value={f.hasPlace} onChange={(v) => set("hasPlace", v)} />
          <p className="muted small">Los filtros de altura, peso y demás dejan afuera a quien no completó ese dato.</p>
        </div>
        <div className="row sheet__foot">
          <button className="btn" onClick={() => close()}>Cancelar</button>
          <button className="btn btn--primary" onClick={() => close(() => onApply(f))}>Aplicar</button>
        </div>
      </div>
    </div>
  );
}
