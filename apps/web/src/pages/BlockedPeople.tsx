import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { api, type Author } from "../api";
import { Avatar } from "../components/Avatar";
import { BackIcon } from "../components/Icons";
import { markBack, usePageTransition } from "../features/navigation/pageTransition";
import { useSectionBack } from "../useSectionBack";

type Page = { people: Author[]; total: number; hasMore: boolean };
/** `i`: posición dentro de la tanda en que llegó, para que cada tanda entre escalonada. */
type Row = { person: Author; i: number };
type List = { q: string; rows: Row[]; total: number; hasMore: boolean };

// Lo que dura el cierre de una fila al desbloquear (igual que en styles.css)
const LEAVE_MS = 260;

export function BlockedPeople() {
  const goBack = useSectionBack("/yo/configuracion");
  const enter = usePageTransition();
  const pageRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [list, setList] = useState<List | null>(null);
  const [failed, setFailed] = useState(false);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const request = useRef(0);
  const loading = useRef(false);

  // La búsqueda sale cuando se deja de escribir un momento
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async (search: string, offset: number) => {
    const id = ++request.current;
    loading.current = true;
    setFailed(false);
    try {
      const page = await api<Page>(`/blocks/page?${new URLSearchParams({ q: search, offset: String(offset) })}`);
      if (id !== request.current) return;
      setList((current) => {
        const keep = offset > 0 && current?.q === search ? current.rows : [];
        const seen = new Set(keep.map((r) => r.person.id));
        const added = page.people.filter((p) => !seen.has(p.id)).map((person, i) => ({ person, i }));
        return { q: search, rows: [...keep, ...added], total: page.total, hasMore: page.hasMore };
      });
    } catch {
      if (id === request.current) setFailed(true);
    } finally {
      if (id === request.current) loading.current = false;
    }
  }, []);

  useEffect(() => {
    void load(q, 0);
  }, [q, load]);

  // Scroll infinito: la tanda siguiente se pide un poco antes de llegar al final
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !list?.hasMore || failed) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loading.current) void load(list.q, list.rows.length);
    }, { root: pageRef.current, rootMargin: "320px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [list, failed, load]);

  async function unblock(person: Author) {
    setBusyId(person.id);
    setNotice("");
    try {
      await api(`/blocks/${person.id}`, { method: "DELETE" });
      setLeaving((s) => new Set(s).add(person.id));
      setTimeout(() => {
        setList((current) => current && {
          ...current, rows: current.rows.filter((r) => r.person.id !== person.id), total: Math.max(0, current.total - 1),
        });
        setLeaving((s) => {
          const next = new Set(s);
          next.delete(person.id);
          return next;
        });
      }, LEAVE_MS);
    } catch {
      setNotice("No se pudo desbloquear. Probá de nuevo.");
    } finally {
      setBusyId(null);
    }
  }

  const nobody = list != null && list.q === "" && list.total === 0 && leaving.size === 0;

  return (
    <div className={`page ${enter}`} ref={pageRef}>
      <header className="topbar topbar--thread">
        <button type="button" className="iconbtn" aria-label="Volver a Configuración" onClick={() => { markBack(); goBack(); }}><BackIcon /></button>
        <h1 className="topbar__title">Personas bloqueadas</h1>
      </header>

      {!nobody && (
        <div className="searchbar form">
          <label className="field">
            <span>Buscar por nombre</span>
            <input className="input" type="search" value={query} maxLength={60} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
      )}
      {notice && <p className="notice notice--error" role="alert">{notice}</p>}
      <p className="sr-only" aria-live="polite">{list ? `${list.total} ${list.total === 1 ? "persona" : "personas"}` : ""}</p>

      {nobody ? (
        <div className="empty empty--in">
          <p className="empty__title">No bloqueaste a nadie</p>
          <p className="muted">Si bloqueás a alguien, va a aparecer acá y lo vas a poder desbloquear cuando quieras.</p>
        </div>
      ) : list == null ? (
        failed ? <ListError onRetry={() => void load(q, 0)} /> : null
      ) : list.rows.length === 0 && list.q ? (
        <div className="empty empty--in" role="status"><p className="empty__title">Nadie con ese nombre</p></div>
      ) : (
        <>
          <ul className="blocked">
            {list.rows.map(({ person, i }) => (
              <li
                key={person.id}
                className={`blocked__row ${leaving.has(person.id) ? "blocked__row--leaving" : ""}`}
                style={{ "--i": Math.min(i, 10) } as CSSProperties}
              >
                <div className="blocked__inner">
                  <Avatar src={person.photo} name={person.name} size={44} />
                  <span className="blocked__name">{person.name}</span>
                  <button className="linkbtn" disabled={busyId === person.id || leaving.has(person.id)} onClick={() => void unblock(person)}>
                    Desbloquear
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {failed ? <ListError onRetry={() => void load(list.q, list.rows.length)} /> : list.hasMore && <div ref={sentinelRef} className="blocked__more" aria-hidden />}
        </>
      )}
    </div>
  );
}

function ListError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="empty" role="alert">
      <p className="muted">No pudimos cargar la lista.</p>
      <button className="btn btn--small" onClick={onRetry}>Reintentar</button>
    </div>
  );
}
