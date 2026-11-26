import { useLayoutEffect, useRef, type TouchEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { markTabSwipe } from "./pageTransition";

export const TAB_PATHS = ["/cerca", "/grupos", "/mensajes", "/yo"] as const;
const EDGE_GUTTER = 24;
const SWIPE_DISTANCE = 64;

export function useTabSwipe() {
  const { pathname, key } = useLocation();
  const navigate = useNavigate();
  const index = TAB_PATHS.findIndex((path) => path === pathname);
  const main = useRef<HTMLElement>(null);
  const start = useRef<{ x: number; y: number; key: string; horizontal: boolean } | null>(null);
  const offset = useRef(0);
  const nextOffset = useRef(0);
  const animation = useRef<Animation | undefined>(undefined);

  function slideToRest(from: number) {
    animation.current?.cancel();
    if (!from || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    animation.current = main.current?.animate(
      [{ translate: `${from}px` }, { translate: "0" }],
      { duration: 190, easing: "ease-out" },
    );
  }

  function resetOffset() {
    const previous = offset.current;
    offset.current = 0;
    main.current?.style.removeProperty("translate");
    return previous;
  }

  useLayoutEffect(() => {
    start.current = null;
    resetOffset();
    slideToRest(nextOffset.current);
    nextOffset.current = 0;
    return () => animation.current?.cancel();
  }, [key]);

  function cancel() {
    start.current = null;
    const previous = resetOffset();
    if (previous) slideToRest(previous);
  }

  function onTouchStart(event: TouchEvent<HTMLElement>) {
    cancel();
    if (index < 0 || event.touches.length !== 1) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest("input, textarea, select, [contenteditable], [role=dialog], .sheet-backdrop, .lightbox")) return;
    const { clientX, clientY } = event.touches[0];
    if (clientX <= EDGE_GUTTER || clientX >= document.documentElement.clientWidth - EDGE_GUTTER) return;
    animation.current?.cancel();
    start.current = { x: clientX, y: clientY, key, horizontal: false };
  }

  function onTouchMove(event: TouchEvent<HTMLElement>) {
    const from = start.current;
    if (!from || !main.current) return;
    if (event.touches.length !== 1) return cancel();
    const { clientX, clientY } = event.touches[0];
    const dx = clientX - from.x;
    const dy = Math.abs(clientY - from.y);
    if (!from.horizontal) {
      if (dy > 12 && dy > Math.abs(dx)) return cancel();
      if (Math.abs(dx) < 10 || Math.abs(dx) < dy * 1.5) return;
      from.horizontal = true;
    }
    const hasNeighbor = Boolean(TAB_PATHS[index + (dx < 0 ? 1 : -1)]);
    const limit = hasNeighbor ? main.current.clientWidth * 0.55 : 36;
    offset.current = Math.sign(dx) * Math.min(Math.abs(dx) * (hasNeighbor ? 1 : 0.2), limit);
    main.current.style.translate = `${offset.current}px`;
  }

  function onTouchEnd(event: TouchEvent<HTMLElement>) {
    const from = start.current;
    const touch = event.changedTouches[0];
    if (!from?.horizontal || from.key !== key || !touch || event.touches.length) return cancel();
    const { clientX, clientY } = touch;
    const dx = clientX - from.x;
    const dy = clientY - from.y;
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return cancel();
    const step = dx < 0 ? 1 : -1;
    const next = TAB_PATHS[index + step];
    if (!next || !main.current) return cancel();
    start.current = null;
    nextOffset.current = step * (main.current.clientWidth - Math.abs(offset.current));
    // La pestaña nueva ya entra deslizándose: sin el fundido de cambiar de pestaña
    markTabSwipe();
    void navigate(next);
  }

  return { main, enabled: index >= 0, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: cancel };
}
