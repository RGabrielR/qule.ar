import { broadcast, onBroadcast } from "./shared.js";

/** Atajos en memoria para /api/files (ver fileAccess.ts). Sin base ni auth: se pueden probar solos. */

const PUBLIC_MS = 60_000;
/** Tope de entradas: si se llena, se vacía entera (es solo un atajo, se vuelve a llenar sola). */
const MAX_ENTRIES = 50_000;

export function remember<V>(map: Map<string, V>, key: string, value: V) {
  if (map.size >= MAX_ENTRIES) map.clear();
  map.set(key, value);
}

/** La cookie de sesión de Better Auth (con prefijo __Secure- en producción). */
export function sessionCookie(cookieHeader: string | undefined): string | null {
  const m = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/.exec(cookieHeader ?? "");
  return m ? m[1] : null;
}

const publicFiles = new Map<string, number>();

/** ¿Este archivo es una foto pública que ya se chequeó hace menos de un minuto? */
export function isKnownPublic(key: string, now = Date.now()) {
  const until = publicFiles.get(key);
  if (until === undefined) return false;
  if (until < now) {
    publicFiles.delete(key);
    return false;
  }
  return true;
}

export function rememberPublic(key: string, now = Date.now()) {
  remember(publicFiles, key, now + PUBLIC_MS);
}

/** El archivo dejó de ser público (se borró, pasó al álbum privado o se dio de baja su grupo): en todos los procesos. */
export function forgetFile(key: string | null | undefined) {
  if (key) broadcast("forgetFile", key);
}

onBroadcast("forgetFile", (key) => {
  if (typeof key === "string") publicFiles.delete(key);
});
