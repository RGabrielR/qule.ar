import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import sharp, { type Exif } from "sharp";
import { detectAiProvenance } from "@mortero/shared/aiProvenance";
import { aiOriginOf } from "./aiOrigin.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/ai/${name}`, import.meta.url));
const IPTC = "http://cv.iptc.org/newscodes/digitalsourcetype";
const base = () => sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 120, g: 90, b: 60 } } });

/** Mete chunks de texto en un PNG, justo antes de IEND. */
function pngWithText(png: Buffer, entries: [string, string][]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunks = entries.map(([key, text]) => {
    const data = Buffer.concat([Buffer.from(key, "latin1"), Buffer.from([0]), Buffer.from(text, "latin1")]);
    const typed = Buffer.concat([Buffer.from("tEXt"), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    typed.copy(out, 4);
    out.writeUInt32BE(crc(typed), 8 + data.length);
    return out;
  });
  const iend = png.length - 12;
  return Buffer.concat([png.subarray(0, iend), ...chunks, png.subarray(iend)]);
}

/** Vuelve a partir el JUMBF de un JPEG en segmentos APP11 chicos, como hacen los manifiestos de más de 64 KB. */
function resplitApp11(jpeg: Buffer, size: number): Buffer {
  const segments: Buffer[] = [];
  let jumbf: Buffer | null = null;
  let i = 2;
  while (jpeg[i] === 0xff && jpeg[i + 1] !== 0xda) {
    const len = jpeg.readUInt16BE(i + 2);
    const seg = jpeg.subarray(i, i + 2 + len);
    if (jpeg[i + 1] === 0xeb) jumbf = seg.subarray(12);
    else segments.push(seg);
    i += 2 + len;
  }
  assert.ok(jumbf);
  const header = jumbf.subarray(0, 8);
  const parts: Buffer[] = [];
  for (let at = 0, seq = 1; at < jumbf.length; at += size, seq++) {
    const body = Buffer.concat([seq === 1 ? Buffer.alloc(0) : header, jumbf.subarray(at, at + size)]);
    const seg = Buffer.alloc(12);
    seg.writeUInt16BE(0xffeb, 0);
    seg.writeUInt16BE(10 + body.length, 2);
    seg.write("JP", 4, "latin1");
    seg.writeUInt16BE(0x0211, 6);
    seg.writeUInt32BE(seq, 8);
    parts.push(Buffer.concat([seg, body]));
  }
  // Desordenados a propósito: se ordenan por número de secuencia
  return Buffer.concat([jpeg.subarray(0, 2), ...segments, ...parts.reverse(), jpeg.subarray(i)]);
}

describe("C2PA (Content Credentials)", () => {
  test("creada por IA, en JPEG, PNG y WebP", async () => {
    for (const ext of ["jpg", "png", "webp"]) {
      assert.deepEqual(await detectAiProvenance(fixture(`c2pa-generated.${ext}`)), { origin: "generated", source: "c2pa" }, ext);
    }
  });

  test("foto real retocada con IA", async () => {
    assert.deepEqual(await detectAiProvenance(fixture("c2pa-edited.jpg")), { origin: "edited", source: "c2pa" });
  });

  test("foto de cámara firmada: sin señal", async () => {
    assert.equal(await detectAiProvenance(fixture("c2pa-camera.jpg")), null);
  });

  test("reabierta en un editor que firma: sigue al ingrediente padre", async () => {
    assert.equal((await detectAiProvenance(fixture("c2pa-reopened.jpg")))?.origin, "generated");
    assert.equal(await detectAiProvenance(fixture("c2pa-camera-reopened.jpg")), null);
  });

  test("manifiesto partido en varios segmentos APP11", async () => {
    const split = resplitApp11(fixture("c2pa-generated.jpg"), 1500);
    assert.ok(split.filter((_, n) => split[n] === 0xff && split[n + 1] === 0xeb).length >= 3);
    assert.equal((await detectAiProvenance(split))?.origin, "generated");
  });

  test("archivos rotos o truncados no rompen nada", async () => {
    const good = fixture("c2pa-generated.png");
    for (const cut of [10, 100, 1000, 5000, good.length - 10]) {
      await assert.doesNotReject(detectAiProvenance(good.subarray(0, cut)));
    }
    const garbage = Buffer.from(good);
    for (let n = 200; n < garbage.length; n += 97) garbage[n] ^= 0x5a;
    await assert.doesNotReject(detectAiProvenance(garbage));
    assert.equal(await detectAiProvenance(new Uint8Array(0)), null);
  });
});

describe("XMP (IPTC DigitalSourceType)", () => {
  const xmp = (value: string, form: "attr" | "element" | "resource") => {
    const field =
      form === "attr" ? `Iptc4xmpExt:DigitalSourceType="${value}"` :
      form === "resource" ? "" : "";
    const inner =
      form === "element" ? `<Iptc4xmpExt:DigitalSourceType>${value}</Iptc4xmpExt:DigitalSourceType>` :
      form === "resource" ? `<Iptc4xmpExt:DigitalSourceType rdf:resource="${value}"/>` : "";
    return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" ${field}>${inner}</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  };

  test("trainedAlgorithmicMedia, en las tres formas de escribirlo", async () => {
    for (const form of ["attr", "element", "resource"] as const) {
      const jpeg = await base().jpeg().withXmp(xmp(`${IPTC}/trainedAlgorithmicMedia`, form)).toBuffer();
      assert.deepEqual(await detectAiProvenance(jpeg), { origin: "generated", source: "xmp" }, form);
    }
  });

  test("en PNG y WebP", async () => {
    const value = xmp(`${IPTC}/trainedAlgorithmicMedia`, "attr");
    assert.equal((await detectAiProvenance(await base().png().withXmp(value).toBuffer()))?.origin, "generated");
    assert.equal((await detectAiProvenance(await base().webp().withXmp(value).toBuffer()))?.origin, "generated");
  });

  test("retocada, de cámara o algorítmica sin IA", async () => {
    const of = async (v: string) => detectAiProvenance(await base().jpeg().withXmp(xmp(`${IPTC}/${v}`, "attr")).toBuffer());
    assert.equal((await of("compositeWithTrainedAlgorithmicMedia"))?.origin, "edited");
    assert.equal(await of("digitalCapture"), null);
    assert.equal(await of("algorithmicMedia"), null);
    assert.equal(await of("computationalCapture"), null);
  });

  test("un XMP armado para trabar la lectura se resuelve rápido (CodeQL: expresión regular polinómica)", async () => {
    // Miles de claves sin cerrar: con un patrón sin límite, cada una se leía hasta el final del texto
    for (const [label, bomb] of [
      ["DigitalSourceType", "DigitalSourceType>" + "DigitalSourceType>!".repeat(15_000)],
      ["Software", "Software>" + "Software>;".repeat(20_000)],
      ["CreatorTool", 'CreatorTool="' + "x".repeat(200_000)],
    ] as const) {
      const jpeg = await base().jpeg().withXmp(`<x:xmpmeta xmlns:x="adobe:ns:meta/">${bomb}</x:xmpmeta>`).toBuffer();
      const started = performance.now();
      assert.equal(await detectAiProvenance(jpeg), null, label);
      const ms = performance.now() - started;
      assert.ok(ms < 500, `${label}: ${Math.round(ms)} ms`);
    }
    // Y lo legítimo, cerca de esas claves, se sigue leyendo
    const real = `<x:xmpmeta xmlns:x="adobe:ns:meta/">${"Software>;".repeat(1_000)}<a Iptc4xmpExt:DigitalSourceType="${IPTC}/trainedAlgorithmicMedia"/></x:xmpmeta>`;
    assert.equal((await detectAiProvenance(await base().jpeg().withXmp(real).toBuffer()))?.origin, "generated");
  });
});

describe("Stable Diffusion y compañía", () => {
  const png = () => base().png().toBuffer();

  test("A1111 / Forge: chunk parameters", async () => {
    const params = "una persona en la playa\nNegative prompt: blurry\nSteps: 28, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 1234, Size: 512x768";
    assert.deepEqual(await detectAiProvenance(pngWithText(await png(), [["parameters", params]])), { origin: "generated", source: "png" });
  });

  test("ComfyUI: grafo de nodos en prompt y workflow", async () => {
    const prompt = JSON.stringify({ 3: { class_type: "KSampler", inputs: { seed: 1 } } });
    assert.equal((await detectAiProvenance(pngWithText(await png(), [["prompt", prompt]])))?.origin, "generated");
    assert.equal((await detectAiProvenance(pngWithText(await png(), [["workflow", JSON.stringify({ nodes: [] })]])))?.origin, "generated");
  });

  test("NovelAI e InvokeAI", async () => {
    assert.equal((await detectAiProvenance(pngWithText(await png(), [["Software", "NovelAI"]])))?.origin, "generated");
    assert.equal((await detectAiProvenance(pngWithText(await png(), [["invokeai_metadata", "{}"]])))?.origin, "generated");
  });

  test("A1111 en JPEG: parámetros en EXIF", async () => {
    const jpeg = await base().jpeg().withExif({ IFD0: { ImageDescription: "retrato\nSteps: 30, Sampler: Euler a, CFG scale: 7, Seed: 99" } }).toBuffer();
    assert.deepEqual(await detectAiProvenance(jpeg), { origin: "generated", source: "exif" });
  });

  test("generador conocido en Software", async () => {
    const jpeg = await base().jpeg().withExif({ IFD0: { Software: "Midjourney" } }).toBuffer();
    assert.equal((await detectAiProvenance(jpeg))?.origin, "generated");
  });
});

describe("sin falsos positivos", () => {
  test("fotos comunes con metadatos de cámara y editores", async () => {
    const cases: Exif[] = [
      { IFD0: { Make: "samsung", Model: "SM-S928B", Software: "S928BXXU4BXK1" } },
      { IFD0: { Make: "Apple", Model: "iPhone 16", Software: "18.1" } },
      { IFD0: { Software: "Adobe Photoshop 26.0 (Windows)" } },
      { IFD0: { Software: "Snapseed 2.0", ImageDescription: "Imagen de la playa, hecha con el celu" } },
      { IFD0: { ImageDescription: "Steps: lo que sea" } },
    ];
    for (const exif of cases) assert.equal(await detectAiProvenance(await base().jpeg().withExif(exif).toBuffer()), null, JSON.stringify(exif));
  });

  test("PNG con textos inocentes", async () => {
    const png = await base().png().toBuffer();
    const entries: [string, string][] = [["parameters", "brillo=2"], ["prompt", "hola"], ["Comment", "foto con amigos"], ["Software", "GIMP 2.10"]];
    for (const entry of entries) assert.equal(await detectAiProvenance(pngWithText(png, [entry])), null, entry[0]);
  });

  test("lo que guarda el servidor ya no trae nada", async () => {
    const { data } = await sharp(fixture("c2pa-generated.jpg")).webp().toBuffer({ resolveWithObject: true });
    assert.equal(await detectAiProvenance(data), null);
  });
});

describe("videos (MP4/MOV)", () => {
  const box = (type: string, payload: Uint8Array | string) => {
    const body = typeof payload === "string" ? Buffer.from(payload, "utf8") : Buffer.from(payload);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + body.length, 0);
    head.write(type, 4, "latin1");
    return Buffer.concat([head, body]);
  };
  const xmp = (type: string) => '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + '<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" '
    + `Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/${type}"/></rdf:RDF></x:xmpmeta>`;
  const ftyp = box("ftyp", "isom\u0000\u0000\u0002\u0000isomiso2mp41");
  const mdat = (size: number, inside = "") => box("mdat", Buffer.concat([Buffer.from(inside), Buffer.alloc(size)]));

  test("lee la marca de las cajas de metadatos, antes o después del video", async () => {
    const mark = box("uuid", "\u00be\u007a\u00cf\u00cb\u0097\u00a9\u0042\u00e8\u009c\u0071\u0099\u0094\u0091\u00e3\u00af\u00ac" + xmp("trainedAlgorithmicMedia"));
    const moov = box("moov", box("mvhd", Buffer.alloc(100)));
    assert.deepEqual(await detectAiProvenance(Buffer.concat([ftyp, moov, mark, mdat(1000)])), { origin: "generated", source: "xmp" });
    assert.deepEqual(await detectAiProvenance(Buffer.concat([ftyp, mdat(1000), moov, mark])), { origin: "generated", source: "xmp" });
    // Dentro de moov › udta, aunque moov sea enorme (tablas de un video largo)
    const bigMoov = box("moov", Buffer.concat([box("trak", Buffer.alloc(5 * 1024 * 1024)), box("udta", box("XMP_", xmp("trainedAlgorithmicMedia")))]));
    assert.equal((await detectAiProvenance(Buffer.concat([ftyp, mdat(1000), bigMoov])))?.origin, "generated");
  });

  test("no recorre el video: un MP4 de 80 MB se revisa en un ratito", async () => {
    // Una marca escondida en los datos del video no cuenta (y buscarla obligaría a recorrer los 80 MB)
    const big = Buffer.concat([ftyp, box("moov", box("mvhd", Buffer.alloc(100))), mdat(80 * 1024 * 1024, xmp("trainedAlgorithmicMedia"))]);
    const start = performance.now();
    assert.equal(await detectAiProvenance(big), null);
    assert.ok(performance.now() - start < 200, `tardó ${Math.round(performance.now() - start)} ms`);
  });

  test("un MP4 roto no traba ni rompe nada", async () => {
    const broken = Buffer.concat([ftyp, box("moov", ""), Buffer.from([0, 0, 0, 3, 0x6d, 0x64, 0x61, 0x74])]);
    assert.equal(await detectAiProvenance(broken), null);
  });
});

describe("aiOriginOf: detectado + lo que manda la web", () => {
  test("gana la señal más fuerte; lo declarado solo suma", async () => {
    const plain = new Uint8Array([1, 2, 3]);
    assert.equal(await aiOriginOf(plain), null);
    assert.equal(await aiOriginOf(plain, "generated"), "generated");
    assert.equal(await aiOriginOf(plain, "edited"), "edited");
    assert.equal(await aiOriginOf(plain, "cualquiera"), null);
    assert.equal(await aiOriginOf(plain, ["generated"]), null);
    assert.equal(await aiOriginOf(fixture("c2pa-generated.jpg"), "edited"), "generated");
    assert.equal(await aiOriginOf(fixture("c2pa-edited.jpg"), "generated"), "generated");
    // La web no puede sacarle la marca a un archivo que la trae
    assert.equal(await aiOriginOf(fixture("c2pa-generated.jpg"), ""), "generated");
  });

  test("si la detección falla, sigue sin marca (o con la que mandó la web) y no frena la subida", async () => {
    const broken = async (): Promise<never> => {
      throw new RangeError("Offset is outside the bounds of the DataView");
    };
    const plain = new Uint8Array([1, 2, 3]);
    assert.equal(await aiOriginOf(plain, undefined, broken), null);
    assert.equal(await aiOriginOf(plain, "generated", broken), "generated");
    assert.equal(await aiOriginOf(plain, "edited", broken), "edited");
  });
});
