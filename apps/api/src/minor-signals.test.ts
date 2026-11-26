import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

// moderation.ts usa la base (reportSpam.ts): una base temporal que se cierra al terminar, así el proceso no queda colgado
let moderation: typeof import("./moderation.js");
let dir = "";
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qule-menores-"));
  process.env.DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  moderation = await import("./moderation.js");
});
after(async () => {
  const { closeDb } = await import("./db/index.js");
  await closeDb();
  await rm(dir, { recursive: true, force: true });
});

test("las palabras ambiguas no disparan alertas ni bloquean el nombre de un grupo", () => {
  for (const text of ["Menores a 40", "Me gustan más chicos, pero no menores de edad", "Perfil secundario", "Exalumnos del liceo"]) {
    assert.equal(moderation.minorSignal(text), null, text);
    assert.equal(moderation.forbiddenGroupText(text), null, text);
  }
});

test("se conservan las señales con edades concretas", () => {
  for (const text of ["+14", "-18", "15 años", "16a", "sub 18"]) {
    assert.ok(moderation.minorSignal(text), text);
    assert.equal(moderation.forbiddenGroupText(text)?.kind, "menores", text);
  }
});
