import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { loadNudeNet, type Detector } from "./nudenet.js";
import { DEFAULT_MIN_SCORE, pendingCount, runQueue } from "./queue.js";

/**
 * Fotos explícitas: configuración y arranque de la cola (ver queue.ts y nudenet.ts, y docs/DEPLOY.md).
 *
 * EXPLICIT_CHECK elige dónde corre el modelo:
 * - "off": en este proceso no. En producción es lo normal: corre aparte, en el contenedor `mortero-fotos`
 *   (`node --import tsx src/explicitWorker.ts`), con CPU y memoria limitadas por Docker.
 * - "inline": dentro del API, en el proceso líder. Por defecto en desarrollo si el modelo está bajado.
 * - "test": un detector de mentira para las pruebas (marca las fotos rojas). No se puede usar en producción.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const production = process.env.NODE_ENV === "production";

export const explicitConfig = {
  model: process.env.EXPLICIT_MODEL ?? path.resolve(here, "../../models/nudenet-320n.onnx"),
  // Límite de trabajo: fotos por minuto. Con 30, en un servidor como el nuestro usa menos de un décimo de un núcleo.
  perMinute: Number(process.env.EXPLICIT_PER_MINUTE ?? 30),
  minScore: Number(process.env.EXPLICIT_MIN_SCORE ?? DEFAULT_MIN_SCORE),
  threads: Number(process.env.EXPLICIT_THREADS ?? 1),
};

type Mode = "off" | "inline" | "test";

export function explicitMode(): Mode {
  const raw = process.env.EXPLICIT_CHECK;
  if (raw === "test") {
    if (production) throw new Error("EXPLICIT_CHECK=test es solo para pruebas");
    return "test";
  }
  if (raw === "inline" || raw === "off") return raw;
  return !production && existsSync(explicitConfig.model) ? "inline" : "off";
}

/** Detector de mentira para las pruebas: una foto casi toda roja cuenta como explícita. */
export const testDetector: Detector = async (image) => {
  const { channels } = await sharp(image).stats();
  const [r, g, b] = channels.map((c) => c.mean);
  return r > 180 && g < 80 && b < 80 ? { score: 0.99, label: "TEST" } : { score: 0, label: null };
};

export async function loadDetector(mode: "inline" | "test"): Promise<Detector> {
  if (mode === "test") return testDetector;
  if (!existsSync(explicitConfig.model)) {
    throw new Error(`Falta el modelo de NudeNet en ${explicitConfig.model}. Bajalo con: npm run model --workspace api`);
  }
  return loadNudeNet(explicitConfig.model, explicitConfig.threads);
}

/** Arranca la cola en este proceso. Se detiene con `signal`. */
export async function startExplicitQueue(mode: "inline" | "test", signal?: AbortSignal) {
  const detect = await loadDetector(mode);
  const pending = await pendingCount().catch(() => null);
  console.log(`Fotos explícitas: revisando (${mode === "test" ? "prueba" : "NudeNet"}, hasta ${explicitConfig.perMinute} por minuto${pending != null ? `, ${pending} pendientes` : ""})`);
  // En pruebas no hace falta esperar entre fotos
  const perMinute = mode === "test" ? 6_000 : explicitConfig.perMinute;
  return runQueue({ detect, perMinute, minScore: explicitConfig.minScore, signal });
}
