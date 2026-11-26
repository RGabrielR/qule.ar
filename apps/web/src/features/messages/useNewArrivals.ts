import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Más que esto de golpe no es un mensaje en vivo: es una tanda (historial, reconexión, otra página). */
const MAX_LIVE = 3;
const NONE: ReadonlySet<string> = new Set();

/**
 * Los mensajes que llegaron (o mandaste) después de abrir el chat, para que entren con `rise-in`.
 * El historial inicial, lo que se carga al subir y los saltos a una cita no cuentan: solo lo nuevo que
 * se suma al final de a poco. `keys` es la lista en el orden en que se muestra; `scope`, el chat abierto.
 * Al terminar la animación, `settle` saca la marca para que no se repita si la burbuja cambia de clase.
 */
export function useNewArrivals(keys: readonly string[], ready: boolean, scope: string) {
  const known = useRef<{ scope: string; keys: Set<string>; last?: string } | null>(null);
  const [arrivals, setArrivals] = useState(NONE);

  useLayoutEffect(() => {
    const prev = known.current;
    if (!ready || !prev || prev.scope !== scope) {
      // Hasta que llega el historial (o al cambiar de chat) se toma de nuevo la base, sin animar nada.
      known.current = ready ? { scope, keys: new Set(keys), last: keys.at(-1) } : null;
      setArrivals((a) => (a.size ? NONE : a));
      return;
    }
    const added = keys.filter((k) => !prev.keys.has(k));
    if (!added.length) return;
    for (const k of added) prev.keys.add(k);
    const lastIndex = prev.last === undefined ? -1 : keys.indexOf(prev.last);
    const atTail = (prev.last === undefined || lastIndex >= 0) && added.every((k) => keys.indexOf(k) > lastIndex);
    prev.last = keys.at(-1);
    if (atTail && added.length <= MAX_LIVE) setArrivals((a) => new Set([...a, ...added]));
  }, [keys, ready, scope]);

  const settle = useCallback((key: string) => {
    setArrivals((a) => {
      if (!a.has(key)) return a;
      const next = new Set(a);
      next.delete(key);
      return next;
    });
  }, []);

  return { arrivals, settle };
}
