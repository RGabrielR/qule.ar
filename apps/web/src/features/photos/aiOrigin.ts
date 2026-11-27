/**
 * Lee en el archivo original si dice estar hecho con IA, para mandarlo junto con la foto (campo `ai`).
 *
 * Hace falta porque el recorte (y la conversión de HEIC) vuelven a codificar la imagen en el navegador: los metadatos
 * no llegan al servidor. Las fotos del chat privado se suben sin tocar y las revisa el servidor solo. Los videos no
 * se revisan.
 * El detector se carga recién al subir una foto. Si algo falla, sigue sin marca: nunca frena la subida.
 */
export async function aiFieldsFor(original: File): Promise<Record<string, string>> {
  try {
    const { detectAiProvenance } = await import("@mortero/shared/aiProvenance");
    const signal = await detectAiProvenance(await original.arrayBuffer());
    return signal ? { ai: signal.origin } : {};
  } catch {
    return {};
  }
}
