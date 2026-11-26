import { AI_ORIGINS, detectAiProvenance, type AiOrigin } from "@mortero/shared/aiProvenance";

export type { AiOrigin };

/**
 * Si una foto o video está hecho con IA, según sus propios metadatos (ver packages/shared/src/aiProvenance.ts).
 *
 * `declared` es lo que la web detectó en el archivo original antes de recortarlo (el recorte lo vuelve a codificar
 * y los metadatos no llegan hasta acá). Se acepta sin verificar: solo puede marcar como IA una foto propia, nunca
 * sacarle la marca a una que la trae. Gana la señal más fuerte.
 */
export async function aiOriginOf(bytes: ArrayBuffer | Uint8Array, declared?: unknown): Promise<AiOrigin | null> {
  const detected = (await detectAiProvenance(bytes))?.origin ?? null;
  const claimed = typeof declared === "string" && (AI_ORIGINS as readonly string[]).includes(declared) ? (declared as AiOrigin) : null;
  if (detected === "generated" || claimed === "generated") return "generated";
  return detected ?? claimed;
}

/** Lo que viaja a la web: solo los dos valores conocidos, cualquier otra cosa es null. */
export const aiOut = (value: string | null | undefined): AiOrigin | null =>
  value && (AI_ORIGINS as readonly string[]).includes(value) ? (value as AiOrigin) : null;
