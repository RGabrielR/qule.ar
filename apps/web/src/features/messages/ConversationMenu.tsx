import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import type { ConversationAction } from "./ConversationActions";

export function ConversationMenu({ id, className, anchor, onClose, muted, canModerate, positionMenu, onAction }: {
  id: string;
  className: string;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  muted: boolean;
  canModerate: boolean;
  positionMenu?: (menu: HTMLDivElement | null) => void;
  onAction: (action: ConversationAction) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menu.current?.querySelector("button")?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !anchor.current?.contains(event.target) && !menu.current?.contains(event.target)) onClose();
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [anchor, onClose]);

  function closeAndFocus() {
    anchor.current?.focus({ preventScroll: true });
    onClose();
  }

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndFocus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      const index = items.findIndex((item) => item === document.activeElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    }
  }

  function act(action: ConversationAction) {
    closeAndFocus();
    onAction(action);
  }

  return (
    <div id={id} className={`menu ${className}`} role="menu" aria-label="Opciones del chat"
      ref={(element) => { menu.current = element; positionMenu?.(element); }}
      onKeyDown={onMenuKey} onBlur={(event) => {
        if (event.relatedTarget instanceof Node &&
          !anchor.current?.contains(event.relatedTarget) && !menu.current?.contains(event.relatedTarget)) onClose();
      }}>
      <button type="button" role="menuitem" onClick={() => act("mute")}>{muted ? "Activar avisos" : "Silenciar"}</button>
      <button type="button" role="menuitem" onClick={() => act("remove")} className="danger">Eliminar chat</button>
      {canModerate && <button type="button" role="menuitem" onClick={() => act("block")} className="danger">Bloquear</button>}
      {canModerate && <button type="button" role="menuitem" onClick={() => act("report")}>Reportar</button>}
    </div>
  );
}
