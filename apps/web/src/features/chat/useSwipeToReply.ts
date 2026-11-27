import { useRef, type HTMLAttributes } from "react";

const MOVE_TOLERANCE = 10;
/** Cuánto hay que arrastrar para que cuente, y hasta dónde llega la fila. */
const REPLY_AT = 64;
const REPLY_MAX = 96;
/** Desde el borde izquierdo de la pantalla es el gesto de volver del sistema (iOS): ahí no se arranca. */
const EDGE = 24;

/** Un deslizamiento en curso. `active`: ya se decidió que es para responder (y no para desplazar la lista). */
type Swipe = { pointerId: number; x: number; y: number; el: HTMLElement; active: boolean; armed: boolean };

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** La fila sigue al dedo hasta REPLY_AT y después cuesta más (como una goma), sin pasar de REPLY_MAX. */
function swipeOffset(dx: number) {
  const pulled = dx <= REPLY_AT ? dx : REPLY_AT + (dx - REPLY_AT) * 0.3;
  return Math.max(0, Math.min(REPLY_MAX, pulled));
}

function showSwipe(el: HTMLElement, dx: number) {
  const icon = el.querySelector<HTMLElement>(":scope > .swipe-reply");
  const progress = Math.min(1, Math.max(0, dx) / REPLY_AT);
  el.style.translate = dx > 0 ? `${swipeOffset(dx)}px 0` : "";
  if (icon) {
    icon.style.opacity = String(progress);
    icon.style.scale = String(0.5 + 0.5 * progress);
  }
}

/**
 * Deslizar la fila de un mensaje para la derecha lo responde, como en WhatsApp: se arrastra la fila entera (no solo
 * el globo), sea un mensaje propio o ajeno. Dentro de la fila va un `.swipe-reply` con el ícono, que aparece al tirar.
 * Con el mouse no: ahí está "Responder" en el menú del mensaje.
 */
export function useSwipeToReply() {
  const swipe = useRef<Swipe | null>(null);
  const suppressClick = useRef(false);

  /** Termina el deslizamiento: la fila vuelve a su lugar y, si había llegado, se responde. */
  function end(pointerId: number, reply: () => void, released: boolean) {
    const current = swipe.current;
    if (!current || current.pointerId !== pointerId) return;
    swipe.current = null;
    if (!current.active) return;
    current.el.classList.remove("message-swipe--dragging");
    current.el.classList.toggle("message-swipe--snap", !reducedMotion());
    showSwipe(current.el, 0);
    if (released && current.armed) reply();
  }

  return (onReply?: () => void): HTMLAttributes<HTMLDivElement> => onReply ? {
    onPointerDown(event) {
      suppressClick.current = false;
      const { pointerId, clientX, clientY, currentTarget, pointerType, isPrimary, button } = event;
      swipe.current = isPrimary && button === 0 && pointerType !== "mouse" && clientX > EDGE
        ? { pointerId, x: clientX, y: clientY, el: currentTarget, active: false, armed: false }
        : null;
    },
    onPointerMove(event) {
      const current = swipe.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (!current.active) {
        // Para arriba o abajo es desplazar la lista: el deslizamiento no va
        if (Math.abs(dy) > MOVE_TOLERANCE && Math.abs(dy) >= Math.abs(dx)) {
          swipe.current = null;
          return;
        }
        if (dx < MOVE_TOLERANCE || dx < Math.abs(dy) * 1.5) return;
        current.active = true;
        suppressClick.current = true;
        current.el.setPointerCapture(event.pointerId);
        current.el.classList.remove("message-swipe--snap");
        current.el.classList.add("message-swipe--dragging");
      }
      showSwipe(current.el, dx);
      const armed = dx >= REPLY_AT;
      // Un toquecito al llegar (en los celus que vibran)
      if (armed && !current.armed) navigator.vibrate?.(10);
      current.armed = armed;
    },
    onPointerUp: (event) => end(event.pointerId, onReply, true),
    onPointerCancel: (event) => end(event.pointerId, onReply, false),
    onClickCapture(event) {
      if (!suppressClick.current || event.detail === 0) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  } : {};
}

/** Junta los gestos de dos hooks sobre el mismo elemento: si los dos escuchan un evento, se llaman los dos. */
export function mergeGestures(a: HTMLAttributes<HTMLDivElement>, b: HTMLAttributes<HTMLDivElement>): HTMLAttributes<HTMLDivElement> {
  const merged: Record<string, unknown> = { ...a, ...b };
  for (const key of Object.keys(b)) {
    const first = (a as Record<string, unknown>)[key];
    const second = (b as Record<string, unknown>)[key];
    if (typeof first === "function" && typeof second === "function") {
      merged[key] = (...args: unknown[]) => {
        (first as (...x: unknown[]) => void)(...args);
        (second as (...x: unknown[]) => void)(...args);
      };
    }
  }
  return merged as HTMLAttributes<HTMLDivElement>;
}
