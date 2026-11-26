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
  for (const text of [
    "Menores a 40", "Me gustan más chicos, pero no menores de edad", "Nada de menores", "Sin menores, solo +18",
    "Perfil secundario", "Exalumnos del liceo", "Lo conocí en la secundaria hace 20 años",
  ]) {
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

test("siguen saltando las palabras que apuntan a menores", () => {
  for (const text of [
    "Menorcitos", "Teens CABA", "teen", "busco menores", "Menores de 18", "menor de edad", "Pasivo menor",
    "No me importa, busco menores", "Voy a la secundaria", "Estoy en 5to de la secundaria", "Termino el secundario",
    "Estoy en el liceo",
  ]) {
    assert.ok(moderation.minorSignal(text), text);
    assert.equal(moderation.forbiddenGroupText(text)?.kind, "menores", text);
  }
});

test("no se permiten grupos que convocan a sexo donde otras personas lo pueden ver sin querer", () => {
  for (const text of ["Sexo en la plaza", "Garchar en parques", "Coger en baños públicos", "Sexo en la vía pública"]) {
    assert.equal(moderation.forbiddenGroupText(text)?.kind, "cruising", text);
  }
  // Se mira la conducta, no la palabra: "cruising" solo puede ser un sauna o un bar (discusión #270)
  for (const text of ["Cruising CABA", "cruisin zona norte", "Mate en la plaza", "Encuentros en parques para correr", "Club de cruceros"]) {
    assert.equal(moderation.forbiddenGroupText(text), null, text);
  }
});
