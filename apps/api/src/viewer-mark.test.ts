import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { burnViewerMark } from "./viewerMark.js";

const photo = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 70, g: 110, b: 90 } } }).webp().toBuffer();

test("la marca visible queda escrita en la foto, del mismo tamaño, con el texto escapado", async () => {
  for (const [width, height] of [[900, 1200], [1200, 800], [24, 24]] as const) {
    const original = await photo(width, height);
    const marked = await burnViewerMark(original, `Ana <b>&"' · seed-ana · 27/11 15:03`);
    const meta = await sharp(marked).metadata();
    assert.equal(meta.width, width);
    assert.equal(meta.height, height);
    const [a, b] = await Promise.all([original, marked].map((img) => sharp(img).raw().toBuffer()));
    let changed = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 16) changed++;
    // Se nota en una parte de la foto, sin taparla entera
    assert.ok(changed > a.length * 0.005, `${width}x${height}: casi sin marca (${changed})`);
    assert.ok(changed < a.length * 0.5, `${width}x${height}: tapa demasiado (${changed})`);
  }
});

test("dos personas reciben copias distintas de la misma foto", async () => {
  const original = await photo(800, 800);
  const [ana, beto] = await Promise.all([
    burnViewerMark(original, "Ana · seed-ana · 27/11 15:03"),
    burnViewerMark(original, "Beto · seed-bet · 27/11 15:03"),
  ]);
  assert.notDeepEqual(ana, beto);
});
