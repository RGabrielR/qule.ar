import { useLayoutEffect, type RefObject } from "react";
import { motionMs } from "../../motion";

/** Hasta cuánto del final cuenta como "estar al final" (iOS deja la lista unos px corrida mientras sube el teclado). */
const END_SLACK = 40;
/** Lo que se espera sin cambios de tamaño para dar por terminado el movimiento del teclado. */
const SETTLE_MS = 150;

/**
 * Al abrir o cerrar el teclado, el borde de abajo de la lista del chat queda fijo, como en cualquier app de
 * mensajería: lo último que se veía sigue pegado al campo de texto. Si estabas al final, seguís al final.
 * La conversación se desliza hasta ahí (--dur-sheet), en vez de saltar de golpe, al abrir y al cerrar.
 *
 * `followWhenStuck`: si estabas al final, también seguís al final cuando la lista cambia de alto por otra cosa (crece
 * el campo de texto). En los grupos no, porque ahí el salto a una cita mueve la lista por su cuenta.
 * `mounted`: cambialo cuando la lista aparece o se reemplaza (por ejemplo, después de cargar el grupo).
 */
export function useBottomAnchor(
  listRef: RefObject<HTMLDivElement | null>,
  stickToBottom: RefObject<boolean>,
  { followWhenStuck = false, mounted = true }: { followWhenStuck?: boolean; mounted?: unknown } = {},
) {
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let height = list.clientHeight;
    // Si estaba al final cuando empezó a moverse el teclado (el teclado de iOS sube en varios pasos)
    let endBeforeKeyboard: boolean | null = null;
    let settle = 0;
    let frame = 0;
    let gliding = false;
    // Espacio de más abajo de la lista mientras se desliza al cerrar el teclado (ver glide)
    let extra = 0;
    const basePadding = parseFloat(getComputedStyle(list).paddingBottom) || 0;
    const setExtra = (px: number) => {
      extra = px > 0.5 ? px : 0;
      if (extra) list.style.paddingBottom = `${basePadding + extra}px`;
      else list.style.removeProperty("padding-bottom");
    };
    const atEnd = (clientHeight: number) => stickToBottom.current || list.scrollHeight - list.scrollTop - clientHeight < END_SLACK;
    /** El final de la conversación, sin contar el espacio de más. */
    const bottom = () => list.scrollHeight - extra - list.clientHeight;

    const stopGlide = () => {
      cancelAnimationFrame(frame);
      gliding = false;
      setExtra(0);
    };
    /**
     * Desliza la conversación desde `from` hasta `target`. Al cerrar el teclado la lista crece y el navegador la
     * acomoda al final en el acto: `extraFrom` es el espacio que se suma abajo para que siga donde estaba, y se achica
     * mientras baja. Sin tocar stickToBottom: lo recalcula cada chat al desplazarse.
     */
    const glide = (target: () => number, from: number, extraFrom = 0) => {
      stopGlide();
      const duration = motionMs("--dur-sheet");
      if (!duration || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        list.scrollTop = target();
        return;
      }
      setExtra(extraFrom);
      list.scrollTop = from;
      const start = performance.now();
      gliding = true;
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - t) ** 3;
        setExtra(extraFrom * (1 - eased));
        // El destino se vuelve a leer en cada cuadro: si el teclado sigue moviéndose, cambia
        list.scrollTop = from + (target() - from) * eased;
        if (t < 1) frame = requestAnimationFrame(step);
        else gliding = false;
      };
      frame = requestAnimationFrame(step);
    };

    const observer = new ResizeObserver(() => {
      const next = list.clientHeight;
      if (next === height) return;
      const before = height;
      height = next;
      if (endBeforeKeyboard === null) {
        // Un cambio que no trae el teclado: lo maneja cada chat
        if (followWhenStuck && stickToBottom.current) list.scrollTop = list.scrollHeight;
        return;
      }
      if (next < before) {
        // Se abre: la lista se achica por abajo y la conversación sube
        const from = list.scrollTop;
        const target = from + before - next;
        glide(endBeforeKeyboard ? bottom : () => Math.min(target, bottom()), from);
      } else {
        // Se cierra: la lista crece por abajo y la conversación baja. Si estaba al final, el navegador ya la corrió:
        // se vuelve a donde estaba (con espacio de más abajo) y se desliza desde ahí.
        const max = bottom();
        const from = endBeforeKeyboard ? max + next - before : list.scrollTop;
        const target = Math.max(0, from - (next - before));
        glide(endBeforeKeyboard ? bottom : () => Math.min(target, bottom()), from, Math.max(0, from - max));
      }
    });
    observer.observe(list);

    // Cuando el teclado termina de moverse, si estaba al final, que quede bien pegado (iOS puede correr la lista
    // un poco después del último cambio de tamaño)
    const viewport = window.visualViewport;
    const onViewportResize = () => {
      endBeforeKeyboard ??= atEnd(height);
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        // Si todavía se está deslizando, ya va al final (lo vuelve a leer en cada cuadro)
        if (endBeforeKeyboard && !gliding && bottom() - list.scrollTop > 1) glide(bottom, list.scrollTop);
        endBeforeKeyboard = null;
      }, SETTLE_MS);
    };
    viewport?.addEventListener("resize", onViewportResize);
    // Si quien usa la app toca o desliza la lista, manda su dedo
    list.addEventListener("pointerdown", stopGlide);
    list.addEventListener("wheel", stopGlide, { passive: true });
    return () => {
      observer.disconnect();
      viewport?.removeEventListener("resize", onViewportResize);
      list.removeEventListener("pointerdown", stopGlide);
      list.removeEventListener("wheel", stopGlide);
      window.clearTimeout(settle);
      stopGlide();
    };
  }, [listRef, stickToBottom, followWhenStuck, mounted]);
}
