import { useState } from "react";
import { Link } from "react-router";
import type { GroupInfo } from "../../api";
import { GroupActionMenu } from "./GroupActionMenu";
import { setGroupMuted } from "./groupNotifications";

export function GroupActions({ group, onMutedChange, onError }: {
  group: GroupInfo;
  onMutedChange: (muted: boolean) => void;
  onError: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const infoPath = `/grupos/${group.id}/info`;
  const canManageRequests = !group.isGeneral && (group.role === "owner" || group.role === "moderator");
  const hasPendingRequests = canManageRequests && group.pendingCount > 0;

  async function toggleNotifications() {
    if (saving) return;
    setSaving(true);
    try {
      const { muted } = await setGroupMuted(group.id, !group.muted);
      onMutedChange(muted);
    } catch {
      onError("No se pudieron cambiar los avisos. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <GroupActionMenu hasPendingRequests={hasPendingRequests}>
      {(close) => (
        <>
          {canManageRequests && (
            <Link className="group-actions__requests" to={`/grupos/${group.id}/solicitudes`} state={{ groupRequestsFrom: "chat" }} onClick={close}>
              Solicitudes
              {hasPendingRequests && <span className="badge">{group.pendingCount}</span>}
            </Link>
          )}
          <Link to={infoPath} state={{ fromGroupChat: true }} onClick={close}>Ver detalles</Link>
          <button type="button" aria-disabled={saving} onClick={toggleNotifications}>
            {group.muted ? "Reactivar notificaciones" : "Silenciar notificaciones"}
          </button>
        </>
      )}
    </GroupActionMenu>
  );
}
