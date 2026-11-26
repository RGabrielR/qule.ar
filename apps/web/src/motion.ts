/** Una duración de la marca (`--dur-base`, `--dur-sheet`…) en milisegundos, para esperar a que termine una animación. */
export function motionMs(token: `--dur-${string}`) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const ms = raw.endsWith("ms") ? parseFloat(raw) : parseFloat(raw) * 1000;
  return Number.isFinite(ms) ? ms : 0;
}
