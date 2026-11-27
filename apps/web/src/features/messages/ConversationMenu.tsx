import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import type { ConversationAction } from "./ConversationActions";

export function ConversationMenu({ id, className, anchor, onClose, muted, canModerate, positionMenu, onAction, focusFirst = true, point }: {
  id: string;
  /** Dónde se apoyó el dedo (coordenadas de pantalla): el menú se corre hasta ahí y se despliega desde ese punto. */
  point?: { x: number; y: number } | null;
  /**
   * Con el teclado, el foco va a la primera opción. Abierto con el dedo (mantener apretado) va al menú en sí: si no,
   * Safari dibuja el anillo de foco en la primera opción y parece que ya estuviera elegida. Las flechas andan igual.
   */
  focusFirst?: boolean;
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
    (focusFirst ? menu.current?.querySelector("button") : menu.current)?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div id={id} className={`menu ${className}`} role="menu" aria-label="Opciones del chat" tabIndex={-1}
      ref={(element) => {
        menu.current = element;
        if (element && point) placeAtPoint(element, point);
        positionMenu?.(element);
      }}
      onKeyDown={onMenuKey} onBlur={(event) => {
        if (event.relatedTarget instanceof Node &&
          !anchor.current?.contains(event.relatedTarget) && !menu.current?.contains(event.relatedTarget)) onClose();
      }}>
      <button type="button" role="menuitem" onClick={() => act("mute")}>{muted ? "Activar avisos" : "Silenciar"}</button>
      <button type="button" role="menuitem" onClick={() => act("remove")} className="danger">Vaciar chat</button>
      {canModerate && <button type="button" role="menuitem" onClick={() => act("block")} className="danger">Bloquear</button>}
      {canModerate && <button type="button" role="menuitem" onClick={() => act("report")}>Reportar</button>}
    </div>
  );
}

/**
 * Corre el menú en horizontal hasta el dedo (sin salirse de la fila) y deja en `--menu-ox` / `--menu-oy` el punto
 * desde el que se despliega (ver @keyframes menu-reveal en styles.css). Arriba o abajo de la fila lo decide positionMenu.
 */
function placeAtPoint(menu: HTMLElement, point: { x: number; y: number }) {
  const row = menu.offsetParent?.getBoundingClientRect();
  if (!row) return;
  const MARGIN = 8;
  const width = menu.offsetWidth;
  const left = Math.min(Math.max(point.x - row.left - width / 2, MARGIN), row.width - width - MARGIN);
  menu.style.left = `${left}px`;
  menu.style.right = "auto";
  menu.style.setProperty("--menu-ox", `${point.x - row.left - left}px`);
  menu.dataset.atPoint = "";
}

