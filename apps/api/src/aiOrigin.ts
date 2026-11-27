import { AI_ORIGINS, detectAiProvenance, type AiOrigin } from "@mortero/shared/aiProvenance";

export type { AiOrigin };

/**
 * Si una foto o video está hecho con IA, según sus propios metadatos (ver packages/shared/src/aiProvenance.ts). En los
 * videos se miran solo las cajas de metadatos: un video de 80 MB cuesta lo mismo que una foto.
 *
 * `declared` es lo que la web detectó en el archivo original antes de recortarlo (el recorte lo vuelve a codificar
 * y los metadatos no llegan hasta acá). Se acepta sin verificar: solo puede marcar como IA una foto propia, nunca
 * sacarle la marca a una que la trae. Gana la señal más fuerte.
 *
 * Si la detección falla con un archivo raro, la foto se sube igual, sin marca (o con la que mandó la web). `detect`
 * se cambia solo en las pruebas.
 */
export async function aiOriginOf(
  bytes: ArrayBuffer | Uint8Array,
  declared?: unknown,
  detect: typeof detectAiProvenance = detectAiProvenance,
): Promise<AiOrigin | null> {
  let detected: AiOrigin | null = null;
  try {
    detected = (await detect(bytes))?.origin ?? null;
  } catch {
    // Sin marca: una imagen que el detector no entiende no puede frenar la subida
  }
  const claimed = typeof declared === "string" && (AI_ORIGINS as readonly string[]).includes(declared) ? (declared as AiOrigin) : null;
  if (detected === "generated" || claimed === "generated") return "generated";
  return detected ?? claimed;
}

/** Lo que viaja a la web: solo los dos valores conocidos, cualquier otra cosa es null. */
export const aiOut = (value: string | null | undefined): AiOrigin | null =>
  value && (AI_ORIGINS as readonly string[]).includes(value) ? (value as AiOrigin) : null;
