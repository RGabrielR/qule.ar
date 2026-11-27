// Baja el modelo de NudeNet (320n.onnx, 12 MB) que usa la revisión de fotos explícitas (ver src/explicit/).
//
// Sale del paquete oficial de NudeNet en PyPI (AGPL-3.0, github.com/notAI-tech/NudeNet): es el mismo archivo que
// el de los releases de GitHub, pero PyPI se puede bajar sin cuenta. Se verifica el hash del paquete y del modelo:
// si no coinciden, no se guarda nada. El modelo corre en nuestro servidor; ninguna foto sale a otro lado.
//
// Uso: node scripts/nudenet-model.mjs [destino]   (por defecto, models/nudenet-320n.onnx)
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const WHEEL_URL = "https://files.pythonhosted.org/packages/1c/ee/1aa02d44ba958cc77e16ff1e41a0aac5e721037db7bf62b9c9d124917f87/nudenet-3.4.2-py3-none-any.whl";
const WHEEL_SHA256 = "5937dbd84e5d8e5de038f08ffea5a1bb50a08475776bf2b4795914ce0eaf0331";
const MODEL_ENTRY = "nudenet/320n.onnx";
const MODEL_SHA256 = "c15d8273adad2d0a92f014cc69ab2d6c311a06777a55545f2c4eb46f51911f0f";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(process.argv[2] ?? path.join(here, "../models/nudenet-320n.onnx"));
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

if (existsSync(target) && sha256(await readFile(target)) === MODEL_SHA256) {
  console.log(`El modelo ya está: ${target}`);
  process.exit(0);
}

const res = await fetch(WHEEL_URL);
if (!res.ok) throw new Error(`No se pudo bajar el paquete de NudeNet (${res.status})`);
const wheel = Buffer.from(await res.arrayBuffer());
if (sha256(wheel) !== WHEEL_SHA256) throw new Error("El paquete de NudeNet no coincide con el esperado");

const model = unzipEntry(wheel, MODEL_ENTRY);
if (sha256(model) !== MODEL_SHA256) throw new Error("El modelo no coincide con el esperado");

await mkdir(path.dirname(target), { recursive: true });
await writeFile(`${target}.tmp`, model);
await rename(`${target}.tmp`, target);
console.log(`Modelo guardado: ${target} (${(model.length / 1e6).toFixed(1)} MB)`);

/** Saca un archivo de un .zip (un .whl es un zip) leyendo el índice central. Alcanza para este paquete. */
function unzipEntry(zip, name) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("El paquete no es un zip válido");
  const entries = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < entries; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("Índice del zip dañado");
    const method = zip.readUInt16LE(p + 10);
    const compressed = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    if (zip.toString("utf8", p + 46, p + 46 + nameLen) === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + compressed);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`Compresión no soportada (${method})`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`No está ${name} en el paquete`);
}
