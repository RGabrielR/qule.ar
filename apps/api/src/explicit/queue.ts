import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { readImage } from "../storage.js";
import type { Detector } from "./nudenet.js";

const { photo } = schema;

/**
 * Cola de revisión de fotos explícitas. Revisa las fotos del perfil (las públicas) que el modelo todavía no vio,
 * de la más nueva a la más vieja: las que se suben ahora pasan primero y las que ya estaban se revisan de a poco,
 * con lo que sobra. Las fotos de los álbumes privados y de los mensajes no se revisan.
 *
 * Límite de trabajo: como mucho `perMinute` fotos por minuto, de a una, con un hilo. La primera pasada sobre las
 * fotos que ya existen tarda, pero no carga el servidor (lo pidió la discusión #255).
 */
export const pendingPhotos = and(
  isNull(photo.explicitCheckedAt),
  isNull(photo.explicitReviewedAt),
  eq(photo.isPrivate, false),
  eq(photo.kind, "photo"),
);

/** Puntaje mínimo para marcar una foto. Más alto: menos fotos marcadas de más, pero se escapan más. */
export const DEFAULT_MIN_SCORE = 0.5;

/** Revisa la próxima foto pendiente. false si no había ninguna. */
export async function checkNext(detect: Detector, minScore = DEFAULT_MIN_SCORE): Promise<boolean> {
  const [next] = await db.select({ id: photo.id, key: photo.key }).from(photo)
    .where(pendingPhotos).orderBy(desc(photo.createdAt)).limit(1);
  if (!next) return false;
  let score: number | null = null;
  try {
    const image = await readImage(next.key);
    if (image) score = (await detect(image)).score;
  } catch (e) {
    console.error("Fotos explícitas: no se pudo revisar una foto", e);
  }
  // Si no se pudo leer o revisar, queda revisada sin marca (score null): mejor una foto sin tapar que reintentar
  // para siempre la misma. Si moderación la revisó mientras tanto, su decisión no se pisa.
  await db.update(photo)
    .set({ explicitCheckedAt: new Date(), explicitScore: score, explicit: score != null && score >= minScore })
    .where(and(eq(photo.id, next.id), isNull(photo.explicitCheckedAt), isNull(photo.explicitReviewedAt)));
  return true;
}

/** Cuántas fotos faltan revisar (para el log). */
export async function pendingCount(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(photo).where(pendingPhotos);
  return row?.n ?? 0;
}

export type QueueOptions = { detect: Detector; perMinute: number; minScore?: number; signal?: AbortSignal };

/**
 * Revisa fotos hasta que `signal` se corte. Entre foto y foto espera lo necesario para no pasar de `perMinute`;
 * sin nada pendiente, vuelve a mirar cada tanto (una consulta chica, con su índice).
 */
export async function runQueue({ detect, perMinute, minScore, signal }: QueueOptions) {
  const gap = 60_000 / Math.max(1, perMinute);
  const idle = Math.max(gap, 1_000);
  let done = 0;
  while (!signal?.aborted) {
    const started = Date.now();
    const did = await checkNext(detect, minScore).catch((e) => {
      console.error("Fotos explícitas: error en la cola", e);
      return false;
    });
    if (did && ++done % 500 === 0) console.log(`Fotos explícitas: ${done} revisadas, faltan ${await pendingCount().catch(() => "?")}`);
    await sleep(did ? Math.max(0, gap - (Date.now() - started)) : idle, signal);
  }
}

/**
 * Espera `ms`, o hasta que se corte `signal`. La escucha de "abort" se saca al vencer la espera: la cola corre todo el
 * día con el mismo `signal`, y si quedaran colgadas se acumularían (Node avisa con MaxListenersExceededWarning).
 */
export const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  if (signal?.aborted) return resolve();
  const onAbort = () => { clearTimeout(t); resolve(); };
  const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
});
