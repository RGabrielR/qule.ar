import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { api, ApiError, getSocket, type GroupInfo } from "../api";
import { BackIcon } from "../components/Icons";
import { JoinRequests } from "../features/groups/JoinRequests";
import { useTabData } from "../features/navigation/tabData";
import { useSectionBack } from "../useSectionBack";
import { markBack, usePageTransition } from "../features/navigation/pageTransition";

export function GroupRequests() {
  const { id = "" } = useParams();
  const { state, search } = useLocation();
  const navigate = useNavigate();
  const { refreshGroups } = useTabData();
  const chat = `/grupos/${id}`;
  const backFromNotification = useSectionBack(`${chat}?aviso=1`);
  const fromNotification = new URLSearchParams(search).get("aviso") === "1";
  const enter = usePageTransition();
  const [group, setGroup] = useState<GroupInfo | null>(null);
  const [error, setError] = useState("");

  function goBack() {
    markBack();
    if (fromNotification) backFromNotification();
    else if (state?.groupRequestsFrom === "details" || state?.groupRequestsFrom === "chat") navigate(-1);
    else navigate(chat, { replace: true });
  }

  useEffect(() => {
    let active = true;
    setError("");
    const load = async () => {
      try {
        const info = await api<GroupInfo>(`/groups/${id}`);
        if (!active) return;
        if (info.isGeneral || (info.role !== "owner" && info.role !== "moderator")) {
          navigate(chat, { replace: true });
          return;
        }
        setGroup(info);
        setError("");
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          navigate("/grupos", { replace: true });
          return;
        }
        setError("No se pudieron cargar las solicitudes. Probá de nuevo.");
      }
    };
    const updateAccess = (event: { groupId: string }) => {
      if (event.groupId === id) void load();
    };
    void load();
    const socket = getSocket();
    socket.on("group:role", updateAccess);
    socket.on("group:removed", updateAccess);
    socket.on("group:gone", updateAccess);
    return () => {
      active = false;
      socket.off("group:role", updateAccess);
      socket.off("group:removed", updateAccess);
      socket.off("group:gone", updateAccess);
    };
  }, [chat, id, navigate]);

  return (
    <div className={`page ${enter}`}>
      <header className="topbar topbar--thread">
        <button type="button" className="iconbtn" onClick={goBack} aria-label="Volver"><BackIcon /></button>
        <div className="topbar__grow">
          <h1 className="topbar__title topbar__title--sm">Solicitudes</h1>
          {group?.id === id && <p className="topbar__sub">{group.name}</p>}
        </div>
      </header>
      <section className="section" aria-label="Solicitudes de ingreso">
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        {group?.id === id && <JoinRequests key={id} groupId={id} onChanged={() => refreshGroups("refresh")} />}
      </section>
    </div>
  );
}
