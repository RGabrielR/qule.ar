export const CELL_SIZE_METERS = 500;
const CELL_DEG_LAT = 0.0045; // ~500 m
const LAST_LAT_ROW = Math.ceil(90 / CELL_DEG_LAT) - 1;

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

export function snapToCell(lat: number, lng: number): { lat: number; lng: number } {
  const row = Math.min(Math.floor(lat / CELL_DEG_LAT), LAST_LAT_ROW);
  const cellLat = (row + 0.5) * CELL_DEG_LAT;
  const lngStep = CELL_DEG_LAT / Math.max(Math.cos((cellLat * Math.PI) / 180), 0.01);
  const col = Math.floor((lng === 180 ? -180 : lng) / lngStep);
  // En el antimeridiano, el centro debe quedar dentro de los límites de la celda recortada.
  const west = Math.max(-180, col * lngStep);
  const east = Math.min(180, (col + 1) * lngStep);
  const cellLng = (west + east) / 2;
  const roundedLng = round6(cellLng);
  return { lat: round6(cellLat), lng: Math.abs(roundedLng) < 180 ? roundedLng : cellLng };
}
