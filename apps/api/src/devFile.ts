import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Lee un archivo de claves de desarrollo, o lo crea si no existe, sin mirar antes si existe.
 *
 * Con "wx" la creación falla si el archivo ya está, así que dos procesos que arrancan a la vez no se pisan: uno lo
 * crea y el otro lee el que quedó. Se crea con permisos 600 (solo el dueño lo puede leer), porque guarda claves.
 * En producción las claves vienen por variables de entorno y esto no se usa.
 */
export function readOrCreateDevFile(file: string, create: () => string): string {
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    writeFileSync(file, create(), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return readFileSync(file, "utf8");
}
