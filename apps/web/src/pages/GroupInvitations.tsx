import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { api, ApiError, getSocket, type GroupInfo, type SentInvite } from "../api";
import { Avatar } from "../components/Avatar";
import { BackIcon, PlusIcon } from "../components/Icons";
import { InvitePeopleSheet } from "../components/Invite";
import { useInstalledAndroidBack } from "../useSectionBack";

export function GroupInvitations() {
  const { id = "" } = useParams();
  const { pathname, search, hash, state } = useLocation();
  const navigate = useNavigate();
  const chat = `/grupos/${id}`;
  const details = `${chat}/info`;
  const path = `/groups/${id}/invites`;
  const loadVersion = useRef(0);
  const [group, setGroup] = useState<GroupInfo | null>(null);
  const [invites, setInvites] = useState<SentInvite[] | null>(null);
  const [inviting, setInviting] = useState(false);
  const [canceling, setCanceling] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const current = group?.id === id ? group : null;

  const openDetailsFromChat = useCallback(() => {
    navigate(chat, { replace: true });
    navigate(details, { state: { fromDirectInvitations: true } });
  }, [chat, details, navigate]);

  useEffect(() => {
    if (!current || state?.fromGroupDetails) return;
    // Un enlace directo llega sin los destinos intermedios de Atrás.
    openDetailsFromChat();
    navigate({ pathname, search, hash }, { state: { fromGroupDetails: true, fromDirectInvitations: true } });
  }, [current, hash, navigate, openDetailsFromChat, pathname, search, state]);

  function goBack() {
    if (state?.fromGroupDetails) navigate(-1);
    else openDetailsFromChat();
  }

  const directEntry = !state?.fromGroupDetails || state?.fromDirectInvitations === true;
  useInstalledAndroidBack(directEntry && !inviting, goBack);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const info = await api<GroupInfo>(`/groups/${id}`);
      if (version !== loadVersion.current) return;
      if (!info.role) {
        navigate(chat, { replace: true });
        return;
      }
      if (info.isGeneral || (info.role !== "owner" && info.role !== "moderator")) {
        navigate(details, { replace: true });
        return;
      }
      setGroup(info);
      const list = await api<SentInvite[]>(path);
      if (version === loadVersion.current) {
        setInvites(list);
        setLoadError("");
      }
    } catch (err) {
      if (version !== loadVersion.current) return;
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        navigate("/grupos", { replace: true });
        return;
      }
      setLoadError("No se pudieron cargar las invitaciones.");
    }
  }, [chat, details, id, navigate, path]);

  useEffect(() => {
    void load();
    const socket = getSocket();
    const update = (event: { groupId: string }) => {
      if (event.groupId === id) void load();
    };
    const gone = (event: { groupId: string }) => {
      if (event.groupId === id) navigate("/grupos", { replace: true });
    };
    socket.on("group:request", update);
    socket.on("group:role", update);
    socket.on("group:removed", gone);
    socket.on("group:gone", gone);
    return () => {
      loadVersion.current += 1;
      socket.off("group:request", update);
      socket.off("group:role", update);
      socket.off("group:removed", gone);
      socket.off("group:gone", gone);
    };
  }, [id, load, navigate]);

  async function cancelInvite(invite: SentInvite) {
    setError("");
    setCanceling(invite.id);
    try {
      await api(`${path}/${invite.id}`, { method: "DELETE" });
      setInvites((list) => list?.filter((item) => item.id !== invite.id) ?? null);
      void load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCanceling(null);
    }
  }

  return (
    <div className="page">
      <header className="topbar topbar--thread">
        <button type="button" className="iconbtn" aria-label="Volver" onClick={goBack}><BackIcon /></button>
        <div className="topbar__grow">
          <h1 className="topbar__title topbar__title--sm">Invitaciones</h1>
          {current && <p className="topbar__sub">{current.name}</p>}
        </div>
        {current && (
          <button type="button" className="iconbtn group-invitations__add" aria-label="Invitar gente" onClick={() => setInviting(true)}>
            <PlusIcon />
          </button>
        )}
      </header>
      <section className="section" aria-label="Invitaciones enviadas">
        {loadError && (
          <div className="notice notice--error" role="alert">
            {loadError}
            <button type="button" className="linkbtn" onClick={() => void load()}>Reintentar</button>
          </div>
        )}
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        {current && (
          <>
            {invites?.length === 0 && <p className="muted small">No hay invitaciones pendientes.</p>}
            {!!invites?.length && (
              <ul className="members">
                {invites.map((invite) => (
                  <li key={invite.id} className="member">
                    <Link to={`/perfil/${invite.user.id}`} className="member__who">
                      <Avatar src={invite.user.photo} name={invite.user.name} size={40} />
                      <span><b><bdi>{invite.user.name}</bdi></b> <span className="muted small">· sin responder</span></span>
                    </Link>
                    <button type="button" className="linkbtn small" disabled={canceling !== null} onClick={() => cancelInvite(invite)}>
                      {canceling === invite.id ? "Cancelando…" : "Cancelar"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {inviting && <InvitePeopleSheet groupId={id} groupName={current.name} onClose={() => setInviting(false)} onChange={load} />}
          </>
        )}
      </section>
    </div>
  );
}
