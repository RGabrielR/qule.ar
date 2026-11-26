import { useCallback, useEffect, useRef, useState } from "react";
import { motionMs } from "../motion";

/**
 * Salida de una hoja (`.sheet-backdrop` + `.sheet`): `close()` marca el fondo con `data-closing`, la hoja baja y el
 * fondo se funde, y recién al terminar llama a `onClose` (o a `then`, si se pasa: por ejemplo, aplicar los filtros).
 * Mientras sale no se puede tocar, así un toque rápido pasa a la pantalla de abajo, y un segundo cierre no hace nada.
 * Va con `<div className="sheet-backdrop" {...backdrop}>` y `<DialogFocus onClose={close} />` (Escape también anima).
 */
export function useSheetExit(onClose: () => void) {
  const [closing, setClosing] = useState(false);
  const done = useRef(onClose);
  done.current = onClose;
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const close = useCallback((then?: () => void) => {
    if (timer.current !== undefined) return;
    setClosing(true);
    timer.current = window.setTimeout(() => {
      // Si la hoja vive dentro de un componente que sigue montado (un botón con su hoja), queda lista para abrirse otra vez
      timer.current = undefined;
      setClosing(false);
      (then ?? done.current)();
    }, motionMs("--dur-base")); // igual que `.sheet-backdrop[data-closing]` en styles.css
  }, []);

  return { closing, close, backdrop: { "data-closing": closing ? "" : undefined, onClick: () => close() } };
}
