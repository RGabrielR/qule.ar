import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { api, ApiError, getSocket, type GroupInfo } from "../api";
import { GroupAvatar } from "../components/GroupAvatar";
import { GroupPhotoSetting } from "../components/GroupPhoto";
import { BackIcon } from "../components/Icons";
import { GroupSettings } from "../features/groups/GroupSettings";
import { useTabData } from "../features/navigation/tabData";

export function GroupEdit() {
  const { id = "" } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { refreshGroups } = useTabData();
  const groupPath = `/grupos/${id}`;
  const details = `${groupPath}/info`;
  const [group, setGroup] = useState<GroupInfo | null>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    let active = true;
    setError("");
    const load = async () => {
      try {
        const info = await api<GroupInfo>(`/groups/${id}`);
        if (!active) return;
        if (!info.role) navigate(groupPath, { replace: true });
        else if (info.role !== "owner" || info.isGeneral) navigate(details, { replace: true });
        else {
          setGroup(info);
          setError("");
        }
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          navigate("/grupos", { replace: true });
        } else {
          setError("No se pudo cargar el grupo.");
        }
      }
    };
    const onRole = (event: { groupId: string }) => {
      if (event.groupId === id) void load();
    };
    const onGone = (event: { groupId: string }) => {
      if (event.groupId === id) navigate("/grupos", { replace: true });
    };
    void load();
    const socket = getSocket();
    socket.on("group:role", onRole);
    socket.on("group:removed", onGone);
    socket.on("group:gone", onGone);
    return () => {
      active = false;
      socket.off("group:role", onRole);
      socket.off("group:removed", onGone);
      socket.off("group:gone", onGone);
    };
  }, [details, groupPath, id, navigate]);

  async function deleteGroup() {
    setDeleting(true);
    setDeleteError("");
    try {
      await api(`/groups/${id}`, { method: "DELETE" });
      refreshGroups("clear");
      navigate("/grupos", { replace: true });
    } catch (err) {
      setDeleteError((err as Error).message);
      setDeleting(false);
    }
  }

  const current = group?.id === id ? group : null;
  return (
    <div className="page">
      <header className="topbar topbar--thread">
        <button type="button" className="iconbtn" onClick={() => {
          if (state?.fromGroupDetails) navigate(-1);
          else navigate(details, { replace: true });
        }} aria-label="Volver"><BackIcon /></button>
        <div className="topbar__grow">
          <h1 className="topbar__title topbar__title--sm">Editar grupo</h1>
          {current && <p className="topbar__sub">{current.name}</p>}
        </div>
      </header>
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      {current && (
        <>
          <section className="section group-head" aria-label="Foto del grupo">
            <GroupAvatar name={current.name} photo={current.photo} size="big" />
            <GroupPhotoSetting key={id} groupId={id} photo={current.photo} onChange={(photo, photoAi) => {
              setGroup((prev) => prev?.id === id ? { ...prev, photo, photoAi } : prev);
              refreshGroups("refresh");
            }} />
          </section>
          <GroupSettings key={id} info={current} onSaved={(name) => {
            setGroup((prev) => prev?.id === id ? { ...prev, name } : prev);
            refreshGroups("refresh");
          }} />
          <section className="section stack">
            {confirmDelete ? (
              <div className="confirm confirm--danger">
                <p>¿Borrar {current.name} para todos? Se pierden todos los mensajes. <b>No se puede deshacer.</b></p>
                {deleteError && <p className="error" role="alert">{deleteError}</p>}
                <div className="row">
                  <button className="btn" disabled={deleting} onClick={() => {
                    setConfirmDelete(false);
                    setDeleteError("");
                  }}>Cancelar</button>
                  <button className="btn btn--danger" disabled={deleting} onClick={deleteGroup}>
                    {deleting ? "Borrando…" : "Borrar grupo"}
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn btn--ghost btn--dangertext" onClick={() => setConfirmDelete(true)}>Borrar grupo</button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
