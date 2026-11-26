// Controla que el código (no el CSS, eso lo hace stylelint) respete la marca. Corre con npm run lint.
// - Sin colores sueltos en TS/TSX: van en packages/brand.
// - Sin style={{ … }} para cosas fijas: solo para valores que se calculan (tamaños, progreso).
// - El nombre de la app escrito a mano en archivos estáticos tiene que coincidir con APP_NAME.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const rel = (f) => relative(root, f).replaceAll("\\", "/");

// Archivos que pueden tener colores propios, y por qué
const COLOR_EXCEPTIONS = {
  "packages/brand/src/index.ts": "es la fuente de la marca",
  "apps/web/src/components/GoogleMark.tsx": "la G de Google lleva los colores de Google",
};
// Propiedades que se pueden pasar por style={{ }} porque se calculan en el momento
const DYNAMIC_STYLE_PROPS = new Set(["width", "height", "fontSize", "transform", "left", "top"]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) yield p;
  }
}

const errors = [];
const COLOR = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b|\b(?:rgba?|hsla?)\(/g;

for (const dir of ["apps/web/src", "apps/api/src", "packages"]) {
  for (const file of walk(join(root, dir))) {
    const name = rel(file);
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      const where = `${name}:${i + 1}`;
      if (!COLOR_EXCEPTIONS[name]) {
        // Saltea "#123" de issues/PRs en comentarios y anclas tipo href="#algo"
        const code = line.replace(/\/\/.*$/, "").replace(/(^|\s)#\d+\b/g, "");
        for (const m of code.matchAll(COLOR)) {
          errors.push(`${where}  color suelto "${m[0]}": usá la marca (packages/brand)`);
        }
      }
      if (name.endsWith(".tsx")) {
        for (const m of line.matchAll(/style=\{\{([^}]*)\}\}/g)) {
          const props = [...m[1].matchAll(/([A-Za-z]+)\s*:/g)].map((p) => p[1]);
          const fixed = props.filter((p) => !DYNAMIC_STYLE_PROPS.has(p));
          if (fixed.length) errors.push(`${where}  style={{ ${fixed.join(", ")} }}: usá una clase en styles.css`);
        }
      }
    });
  }
}

// Las variables de la marca se definen en packages/brand, no en el CSS (solo se permiten las de layout)
const LAYOUT_VARS = new Set(["--tabbar-h", "--tabbar-inset", "--safe-b", "--composer-action-height", "--people-grid-columns"]);
for (const name of readdirSync(join(root, "apps/web/src"))) {
  if (!name.endsWith(".css")) continue;
  readFileSync(join(root, "apps/web/src", name), "utf8").split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/(?:^|[{;])\s*(--[a-z0-9-]+)\s*:/g)) {
      if (!LAYOUT_VARS.has(m[1])) errors.push(`apps/web/src/${name}:${i + 1}  ${m[1]} se define en packages/brand, no en el CSS`);
    }
  });
}

// El service worker es un archivo estático: el nombre va a mano, pero tiene que ser el mismo
const appName = readFileSync(join(root, "packages/brand/src/index.ts"), "utf8").match(/APP_NAME = "([^"]+)"/)?.[1];
const sw = readFileSync(join(root, "apps/web/public/sw.js"), "utf8");
for (const m of sw.matchAll(/title: "([^"]*)"/g)) {
  if (m[1] !== appName) errors.push(`apps/web/public/sw.js  el título "${m[1]}" no coincide con APP_NAME ("${appName}")`);
}

if (errors.length) {
  console.error(`La marca no se está respetando en ${errors.length} lugar(es):\n`);
  for (const e of errors) console.error("  " + e);
  console.error("\nGuía: docs/LOOK.md");
  process.exit(1);
}
console.log("✓ La marca se respeta (colores, estilos y nombre).");
