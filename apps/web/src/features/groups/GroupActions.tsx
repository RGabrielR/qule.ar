import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import type { GroupInfo } from "../../api";
import { DotsIcon } from "../../components/Icons";
import { groupPath } from "./groupLink";
import { setGroupMuted } from "./groupNotifications";

export function GroupActions({ group, onMutedChange, onLinkCopied, onError }: {
  group: GroupInfo;
  onMutedChange: (muted: boolean) => void;
  onLinkCopied: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const actionsId = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const infoPath = `/grupos/${group.id}/info`;
  const canManageRequests = !group.isGeneral && (group.role === "owner" || group.role === "moderator");
  const hasPendingRequests = canManageRequests && group.pendingCount > 0;

  async function share() {
    setOpen(false);
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

  useEffect(() => {
    if (!open) return;

    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  return (
    <div
      className="group-actions"
      ref={container}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        type="button"
        className="iconbtn iconbtn--badge"
        ref={trigger}
        aria-label={hasPendingRequests && !open ? "Opciones del grupo, hay solicitudes pendientes" : "Opciones del grupo"}
        aria-expanded={open}
        aria-controls={actionsId}
        onClick={() => setOpen(!open)}
      >
        <DotsIcon />
        {hasPendingRequests && !open && <span className="group-actions__dot" aria-hidden="true" />}
      </button>
      <div className="menu group-actions__menu" id={actionsId} hidden={!open}>
        {canManageRequests && (
          <Link className="group-actions__requests" to={`/grupos/${group.id}/solicitudes`} state={{ groupRequestsFrom: "chat" }} onClick={() => setOpen(false)}>
            Solicitudes
            {hasPendingRequests && <span className="badge">{group.pendingCount}</span>}
          </Link>
        )}
        <Link to={infoPath} state={{ fromGroupChat: true }} onClick={() => setOpen(false)}>Ver detalles</Link>
        <button type="button" onClick={share}>Compartir grupo</button>
        <button type="button" aria-disabled={saving} onClick={toggleNotifications}>
          {group.muted ? "Reactivar notificaciones" : "Silenciar notificaciones"}
        </button>
      </div>
    </div>
  );
}
