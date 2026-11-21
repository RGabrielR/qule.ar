import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";
import { InstallBanner } from "../components/InstallBanner";
import { Link } from "react-router";
import { api, type NearbyPerson } from "../api";
import { useMe } from "../App";
import { CheckIcon, FilterIcon, PinIcon, RefreshIcon, StarIcon } from "../components/Icons";
import { LOCATION_EVENT, shareLocation } from "../location";
import { BODY_TYPES, LOOKING_FOR, POSITIONS, RELATIONSHIP, TRIBES } from "../options";

export type Filters = {
  ageMin?: number; ageMax?: number;
  heightMin?: number; heightMax?: number;
  weightMin?: number; weightMax?: number;
  bodyType: string[]; position: string[]; tribes: string[]; lookingFor: string[]; relationship: string[];
  online: boolean; withPhoto: boolean; favorites: boolean;
};

const EMPTY: Filters = { bodyType: [], position: [], tribes: [], lookingFor: [], relationship: [], online: false, withPhoto: false, favorites: false };
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

function toQuery(f: Filters, offset: number) {
  const q = new URLSearchParams();
  for (const k of ["ageMin", "ageMax", "heightMin", "heightMax", "weightMin", "weightMax"] as const) {
    if (f[k] != null) q.set(k, String(f[k]));
  }
  for (const k of ["bodyType", "position", "tribes", "lookingFor", "relationship"] as const) {
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
  n += [f.bodyType, f.position, f.tribes, f.lookingFor, f.relationship].filter((x) => x.length).length;
  if (f.online) n++;
  if (f.withPhoto) n++;
  if (f.favorites) n++;
  return n;
}

type Status = "loading" | "ready" | "error";
type LocState = "none" | "asking" | "denied" | "unsupported" | "ok";
const REFRESH_DISTANCE = 100;

export function Nearby() {
  const { me, reload } = useMe();
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [people, setPeople] = useState<NearbyPerson[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<Status>("loading");
  const [loc, setLoc] = useState<LocState>("ok");
  const [showFilters, setShowFilters] = useState(false);
  const [updating, setUpdating] = useState<"idle" | "busy" | "done">("idle");
  const [refreshDistance, setRefreshDistance] = useState(0);
  const [refreshError, setRefreshError] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const pageRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const pull = useRef<{ x: number; y: number; distance: number } | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const load = useCallback(async (f: Filters, offset = 0, releasedDistance = 0) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setRefreshDistance(releasedDistance);
    setRefreshError(false);
    try {
      const d = await api<{ hasLocation: boolean; people: NearbyPerson[]; hasMore: boolean }>(`/nearby?${toQuery(f, offset)}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setLoc((prev) => (d.hasLocation ? "ok" : prev === "ok" ? "none" : prev));
      setPeople((prev) => (offset ? [...prev, ...d.people] : d.people));
      setHasMore(d.hasMore);
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
    load(filters);
    // Cada vez que se manda una ubicación nueva (a mano o sola), la grilla se reordena
    const onLocation = () => load(filtersRef.current);
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
    setFilters(f);
    saveFilters(f);
    setShowFilters(false);
    load(f);
  }

  const active = countFilters(filters);
  const refreshing = refreshDistance > 0;
  const refreshHeight = refreshing ? refreshDistance : pullDistance;
  const pullProgress = pullDistance / REFRESH_DISTANCE;
  const readyToRefresh = pullDistance === REFRESH_DISTANCE;

  return (
    <div ref={pageRef} className="page nearby-page" onTouchStart={startPull} onTouchEnd={endPull} onTouchCancel={cancelPull}>
      <header className="topbar">
        <h1 className="topbar__title">Gente</h1>
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
            <button className={`btn btn--small ${active ? "btn--primary" : ""}`} onClick={() => setShowFilters(true)}>
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
              <li key={p.id}>
                <Link to={`/perfil/${p.id}`} className="tile" aria-label={`${p.name}, ${p.age}${p.distance ? `, ${p.distance}` : ""}${p.online ? ", en línea" : ""}`}>
                  {p.photo ? <img src={p.photo} alt="" loading="lazy" /> : <span className="tile__empty">{p.name.charAt(0).toUpperCase()}</span>}
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

      {showFilters && <FilterSheet initial={filters} onApply={applyFilters} onClose={() => setShowFilters(false)} />}
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

function FilterSheet({ initial, onApply, onClose }: { initial: Filters; onApply: (f: Filters) => void; onClose: () => void }) {
  const [f, setF] = useState<Filters>(initial);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF({ ...f, [k]: v });

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet sheet--tall" role="dialog" aria-modal aria-labelledby="filters-title" onClick={(e) => e.stopPropagation()}>
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
          <p className="muted small">Los filtros de altura, peso y demás dejan afuera a quien no completó ese dato.</p>
        </div>
        <div className="row sheet__foot">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" onClick={() => onApply(f)}>Aplicar</button>
        </div>
      </div>
    </div>
  );
}
