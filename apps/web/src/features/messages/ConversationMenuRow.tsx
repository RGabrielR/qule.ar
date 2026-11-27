import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import type { ConversationSummary } from "../../api";
import type { ConversationAction } from "./ConversationActions";
import { ConversationMenu } from "./ConversationMenu";
import { motionMs } from "../../motion";

// Lo que hay que mantener apretado para abrir el menú (--dur-hold). La fila se achica durante ese tiempo
// (.inbox__row--pressing) y así anticipa que se va a abrir algo, como el menú de contexto de iOS.
const MOVE_TOLERANCE = 10;

export function ConversationMenuRow({ chat, avatar, children, positionMenu, onAction, className, style }: {
  chat: ConversationSummary;
  /** Para la entrada escalonada de la fila (useArrival) */
  className?: string;
  style?: CSSProperties;
  /** La foto va afuera del enlace al chat: abre el perfil. */
  avatar?: ReactNode;
  children: ReactNode;
  positionMenu: (menu: HTMLDivElement | null) => void;
  onAction: (action: ConversationAction) => void;
}) {
  const [open, setOpen] = useState(false);
  // Cómo se abrió: con el teclado el foco va a la primera opción; con el dedo, al menú (ver ConversationMenu)
  const [byKeyboard, setByKeyboard] = useState(false);
  // Dónde se apoyó el dedo: el menú se abre ahí (ver ConversationMenu)
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [pressing, setPressing] = useState(false);
  const link = useRef<HTMLAnchorElement>(null);
  const press = useRef<{ pointerId: number; x: number; y: number; timer: number } | null>(null);
  const swallowClick = useRef(false);
  const menuId = `chat-menu-${chat.id}`;

  function cancelPress(pointerId?: number) {
    if (!press.current || (pointerId !== undefined && press.current.pointerId !== pointerId)) return;
    window.clearTimeout(press.current.timer);
    press.current = null;
    setPressing(false);
  }

  useEffect(() => () => cancelPress(), []);

  return (
    <li className={`inbox__row ${pressing ? "inbox__row--pressing" : ""} ${open ? "inbox__row--menu" : ""} ${className ?? ""}`} style={style}>
      {avatar}
      <Link
        ref={link}
        to={`/mensajes/${chat.id}`}
        className={`inbox__item ${chat.unread ? "inbox__item--unread" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-keyshortcuts="Shift+F10 ContextMenu"
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          cancelPress();
          swallowClick.current = false;
          const { pointerId, clientX, clientY } = event;
          const timer = window.setTimeout(() => {
            press.current = null;
            setPoint({ x: clientX, y: clientY });
            swallowClick.current = true;
            setPressing(false);
            setByKeyboard(false);
            setOpen(true);
            // Un toque corto en los celus que vibran (Android); en iPhone no hace nada
            navigator.vibrate?.(10);
          }, motionMs("--dur-hold"));
          press.current = { pointerId, x: clientX, y: clientY, timer };
          // Solo con el dedo: con el mouse no hace falta anticipar nada
          if (event.pointerType === "touch") setPressing(true);
        }}
        onPointerMove={(event) => {
          const active = press.current;
          if (active?.pointerId === event.pointerId &&
            Math.hypot(event.clientX - active.x, event.clientY - active.y) > MOVE_TOLERANCE) {
            cancelPress(event.pointerId);
          }
        }}
        onPointerUp={(event) => cancelPress(event.pointerId)}
        onPointerLeave={(event) => cancelPress(event.pointerId)}
        onPointerCancel={(event) => cancelPress(event.pointerId)}
        onDragStart={(event) => event.preventDefault()}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
            event.preventDefault();
            setByKeyboard(true);
            setPoint(null);
            setOpen(true);
          }
        }}
        onClick={(event) => {
          if (!swallowClick.current || event.detail === 0) return;
          swallowClick.current = false;
          event.preventDefault();
        }}
      >
        {children}
      </Link>
      {open && <ConversationMenu id={menuId} className="menu--inbox" anchor={link} focusFirst={byKeyboard} point={point}
        muted={chat.muted} canModerate={Boolean(chat.other)} positionMenu={positionMenu}
        onAction={onAction} onClose={() => setOpen(false)} />}
    </li>
  );
}
