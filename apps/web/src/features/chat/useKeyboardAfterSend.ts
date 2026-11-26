import { useRef, type RefObject } from "react";

/**
 * Tocar "Mandar" le saca el foco al campo y cierra el teclado. Si estaba abierto, se lo devolvemos para seguir
 * escribiendo; si estaba cerrado (por ejemplo, después de bajarlo para leer), no lo abrimos.
 */
export function useKeyboardAfterSend(inputRef: RefObject<HTMLTextAreaElement | null>) {
  const wasOpen = useRef(false);
  return {
    /** Para el botón de mandar: se fija si el campo tenía el foco antes de que el toque se lo saque. */
    onPointerDown: () => {
      wasOpen.current = document.activeElement === inputRef.current;
    },
    /** Al mandar: devuelve el foco solo si el teclado estaba abierto. */
    restore: () => {
      if (wasOpen.current) inputRef.current?.focus({ preventScroll: true });
      wasOpen.current = false;
    },
  };
}
