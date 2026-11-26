import { readFile } from "node:fs/promises";
import { parseWatermarkKey, verifyAlbumImage } from "../src/albumWatermark.js";

const [originalPath, copyPath, fileKey, viewerId, variant, ...coordinates] = process.argv.slice(2);
if (!originalPath || !copyPath || !fileKey || !viewerId || (variant !== "photo" && variant !== "thumb") ||
    (coordinates.length !== 0 && coordinates.length !== 4)) {
  throw new Error("Uso: verify-album-watermark.ts <original> <copia> <clave-archivo> <id-cuenta> <photo|thumb> [izquierda arriba ancho alto]");
}
const secret = parseWatermarkKey(process.env.ALBUM_WATERMARK_KEY);
if (!secret) throw new Error("Falta ALBUM_WATERMARK_KEY");

const [left, top, width, height] = coordinates.map(Number);
const crop = coordinates.length ? { left, top, width, height } : undefined;
const [original, copy] = await Promise.all([readFile(originalPath), readFile(copyPath)]);
const result = await verifyAlbumImage(original, copy, { secret, fileKey, viewerId, thumb: variant === "thumb" }, crop);
console.log(JSON.stringify(result));
if (!result.match) process.exitCode = 1;
