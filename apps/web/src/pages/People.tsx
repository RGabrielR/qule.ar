import { useEffect, useRef, useState } from "react";
import { Link, useNavigationType } from "react-router";
import { api, type Author, type Toque, type Viewer } from "../api";
import { ReactionIcon } from "../components/Reactions";
import { reactionLabel } from "../reactions";
import { useMe } from "../App";
import { BackIcon } from "../components/Icons";
import { useSectionBack } from "../useSectionBack";
import { useRememberScroll } from "../features/navigation/viewMemory";
import { usePageTransition } from "../features/navigation/pageTransition";
import { photoAppear } from "../components/photoAppear";
import { SkeletonGrid } from "../components/Skeleton";
import { useArrival } from "../components/useArrival";

function ago(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 3600) return `hace ${Math.max(1, Math.floor(diff / 60))} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  const d = Math.floor(diff / 86400);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

function PeopleGrid({ title, people, empty, note, tabs }: { title: string; people: (Author & { sub?: string; reaction?: string; isNew?: boolean })[] | null; empty: string; note?: string; tabs?: React.ReactNode }) {
  const goBack = useSectionBack("/yo");
  const enter = usePageTransition();
  const pageRef = useRef<HTMLDivElement>(null);
  useRememberScroll(pageRef, people != null);
  // Las fotos entran escalonadas cuando llegan; al volver de un perfil, no: la grilla vuelve a estar como estaba
  const returning = useNavigationType() === "POP";
  const arrival = useArrival(people?.map((p) => p.id), { quietFirst: returning, columns: 3 });
  return (
    <div className={`page ${enter}`} ref={pageRef}>
      <header className={tabs ? "topbar" : "topbar topbar--thread"}>
        {!tabs && <button className="iconbtn" onClick={goBack} aria-label="Volver"><BackIcon /></button>}
        <h1 className="topbar__title topbar__title--sm">{tabs ? "Gente" : title}</h1>
      </header>
      {tabs}
      {note && <p className="muted small page-note">{note}</p>}
      {!people && <SkeletonGrid className="grid--spaced" />}
      {people && people.length === 0 && <div className="empty"><p className="muted">{empty}</p></div>}
      {people && people.length > 0 && (
        <ul className="grid grid--spaced">
          {people.map((p) => (
            <li key={p.id} {...arrival(p.id)}>
              <Link to={`/perfil/${p.id}`} className="tile" aria-label={p.name}>
                {p.photo ? <img src={p.photo} alt="" loading="lazy" {...photoAppear} /> : <span className="tile__empty">{p.name.charAt(0).toUpperCase()}</span>}
                {p.reaction && (
                  <span className={`tile__reaction ${p.isNew ? "tile__reaction--new" : ""}`} title={reactionLabel(p.reaction)}>
                    <ReactionIcon kind={p.reaction} size={26} />
                  </span>
                )}
                <span className="tile__info">
                  <span className="tile__name">{p.name}</span>
                  {p.sub && <span className="tile__dist">{p.sub}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Views() {
  const { me } = useMe();
  const [list, setList] = useState<Viewer[] | null>(null);
  useEffect(() => {
    api<Viewer[]>("/me/views").then(setList).catch(() => setList([]));
  }, []);
  return (
    <PeopleGrid
      title="Quién me vio"
      people={list?.map((v) => ({ ...v, sub: ago(v.viewedAt) })) ?? null}
      empty="Nadie visitó tu perfil en los últimos 30 días."
      note={me?.profile?.incognito ? "Estás en incógnito: vos podés ver quién te visitó, pero tus visitas no se registran." : "Visitas de los últimos 30 días. Quien está en incógnito no aparece."}
    />
  );
}

export function Favorites() {
  const [list, setList] = useState<Author[] | null>(null);
  useEffect(() => {
    api<Author[]>("/favorites").then(setList).catch(() => setList([]));
  }, []);
  return <PeopleGrid title="Favoritos" people={list} empty="Todavía no marcaste a nadie. Tocá la estrella en un perfil." note="Nadie se entera de que lo marcaste como favorito." />;
}

/** Los toques que te mandaron en los últimos 30 días (el último de cada persona). Al entrar se marcan como vistos. */
export function Toques({ tabs }: { tabs?: React.ReactNode }) {
  const [list, setList] = useState<Toque[] | null>(null);
  useEffect(() => {
    api<Toque[]>("/toques").then((t) => {
      setList(t);
      if (t.some((x) => x.unseen)) {
        api("/toques/seen", { method: "POST" }).then(() => window.dispatchEvent(new Event("mortero:toques"))).catch(() => {});
      }
    }).catch(() => setList([]));
  }, []);
  return (
    <PeopleGrid
      title="Toques"
      tabs={tabs}
      people={list?.map((t) => ({ ...t, sub: `${reactionLabel(t.kind)} · ${ago(t.at)}`, reaction: t.kind, isNew: t.unseen })) ?? null}
      empty="Todavía nadie te mandó un toque. Cuando alguien lo haga, aparece acá."
      note="Toques de los últimos 30 días. Devolvé uno desde su perfil o escribile."
    />
  );
}
