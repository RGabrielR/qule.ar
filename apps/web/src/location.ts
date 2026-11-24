import { useEffect } from "react";
import { CELL_SIZE_METERS, snapToCell } from "../../../packages/geo/cell.js";
import { api } from "./api";

/**
 * Ubicación al día. La primera vez la comparte la persona a mano (botón "Compartir" de la grilla).
 * Después se actualiza sola mientras la app está en pantalla: al abrirla, al volver a ella y cada 5 minutos.
 * Con la app cerrada o en segundo plano no se manda nada.
 *
 * Solo se manda el centro de una zona de ~500 m. El servidor también lo redondea antes de guardarlo.
 * Si la persona borró su ubicación (en cualquier dispositivo), el servidor ignora las actualizaciones automáticas.
 */

/** Se dispara cada vez que se mandó una ubicación nueva, para que la grilla se recargue. */
export const LOCATION_EVENT = "mortero:ubicacion";

const KEY = "mortero:ubicacion";
/** Cada cuánto se actualiza mientras la app está en pantalla. */
const EVERY_MS = 5 * 60_000;
/** Para no mandar dos veces seguidas (abrir la app y volver a ella enseguida). */
const MIN_GAP_MS = 2 * 60_000;
/** Si el navegador puede volver a preguntar (pasa en iPhone), se intenta solo al abrir o volver, y no tan seguido. */
const ASK_GAP_MS = 30 * 60_000;
/** Si en ese cartel la persona dijo que no, no se insiste por un rato. */
const PAUSE_MS = 12 * 3_600_000;

type Saved = { sentAt: number; pausedUntil: number };

function read(): Saved {
  try {
    return { sentAt: 0, pausedUntil: 0, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { sentAt: 0, pausedUntil: 0 };
  }
}

function save(s: Partial<Saved>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), ...s }));
  } catch {
    /* sin almacenamiento: se actualiza igual, solo que sin recordar cuándo */
  }
}

async function permission(): Promise<PermissionState | "unknown"> {
  try {
    return (await navigator.permissions.query({ name: "geolocation" as PermissionName })).state;
  } catch {
    return "unknown";
  }
}

function position(auto: boolean): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: !auto,
      maximumAge: auto ? 60_000 : 0,
      timeout: 15_000,
    }),
  );
}

function isAccurate({ coords }: GeolocationPosition): boolean {
  return coords.accuracy <= CELL_SIZE_METERS;
}

async function send(pos: GeolocationPosition, auto: boolean) {
  const cell = snapToCell(pos.coords.latitude, pos.coords.longitude);
  await api("/me/location", { method: "PUT", json: { ...cell, auto } });
  save({ sentAt: Date.now(), pausedUntil: 0 });
  window.dispatchEvent(new Event(LOCATION_EVENT));
}

export type ShareResult = "ok" | "denied" | "unsupported" | "imprecise" | "error";

/** La persona toca "Compartir" o "Actualizar ubicación". */
export async function shareLocation(): Promise<ShareResult> {
  if (!("geolocation" in navigator)) return "unsupported";
  try {
    const pos = await position(false);
    if (!isAccurate(pos)) return "imprecise";
    await send(pos, false);
    return "ok";
  } catch (e) {
    return (e as GeolocationPositionError)?.code === 1 ? "denied" : "error";
  }
}

let running = false;

/** Actualización automática. `asking` es true cuando la llama abrir o volver a la app (no el reloj). */
async function refresh(asking: boolean) {
  if (running || document.visibilityState !== "visible" || !("geolocation" in navigator)) return;
  const now = Date.now();
  running = true;
  try {
    const perm = await permission();
    if (perm === "denied" || document.visibilityState !== "visible") return;
    const s = read();
    if (perm === "granted") {
      if (now - s.sentAt < MIN_GAP_MS) return;
    } else if (!asking || now - s.sentAt < ASK_GAP_MS || now < s.pausedUntil) {
      return;
    }
    const pos = await position(true);
    if (document.visibilityState === "visible" && isAccurate(pos)) await send(pos, true);
  } catch (e) {
    if ((e as GeolocationPositionError)?.code === 1) save({ pausedUntil: now + PAUSE_MS });
  } finally {
    running = false;
  }
}

/** Va en la estructura de la app: mantiene la ubicación al día si la persona la compartió. */
export function useLocationSync(hasLocation: boolean) {
  useEffect(() => {
    if (!hasLocation) return;
    refresh(true);
    const onVisible = () => document.visibilityState === "visible" && refresh(true);
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(() => refresh(false), EVERY_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(t);
    };
  }, [hasLocation]);
}
