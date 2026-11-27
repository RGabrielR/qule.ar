import { useRef, type CSSProperties } from "react";

// Hasta cuántos escalones se escalona una tanda; los que siguen entran con el último
const MAX_STEP = 10;
// Lo que dura la entrada más larga de una tanda (10 × --stagger + --dur-base), con margen.
// Pasado eso, si la fila se vuelve a montar (un filtro, un reordenamiento) ya no se anima.
const WINDOW_MS = 1000;

type Step = { i: number; at: number };
const QUIET: Step = { i: 0, at: -Infinity };
const NONE = { className: "" };

/**
 * Entrada escalonada de lo que llega a una lista (`.arrive` en styles.css, ver "Movimiento" en docs/LOOK.md).
 *
 * - Lo que ya estaba cuando se abrió la pantalla (datos guardados de antes) no se anima.
 * - `quietFirst`: la primera tanda que llegue tampoco (por ejemplo, al volver a una lista que ya se había visto).
 * - Lo que llega después entra escalonado dentro de su tanda, una sola vez: las actualizaciones en vivo no
 *   vuelven a animar lo que ya estaba.
 * - `batch`: cuando cambia (otros filtros), lo que llegue con la lista nueva vuelve a entrar entero.
 *
 * - `columns`: en una grilla, el escalonado va en diagonal (fila + columna), así la tanda entra como una ola corta
 *   en vez de ficha por ficha.
 *
 * `ids` es `null` mientras no llegó nada. Devuelve, para cada id, la clase y el `--i` del escalonado.
 */
export function useArrival(
  ids: readonly string[] | null | undefined,
  { quietFirst = false, batch, columns }: { quietFirst?: boolean; batch?: string; columns?: number } = {},
) {
  const state = useRef<{ seen: Map<string, Step>; quiet: boolean; batch?: string } | null>(null);
  const now = performance.now();
  if (!state.current) state.current = { seen: new Map(), quiet: quietFirst || Boolean(ids?.length), batch };
  const current = state.current;
  if (ids) {
    if (batch !== current.batch) {
      current.seen.clear();
      current.batch = batch;
    }
    let step = 0;
    for (const id of ids) {
      if (current.seen.has(id)) continue;
      const n = step++;
      const i = columns ? Math.floor(n / columns) + (n % columns) : n;
      current.seen.set(id, current.quiet ? QUIET : { i: Math.min(i, MAX_STEP), at: now });
    }
    current.quiet = false;
  }
  return (id: string): { className: string; style?: CSSProperties } => {
    const s = current.seen.get(id);
    if (!s || now - s.at > WINDOW_MS) return NONE;
    return { className: "arrive", style: { "--i": s.i } as CSSProperties };
  };
}
