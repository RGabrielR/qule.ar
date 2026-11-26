import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import path from "node:path";
import { customType } from "drizzle-orm/pg-core";
import { readOrCreateDevFile } from "./devFile.js";
import { env } from "./env.js";

/**
 * Cifrado de datos sensibles en la base: estado serológico y fecha del último test, mensajes privados y las
 * copias de los reportes.
 * AES-256-GCM con la clave DATA_KEY. Quien vea la base o un backup sin la clave no puede leerlos.
 *
 * Formato guardado: "v1:" + base64(iv de 12 bytes | tag de 16 bytes | texto cifrado).
 * Un valor sin el prefijo es de antes del cifrado: se lee tal cual y se cifra al arrancar (encryptLegacyHealth,
 * encryptLegacyMessages).
 *
 * Si se pierde DATA_KEY, esos datos no se pueden recuperar. Ver docs/DEPLOY.md.
 */
export const ENCRYPTED_PREFIX = "v1:";
let cached: Buffer | undefined;

function key(): Buffer {
  if (cached) return cached;
  let b64 = env.DATA_KEY;
  if (!b64) {
    if (process.env.NODE_ENV === "production") throw new Error("Falta DATA_KEY (ver docs/DEPLOY.md)");
    // Desarrollo: se crea sola, como las claves VAPID
    b64 = readOrCreateDevFile(path.join(env.DATA_DIR, "data-key"), () => randomBytes(32).toString("base64")).trim();
  }
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("DATA_KEY tiene que ser de 32 bytes en base64 (openssl rand -base64 32)");
  return (cached = k);
}

/** Para chequear al arrancar que la clave está y es válida, antes de atender a nadie. */
export const checkDataKey = () => void key();

/** La clave base, para derivar otras (por ejemplo, la de los archivos en fileCrypt.ts). */
export const dataKey = () => key();

export const isEncrypted = (v: string) => v.startsWith(ENCRYPTED_PREFIX);

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ENCRYPTED_PREFIX + Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

export function decrypt(stored: string): string {
  if (!isEncrypted(stored)) return stored;
  const raw = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), "base64");
  const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

/**
 * Forma de un valor cifrado: el prefijo y al menos 28 bytes (iv + tag) en base64. Un mensaje viejo, sin cifrar,
 * puede empezar con "v1:" porque lo escribió alguien; con esto se lo distingue de uno cifrado.
 */
export const ENCRYPTED_SHAPE = /^v1:[A-Za-z0-9+/]{38,}={0,2}$/;

/** Columna de texto que se guarda cifrada y se lee en claro. No se puede buscar ni ordenar por ella. */
export const encryptedText = customType<{ data: string; driverData: string }>({
  dataType: () => "text",
  toDriver: (v) => encrypt(v),
  fromDriver: (v) => decrypt(v),
});

/**
 * Como encryptedText, para textos que escribe la gente (mensajes privados, copias de reportes).
 * Mientras se cifran los mensajes viejos (encryptLegacyMessages), uno sin cifrar que empiece con "v1:" se lee
 * tal cual en vez de fallar. Uno con forma de cifrado que no se puede descifrar (clave equivocada) sí falla.
 * Igual que encryptedText: no se puede buscar, comparar ni ordenar por esta columna en la base.
 */
export const encryptedMessageText = customType<{ data: string; driverData: string }>({
  dataType: () => "text",
  toDriver: (v) => encrypt(v),
  fromDriver: (v) => (ENCRYPTED_SHAPE.test(v) ? decrypt(v) : v),
});
