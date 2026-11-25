import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";

const dataDir = await mkdtemp(path.join(tmpdir(), "qule-filecrypt-"));
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = "test";
process.env.DATA_KEY = randomBytes(32).toString("base64");
process.env.STORAGE = "disk";

const { CHUNK, decryptBlob, decryptRange, encryptBlob, isEncryptedBlob, plainSize } = await import("./fileCrypt.js");

async function* once(buf: Buffer, size = 7000) {
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size);
}
const readFrom = (enc: Buffer) => async (from: number, to: number) => once(enc.subarray(from, to + 1));
async function collect(it: AsyncIterable<Buffer>) {
  const parts: Buffer[] = [];
  for await (const p of it) parts.push(p);
  return Buffer.concat(parts);
}

test.after(() => rm(dataDir, { recursive: true, force: true }));

test("cifra y descifra archivos de cualquier tamaño", () => {
  for (const n of [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK + 5]) {
    const plain = randomBytes(n);
    const enc = encryptBlob(plain);
    assert.ok(isEncryptedBlob(enc));
    assert.equal(plainSize(enc.length), n);
    if (n >= 16) assert.ok(!enc.includes(plain.subarray(0, 16)));
    assert.deepEqual(decryptBlob(enc), plain);
  }
});

test("dos cifrados del mismo archivo salen distintos", () => {
  const plain = randomBytes(100);
  assert.notDeepEqual(encryptBlob(plain), encryptBlob(plain));
});

test("un archivo de antes del cifrado se lee tal cual", async () => {
  const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } } }).webp().toBuffer();
  assert.equal(isEncryptedBlob(webp), false);
  assert.deepEqual(decryptBlob(webp), webp);
});

test("descifra pedazos sueltos para servir videos por partes", async () => {
  const plain = randomBytes(3 * CHUNK + 1234);
  const enc = encryptBlob(plain);
  const header = enc.subarray(0, 20);
  const ranges: [number, number][] = [
    [0, plain.length - 1], [0, 0], [5, 10], [CHUNK - 3, CHUNK + 3], [CHUNK, 2 * CHUNK - 1],
    [2 * CHUNK + 7, plain.length - 1], [plain.length - 1, plain.length - 1],
  ];
  for (const [s, e] of ranges) {
    const got = await collect(decryptRange(header, enc.length, s, e, readFrom(enc)));
    assert.deepEqual(got, plain.subarray(s, e + 1), `rango ${s}-${e}`);
  }
});

test("si alguien toca o corta el archivo, falla en vez de mostrar cualquier cosa", async () => {
  const plain = randomBytes(2 * CHUNK + 10);
  const enc = encryptBlob(plain);
  const touched = Buffer.from(enc);
  touched[30] ^= 1;
  assert.throws(() => decryptBlob(touched));
  // Sin el último pedazo: el que queda último no está marcado como tal
  const cut = enc.subarray(0, 20 + 2 * (CHUNK + 16));
  assert.throws(() => decryptBlob(cut));
  await assert.rejects(collect(decryptRange(enc.subarray(0, 20), cut.length, CHUNK + 5, CHUNK + 10, readFrom(cut))));
});

test("con otra clave no se puede leer", async () => {
  const enc = encryptBlob(Buffer.from("foto privada"));
  const other = await mkdtemp(path.join(tmpdir(), "qule-otra-clave-"));
  await writeFile(path.join(other, "enc"), enc);
  // La clave se lee una sola vez por proceso: se prueba en un proceso aparte
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const script = `process.env.DATA_KEY=${JSON.stringify(randomBytes(32).toString("base64"))};
    const { decryptBlob } = await import(${JSON.stringify(new URL("./fileCrypt.ts", import.meta.url).href)});
    const fs = await import("node:fs");
    try { decryptBlob(fs.readFileSync(${JSON.stringify(path.join(other, "enc"))})); console.log("leyó"); } catch { console.log("falló"); }`;
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script]);
  await rm(other, { recursive: true, force: true });
  assert.equal(stdout.trim(), "falló");
});

test("las fotos y los videos se guardan cifrados en el disco", async () => {
  const { readImage, saveImage, videoFile } = await import("./storage.js");
  const webp = await sharp({ create: { width: 600, height: 600, channels: 3, background: { r: 192, g: 255, b: 238 } } }).webp().toBuffer();
  const key = await saveImage(webp);
  const stored = await readFile(path.join(dataDir, "uploads", key));
  assert.ok(isEncryptedBlob(stored));
  assert.equal(stored.subarray(0, 4).toString(), "QLE1");
  const back = await readImage(key);
  assert.equal(back?.subarray(8, 12).toString(), "WEBP");
  // La miniatura también queda cifrada
  const thumb = await readImage(key, "thumb");
  assert.equal(thumb?.subarray(8, 12).toString(), "WEBP");
  assert.ok(isEncryptedBlob(await readFile(path.join(dataDir, "uploads", "thumbs", key))));
  // Y la de la portada (#194)
  const cover = await readImage(key, "cover");
  assert.equal(cover?.subarray(8, 12).toString(), "WEBP");
  assert.ok(isEncryptedBlob(await readFile(path.join(dataDir, "uploads", "thumbs", `cover-${key}`))));
  // No queda ningún temporal suelto
  assert.deepEqual((await readdir(path.join(dataDir, "uploads"))).filter((f) => f.endsWith(".tmp")), []);

  // Un video viejo (sin cifrar) y uno nuevo (cifrado) se sirven igual por partes
  const mp4 = randomBytes(CHUNK * 2 + 99);
  const oldKey = `${crypto.randomUUID()}.mp4`;
  const newKey = `${crypto.randomUUID()}.mp4`;
  await writeFile(path.join(dataDir, "uploads", oldKey), mp4);
  await writeFile(path.join(dataDir, "uploads", newKey), encryptBlob(mp4));
  for (const k of [oldKey, newKey]) {
    const v = await videoFile(k);
    assert.equal(v?.size, mp4.length);
    const body = Buffer.from(await new Response(await v!.open(CHUNK - 10, CHUNK + 10)).arrayBuffer());
    assert.deepEqual(body, mp4.subarray(CHUNK - 10, CHUNK + 11));
  }
});
