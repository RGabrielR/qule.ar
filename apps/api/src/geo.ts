/**
 * Privacidad de ubicación.
 *
 * 1. La posición exacta nunca se guarda: se redondea al centro de una celda de ~500 m.
 * 2. La distancia se calcula entre centros de celda y se muestra en tramos gruesos
 *    ("a menos de 1 km", "3 km", "15 km"). Así no se puede triangular a nadie
 *    moviéndose y comparando distancias: lo máximo que se puede saber es la celda.
 */

export { snapToCell } from "../../../packages/geo/cell.js";

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

type Located = { cellLat: number | null; cellLng: number | null; showDistance: boolean };

/**
 * Distancia entre dos personas, solo si las dos tienen ubicación y ninguna la escondió. Si alguna la escondió,
 * es null para todo: no se muestra, pero tampoco se usa para ordenar ni para filtrar. Si se usara para ordenar
 * ("más cerca primero"), cualquiera podría ubicar igual a quien la escondió moviendo su propia ubicación.
 */
export function visibleKm(me: Located, other: Located): number | null {
  if (!me.showDistance || !other.showDistance) return null;
  if (me.cellLat == null || me.cellLng == null || other.cellLat == null || other.cellLng == null) return null;
  return distanceKm(me.cellLat, me.cellLng, other.cellLat, other.cellLng);
}

/** Tramo de distancia que se muestra. Nunca el número exacto. */
export function distanceLabel(km: number): string {
  if (km < 1) return "a menos de 1 km";
  if (km < 10) return `${Math.round(km)} km`;
  if (km < 100) return `${Math.round(km / 5) * 5} km`;
  return "más de 100 km";
}

/** Caja de búsqueda alrededor de un punto. */
export function boundingBox(lat: number, lng: number, km: number) {
  const dLat = km / 111;
  const dLng = km / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}
