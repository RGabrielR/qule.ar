import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { CheckIcon, RefreshIcon } from "../../components/Icons";

const REFRESH_DISTANCE = 100;

/**
 * Tirar hacia abajo desde arriba de todo para actualizar una pestaña, igual que en Gente.
 * Mientras está la indicadora, la página y el documento no rebotan: así el encabezado y la barra de pestañas
 * quedan quietos cuando se arrastra de más hacia arriba o hacia abajo (ver .pull-refresh en styles.css).
 */
export function usePullToRefresh(pageRef: RefObject<HTMLElement | null>, onRefresh: () => Promise<unknown>) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pull = useRef<{ x: number; y: number; distance: number } | null>(null);
  const busy = useRef(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  const cancelPull = useCallback(() => {
    pull.current = null;
    setPullDistance(0);
  }, []);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    let alive = true;

    const start = (event: TouchEvent) => {
      if (busy.current || page.scrollTop > 0 || event.touches.length !== 1) {
        cancelPull();
        return;
      }
      const { clientX, clientY } = event.touches[0];
      pull.current = { x: clientX, y: clientY, distance: 0 };
    };

    const move = (event: TouchEvent) => {
      const gesture = pull.current;
      if (!gesture) return;
      if (event.touches.length !== 1 || page.scrollTop > 0) {
        cancelPull();
        return;
      }
      const { clientX, clientY } = event.touches[0];
      const down = clientY - gesture.y;
      const sideways = Math.abs(clientX - gesture.x);
      if (down < -8 || (sideways > 12 && sideways > down)) {
        cancelPull();
        return;
      }
      // Evita que el navegador convierta en scroll el movimiento de vuelta del mismo arrastre.
      if ((gesture.distance > 0 || down > sideways) && event.cancelable) event.preventDefault();
      gesture.distance = Math.max(0, Math.min(down, REFRESH_DISTANCE));
      setPullDistance(gesture.distance);
    };

    const end = () => {
      const gesture = pull.current;
      cancelPull();
      if (gesture?.distance !== REFRESH_DISTANCE || busy.current) return;
      busy.current = true;
      setRefreshing(true);
      refresh.current().catch(() => {}).finally(() => {
        busy.current = false;
        if (alive) setRefreshing(false);
      });
    };

    page.addEventListener("touchstart", start, { passive: true });
    page.addEventListener("touchmove", move, { passive: false });
    page.addEventListener("touchend", end);
    page.addEventListener("touchcancel", cancelPull);
    return () => {
      alive = false;
      page.removeEventListener("touchstart", start);
      page.removeEventListener("touchmove", move);
      page.removeEventListener("touchend", end);
      page.removeEventListener("touchcancel", cancelPull);
    };
  }, [pageRef, cancelPull]);

  const ready = pullDistance === REFRESH_DISTANCE;
  const progress = pullDistance / REFRESH_DISTANCE;
  const height = refreshing ? REFRESH_DISTANCE : pullDistance;

  return (
    <>
      <div
        className={`pull-refresh${ready || refreshing ? " pull-refresh--ready" : ""}${pullDistance > 0 ? " pull-refresh--pulling" : ""}`}
        aria-hidden="true"
        style={{ height }}
      >
        <span
          className={refreshing ? "pull-refresh__spin" : undefined}
          style={refreshing ? undefined : { transform: `rotate(${(progress - 1) * 270}deg)` }}
        >
          {ready ? <CheckIcon /> : <RefreshIcon />}
        </span>
      </div>
      <p className="sr-only" role="status">{refreshing ? "Actualizando…" : ready ? "Soltá para actualizar" : ""}</p>
    </>
  );
}
