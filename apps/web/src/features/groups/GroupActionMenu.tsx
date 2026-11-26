import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { DotsIcon } from "../../components/Icons";

export function GroupActionMenu({ hasPendingRequests = false, children }: {
  hasPendingRequests?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const actionsId = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

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
        {children(() => setOpen(false))}
      </div>
    </div>
  );
}
