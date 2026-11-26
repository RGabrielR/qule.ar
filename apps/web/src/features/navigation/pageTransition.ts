import { useEffect, useState } from "react";
import { useNavigationType } from "react-router";

// Volver con el botón de la app: la pantalla anterior entra desde la izquierda.
let backIntent = false;

/** Llamalo justo antes de navegar hacia atrás desde un botón Volver. */
export function markBack() {
  backIntent = true;
}

/**
 * Clase de entrada para una pantalla (ver `.page--forward` y `.page--back` en styles.css).
 * Entrar a una pantalla la desliza desde la derecha; volver con el botón de la app, desde la izquierda.
 * Volver con el gesto o el botón del sistema no anima: Safari ya hace su propia transición y se verían dos.
 */
export function usePageTransition() {
  const type = useNavigationType();
  const [className] = useState(() => (backIntent ? "page--back" : type === "PUSH" ? "page--forward" : ""));
  useEffect(() => {
    backIntent = false;
  }, []);
  return className;
}
