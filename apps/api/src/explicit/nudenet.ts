import sharp from "sharp";

/**
 * Detector de desnudos con NudeNet (github.com/notAI-tech/NudeNet, AGPL-3.0): un modelo chico (12 MB) que corre
 * acá, con onnxruntime. Ninguna foto sale del servidor.
 *
 * El modelo marca partes del cuerpo con un puntaje. Para qule.ar cuenta como explícito SOLO genitales o culo al
 * descubierto. Torsos, ropa interior, pies o axilas no (se acordó en la discusión #255).
 */

/** Las clases del modelo, en el orden de su salida (copiadas de nudenet.py, versión 3.4). */
export const NUDENET_LABELS = [
  "FEMALE_GENITALIA_COVERED",
  "FACE_FEMALE",
  "BUTTOCKS_EXPOSED",
  "FEMALE_BREAST_EXPOSED",
  "FEMALE_GENITALIA_EXPOSED",
  "MALE_BREAST_EXPOSED",
  "ANUS_EXPOSED",
  "FEET_EXPOSED",
  "BELLY_COVERED",
  "FEET_COVERED",
  "ARMPITS_COVERED",
  "ARMPITS_EXPOSED",
  "FACE_MALE",
  "BELLY_EXPOSED",
  "MALE_GENITALIA_EXPOSED",
  "ANUS_COVERED",
  "FEMALE_BREAST_COVERED",
  "BUTTOCKS_COVERED",
] as const;

/** Lo que cuenta como explícito. */
export const EXPLICIT_LABELS = new Set<string>(["BUTTOCKS_EXPOSED", "ANUS_EXPOSED", "MALE_GENITALIA_EXPOSED", "FEMALE_GENITALIA_EXPOSED"]);

/** El modelo recibe imágenes de 320 × 320. */
const SIZE = 320;

/** Puntaje (de 0 a 1) de lo explícito más seguro que encontró el modelo, y qué fue. */
export type Detection = { score: number; label: string | null };
export type Detector = (image: Buffer) => Promise<Detection>;

/**
 * Lee la salida del modelo ([1, 4 + clases, cajas]): por cada caja, la clase con más puntaje (igual que NudeNet).
 * Devuelve la caja explícita con más puntaje. No hace falta descartar cajas superpuestas: solo importa la mejor.
 */
export function bestExplicit(data: Float32Array, dims: readonly number[]): Detection {
  const classes = dims[1] - 4;
  const boxes = dims[2];
  let best: Detection = { score: 0, label: null };
  for (let i = 0; i < boxes; i++) {
    let top = 0;
    let topScore = -1;
    for (let c = 0; c < classes; c++) {
      const s = data[(4 + c) * boxes + i];
      if (s > topScore) {
        topScore = s;
        top = c;
      }
    }
    const label = NUDENET_LABELS[top];
    if (EXPLICIT_LABELS.has(label) && topScore > best.score) best = { score: topScore, label };
  }
  return best;
}

/**
 * La imagen como la espera el modelo: completada con negro abajo y a la derecha hasta ser cuadrada, achicada a
 * 320 × 320, en RGB de 0 a 1, canal por canal (igual que el preprocesado de NudeNet).
 */
export async function toInput(image: Buffer): Promise<Float32Array> {
  const { data } = await sharp(image, { limitInputPixels: 40_000_000 })
    .removeAlpha()
    .resize(SIZE, SIZE, { fit: "contain", position: "left top", background: { r: 0, g: 0, b: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const plane = SIZE * SIZE;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    out[i] = data[i * 3] / 255;
    out[plane + i] = data[i * 3 + 1] / 255;
    out[2 * plane + i] = data[i * 3 + 2] / 255;
  }
  return out;
}

/**
 * Carga el modelo. `threads`: cuántos hilos usa (por defecto 1, para no competir con el resto del servidor).
 * onnxruntime se importa recién acá: el API que no revisa fotos no lo carga en memoria.
 */
export async function loadNudeNet(modelPath: string, threads = 1): Promise<Detector> {
  const ort = await import("onnxruntime-node");
  const session = await ort.InferenceSession.create(modelPath, {
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    executionMode: "sequential",
    graphOptimizationLevel: "all",
  });
  const [input] = session.inputNames;
  const [output] = session.outputNames;
  return async (image) => {
    const tensor = new ort.Tensor("float32", await toInput(image), [1, 3, SIZE, SIZE]);
    const result = await session.run({ [input]: tensor });
    const out = result[output];
    return bestExplicit(out.data as Float32Array, out.dims);
  };
}
