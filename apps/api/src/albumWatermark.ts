import { createHash, createHmac } from "node:crypto";
import sharp, { type Sharp } from "sharp";

const BLOCK = 8;
const MIN_STRENGTH = 2;
const MAX_STRENGTH = 5;
const MAX_EDGE = 1200;
/** Al verificar, una diferencia de brillo mayor a esto en un píxel es la marca visible (u otro cambio), no esta. */
const VISIBLE_MARK_SKIP = 16;
const MAX_PIXELS = MAX_EDGE ** 2;
const DCT = Array.from({ length: BLOCK }, (_, y) =>
  Array.from({ length: BLOCK }, (_, x) =>
    Math.cos(Math.PI * (x + 0.5) / BLOCK) * Math.cos(Math.PI * (y + 0.5) / BLOCK),
  ),
);

const DELTAS = Array.from({ length: MAX_STRENGTH - MIN_STRENGTH + 1 }, (_, level) =>
  DCT.map((row) => row.map((basis) => Math.round((MIN_STRENGTH + level) * basis))),
);

export type Watermark = { secret: Buffer; fileKey: string; viewerId: string; thumb: boolean };
export type Crop = { left: number; top: number; width: number; height: number };

export function parseWatermarkKey(value: string | undefined) {
  if (!value) return undefined;
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) {
    throw new Error("ALBUM_WATERMARK_KEY necesita 32 bytes en base64");
  }
  return key;
}

function pattern(mark: Watermark, blocks: number) {
  const seed = createHmac("sha256", mark.secret)
    .update(JSON.stringify(["qule-album-dct-v1", mark.fileKey, mark.viewerId, mark.thumb]))
    .digest();
  return createHash("shake256", { outputLength: Math.ceil(blocks / 8) }).update(seed).digest();
}

const direction = (bits: Buffer, block: number) => (bits[block >> 3] & (1 << (block % 8))) ? 1 : -1;

const pixels = (image: Sharp) => image.toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });

/** Suma un coeficiente DCT de luminancia por bloque. Aplicarlo como una base espacial
 * evita calcular el resto de la transformada y conserva el alfa de la foto. */
export async function markAlbumImage(image: Buffer, mark: Watermark) {
  const { data, info: { width, height } } = await pixels(sharp(image, { limitInputPixels: MAX_PIXELS }));
  const columns = Math.ceil(width / BLOCK);
  const bits = pattern(mark, columns * Math.ceil(height / BLOCK));
  for (let top = 0; top < height; top += BLOCK) {
    const blockHeight = Math.min(BLOCK, height - top);
    for (let left = 0; left < width; left += BLOCK) {
      const sign = direction(bits, (top / BLOCK) * columns + left / BLOCK);
      const blockWidth = Math.min(BLOCK, width - left);
      // En las zonas lisas una trama regular se ve antes que sobre una textura.
      let darkest = 255;
      let lightest = 0;
      for (let y = 0; y < blockHeight; y++) {
        for (let x = 0; x < blockWidth; x++) {
          const green = data[((top + y) * width + left + x) * 4 + 1];
          darkest = Math.min(darkest, green);
          lightest = Math.max(lightest, green);
        }
      }
      const level = Math.min(MAX_STRENGTH - MIN_STRENGTH, Math.floor((lightest - darkest) / 8));
      for (let y = 0; y < blockHeight; y++) {
        for (let x = 0; x < blockWidth; x++) {
          const i = ((top + y) * width + left + x) * 4;
          const delta = sign * DELTAS[level][y][x];
          for (let c = 0; c < 3; c++) {
            data[i + c] = Math.max(0, Math.min(255, data[i + c] + delta));
          }
        }
      }
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).webp({ quality: 88 }).toBuffer();
}

const luma = (data: Buffer, i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

/** Compara una copia alineada con la foto o miniatura sin marcar. Crop ubica en la
 * referencia el rectángulo que contiene la copia, antes de cualquier cambio de escala. */
export async function verifyAlbumImage(original: Buffer, copy: Buffer, mark: Watermark, crop?: Crop) {
  const { data: reference, info: { width, height } } = await pixels(sharp(original, { limitInputPixels: MAX_PIXELS }));
  const { left, top, width: cropWidth, height: cropHeight } = crop ?? { left: 0, top: 0, width, height };
  if (![left, top, cropWidth, cropHeight].every(Number.isSafeInteger) ||
      left < 0 || top < 0 || cropWidth < 1 || cropHeight < 1 ||
      left + cropWidth > width || top + cropHeight > height) {
    throw new Error("El recorte tiene que estar dentro de la imagen de referencia");
  }

  const { data: candidate } = await pixels(sharp(copy, { limitInputPixels: 40_000_000 })
    .autoOrient().resize(cropWidth, cropHeight, { fit: "fill" }));
  const columns = Math.ceil(width / BLOCK);
  const bits = pattern(mark, columns * Math.ceil(height / BLOCK));
  let blocks = 0;
  let sum = 0;
  let energy = 0;
  for (let by = Math.ceil(top / BLOCK) * BLOCK; by + BLOCK <= top + cropHeight; by += BLOCK) {
    for (let bx = Math.ceil(left / BLOCK) * BLOCK; bx + BLOCK <= left + cropWidth; bx += BLOCK) {
      let coefficient = 0;
      let weight = 0;
      for (let y = 0; y < BLOCK; y++) {
        for (let x = 0; x < BLOCK; x++) {
          const i = ((by + y) * width + bx + x) * 4;
          const j = ((by - top + y) * cropWidth + bx - left + x) * 4;
          if (reference[i + 3] < 250 || candidate[j + 3] < 250) continue;
          const difference = luma(candidate, j) - luma(reference, i);
          // La marca visible con quién mira (viewerMark.ts) cambia mucho los píxeles del texto; esta, apenas unos
          // niveles. Lo que cambió de más no es esta señal: se saltea
          if (Math.abs(difference) > VISIBLE_MARK_SKIP) continue;
          const basis = DCT[y][x];
          coefficient += difference * basis;
          weight += basis * basis;
        }
      }
      if (weight < 12) continue;
      const delta = coefficient / weight;
      sum += delta * direction(bits, (by / BLOCK) * columns + bx / BLOCK);
      energy += delta ** 2;
      blocks++;
    }
  }
  // La correlación sola puede dar alta con una señal pequeña. Pedimos también
  // amplitud mínima y suficientes bloques antes de informar una coincidencia.
  const strength = blocks ? sum / blocks : 0;
  const score = energy ? sum / Math.sqrt(energy) : 0;
  const insufficient = blocks < 128;
  return { match: !insufficient && strength >= 0.5 && score >= 6, insufficient, blocks, strength, score };
}
