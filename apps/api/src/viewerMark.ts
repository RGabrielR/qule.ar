import sharp, { type Sharp } from "sharp";
import { palette } from "./brand.js";

/**
 * Marca de agua visible con quién está mirando, escrita en los píxeles de la foto (ver Watermark.tsx en la web).
 *
 * Antes se dibujaba solo en el navegador, encima de la foto: arrastrar la imagen a otra app (o "Guardar imagen", o
 * bajarla por su dirección) se llevaba la foto limpia. Ahora la escribe el servidor en cada foto privada que mira
 * alguien que no es quien la subió, así cualquier copia sale marcada. Mismo texto que la de la web: nombre, un ID
 * corto (el nombre se puede repetir o cambiar) y la fecha y hora.
 */

/** Para no reventar con imágenes enormes armadas a propósito (las subidas ya vienen achicadas a 1200 px). */
const MAX_PIXELS = 40_000_000;

const escapeXml = (text: string) => text.replace(/[<>&'"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * Escribe la marca en diagonal, repetida por toda la foto, clara y con un borde oscuro finito para que se lea sobre
 * fondos claros y oscuros sin tapar la foto (como la de la web: -28°, 22 % de opacidad).
 *
 * Se dibuja una sola celda con el texto (dos renglones corridos, así no quedan en columna), se repite por una capa
 * más grande que la foto, se gira y se pega encima. Dibujar la trama girada directamente en SVG es muy lento.
 */
export async function burnViewerMark(image: Buffer, label: string): Promise<Buffer> {
  const input = sharp(image, { limitInputPixels: MAX_PIXELS }).rotate();
  const { width = 0, height = 0, orientation } = await input.metadata();
  // Con la orientación de la cámara, ancho y alto pueden venir cruzados
  const [w, h] = orientation && orientation >= 5 ? [height, width] : [width, height];
  if (!w || !h) return image;
  const key = `${label}|${w}x${h}`;
  let overlay = overlays.get(key);
  if (!overlay) {
    overlay = await drawOverlay(label, w, h);
    overlays.set(key, overlay);
    // Se guardan las últimas: un álbum suele tener fotos del mismo tamaño, y la etiqueta cambia cada minuto
    if (overlays.size > MAX_OVERLAYS) overlays.delete(overlays.keys().next().value!);
  }
  // effort bajo: se codifica en cada pedido, y la diferencia de peso es mínima
  return input.composite([{ input: overlay.data, raw: overlay.info }]).webp({ quality: 82, effort: 1 }).toBuffer();
}

type Raw = { data: Buffer; info: { width: number; height: number; channels: 4 } };
const MAX_OVERLAYS = 24;
const overlays = new Map<string, Raw>();
const clear = { r: 0, g: 0, b: 0, alpha: 0 };
const raw = async (image: Sharp): Promise<Raw> => {
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info: { width: info.width, height: info.height, channels: 4 } };
};

/** La capa con la marca para una foto de w × h (todo en píxeles crudos, sin pasar por PNG en el medio). */
async function drawOverlay(label: string, w: number, h: number): Promise<Raw> {
  const size = Math.max(11, Math.round(Math.min(w, h) / 30));
  const cellWidth = Math.round(size * 0.66 * label.length) + size * 4;
  const rowGap = Math.round(size * 3.4);
  const text = escapeXml(label);
  const line = (x: number, y: number) =>
    `<text x="${x}" y="${y}" font-family="DejaVu Sans, Verdana, sans-serif" font-size="${size}" font-weight="600" ` +
    `fill="${palette.onMedia}" fill-opacity="0.24" stroke="${palette.mediaBg}" stroke-opacity="0.16" stroke-width="${Math.max(1, size / 9)}" paint-order="stroke">${text}</text>`;
  // Celda: un renglón al principio y otro corrido media celda (que sigue en la celda de al lado)
  const half = Math.round(cellWidth / 2);
  const cell = await raw(sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cellWidth}" height="${rowGap * 2}">` +
    `${line(0, rowGap - size / 2)}${line(half, rowGap * 2 - size / 2)}${line(half - cellWidth, rowGap * 2 - size / 2)}</svg>`,
  )));
  // Capa del tamaño de la diagonal (así al girarla sigue cubriendo toda la foto), con la celda repetida
  // (nunca más chica que la celda: en fotos muy chicas, la celda es más grande que la foto)
  const side = Math.max(Math.ceil(Math.hypot(w, h)), cell.info.width, cell.info.height);
  const tiled = await raw(sharp({ create: { width: side, height: side, channels: 4, background: clear } })
    .composite([{ input: cell.data, raw: cell.info, tile: true, left: 0, top: 0 }]));
  const turned = await raw(sharp(tiled.data, { raw: tiled.info }).rotate(-28, { background: clear }));
  return raw(sharp(turned.data, { raw: turned.info }).extract({
    left: Math.floor((turned.info.width - w) / 2), top: Math.floor((turned.info.height - h) / 2), width: w, height: h,
  }));
}
