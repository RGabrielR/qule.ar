/**
 * Detects whether an image (or video) declares, in its own metadata, that it was made with AI.
 *
 * It only reads *positive provenance signals* that generators write on purpose:
 * - C2PA / Content Credentials (OpenAI, Google, Adobe, Microsoft, Sora, Veo…): the `digitalSourceType` of the
 *   `c2pa.created` action in the active manifest, following `parentOf` ingredients when the file was reopened.
 * - IPTC `DigitalSourceType` in XMP (Meta AI, Midjourney, stock sites…).
 * - Text that Stable Diffusion front-ends (A1111, Forge, ComfyUI, InvokeAI, NovelAI, Fooocus) store in PNG chunks
 *   or in EXIF.
 * - A known generator in EXIF `Software` / XMP `CreatorTool`.
 *
 * The absence of a signal says nothing: screenshots and most apps drop metadata. It never means "real".
 * Signatures are not validated on purpose: nobody forges metadata to label their own picture as AI, and a stale
 * hash (the file was edited afterwards by a tool that ignores C2PA) does not make the origin less true.
 *
 * Pure and dependency-free: it runs the same in the browser (before the crop re-encodes the picture) and in the API.
 */

/** "generated": the picture itself was created by an AI model. "edited": a real picture with AI-made parts. */
export type AiOrigin = "generated" | "edited";
export type AiSource = "c2pa" | "xmp" | "png" | "exif";
export type AiSignal = { origin: AiOrigin; source: AiSource };

export const AI_ORIGINS: readonly AiOrigin[] = ["generated", "edited"];

const IPTC_GENERATED = /(?:^|\/)trainedAlgorithmicMedia$/;
const IPTC_EDITED = /(?:^|\/)(?:compositeWithTrainedAlgorithmicMedia|compositeSynthetic)$/;

/** Generators that sign their name in `Software`/`CreatorTool`. Only whole product names, nothing generic. */
const GENERATOR_RE =
  /\b(?:midjourney|dall[·\- ]?e|stable diffusion|comfyui|novelai|invokeai|fooocus|automatic1111|leonardo\.ai|ideogram|adobe firefly)\b/i;

/** Generation parameters as written by A1111/Forge/SD.Next ("Steps: 20, Sampler: Euler a, CFG scale: 7…"). */
const SD_PARAMS_RE = /\bSteps: ?\d+,.*\b(?:Sampler|Seed|CFG scale): /s;

export function classifyDigitalSourceType(value: string | undefined | null): AiOrigin | null {
  const v = (value ?? "").trim();
  if (IPTC_GENERATED.test(v)) return "generated";
  if (IPTC_EDITED.test(v)) return "edited";
  return null;
}

export async function detectAiProvenance(input: Uint8Array | ArrayBuffer): Promise<AiSignal | null> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const parts = collectMetadata(bytes);
  // Compressed PNG text (zTXt, compressed iTXt): libvips writes XMP like this, ComfyUI may too
  for (const [key, data] of parts.pngCompressed.slice(0, 8)) {
    const raw = await inflate(data).catch(() => null);
    if (!raw) continue;
    const text = utf8.decode(raw);
    if (key === "XML:com.adobe.xmp") parts.xmp.push(text);
    else parts.pngText.push([key, text]);
  }
  const signals: AiSignal[] = [];
  const push = (origin: AiOrigin | null, source: AiSource) => {
    if (origin) signals.push({ origin, source });
  };

  for (const jumbf of parts.jumbf) push(safe(() => c2paOrigin(jumbf)), "c2pa");
  for (const xmp of parts.xmp) push(xmpOrigin(xmp), "xmp");
  for (const [key, text] of parts.pngText) push(pngTextOrigin(key, text), "png");
  for (const tiff of parts.exif) push(safe(() => exifOrigin(tiff)), "exif");

  return signals.find((s) => s.origin === "generated") ?? signals[0] ?? null;
}

function safe<T>(fn: () => T | null): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Containers: pull XMP packets, C2PA JUMBF stores, PNG text chunks and EXIF (TIFF) blocks out of the file.

type Metadata = {
  xmp: string[];
  jumbf: Uint8Array[];
  pngText: [string, string][];
  pngCompressed: [string, Uint8Array][];
  exif: Uint8Array[];
};

/** Most text we care about is a few KB; ComfyUI workflows can reach a few hundred. Anything bigger is ignored. */
const MAX_INFLATED = 2 * 1024 * 1024;

async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_INFLATED) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) out.set(c, (at += c.length) - c.length);
  return out;
}

const latin1 = new TextDecoder("latin1");
const utf8 = new TextDecoder("utf-8");

function u32(b: Uint8Array, at: number) {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

function u32le(b: Uint8Array, at: number) {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}

function ascii(b: Uint8Array, at: number, len: number) {
  return latin1.decode(b.subarray(at, at + len));
}

function indexOf(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  const first = needle[0];
  const last = hay.length - needle.length;
  outer: for (let i = hay.indexOf(first, from); i !== -1 && i <= last; i = hay.indexOf(first, i + 1)) {
    for (let j = 1; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const XMP_OPEN = enc("<x:xmpmeta");
const XMP_CLOSE = enc("</x:xmpmeta>");
const JUMB = enc("jumb");
const C2PA_UUID = enc("c2pa\u0000\u0011\u0000\u0010\u0080\u0000\u0000ª\u00008\u009bq");

function collectMetadata(b: Uint8Array): Metadata {
  const out: Metadata = { xmp: [], jumbf: [], pngText: [], pngCompressed: [], exif: [] };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) readJpeg(b, out);
  else if (b.length > 8 && ascii(b, 1, 3) === "PNG") readPng(b, out);
  else if (b.length > 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") readWebp(b, out);

  // Any other container (HEIF, MP4, MOV, GIF, TIFF…), or what the walkers missed: XMP packets and the C2PA store are
  // contiguous there, so a byte search finds them. In a video only the small metadata boxes are searched, never the
  // media data, so an 80 MB upload costs the same as a photo.
  const searchable = videoMetadata(b) ?? b;
  if (!out.xmp.length) out.xmp.push(...findXmp(searchable));
  if (!out.jumbf.length) {
    const store = findC2paStore(searchable);
    if (store) out.jumbf.push(store);
  }
  return out;
}

/** Most metadata boxes are a few KB; a long video's `moov` can reach a few MB. */
const MAX_VIDEO_METADATA = 4 * 1024 * 1024;
/** Where an MP4/MOV keeps metadata: C2PA and XMP in top-level `uuid` boxes, XMP and tags in `moov` › `udta`/`meta`. */
const MEDIA_BOXES = new Set(["mdat", "free", "skip", "wide"]);

/**
 * For an MP4/MOV (ISO BMFF with a `moov` box), the bytes of every box except the media data, glued together.
 * Only box headers are read to skip over the rest, so it takes the same time whatever the size of the video.
 * Anything else (photos, HEIF, whose XMP lives inside `mdat`) returns null and is searched whole.
 */
function videoMetadata(b: Uint8Array): Uint8Array | null {
  if (b.length < 16 || ascii(b, 4, 4) !== "ftyp") return null;
  const boxes = topLevelBoxes(b, 0, b.length);
  if (!boxes.some((box) => box.type === "moov")) return null;
  const keep: Uint8Array[] = [];
  let total = 0;
  const add = (part: Uint8Array) => {
    if (total + part.length > MAX_VIDEO_METADATA) return;
    keep.push(part);
    total += part.length;
  };
  for (const box of boxes) {
    if (MEDIA_BOXES.has(box.type)) continue;
    const part = b.subarray(box.start, box.end);
    if (box.type === "moov" && part.length > MAX_VIDEO_METADATA) {
      // A huge `moov` is almost all sample tables: keep only its metadata children
      for (const child of topLevelBoxes(b, box.start + 8, box.end)) {
        if (child.type === "udta" || child.type === "meta" || child.type === "uuid") add(b.subarray(child.start, child.end));
      }
    } else {
      add(part);
    }
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of keep) out.set(part, (at += part.length) - part.length);
  return out;
}

/** The boxes between `from` and `to`, reading only their headers. Stops at the first malformed one. */
function topLevelBoxes(b: Uint8Array, from: number, to: number) {
  const boxes: { type: string; start: number; end: number }[] = [];
  for (let at = from; at + 8 <= to && boxes.length < 1024;) {
    let size = u32(b, at);
    const type = ascii(b, at + 4, 4);
    if (size === 1) {
      if (at + 16 > to) break;
      size = u32(b, at + 8) * 2 ** 32 + u32(b, at + 12);
    } else if (size === 0) {
      size = to - at;
    }
    if (size < 8 || at + size > to) break;
    boxes.push({ type, start: at, end: at + size });
    at += size;
  }
  return boxes;
}

function findXmp(b: Uint8Array): string[] {
  const found: string[] = [];
  for (let at = indexOf(b, XMP_OPEN); at !== -1 && found.length < 4; at = indexOf(b, XMP_OPEN, at + 1)) {
    const end = indexOf(b, XMP_CLOSE, at);
    if (end === -1) break;
    found.push(utf8.decode(b.subarray(at, end + XMP_CLOSE.length)));
  }
  return found;
}

/** Finds a JUMBF superbox whose description box carries the C2PA store UUID, and returns it whole. */
function findC2paStore(b: Uint8Array): Uint8Array | null {
  for (let at = indexOf(b, C2PA_UUID); at !== -1; at = indexOf(b, C2PA_UUID, at + 1)) {
    // [LBox]['jumb'][LBox]['jumd'][UUID…]: the UUID sits 16 bytes after the start of the superbox
    const start = at - 16;
    if (start < 0 || ascii(b, start + 4, 4) !== "jumb" || ascii(b, start + 12, 4) !== "jumd") continue;
    const size = u32(b, start);
    if (size >= 16 && start + size <= b.length) return b.subarray(start, start + size);
  }
  return null;
}

function readJpeg(b: Uint8Array, out: Metadata) {
  // C2PA spreads its JUMBF across APP11 segments: [‘JP’][En][Z][LBox][TBox]payload. Segments after the first one
  // repeat the 8-byte box header, which has to be skipped when gluing them back together.
  const app11 = new Map<number, { seq: number; data: Uint8Array }[]>();
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // image data: no more metadata segments
    const len = (b[i + 2] << 8) | b[i + 3];
    const seg = b.subarray(i + 4, i + 2 + len);
    if (marker === 0xe1) {
      if (ascii(seg, 0, 6) === "Exif\0\0") out.exif.push(seg.subarray(6));
      else if (ascii(seg, 0, 28) === "http://ns.adobe.com/xap/1.0/") out.xmp.push(utf8.decode(seg.subarray(29)));
    } else if (marker === 0xeb && seg.length > 16 && seg[0] === 0x4a && seg[1] === 0x50) {
      const instance = (seg[2] << 8) | seg[3];
      const list = app11.get(instance) ?? [];
      list.push({ seq: u32(seg, 4), data: seg.subarray(8) });
      app11.set(instance, list);
    }
    i += 2 + len;
  }
  for (const segments of app11.values()) {
    segments.sort((a, z) => a.seq - z.seq);
    const header = segments[0].data;
    if (ascii(header, 4, 4) !== "jumb") continue;
    const headerLen = u32(header, 0) === 1 ? 16 : 8;
    const pieces = segments.map((s, n) => (n === 0 ? s.data : s.data.subarray(headerLen)));
    const glued = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of pieces) {
      glued.set(p, at);
      at += p.length;
    }
    if (findC2paStore(glued)) out.jumbf.push(glued);
  }
}

function readPng(b: Uint8Array, out: Metadata) {
  let i = 8;
  while (i + 12 <= b.length) {
    const len = u32(b, i);
    const type = ascii(b, i + 4, 4);
    const data = b.subarray(i + 8, i + 8 + len);
    if (type === "tEXt") {
      const nul = data.indexOf(0);
      if (nul > 0) out.pngText.push([ascii(data, 0, nul), latin1.decode(data.subarray(nul + 1))]);
    } else if (type === "zTXt") {
      // keyword\0 compressionMethod zlib-data
      const nul = data.indexOf(0);
      if (nul > 0) out.pngCompressed.push([ascii(data, 0, nul), data.subarray(nul + 2)]);
    } else if (type === "iTXt") {
      // keyword\0 compressionFlag compressionMethod language\0 translatedKeyword\0 text
      const nul = data.indexOf(0);
      const lang = nul > 0 ? data.indexOf(0, nul + 3) : -1;
      const translated = lang === -1 ? -1 : data.indexOf(0, lang + 1);
      if (translated !== -1) {
        const key = ascii(data, 0, nul);
        const body = data.subarray(translated + 1);
        if (data[nul + 1] === 1) out.pngCompressed.push([key, body]);
        else if (key === "XML:com.adobe.xmp") out.xmp.push(utf8.decode(body));
        else out.pngText.push([key, utf8.decode(body)]);
      }
    } else if (type === "eXIf") out.exif.push(data);
    else if (type === "caBX") out.jumbf.push(data);
    else if (type === "IEND") break;
    i += 12 + len;
  }
}

function readWebp(b: Uint8Array, out: Metadata) {
  let i = 12;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    const len = u32le(b, i + 4);
    const data = b.subarray(i + 8, i + 8 + len);
    if (type === "XMP ") out.xmp.push(utf8.decode(data));
    else if (type === "EXIF") out.exif.push(ascii(data, 0, 6) === "Exif\0\0" ? data.subarray(6) : data);
    else if (type === "C2PA") out.jumbf.push(data);
    i += 8 + len + (len & 1);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// XMP, PNG text and EXIF

// The XMP comes from the uploaded file, so it can be crafted. Each keyword is found first with a plain search and
// only a short window after it is read: an unbounded pattern scanning to the end of the text from every occurrence
// takes quadratic time ("DigitalSourceType>" repeated thousands of times without a closing "<").
const XMP_WINDOW = 512;

/** For each occurrence of `keyword`, the match of `after` right after it, reading at most XMP_WINDOW characters. */
function* afterKeyword(text: string, keyword: RegExp, after: RegExp) {
  for (const k of text.matchAll(keyword)) {
    const start = k.index + k[0].length;
    const m = after.exec(text.slice(start, start + XMP_WINDOW));
    if (m) yield m;
  }
}

// Attribute (DigitalSourceType="…"), element (<…DigitalSourceType>…<) or resource (rdf:resource="…")
const SOURCE_TYPE_VALUE = /^(?:\s*=\s*"([^"]*)"|>\s*([^<\s]+)\s*<|\s+rdf:resource="([^"]*)")/;
// Attribute (CreatorTool="…") or element (<…Software>…<)
const TOOL_VALUE = /^(?:\s*=\s*"([^"]*)"|>([^<]*)<)/;

function xmpOrigin(xmp: string): AiOrigin | null {
  let best: AiOrigin | null = null;
  for (const m of afterKeyword(xmp, /DigitalSourceType/g, SOURCE_TYPE_VALUE)) {
    const origin = classifyDigitalSourceType(m[1] ?? m[2] ?? m[3]);
    if (origin === "generated") return origin;
    best ??= origin;
  }
  if (best) return best;
  // The first tool that has a value, as before
  const tool = afterKeyword(xmp, /CreatorTool|Software/g, TOOL_VALUE).next().value;
  return tool && GENERATOR_RE.test(tool[1] ?? tool[2] ?? "") ? "generated" : null;
}

function pngTextOrigin(key: string, text: string): AiOrigin | null {
  switch (key) {
    case "parameters": // A1111, Forge, SD.Next, Fooocus
      return SD_PARAMS_RE.test(text) || /"(?:sampler|seed|steps)"\s*:/i.test(text) ? "generated" : null;
    case "prompt": // ComfyUI: the node graph that produced the image
    case "workflow":
      return /"class_type"\s*:|"nodes"\s*:/.test(text) ? "generated" : null;
    case "invokeai_metadata":
    case "invokeai_graph":
    case "sd-metadata":
    case "Dream":
      return "generated";
    case "Software":
    case "Source":
    case "Comment":
      return GENERATOR_RE.test(text) || SD_PARAMS_RE.test(text) ? "generated" : null;
    default:
      return null;
  }
}

/** Reads ImageDescription, Software and Artist from IFD0 and UserComment from the Exif IFD. */
function exifOrigin(t: Uint8Array): AiOrigin | null {
  const little = t[0] === 0x49;
  const view = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const u16 = (at: number) => view.getUint16(at, little);
  const u32x = (at: number) => view.getUint32(at, little);
  const texts: string[] = [];

  const readIfd = (offset: number, wanted: Set<number>, onExifPointer?: (at: number) => void) => {
    const count = u16(offset);
    for (let n = 0; n < count && n < 256; n++) {
      const entry = offset + 2 + n * 12;
      const tag = u16(entry);
      if (tag === 0x8769 && onExifPointer) onExifPointer(u32x(entry + 8));
      if (!wanted.has(tag)) continue;
      const len = u32x(entry + 4); // ASCII and UNDEFINED are both 1 byte per item
      const at = len <= 4 ? entry + 8 : u32x(entry + 8);
      const raw = t.subarray(at, at + Math.min(len, 64 * 1024));
      if (tag === 0x9286) texts.push(userComment(raw, little));
      else texts.push(latin1.decode(raw).replace(/\0+$/, ""));
    }
  };

  readIfd(u32x(4), new Set([0x010e, 0x0131, 0x013b]), (exifIfd) => readIfd(exifIfd, new Set([0x9286])));
  return texts.some((s) => GENERATOR_RE.test(s) || SD_PARAMS_RE.test(s)) ? "generated" : null;
}

function userComment(raw: Uint8Array, little: boolean): string {
  const charset = ascii(raw, 0, 8);
  const body = raw.subarray(8);
  if (charset.startsWith("UNICODE")) {
    // UCS-2; writers disagree on byte order, so guess it from where the zero bytes are
    const le = body.length > 1 && body[1] === 0 && body[0] !== 0 ? true : body[0] === 0 ? false : little;
    return new TextDecoder(le ? "utf-16le" : "utf-16be").decode(body);
  }
  return utf8.decode(body);
}

// ---------------------------------------------------------------------------------------------------------------
// C2PA: JUMBF boxes + CBOR assertions

type Box = { type: string; label: string; payload: Uint8Array; children: Box[] };

function parseBoxes(b: Uint8Array, depth = 0): Box[] {
  const boxes: Box[] = [];
  let i = 0;
  while (i + 8 <= b.length) {
    let size = u32(b, i);
    const type = ascii(b, i + 4, 4);
    let header = 8;
    if (size === 1) {
      size = u32(b, i + 8) * 2 ** 32 + u32(b, i + 12);
      header = 16;
    } else if (size === 0) size = b.length - i;
    if (size < header || i + size > b.length) break;
    const payload = b.subarray(i + header, i + size);
    const box: Box = { type, label: "", payload, children: [] };
    if (type === "jumb" && depth < 12) {
      box.children = parseBoxes(payload, depth + 1);
      const desc = box.children[0];
      if (desc?.type === "jumd") box.label = jumdLabel(desc.payload);
    }
    boxes.push(box);
    i += size;
  }
  return boxes;
}

/** jumd = UUID(16) + toggles(1) + label (null-terminated, present when toggles has bit 2). */
function jumdLabel(p: Uint8Array): string {
  if (p.length < 17 || !(p[16] & 0x02)) return "";
  const end = p.indexOf(0, 17);
  return utf8.decode(p.subarray(17, end === -1 ? p.length : end));
}

function c2paOrigin(jumbf: Uint8Array): AiOrigin | null {
  const store = parseBoxes(jumbf).find((box) => box.label === "c2pa");
  if (!store) return null;
  const manifests = new Map<string, Box>();
  const order: Box[] = [];
  for (const m of store.children) {
    if (m.type !== "jumb") continue;
    manifests.set(m.label, m);
    order.push(m);
  }
  // The active manifest is the last one in the store
  return manifestOrigin(order[order.length - 1], manifests, 0);
}

type Json = null | boolean | number | string | Uint8Array | Json[] | { [k: string]: Json };

function manifestOrigin(manifest: Box | undefined, all: Map<string, Box>, depth: number): AiOrigin | null {
  if (!manifest || depth > 8) return null;
  const assertionStore = manifest.children.find((c) => c.label === "c2pa.assertions");
  if (!assertionStore) return null;

  let created: AiOrigin | null = null;
  let createdSeen = false;
  let edited = false;
  let parent: string | null = null;
  let declaredType: AiOrigin | null = null;

  for (const assertion of assertionStore.children) {
    const base = assertion.label.replace(/__\d+$/, "");
    const body = assertion.children.find((c) => c.type === "cbor");
    if (!body) continue;
    if (base === "c2pa.actions" || base === "c2pa.actions.v2") {
      const data = decodeCbor(body.payload) as { actions?: Json[] } | null;
      for (const a of Array.isArray(data?.actions) ? data.actions : []) {
        if (!a || typeof a !== "object" || Array.isArray(a) || a instanceof Uint8Array) continue;
        const dst = typeof a.digitalSourceType === "string" ? a.digitalSourceType : "";
        const origin = classifyDigitalSourceType(dst);
        if (a.action === "c2pa.created") {
          createdSeen = true;
          created = origin;
        } else if (origin) edited = true;
      }
    } else if (base === "c2pa.digital-source-type") {
      // Not in the spec, but some generators (Ideogram) declare the source type in its own assertion
      const data = decodeCbor(body.payload) as { value?: Json } | null;
      declaredType = classifyDigitalSourceType(typeof data?.value === "string" ? data.value : "");
    } else if (base.startsWith("c2pa.ingredient")) {
      const data = decodeCbor(body.payload) as Record<string, Json> | null;
      if (data?.relationship !== "parentOf") continue;
      const ref = (data.activeManifest ?? data.active_manifest ?? data.c2pa_manifest) as { url?: Json } | null;
      const url = typeof ref?.url === "string" ? ref.url : "";
      parent = /self#jumbf=\/?c2pa\/([^/]+)/.exec(url)?.[1] ?? null;
    }
  }

  if (created === "generated" || declaredType === "generated") return "generated";
  // Opened from another image: its origin is the parent's
  const inherited = !createdSeen && parent ? manifestOrigin(all.get(parent), all, depth + 1) : null;
  if (inherited === "generated") return "generated";
  if (created === "edited" || edited || inherited === "edited" || declaredType === "edited") return "edited";
  return null;
}

/** Minimal CBOR decoder (RFC 8949), enough for C2PA assertions. Tags are dropped, keys become strings. */
export function decodeCbor(b: Uint8Array): Json {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 0;
  let budget = 100_000; // items: protects against hostile files

  const length = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) return b[i++];
    if (info === 25) return (i += 2), view.getUint16(i - 2);
    if (info === 26) return (i += 4), view.getUint32(i - 4);
    if (info === 27) return (i += 8), Number(view.getBigUint64(i - 8));
    if (info === 31) return -1; // indefinite
    throw new Error("cbor: bad length");
  };

  const item = (depth: number): Json => {
    if (--budget < 0 || depth > 64 || i >= b.length) throw new Error("cbor: too deep");
    const head = b[i++];
    const major = head >> 5;
    const info = head & 0x1f;
    if (major === 7) {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22 || info === 23) return null;
      if (info === 25) return (i += 2), half(view.getUint16(i - 2));
      if (info === 26) return (i += 4), view.getFloat32(i - 4);
      if (info === 27) return (i += 8), view.getFloat64(i - 8);
      if (info === 31) throw new Error("cbor: unexpected break");
      return null;
    }
    const n = length(info);
    switch (major) {
      case 0:
        return n;
      case 1:
        return -1 - n;
      case 2:
      case 3: {
        let chunk: Uint8Array;
        if (n === -1) {
          const parts: Uint8Array[] = [];
          while (b[i] !== 0xff) {
            const part = item(depth + 1);
            parts.push(typeof part === "string" ? enc(part) : (part as Uint8Array));
          }
          i++;
          chunk = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
          let at = 0;
          for (const p of parts) chunk.set(p, (at += p.length) - p.length);
        } else {
          if (i + n > b.length) throw new Error("cbor: truncated");
          chunk = b.subarray(i, (i += n));
        }
        return major === 3 ? utf8.decode(chunk) : chunk;
      }
      case 4: {
        const arr: Json[] = [];
        if (n === -1) {
          while (b[i] !== 0xff) arr.push(item(depth + 1));
          i++;
        } else for (let k = 0; k < n; k++) arr.push(item(depth + 1));
        return arr;
      }
      case 5: {
        const obj: Record<string, Json> = {};
        const read = () => {
          const key = item(depth + 1);
          obj[String(key)] = item(depth + 1);
        };
        if (n === -1) {
          while (b[i] !== 0xff) read();
          i++;
        } else for (let k = 0; k < n; k++) read();
        return obj;
      }
      default: // 6: tag, the content is what matters
        return item(depth + 1);
    }
  };
  return item(0);
}

function half(h: number): number {
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  const v = exp === 0 ? frac * 2 ** -24 : exp === 31 ? (frac ? NaN : Infinity) : (frac + 1024) * 2 ** (exp - 25);
  return h & 0x8000 ? -v : v;
}
