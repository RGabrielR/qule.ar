import { useEffect, useState } from "react";
import { useLocation, useNavigationType } from "react-router";
import { motionMs } from "../../motion";

// Cómo se llegó a la pantalla que se está por montar: volviendo con el botón de la app o deslizando entre pestañas.
let intent: "back" | "tab-swipe" | null = null;

/** Llamalo justo antes de navegar hacia atrás desde un botón Volver. */
export function markBack() {
  intent = "back";
}

/** Llamalo antes de cambiar de pestaña con el gesto: el gesto ya mueve la pantalla y no hace falta el fundido. */
export function markTabSwipe() {
  intent = "tab-swipe";
}

function useEntryClass(forward: string) {
  const type = useNavigationType();
  // Se calcula una sola vez al montar: volver a renderizar no repite la animación.
  // La primera pantalla de la app llega con POP y no anima.
  const [className] = useState(() => {
    if (intent === "back") return "page--back";
    if (intent === "tab-swipe") return "";
    return type === "PUSH" ? forward : "";
  });
  useEffect(() => {
    intent = null;
  }, []);
  return className;
}

/**
 * Clase de entrada para una pantalla apilada (ver `.page--forward` y `.page--back` en styles.css).
 * Entrar a una pantalla la desliza desde la derecha; volver con el botón de la app, desde la izquierda.
 * Volver con el gesto o el botón del sistema no anima: Safari ya hace su propia transición y se verían dos.
 */
export function usePageTransition() {
  return useEntryClass("page--forward");
}

/** Para una pantalla que a veces es pestaña y a veces va apilada (Toques: dentro de Gente o desde Yo). */
export function useEntryTransition(asTab: boolean) {
  const stacked = useEntryClass("page--forward");
  const tab = useTabTransition(asTab);
  return asTab ? tab : stacked;
}

/**
 * Clase de entrada para la raíz de una pestaña (Gente, Grupos, Mensajes, Yo).
 * Cambiar de pestaña no desliza, como en las apps nativas: el encabezado queda quieto y el contenido se asienta.
 * Volver a la pestaña con el botón de la app sí entra desde la izquierda, y deslizar entre pestañas no suma nada.
 */
export function useTabTransition(enabled = true) {
  const className = useEntryClass("page--tab");
  // Entre solapas de la misma pestaña (Gente: Cerca y Toques) el encabezado es el mismo: no se vuelve a fundir
  const { pathname } = useLocation();
  const [sameHeader] = useState(() => section(lastPath) === section(pathname));
  // `.page--tab` anima a los hijos directos de la pantalla. Cuando la entrada terminó, la clase se saca: si no, lo
  // que se monte después (una hoja, un aviso, la lista que reemplaza al esqueleto) repetiría la entrada.
  const [entering, setEntering] = useState(enabled && className === "page--tab");
  useEffect(() => {
    if (!entering) return;
    const timer = window.setTimeout(() => setEntering(false), motionMs("--dur-sheet") + 60);
    return () => window.clearTimeout(timer);
  }, [entering]);
  if (className !== "page--tab") return className;
  if (!entering) return "";
  return sameHeader ? "page--tab page--same-header" : "page--tab";
}

// La pantalla anterior, para saber si la nueva comparte el encabezado (la actualiza useForgetPageIntent)
let lastPath: string | null = null;
const section = (path: string | null) => path?.split("/")[1] ?? null;

/**
 * Va una vez, fuera de las rutas: si la pantalla a la que se llegó no usa estas clases (Entrar, Admin),
 * la intención se olvida y no se le pega a la próxima.
 */
export function useForgetPageIntent() {
  const { key, pathname } = useLocation();
  useEffect(() => {
    intent = null;
    lastPath = pathname;
  }, [key, pathname]);
}
