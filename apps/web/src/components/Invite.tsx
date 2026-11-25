import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, type InvitableGroup, type InviteCandidate, type InviteCandidates, type InviteState, type MyInvite } from "../api";
import { Avatar } from "./Avatar";
import { GroupAvatar } from "./GroupAvatar";
import { GroupIcon } from "./Icons";
import { DialogFocus } from "./DialogFocus";

/**
 * Botón de invitar según dónde está la persona en el grupo.
 * Si ya había pedido entrar, invitarla es aceptarla.
 */
function InviteAction({ state, onInvite }: { state: InviteState; onInvite: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  if (state === "member") return <span className="pill">Ya está</span>;
  if (state === "invited") return <span className="pill pill--wait">Invitación enviada</span>;
  if (state === "declined") return <span className="pill">Rechazó hace poco</span>;
  const run = async () => {
    setBusy(true);
    try {
      await onInvite();
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="btn btn--small btn--primary" disabled={busy} onClick={run}>
      {state === "requested" ? "Aceptar" : "Invitar"}
    </button>
  );
}

/** Hasta qué distancia mostrar gente (km). null = sin límite. */
const DISTANCES: { km: number | null; label: string }[] = [
  { km: null, label: "Cualquier distancia" },
  { km: 1, label: "1 km" },
  { km: 5, label: "5 km" },
  { km: 10, label: "10 km" },
  { km: 25, label: "25 km" },
  { km: 50, label: "50 km" },
  { km: 200, label: "200 km" },
];

type CandidateFilters = { maxKm: number | null; online: boolean; withPhoto: boolean; chatted: boolean; favorites: boolean; showMembers: boolean; ageMin: string; ageMax: string };
const NO_FILTERS: CandidateFilters = { maxKm: null, online: false, withPhoto: false, chatted: false, favorites: false, showMembers: false, ageMin: "", ageMax: "" };

function candidatesUrl(groupId: string, q: string, f: CandidateFilters, offset: number) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (f.maxKm != null) p.set("maxKm", String(f.maxKm));
  if (f.online) p.set("online", "1");
  if (f.withPhoto) p.set("withPhoto", "1");
  if (f.chatted) p.set("chatted", "1");
  if (f.favorites) p.set("favorites", "1");
  if (f.showMembers) p.set("showMembers", "1");
  if (f.ageMin) p.set("ageMin", f.ageMin);
  if (f.ageMax) p.set("ageMax", f.ageMax);
  if (offset) p.set("offset", String(offset));
  return `/groups/${groupId}/invite-candidates?${p}`;
}

/**
 * Desde Invitaciones: la lista larga de gente para invitar, de la más cercana a la más lejana,
 * con búsqueda por nombre y filtros (distancia, en línea, ya chateamos, favoritos, con foto, edad).
 */
export function InvitePeopleSheet({ groupId, groupName, onClose, onChange }: {
  groupId: string;
  groupName: string;
  onClose: () => void;
  onChange: () => void;
}) {
  const [q, setQ] = useState("");
  const [f, setF] = useState<CandidateFilters>(NO_FILTERS);
  const [moreFilters, setMoreFilters] = useState(false);
  const [data, setData] = useState<InviteCandidates | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    (query: string, filters: CandidateFilters) =>
      api<InviteCandidates>(candidatesUrl(groupId, query, filters, 0))
        .then(setData)
        .catch(() => setData({ people: [], total: 0, hasMore: false, hasLocation: false })),
    [groupId],
  );

  useEffect(() => {
    const t = setTimeout(() => load(q, f), q || f.ageMin || f.ageMax ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, f, load]);

  async function more() {
    if (!data) return;
    setLoadingMore(true);
    try {
      const next = await api<InviteCandidates>(candidatesUrl(groupId, q, f, data.people.length));
      setData({ ...next, people: [...data.people, ...next.people.filter((p) => !data.people.some((x) => x.id === p.id))] });
    } finally {
      setLoadingMore(false);
    }
  }

  async function invite(p: InviteCandidate) {
    setError("");
    try {
      const r = await api<{ joined?: boolean }>(`/groups/${groupId}/invites`, { method: "POST", json: { userId: p.id } });
      setData((d) => d && { ...d, people: d.people.map((x) => (x.id === p.id ? { ...x, state: r.joined ? "member" : "invited" } : x)) });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const set = <K extends keyof CandidateFilters>(k: K, v: CandidateFilters[K]) => setF((x) => ({ ...x, [k]: v }));
  const active = JSON.stringify(f) !== JSON.stringify(NO_FILTERS);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet sheet--list invite-sheet" role="dialog" aria-modal aria-labelledby="invite-title" onClick={(e) => e.stopPropagation()}>
        <DialogFocus onClose={onClose} />
        <h2 id="invite-title">Invitar a {groupName}</h2>
        <input
          className="input"
          type="search"
          placeholder="Buscar por nombre…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Buscar gente"
        />

        <div className="invite-filters" role="group" aria-label="Distancia">
          {DISTANCES.map((d) => (
            <button key={d.label} type="button" className={`chip ${f.maxKm === d.km ? "chip--on" : ""}`} aria-pressed={f.maxKm === d.km} onClick={() => set("maxKm", d.km)}>
              {d.label}
            </button>
          ))}
        </div>
        <div className="invite-filters" role="group" aria-label="Filtros">
          <button type="button" className={`chip ${f.online ? "chip--on" : ""}`} aria-pressed={f.online} onClick={() => set("online", !f.online)}>En línea</button>
          <button type="button" className={`chip ${f.chatted ? "chip--on" : ""}`} aria-pressed={f.chatted} onClick={() => set("chatted", !f.chatted)}>Ya chateamos</button>
          <button type="button" className={`chip ${f.favorites ? "chip--on" : ""}`} aria-pressed={f.favorites} onClick={() => set("favorites", !f.favorites)}>Favoritos</button>
          <button type="button" className={`chip ${f.withPhoto ? "chip--on" : ""}`} aria-pressed={f.withPhoto} onClick={() => set("withPhoto", !f.withPhoto)}>Con foto</button>
          <button type="button" className={`chip ${moreFilters ? "chip--on" : ""}`} aria-expanded={moreFilters} onClick={() => setMoreFilters(!moreFilters)}>Más filtros</button>
        </div>
        {moreFilters && (
          <div className="invite-more">
            <label className="field field--inline">
              <span>Edad</span>
              <input className="input input--num" inputMode="numeric" placeholder="18" value={f.ageMin} onChange={(e) => set("ageMin", e.target.value.replace(/\D/g, "").slice(0, 2))} aria-label="Edad mínima" />
              <span className="muted">a</span>
              <input className="input input--num" inputMode="numeric" placeholder="99" value={f.ageMax} onChange={(e) => set("ageMax", e.target.value.replace(/\D/g, "").slice(0, 2))} aria-label="Edad máxima" />
            </label>
            <label className="check">
              <input type="checkbox" checked={f.showMembers} onChange={(e) => set("showMembers", e.target.checked)} />
              <span>Mostrar también a quienes ya están en el grupo</span>
            </label>
          </div>
        )}

        <div className="invite-count muted small" role="status">
          {data ? `${data.total} ${data.total === 1 ? "persona" : "personas"}${data.hasLocation ? ", de la más cerca a la más lejos" : ""}` : "Buscando…"}
          {active && <button type="button" className="linkbtn small" onClick={() => { setF(NO_FILTERS); setMoreFilters(false); }}>Sacar filtros</button>}
        </div>
        {data && !data.hasLocation && f.maxKm != null && (
          <p className="muted small">Para filtrar por distancia, activá tu ubicación en la pestaña Gente.</p>
        )}
        {error && <p className="error" role="alert">{error}</p>}

        <ul className="members invite-list">
          {data?.people.map((p) => (
            <li key={p.id} className="member">
              <Link to={`/perfil/${p.id}`} className="member__who">
                <Avatar src={p.photo} name={p.name} size={40} />
                <span className="invite-who">
                  <span><b>{p.name}</b></span>
                  {(p.online || p.distance) && (
                    <span className="muted small">
                      {p.online && <><i className="dot dot--on" /> En línea</>}
                      {p.online && p.distance && " · "}
                      {p.distance}
                    </span>
                  )}
                </span>
              </Link>
              <InviteAction state={p.state} onInvite={() => invite(p)} />
            </li>
          ))}
          {data && data.people.length === 0 && (
            <li className="muted">{q ? "No encontramos a nadie con ese nombre y esos filtros." : "No hay nadie con esos filtros. Probá ampliar la distancia."}</li>
          )}
        </ul>
        {data?.hasMore && (
          <button className="btn btn--ghost" disabled={loadingMore} onClick={more}>{loadingMore ? "Cargando…" : "Ver más gente"}</button>
        )}
        <p className="muted small">La persona recibe la invitación y elige si entra.</p>
        <button className="btn" onClick={onClose}>Listo</button>
      </div>
    </div>
  );
}

/** Desde el perfil de alguien: invitarle a los grupos que modero. No se muestra si no modero ninguno. */
export function InviteToGroups({ userId, name }: { userId: string; name: string }) {
  const [groups, setGroups] = useState<InvitableGroup[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<InvitableGroup[]>(`/groups/invitable/${userId}`).then(setGroups).catch(() => setGroups([]));
  }, [userId]);

  if (!groups?.length) return null;

  async function invite(g: InvitableGroup) {
    setError("");
    try {
      const r = await api<{ joined?: boolean }>(`/groups/${g.id}/invites`, { method: "POST", json: { userId } });
      setGroups((list) => list?.map((x) => (x.id === g.id ? { ...x, state: r.joined ? "member" : "invited" } : x)) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <button className="btn btn--ghost" onClick={() => setOpen(true)}><GroupIcon /> Invitar a un grupo</button>
      {open && (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="sheet sheet--list" role="dialog" aria-modal aria-labelledby="invite-groups-title" onClick={(e) => e.stopPropagation()}>
            <DialogFocus onClose={() => setOpen(false)} />
            <h2 id="invite-groups-title">Invitar a {name}</h2>
            <p className="muted small">Estos son los grupos que moderás. {name} recibe la invitación y elige si entra.</p>
            {error && <p className="error" role="alert">{error}</p>}
            <ul className="members invite-list">
              {groups.map((g) => (
                <li key={g.id} className="member">
                  <span className="member__who">
                    <GroupAvatar name={g.name} photo={g.photo} size="sm" />
                    <b>{g.name}</b>
                  </span>
                  <InviteAction state={g.state} onInvite={() => invite(g)} />
                </li>
              ))}
            </ul>
            <button className="btn" onClick={() => setOpen(false)}>Listo</button>
          </div>
        </div>
      )}
    </>
  );
}

/** Invitaciones que me mandaron, arriba de Mis grupos. */
export function MyInvites({ invites, onChange }: { invites: MyInvite[]; onChange: () => void }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!invites.length) return null;

  async function answer(inv: MyInvite, accept: boolean) {
    setBusy(inv.id);
    setError("");
    try {
      await api(`/invites/${inv.id}/${accept ? "accept" : "decline"}`, { method: "POST" });
      if (accept) nav(`/grupos/${inv.group.id}`);
      else onChange();
    } catch (e) {
      setError((e as Error).message);
      onChange();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="section">
      <h2 className="section__title">Te invitaron <span className="muted">{invites.length}</span></h2>
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="reqs">
        {invites.map((inv) => (
          <li key={inv.id} className="req">
            <div className="req__who">
              <GroupAvatar name={inv.group.name} photo={inv.group.photo} />
              <span>
                <b>{inv.group.name}</b>
                <span className="gcard__meta">
                  {" "}· {inv.group.memberCount} {inv.group.memberCount === 1 ? "miembro" : "miembros"}
                </span>
              </span>
            </div>
            {inv.group.description && <p className="gcard__desc">{inv.group.description}</p>}
            {inv.invitedBy && (
              <p className="muted small">
                Te invitó <Link to={`/perfil/${inv.invitedBy.id}`}>{inv.invitedBy.name}</Link>
              </p>
            )}
            <div className="row">
              <button className="btn btn--small" disabled={busy === inv.id} onClick={() => answer(inv, false)}>No, gracias</button>
              <button className="btn btn--small btn--primary" disabled={busy === inv.id} onClick={() => answer(inv, true)}>Entrar</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
