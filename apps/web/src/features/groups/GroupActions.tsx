import { useState } from "react";
import { Link } from "react-router";
import type { GroupInfo } from "../../api";
import { groupPath } from "./groupLink";
import { GroupActionMenu } from "./GroupActionMenu";
import { setGroupMuted } from "./groupNotifications";

export function GroupActions({ group, onMutedChange, onLinkCopied, onError }: {
  group: GroupInfo;
  onMutedChange: (muted: boolean) => void;
  onLinkCopied: () => void;
  onError: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const infoPath = `/grupos/${group.id}/info`;
  const canManageRequests = !group.isGeneral && (group.role === "owner" || group.role === "moderator");
  const hasPendingRequests = canManageRequests && group.pendingCount > 0;

  async function share() {
    const url = new URL(groupPath(group.id), window.location.origin).href;
    try {
      if (navigator.share) {
        await navigator.share({ title: group.name, url });
      } else {
        await navigator.clipboard.writeText(url);
        onLinkCopied();
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      onError("No se pudo compartir el grupo. Probá de nuevo.");
    }
  }

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
          <button type="button" onClick={() => { close(); void share(); }}>Compartir grupo</button>
          <button type="button" aria-disabled={saving} onClick={toggleNotifications}>
            {group.muted ? "Reactivar notificaciones" : "Silenciar notificaciones"}
          </button>
        </>
      )}
    </GroupActionMenu>
  );
}
