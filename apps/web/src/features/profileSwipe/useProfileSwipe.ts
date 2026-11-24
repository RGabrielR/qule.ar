import { useCallback, useEffect, useLayoutEffect, useRef, useState, type TouchEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { useMe } from "../../App";
import { getGridList, loadMoreGrid, type GridList } from "./gridList";

/** Lo que viaja en el estado del historial al pasar de un perfil a otro. */
type SwipeState = { nearbyEntry?: unknown; enterFrom?: unknown; focus?: unknown };
export type SwipeFocus = "prev" | "next";

// Los primeros píxeles de cada borde son del sistema (el "atrás" de iOS y Android).
const EDGE_GUTTER = 24;
const SWIPE_DISTANCE = 72;
const NUDGE = 48;
const PREFETCH_FROM_END = 3;
const IGNORE = "input, textarea, select, [contenteditable], [role=dialog], .sheet-backdrop, .lightbox";
const TYPING = "input, textarea, select, [contenteditable]";

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Si el dedo empieza sobre algo que ya se desliza de costado (chips, filtros), el gesto es de eso. */
function inSideScroller(target: Element, stop: Element) {
  for (let node: Element | null = target; node && node !== stop; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
  }
  return false;
}

/**
 * Pasar al perfil anterior o siguiente de la grilla de Gente, con el dedo, las flechas o los botones.
 * Solo se activa si llegaste al perfil desde la grilla: en cualquier otro caso no hace nada.
 */
export function useProfileSwipe(id: string, enabled: boolean) {
  const { state } = useLocation();
  const navigate = useNavigate();
  const { me } = useMe();
  const userId = me?.user.id;
  const swipeState = (state ?? {}) as SwipeState;
  const entry = typeof swipeState.nearbyEntry === "string" ? swipeState.nearbyEntry : undefined;
  const [enterFrom] = useState(() => (typeof swipeState.enterFrom === "number" ? swipeState.enterFrom : 0));
  const [focus] = useState<SwipeFocus | undefined>(() => (swipeState.focus === "prev" || swipeState.focus === "next" ? swipeState.focus : undefined));
  const [list, setList] = useState<GridList | undefined>(() => getGridList(entry, userId));
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const page = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; horizontal: boolean } | null>(null);
  const offset = useRef(0);
  const animation = useRef<Animation | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => setList(getGridList(entry, userId)), [entry, userId]);

  const index = list ? list.people.findIndex((p) => p.id === id) : -1;
  const active = Boolean(list && entry && index >= 0);
  const current = active ? list!.people[index] : undefined;
  const prev = active && index > 0 ? list!.people[index - 1] : undefined;
  const next = active ? list!.people[index + 1] : undefined;
  const hasMore = Boolean(active && list!.hasMore);

  const loadMore = useCallback(async () => {
    if (!entry) return undefined;
    setLoading(true);
    setFailed(false);
    try {
      const fresh = await loadMoreGrid(entry);
      if (mounted.current) setList(fresh);
      return fresh;
    } catch {
      if (mounted.current) setFailed(true);
      return undefined;
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [entry]);

  // Cerca del final de lo cargado, se pide la página siguiente para que el próximo perfil ya esté.
  useEffect(() => {
    if (active && hasMore && index >= list!.people.length - PREFETCH_FROM_END) void loadMore();
  }, [active, hasMore, index, list, loadMore]);

  // El perfil nuevo entra desde el lado hacia el que deslizaste.
  useLayoutEffect(() => {
    if (!enterFrom || !page.current || reducedMotion()) return;
    const small = Math.abs(enterFrom) <= NUDGE;
    const run = page.current.animate(
      [{ translate: `${enterFrom}px`, opacity: small ? 0.4 : 1 }, { translate: "0", opacity: 1 }],
      { duration: small ? 160 : 190, easing: "ease-out" },
    );
    return () => run.cancel();
  }, [enterFrom]);

  function snapBack() {
    const from = offset.current;
    offset.current = 0;
    page.current?.style.removeProperty("translate");
    animation.current?.cancel();
    if (!from || !page.current || reducedMotion()) return;
    animation.current = page.current.animate([{ translate: `${from}px` }, { translate: "0" }], { duration: 190, easing: "ease-out" });
  }

  function cancel() {
    start.current = null;
    snapBack();
  }

  const go = useCallback(async (step: 1 | -1, how: "swipe" | "key" | "button", dragged = 0) => {
    if (!entry || !list) return;
    let target = step < 0 ? prev : next;
    if (!target && step > 0 && hasMore) {
      const fresh = await loadMore();
      if (!mounted.current || !fresh) return;
      target = fresh.people[fresh.people.findIndex((p) => p.id === id) + 1];
    }
    if (!target) return;
    const width = page.current?.clientWidth ?? 0;
    const from = how === "swipe" && width ? step * (width - Math.abs(dragged)) : step * NUDGE;
    void navigate(`/perfil/${target.id}`, {
      replace: true,
      state: { nearbyEntry: entry, enterFrom: from, focus: how === "button" ? (step < 0 ? "prev" : "next") : undefined },
    });
  }, [entry, list, prev, next, hasMore, loadMore, id, navigate]);

  // Flechas del teclado, salvo que estés escribiendo o haya algo abierto encima (fotos, reportes).
  useEffect(() => {
    if (!active || !enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.target instanceof Element && e.target.closest(TYPING)) return;
      if (document.querySelector("[role=dialog], [aria-modal]")) return;
      e.preventDefault();
      void go(e.key === "ArrowLeft" ? -1 : 1, "key");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, enabled, go]);

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    cancel();
    if (!active || !enabled || event.touches.length !== 1) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest(IGNORE) || inSideScroller(target, event.currentTarget)) return;
    const { clientX, clientY } = event.touches[0];
    if (clientX <= EDGE_GUTTER || clientX >= document.documentElement.clientWidth - EDGE_GUTTER) return;
    animation.current?.cancel();
    start.current = { x: clientX, y: clientY, horizontal: false };
  }

  function onTouchMove(event: TouchEvent<HTMLDivElement>) {
    const from = start.current;
    if (!from || !page.current) return;
    if (event.touches.length !== 1) return cancel();
    const { clientX, clientY } = event.touches[0];
    const dx = clientX - from.x;
    const dy = Math.abs(clientY - from.y);
    if (!from.horizontal) {
      // Si arrancó para arriba o para abajo, es scroll y no se toca.
      if (dy > 12 && dy > Math.abs(dx)) return cancel();
      if (Math.abs(dx) < 10 || Math.abs(dx) < dy * 1.5) return;
      from.horizontal = true;
    }
    const hasNeighbor = dx > 0 ? Boolean(prev) : Boolean(next) || hasMore;
    const limit = hasNeighbor ? page.current.clientWidth * 0.55 : 36;
    offset.current = Math.sign(dx) * Math.min(Math.abs(dx) * (hasNeighbor ? 1 : 0.2), limit);
    page.current.style.translate = `${offset.current}px`;
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const from = start.current;
    const touch = event.changedTouches[0];
    if (!from?.horizontal || !touch || event.touches.length) return cancel();
    const dx = touch.clientX - from.x;
    const dy = touch.clientY - from.y;
    const dragged = offset.current;
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return cancel();
    const step = dx < 0 ? 1 : -1;
    const hasTarget = step < 0 ? Boolean(prev) : Boolean(next);
    start.current = null;
    // Sin el perfil a mano (hay que traer otra página), vuelve a su lugar mientras carga.
    if (!hasTarget) snapBack();
    void go(step, "swipe", hasTarget ? dragged : 0);
  }

  return {
    active,
    current,
    prev,
    next,
    hasMore,
    loading,
    failed,
    position: index + 1,
    total: list?.people.length ?? 0,
    focus,
    go,
    page,
    handlers: active ? { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: cancel } : {},
  };
}

export type ProfileSwipe = ReturnType<typeof useProfileSwipe>;
