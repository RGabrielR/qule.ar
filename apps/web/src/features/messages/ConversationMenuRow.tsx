import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { ConversationSummary } from "../../api";
import type { ConversationAction } from "./ConversationActions";
import { ConversationMenu } from "./ConversationMenu";

const HOLD_MS = 500;
const MOVE_TOLERANCE = 10;

export function ConversationMenuRow({ chat, children, positionMenu, onAction }: {
  chat: ConversationSummary;
  children: ReactNode;
  positionMenu: (menu: HTMLDivElement | null) => void;
  onAction: (action: ConversationAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const link = useRef<HTMLAnchorElement>(null);
  const press = useRef<{ pointerId: number; x: number; y: number; timer: number } | null>(null);
  const swallowClick = useRef(false);
  const menuId = `chat-menu-${chat.id}`;

  function cancelPress(pointerId?: number) {
    if (!press.current || (pointerId !== undefined && press.current.pointerId !== pointerId)) return;
    window.clearTimeout(press.current.timer);
    press.current = null;
  }

  useEffect(() => () => cancelPress(), []);

  return (
    <li className="inbox__row">
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
            swallowClick.current = true;
            setOpen(true);
          }, HOLD_MS);
          press.current = { pointerId, x: clientX, y: clientY, timer };
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
      {open && <ConversationMenu id={menuId} className="menu--inbox" anchor={link}
        muted={chat.muted} canModerate={Boolean(chat.other)} positionMenu={positionMenu}
        onAction={onAction} onClose={() => setOpen(false)} />}
    </li>
  );
}
