import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { mkdir, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import sharp from "sharp";
import { env } from "./env.js";
import { decryptBlob, decryptRange, encryptBlob, HEADER, isEncryptedBlob, plainSize } from "./fileCrypt.js";
import { createS3 } from "./s3.js";
import { clustered } from "./shared.js";

/**
 * Dónde se guardan las fotos y los videos: en el disco del servidor (por defecto) o en un almacenamiento compatible
 * con S3, como Cloudflare R2 (STORAGE=s3, ver docs/DEPLOY.md). Las miniaturas van al mismo lugar, en "thumbs/".
 * Con S3, si un archivo todavía no está en el bucket se busca en el disco: así se puede migrar sin cortar nada.
 *
 * Todo se guarda cifrado con DATA_KEY (ver fileCrypt.ts). Lo de antes del cifrado se lee igual, sin cifrar,
 * hasta que se corra files-encrypt.ts.
 */
const dir = path.join(env.DATA_DIR, "uploads");
await Promise.all([
  mkdir(path.join(dir, "thumbs"), { recursive: true }),
  mkdir(path.join(dir, "report-captures"), { recursive: true }),
]);
const THUMB_PX = 480;

const s3 = env.STORAGE === "s3"
  ? createS3({
      endpoint: required("S3_ENDPOINT", env.S3_ENDPOINT),
      bucket: required("S3_BUCKET", env.S3_BUCKET),
      region: env.S3_REGION,
      accessKeyId: required("S3_ACCESS_KEY_ID", env.S3_ACCESS_KEY_ID),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY", env.S3_SECRET_ACCESS_KEY),
    })
  : null;

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`STORAGE=s3 necesita ${name}`);
  return value;
}

/** Dónde se guarda este archivo. */
export const storageKind = s3 ? "s3" : "disk";

/** Guarda un archivo tal cual (ya cifrado). En el disco se escribe aparte y se renombra: nadie lee uno a medias. */
export async function putRawBlob(key: string, data: Buffer, contentType: string) {
  if (s3) return s3.put(key, data, contentType);
  const file = path.join(dir, key);
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

/** El archivo tal como está guardado (cifrado, o sin cifrar si es de antes). */
export async function getRawBlob(key: string): Promise<Buffer | null> {
  if (s3) {
    const found = await s3.get(key);
    if (found) return found;
  }
  return readFile(path.join(dir, key)).catch(() => null);
}

const putBlob = (key: string, data: Buffer, contentType: string) => putRawBlob(key, encryptBlob(data), contentType);

async function getBlob(key: string): Promise<Buffer | null> {
  const raw = await getRawBlob(key);
  return raw && decryptBlob(raw);
}

export async function deleteThumb(key: string) {
  if (!KEY_RE.test(key)) return;
  await deleteBlob(`thumbs/${key}`);
  await deleteBlob(`thumbs/cover-${key}`);
}

async function deleteBlob(key: string) {
  if (s3) await s3.del(key).catch(() => {});
  await unlink(path.join(dir, key)).catch(() => {});
}

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/**
 * Normaliza la imagen: la rota según EXIF, la achica y la pasa a WebP.
 * Re-codificar con sharp descarta TODOS los metadatos (incluida la ubicación GPS de la foto).
 */
/**
 * Tope de píxeles de una imagen subida (40 megapíxeles: cualquier cámara de celu entra con margen). Una imagen
 * puede pesar poco en bytes y ser gigante en píxeles; sin tope, procesarla puede tragarse la memoria del servidor.
 */
const MAX_INPUT_PIXELS = 40_000_000;

export class InvalidImageError extends Error {}

export async function saveImage(input: ArrayBuffer | Buffer): Promise<string> {
  const out = await sharp(Buffer.isBuffer(input) ? input : Buffer.from(input), { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer()
    .catch((cause) => { throw new InvalidImageError("No pudimos leer esa imagen", { cause }); });
  const key = `${crypto.randomUUID()}.webp`;
  await putBlob(key, out, "image/webp");
  return key;
}

const KEY_RE = /^[0-9a-f-]{36}\.webp$/;
const REPORT_CAPTURE_RE = /^report-captures\/[0-9a-f-]{36}\.webp$/;

export async function saveReportCapture(input: ArrayBuffer): Promise<string> {
  const photo = sharp(Buffer.from(input), { limitInputPixels: MAX_INPUT_PIXELS });
  const { format, pages } = await photo.metadata();
  if (!["jpeg", "png", "webp"].includes(format) || (pages ?? 1) > 1) {
    throw new Error("Formato de captura inválido");
  }
  // Conserva los píxeles de la captura para la verificación y descarta los metadatos.
  const bytes = await photo.autoOrient().webp({ lossless: true }).toBuffer();
  const key = `report-captures/${crypto.randomUUID()}.webp`;
  await putBlob(key, bytes, "image/webp");
  return key;
}

export function readReportCapture(key: string) {
  return REPORT_CAPTURE_RE.test(key) ? getBlob(key) : null;
}

export async function deleteReportCapture(key: string) {
  if (REPORT_CAPTURE_RE.test(key)) await deleteBlob(key);
}

const VIDEO_RE = /^[0-9a-f-]{36}\.mp4$/;

export async function readImage(key: string, size?: "thumb" | "cover"): Promise<Buffer | null> {
  if (!KEY_RE.test(key)) return null;
  try {
    if (!size) return await getBlob(key);
    // La miniatura se genera la primera vez que se pide y queda guardada
    const thumbnailKey = size === "cover" ? `thumbs/cover-${key}` : `thumbs/${key}`;
    const saved = await getBlob(thumbnailKey);
    if (saved) return saved;
    const original = await getBlob(key);
    if (!original) return null;
    const out = await sharp(original, { limitInputPixels: MAX_INPUT_PIXELS })
      .resize(size === "cover"
        ? { width: THUMB_PX, height: THUMB_PX, fit: "inside", withoutEnlargement: true }
        : { width: THUMB_PX, height: THUMB_PX, fit: "cover", position: "attention" })
      .webp({ quality: 74 })
      .toBuffer();
    await putBlob(thumbnailKey, out, "image/webp").catch(() => {});
    return out;
  } catch {
    return null;
  }
}

export async function deleteImage(key: string) {
  if (VIDEO_RE.test(key)) {
    await deleteBlob(key);
    return;
  }
  if (!KEY_RE.test(key)) return;
  await deleteBlob(key);
  await deleteBlob(`thumbs/${key}`);
  await deleteBlob(`thumbs/cover-${key}`);
}

// ---------- Videos (solo para el álbum privado) ----------

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
export const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 60;

/** ¿Hay ffmpeg en el servidor? Sin ffmpeg no se aceptan videos. */
export const videoEnabled = await run(FFMPEG, ["-version"]).then(() => true, () => false);

/**
 * Normaliza el video: lo corta a 60 s, lo achica a 720 px del lado más largo y lo pasa a H.264 + AAC en MP4,
 * que se reproduce en cualquier celu (los .mov de iPhone en HEVC no andan en Android).
 * Re-codificar descarta los metadatos, incluida la ubicación GPS. También saca un fotograma para la miniatura.
 */
/**
 * Videos procesándose a la vez. ffmpeg usa mucho procesador: si varias personas suben videos juntas, los que
 * sobran esperan su turno en vez de trabar el servidor para todes. Con varios procesos del API, uno por proceso.
 */
const MAX_VIDEO_JOBS = clustered ? 1 : 2;
let videoJobs = 0;
const videoQueue: (() => void)[] = [];
async function videoSlot<T>(job: () => Promise<T>): Promise<T> {
  // Si hay lugar se ocupa; si no, se espera y el turno lo pasa directo quien termina (así nunca hay más de MAX)
  if (videoJobs < MAX_VIDEO_JOBS) videoJobs++;
  else await new Promise<void>((r) => videoQueue.push(r));
  try {
    return await job();
  } finally {
    const next = videoQueue.shift();
    if (next) next();
    else videoJobs--;
  }
}

export function saveVideo(input: ArrayBuffer): Promise<{ key: string; posterKey: string; seconds: number }> {
  return videoSlot(() => processVideo(input));
}

async function processVideo(input: ArrayBuffer): Promise<{ key: string; posterKey: string; seconds: number }> {
  const id = crypto.randomUUID();
  const key = `${id}.mp4`;
  // ffmpeg trabaja en una carpeta temporal propia, con permisos 700 (solo el proceso del API la puede leer): el video
  // todavía no está cifrado. Después se guarda cifrado en el disco o en el bucket, y la carpeta se borra entera.
  const work = await mkdtemp(path.join(tmpdir(), "qule-video-"));
  const tmpIn = path.join(work, "in");
  const out = path.join(work, key);
  const frame = path.join(work, "frame.png");
  await writeFile(tmpIn, Buffer.from(input), { mode: 0o600 });
  try {
    const { stderr } = await run(FFMPEG, [
      "-hide_banner", "-y", "-i", tmpIn,
      "-t", String(MAX_VIDEO_SECONDS),
      "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1",
      "-vf", "scale='if(gt(iw,ih),min(720,iw),-2)':'if(gt(iw,ih),-2,min(720,ih))'",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart",
      out,
    ], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    const m = /Duration: (\d+):(\d+):(\d+)/.exec(stderr);
    const seconds = m ? Math.min(MAX_VIDEO_SECONDS, Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) : 0;
    await run(FFMPEG, ["-hide_banner", "-y", "-ss", "0.5", "-i", out, "-frames:v", "1", frame], { timeout: 30_000 })
      .catch(() => run(FFMPEG, ["-hide_banner", "-y", "-i", out, "-frames:v", "1", frame], { timeout: 30_000 }));
    const posterKey = await saveImage(await readFile(frame));
    await putBlob(key, await readFile(out), "video/mp4");
    return { key, posterKey, seconds };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

export type VideoSource = { size: number; open: (start: number, end: number) => Promise<ReadableStream> };

/** Tamaño de un video guardado y cómo leer un pedazo, para servirlo por partes (Safari lo exige para reproducir). */
export async function videoFile(key: string): Promise<VideoSource | null> {
  if (!VIDEO_RE.test(key)) return null;
  let raw: { size: number; read: (from: number, to: number) => Promise<AsyncIterable<Uint8Array>> } | null = null;
  if (s3) {
    const size = await s3.size(key).catch(() => null);
    if (size != null) raw = { size, read: async (from, to) => s3.stream(key, from, to) as unknown as AsyncIterable<Uint8Array> };
  }
  if (!raw) {
    const file = path.join(dir, key);
    const size = await stat(file).then((s) => s.size, () => null);
    if (size == null) return null;
    raw = { size, read: async (from, to) => createReadStream(file, { start: from, end: to }) };
  }
  const { size, read } = raw;
  // Primeros bytes: ¿está cifrado o es de antes?
  const parts: Buffer[] = [];
  for await (const p of await read(0, Math.min(size, HEADER) - 1)) parts.push(Buffer.from(p));
  const header = Buffer.concat(parts).subarray(0, HEADER);
  if (!isEncryptedBlob(header)) {
    return { size, open: async (start, end) => Readable.toWeb(Readable.from(await read(start, end))) as ReadableStream };
  }
  return {
    size: plainSize(size),
    open: async (start, end) => Readable.toWeb(Readable.from(decryptRange(header, size, start, end, read))) as ReadableStream,
  };
}
