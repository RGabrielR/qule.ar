import { useSyncExternalStore } from "react";

/**
 * Desde este ancho la app usa el diseño de compu: barra lateral en vez de la barra de abajo, y lista y detalle lado a
 * lado en Mensajes, Grupos y Moderación. Tiene que coincidir con el `@media (min-width: 1024px)` de styles.css.
 */
export const DESKTOP_QUERY = "(min-width: 1024px)";

const media = typeof window === "undefined" ? null : window.matchMedia(DESKTOP_QUERY);

function subscribe(onChange: () => void) {
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}

/** true en pantallas anchas (compu, tablet apaisada). Cambia en vivo si se agranda o se achica la ventana. */
export function useDesktop() {
  return useSyncExternalStore(subscribe, () => media?.matches ?? false, () => false);
}
