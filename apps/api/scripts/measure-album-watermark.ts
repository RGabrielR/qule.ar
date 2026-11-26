import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { markAlbumImage, verifyAlbumImage, type Crop } from "../src/albumWatermark.js";

const paths = process.argv.slice(2);
if (!paths.length) throw new Error("Pasá las rutas de las imágenes de prueba");
const secret = Buffer.alloc(32, 17); // Clave fija para reproducir la prueba local
const browser = await chromium.launch();
try {
  const pages = await Promise.all([1, 2].map((deviceScaleFactor) =>
    browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor, isMobile: true }),
  ));
  const rows = [];
  for (const path of paths) {
    const input = await readFile(path);
    const photo = await sharp(input).autoOrient().resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 }).toBuffer();
    const thumbnail = await sharp(photo).resize(480, 480, { fit: "cover", position: "attention" }).webp({ quality: 74 }).toBuffer();

    for (const [variant, original] of [["foto", photo], ["miniatura", thumbnail]] as const) {
      const mark = { secret, fileKey: basename(path), viewerId: "prueba", thumb: variant === "miniatura" };
      const times = [];
      let marked = original;
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        marked = await markAlbumImage(original, mark);
        times.push(performance.now() - start);
      }
      const ms = Math.round(times.sort((a, b) => a - b)[2]);
      const { width, height } = await sharp(original).metadata();
      const crop = {
        left: Math.floor(width / 4), top: Math.floor(height / 4),
        width: Math.floor(width / 2), height: Math.floor(height / 2),
      };
      const originalPixels = await sharp(original).removeAlpha().raw().toBuffer();
      const markedPixels = await sharp(marked).removeAlpha().raw().toBuffer();
      const mse = originalPixels.reduce((acc, value, i) => acc + (value - markedPixels[i]) ** 2, 0) / originalPixels.length;
      const psnrDb = Math.round(10 * Math.log10(255 ** 2 / mse) * 10) / 10;
      const screenshots = await Promise.all(pages.map(async (page, i) => {
        await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><img src="data:image/webp;base64,${marked.toString("base64")}" width="${mark.thumb ? 120 : 350}">`);
        return { name: `Captura Chromium DPR ${i + 1}`, copy: await page.locator("img").screenshot() };
      }));
      const cases: { name: string; copy: Buffer; crop?: Crop; unmarked?: boolean }[] = [
        { name: "WebP servido", copy: marked },
        { name: "JPEG q65", copy: await sharp(marked).jpeg({ quality: 65 }).toBuffer() },
        { name: "JPEG q65 al 50%", copy: await sharp(marked).resize(Math.floor(width / 2)).jpeg({ quality: 65 }).toBuffer() },
        { name: "Recorte central 25%", copy: await sharp(marked).extract(crop).jpeg({ quality: 75 }).toBuffer(), crop },
        ...screenshots,
        { name: "Sin marca (JPEG q65)", copy: await sharp(original).jpeg({ quality: 65 }).toBuffer(), unmarked: true },
      ];
      for (const { name, copy, crop, unmarked } of cases) {
        const result = await verifyAlbumImage(original, copy, mark, crop);
        let falseMatches = Number(Boolean(unmarked && result.match));
        for (let i = 0; i < 16; i++) {
          const wrong = { ...mark, viewerId: `otra-cuenta-${i}` };
          if ((await verifyAlbumImage(original, copy, wrong, crop)).match) falseMatches++;
        }
        rows.push({
          image: basename(path), variant, case: name, match: result.match, score: result.score.toFixed(1),
          strength: result.strength.toFixed(2), falseMatches, ms, psnrDb,
        });
      }
    }
  }
  console.table(rows);
} finally {
  await browser.close();
}
