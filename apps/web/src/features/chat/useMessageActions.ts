import { useEffect, useRef, type HTMLAttributes } from "react";

const HOLD_MS = 500;
const MOVE_TOLERANCE = 10;

function isControl(target: EventTarget) {
  return target instanceof Element && Boolean(target.closest("a, button, input, [role='menu']"));
}

type Press = { pointerId: number; x: number; y: number; timer: number };

export function useMessageActions(openId: string | null, setOpenId: (id: string | null) => void) {
  const press = useRef<Press | null>(null);
  const suppressClickFor = useRef<string | null>(null);

  function cancelPress(pointerId?: number) {
    if (!press.current || (pointerId !== undefined && press.current.pointerId !== pointerId)) return;
    window.clearTimeout(press.current.timer);
    press.current = null;
  }

  useEffect(() => () => cancelPress(), []);

  return (id: string): HTMLAttributes<HTMLDivElement> => ({
    tabIndex: 0,
    "aria-haspopup": "menu",
    "aria-expanded": openId === id,
    "aria-controls": openId === id ? `message-options-${id}` : undefined,
    "aria-keyshortcuts": "Enter Space Shift+F10 ContextMenu",
    onPointerDown(event) {
      if (!event.isPrimary || event.button !== 0) return;
      cancelPress();
      suppressClickFor.current = null;
      if (isControl(event.target)) return;
      const { pointerId, clientX, clientY, currentTarget } = event;
      const timer = window.setTimeout(() => {
        press.current = null;
        if (!currentTarget.isConnected) return;
        suppressClickFor.current = id;
        setOpenId(id);
        navigator.vibrate?.(15);
      }, HOLD_MS);
      press.current = { pointerId, x: clientX, y: clientY, timer };
    },
    onPointerMove(event) {
      const active = press.current;
      if (active?.pointerId === event.pointerId &&
        Math.hypot(event.clientX - active.x, event.clientY - active.y) > MOVE_TOLERANCE) {
        cancelPress(event.pointerId);
      }
    },
    onPointerUp: (event) => cancelPress(event.pointerId),
    onPointerCancel: (event) => cancelPress(event.pointerId),
    onPointerLeave: (event) => cancelPress(event.pointerId),
    onClickCapture(event) {
      if (suppressClickFor.current !== id || event.detail === 0) return;
      suppressClickFor.current = null;
      event.preventDefault();
      event.stopPropagation();
    },
    onContextMenu(event) {
      if (isControl(event.target)) return;
      event.preventDefault();
      if (press.current) return;
      setOpenId(id);
    },
    onKeyDown(event) {
      if (event.key === "Escape" && openId === id) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus();
        setOpenId(null);
        return;
      }
      if (event.currentTarget !== event.target) return;
      if (event.key !== "Enter" && event.key !== " " && event.key !== "ContextMenu" &&
        !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault();
      const message = event.currentTarget;
      setOpenId(id);
      requestAnimationFrame(() => message.querySelector<HTMLElement>('[role="menu"] button')?.focus());
    },
  });
}
