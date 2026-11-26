import { useEffect, useState } from "react";
import { useLocation, useNavigationType } from "react-router";

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

/**
 * Clase de entrada para la raíz de una pestaña (Gente, Grupos, Mensajes, Yo).
 * Cambiar de pestaña es un fundido corto, sin deslizar, como en las apps nativas.
 * Volver a la pestaña con el botón de la app sí entra desde la izquierda, y deslizar entre pestañas no suma nada.
 */
export function useTabTransition() {
  return useEntryClass("page--tab");
}

/**
 * Va una vez, fuera de las rutas: si la pantalla a la que se llegó no usa estas clases (Entrar, Admin),
 * la intención se olvida y no se le pega a la próxima.
 */
export function useForgetPageIntent() {
  const { key } = useLocation();
  useEffect(() => {
    intent = null;
  }, [key]);
}
