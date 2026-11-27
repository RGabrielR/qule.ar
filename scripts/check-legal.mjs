// Controla que nadie cambie los Términos o la Política de privacidad sin decidir si hace falta que todas las
// personas los vuelvan a aceptar.
//
// La app ya pide aceptar de nuevo cuando sube TERMS_VERSION (ver apps/web/src/components/TermsBanner.tsx). El
// problema es que subirla es a mano y se olvida. Este chequeo guarda una huella (sha256) de cada texto en
// apps/web/src/legal/hashes.json y falla si el texto cambió y la huella no, con dos salidas:
//
//   - Cambio importante (una regla nueva, un dato nuevo que guardamos, un cambio de responsabilidad):
//       1. subí TERMS_VERSION en apps/web/src/legal/version.ts y en apps/api/src/legal.ts (la fecha de hoy);
//       2. poné esa fecha en el encabezado de terminos.md y privacidad.md ("Versión beta · 27 de noviembre de 2026");
//       3. corré `npm run legal:hash`.
//     Al desplegar, a todas las personas les aparece el cartel para aceptar la versión nueva.
//   - Cambio menor (un error de tipeo, un link, algo que no cambia lo que aceptaste):
//       `npm run legal:hash -- --menor`. No sube la versión y nadie tiene que aceptar de nuevo.
//
// Las dos salidas quedan en el PR (hashes.json cambia), así que quien revisa ve qué se decidió.
//
// Además controla que las dos TERMS_VERSION coincidan y que los encabezados de los textos tengan esa fecha.
// Uso: node scripts/check-legal.mjs [--write [--menor]]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const legalDir = path.join(root, "apps/web/src/legal");
const hashesFile = path.join(legalDir, "hashes.json");
const DOCS = ["terminos.md", "privacidad.md"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// Saltos de línea normalizados: en Windows git puede traer CRLF y la huella tiene que dar igual
const read = (file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const versionIn = (file) => /TERMS_VERSION\s*=\s*"(\d{4}-\d{2}-\d{2})"/.exec(read(file))?.[1];

const webVersion = versionIn(path.join(legalDir, "version.ts"));
const apiVersion = versionIn(path.join(root, "apps/api/src/legal.ts"));
const errors = [];

if (!webVersion || !apiVersion) errors.push("No encontré TERMS_VERSION en apps/web/src/legal/version.ts o en apps/api/src/legal.ts.");
else if (webVersion !== apiVersion) {
  errors.push(`TERMS_VERSION no coincide: la web dice ${webVersion} y la API ${apiVersion}. Tienen que ser iguales.`);
}

const [y, m, d] = (webVersion ?? "").split("-").map(Number);
const expectedDate = webVersion ? `${d} de ${MONTHS[m - 1]} de ${y}` : "";
const current = Object.fromEntries(DOCS.map((doc) => [doc, sha256(read(path.join(legalDir, doc)))]));

for (const doc of DOCS) {
  const header = /\*\*Versión beta · ([^*]+)\*\*/.exec(read(path.join(legalDir, doc)))?.[1];
  if (webVersion && header !== expectedDate) {
    errors.push(`${doc} dice "Versión beta · ${header ?? "(sin fecha)"}" y tiene que decir "Versión beta · ${expectedDate}" (TERMS_VERSION ${webVersion}).`);
  }
}

if (process.argv.includes("--write")) {
  let before = {};
  try {
    before = JSON.parse(readFileSync(hashesFile, "utf8"));
  } catch {
    // Primera vez: no hay huellas guardadas
  }
  const menor = process.argv.includes("--menor");
  if (!menor && before.version === webVersion && DOCS.some((doc) => before[doc] !== current[doc])) {
    console.error(
      "Cambiaste un texto legal pero TERMS_VERSION sigue en " + webVersion + ".\n" +
      "  - Si es un cambio importante, subí TERMS_VERSION (y la fecha de los encabezados) y volvé a correr esto.\n" +
      "  - Si es un cambio menor, corré `npm run legal:hash -- --menor`.",
    );
    process.exit(1);
  }
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  writeFileSync(hashesFile, JSON.stringify({ version: webVersion, ...current }, null, 2) + "\n");
  console.log(`Huellas de los textos legales guardadas (versión ${webVersion}${menor ? ", cambio menor" : ""}).`);
  process.exit(0);
}

let saved;
try {
  saved = JSON.parse(readFileSync(hashesFile, "utf8"));
} catch {
  errors.push("Falta apps/web/src/legal/hashes.json: corré `npm run legal:hash`.");
}
if (saved) {
  if (saved.version !== webVersion) {
    errors.push(`TERMS_VERSION es ${webVersion} pero las huellas son de ${saved.version}: corré \`npm run legal:hash\`.`);
  }
  for (const doc of DOCS) {
    if (saved[doc] !== current[doc]) {
      errors.push(
        `Cambió ${doc} y no se decidió si hace falta volver a aceptarlo.\n` +
        "  - Cambio importante: subí TERMS_VERSION (web y API) y la fecha de los encabezados, y corré `npm run legal:hash`.\n" +
        "    A todas las personas les va a aparecer el cartel para aceptar la versión nueva.\n" +
        "  - Cambio menor (tipeo, un link): corré `npm run legal:hash -- --menor`.",
      );
    }
  }
}

if (errors.length) {
  console.error("Textos legales:\n" + errors.map((e) => "- " + e).join("\n"));
  process.exit(1);
}
console.log(`Textos legales al día (versión ${webVersion}).`);
