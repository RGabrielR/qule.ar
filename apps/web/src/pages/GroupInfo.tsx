import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";
import { api, getSocket, ROLE_LABEL, type GroupInfo as Info, type Member, type MemberPage } from "../api";
import { useMe } from "../App";
import { Avatar } from "../components/Avatar";
import { BackIcon } from "../components/Icons";
import { GroupActionMenu } from "../features/groups/GroupActionMenu";
import { setGroupMuted } from "../features/groups/groupNotifications";
import { ReportDialog } from "../components/ReportDialog";
import { slowModeText } from "../features/groups/groupRules";
import { useTabData } from "../features/navigation/tabData";
import { markBack, usePageTransition } from "../features/navigation/pageTransition";
import { GroupAvatar } from "../components/GroupAvatar";
import { Skeleton, SkeletonRows, SkeletonText, SkeletonWait } from "../components/Skeleton";
import { useInstalledAndroidBack } from "../useSectionBack";

export function GroupInfo() {
  const { id = "" } = useParams();
  const { me } = useMe();
  const { refreshGroups } = useTabData();
  const nav = useNavigate();
  const location = useLocation();
  const enter = usePageTransition();
  const [info, setInfo] = useState<Info | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  // Los miembros llegan después que la info: mientras tanto, su esqueleto
  const [membersReady, setMembersReady] = useState(false);
  // Las recargas por socket llaman a load() sin cantidad: el ref conserva lo que se ve.
  const visibleMembers = useRef(0);
  const [memberNext, setMemberNext] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [memberMenu, setMemberMenu] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [reporting, setReporting] = useState(false);

  const isMod = info?.role === "owner" || info?.role === "moderator";
  const isOwner = info?.role === "owner";

  const load = useCallback(async (keepMembers = visibleMembers.current) => {
    try {
      const g = await api<Info>(`/groups/${id}`);
      setInfo(g);
      if (!g.role) return nav(`/grupos/${id}`, { replace: true });
      // De a 25; si hace falta (por ejemplo al expulsar a alguien), se vuelven a pedir las páginas ya abiertas.
      const first = await api<MemberPage>(`/groups/${id}/members`);
      let list = first.members;
      let next = first.nextOffset;
      while (next != null && list.length < keepMembers) {
        const more = await api<MemberPage>(`/groups/${id}/members?offset=${next}`);
        list = [...list, ...more.members];
        next = more.nextOffset;
      }
      visibleMembers.current = list.length;
      setMembers(list);
      setMembersReady(true);
      setMemberNext(next);
    } catch {
      nav("/grupos", { replace: true });
    }
  }, [id, nav]);

  useEffect(() => {
    load();
    const s = getSocket();
    const onAny = (p: { groupId: string }) => p.groupId === id && load();
    const gone = (p: { groupId: string }) => p.groupId === id && nav("/grupos", { replace: true });
    s.on("group:request", onAny);
    s.on("group:role", onAny);
    s.on("group:removed", gone);
    s.on("group:gone", gone);
    return () => {
      s.off("group:request", onAny);
      s.off("group:role", onAny);
      s.off("group:removed", gone);
      s.off("group:gone", gone);
    };
  }, [id, load, nav]);

  async function act(fn: () => Promise<unknown>) {
    setError("");
    setMemberMenu(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function loadMoreMembers() {
    if (memberNext == null || loadingMore) return;
    setError("");
    setLoadingMore(true);
    try {
      const page = await api<MemberPage>(`/groups/${id}/members?offset=${memberNext}`);
      setMembers((prev) => {
        const nextList = [...prev, ...page.members];
        visibleMembers.current = nextList.length;
        return nextList;
      });
      setMemberNext(page.nextOffset);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  function goBack() {
    markBack();
    // Volvé al origen. Si Detalles se abrió directo, volvé al chat.
    if (location.key === "default" || window.history.state?.idx === 0) nav(`/grupos/${id}`, { replace: true });
    else nav(-1);
  }

  useInstalledAndroidBack(Boolean(location.state?.fromDirectInvitations && !reporting), goBack);

  if (location.hash === "#solicitudes") return <Navigate to={`/grupos/${id}/solicitudes`} replace />;
  if (!info) return <div className={`page ${enter}`}><GroupInfoSkeleton /></div>;
  const showChatLink = Boolean(info.role && !location.state?.fromGroupChat);
  const canManageGroup = isMod && !info.isGeneral;
  const hasPendingRequests = canManageGroup && info.pendingCount > 0;

  return (
    <div className={`page ${enter}`}>
      <header className="topbar topbar--thread">
        <button className="iconbtn" onClick={goBack} aria-label="Volver"><BackIcon /></button>
        <h1 className="topbar__grow topbar__title topbar__title--sm">{info.isGeneral ? "# " : ""}{info.name}</h1>
        {(canManageGroup || showChatLink) && (
          <GroupActionMenu hasPendingRequests={hasPendingRequests}>
            {(close) => (
              <>
                {canManageGroup && (
                  <Link className="group-actions__requests" to={`/grupos/${id}/solicitudes`} state={{ groupRequestsFrom: "details" }} onClick={close}>
                    Solicitudes
                    {hasPendingRequests && <span className="badge">{info.pendingCount}</span>}
                  </Link>
                )}
                {canManageGroup && isOwner && (
                  <Link to={`/grupos/${id}/editar`} state={{ fromGroupDetails: true }} onClick={close}>Editar grupo</Link>
                )}
                {canManageGroup && (
                  <Link to={`/grupos/${id}/invitaciones`} state={{ fromGroupDetails: true }} onClick={close}>Invitaciones</Link>
                )}
                {showChatLink && (
                  <Link to={`/grupos/${id}`} aria-label="Ver chat del grupo" onClick={close}>Ver</Link>
                )}
              </>
            )}
          </GroupActionMenu>
        )}
      </header>

      <section className="section group-head">
        <GroupAvatar name={info.name} photo={info.photo} general={info.isGeneral} size="big" />
      </section>

      <section className="section">
        <h2 className="section__title">Sobre el grupo</h2>
        {info.description && <p className="profile__about group-description">{info.description}</p>}
        <p className="muted small hint">
          {info.memberCount} {info.memberCount === 1 ? "miembro" : "miembros"} · Tu rol: {ROLE_LABEL[info.role!]}
        </p>
        <p className="muted small">{slowModeText(info.rules)}</p>
      </section>

      {error && <div className="notice notice--error" role="alert">{error}</div>}

      {!info.isGeneral && (
        <section className="section">
          <h2 className="section__title">Miembros <span className="muted">{info.memberCount}</span></h2>
          {!membersReady ? <SkeletonRows flush count={Math.min(Math.max(info.memberCount, 1), 6)} avatar={40} lines={1} /> : (
          <ul className="members">
            {members.map((m) => {
              const isMe = m.id === me?.user.id;
              const canKick = !isMe && (isOwner || (info.role === "moderator" && m.role === "member"));
              const canPromote = isOwner && !isMe;
              return (
                <li key={m.id} className="member">
                  <Link to={`/perfil/${m.id}`} className="member__who">
                    <Avatar src={m.photo} name={m.name} size={40} appear />
                    <span>
                      <b>{m.name}</b>{isMe && <span className="muted"> (vos)</span>}
                      {m.role !== "member" && <span className="pill pill--role">{ROLE_LABEL[m.role]}</span>}
                    </span>
                  </Link>
                  {(canKick || canPromote) && m.role !== "owner" && (
                    <div className="member__actions">
                      <button className="linkbtn small" onClick={() => setMemberMenu(memberMenu === m.id ? null : m.id)} aria-expanded={memberMenu === m.id}>Opciones</button>
                      {memberMenu === m.id && (
                        <div className="menu" role="menu">
                          {canPromote && m.role === "member" && (
                            <button role="menuitem" onClick={() => act(() => api(`/groups/${id}/members/${m.id}`, { method: "PATCH", json: { role: "moderator" } }))}>Hacer moderador</button>
                          )}
                          {canPromote && m.role === "moderator" && (
                            <button role="menuitem" onClick={() => act(() => api(`/groups/${id}/members/${m.id}`, { method: "PATCH", json: { role: "member" } }))}>Quitar moderador</button>
                          )}
                          {canKick && (
                            <button role="menuitem" className="danger" onClick={() => act(() => api(`/groups/${id}/members/${m.id}`, { method: "DELETE" }))}>Expulsar del grupo</button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          )}
          {memberNext != null && (
            <div className="center">
              <button className="btn btn--small" disabled={loadingMore} onClick={loadMoreMembers}>
                {loadingMore ? "Cargando…" : "Ver más"}
              </button>
            </div>
          )}
        </section>
      )}

      <section className="section">
        <div className="setting">
          <div>
            <h2 className="section__title section__title--tight">Avisos de este grupo</h2>
            <p className="muted small">
              {info.muted
                ? "Silenciado: solo te avisamos si alguien te responde."
                : "Te avisamos cuando hay mensajes nuevos (como mucho cada 10 minutos) y cuando te responden."}
            </p>
          </div>
          <button
            className={`switch ${!info.muted ? "switch--on" : ""}`}
            role="switch"
            aria-checked={!info.muted}
            aria-label="Avisos de este grupo"
            onClick={async () => {
              const muted = !info.muted;
              setInfo({ ...info, muted });
              await setGroupMuted(id, muted).catch(() => setInfo({ ...info }));
            }}
          >
            <span />
          </button>
        </div>
      </section>

      {!info.isGeneral && (
        <section className="section">
          <div className="stack">
            {confirmLeave ? (
              <div className="confirm">
                <p>¿Salir de {info.name}? Para volver vas a tener que pedir ingreso de nuevo.{isOwner && " Como sos el dueño, el grupo pasa a un moderador o al miembro más antiguo. Si no queda nadie, se cierra."}</p>
                <div className="row">
                  <button className="btn" onClick={() => setConfirmLeave(false)}>Cancelar</button>
                  <button className="btn btn--danger" onClick={() => act(async () => {
                    await api(`/groups/${id}/leave`, { method: "POST" });
                    refreshGroups("clear");
                    nav("/grupos");
                  })}>Salir</button>
                </div>
              </div>
            ) : (
              <>
                <button className="btn" onClick={() => setConfirmLeave(true)}>Salir del grupo</button>
                <button type="button" className="btn btn--ghost btn--dangertext" onClick={() => setReporting(true)}>Reportar este grupo</button>
              </>
            )}
          </div>
        </section>
      )}

      {reporting && <ReportDialog groupId={id} name={info.name} onClose={() => setReporting(false)} />}

      {info.isGeneral && (
        <section className="section">
          <p className="muted">Este es el chat de toda la app: todo el mundo está acá y no se puede salir. Si alguien molesta, bloquealo o reportalo desde su perfil.</p>
        </section>
      )}
    </div>
  );
}

/** Mientras llega la info del grupo: la barra, la foto y las primeras secciones con su forma. */
function GroupInfoSkeleton() {
  return (
    <SkeletonWait>
      <header className="topbar topbar--thread">
        <span className="skeleton--iconbtn" />
        <Skeleton className="skeleton--title" />
      </header>
      <section className="section group-head"><Skeleton className="skeleton--group-photo" /></section>
      <section className="section">
        <Skeleton className="skeleton--title section__title" />
        <SkeletonText lines={3} />
      </section>
      <section className="section"><SkeletonText lines={2} /></section>
    </SkeletonWait>
  );
}
