import assert from "node:assert/strict";
import { test } from "node:test";
import { forbiddenGroupText, minorSignal } from "./moderation.js";

test("las palabras ambiguas no disparan alertas ni bloquean el nombre de un grupo", () => {
  for (const text of ["Menores a 40", "Me gustan más chicos, pero no menores de edad", "Perfil secundario", "Exalumnos del liceo"]) {
    assert.equal(minorSignal(text), null, text);
    assert.equal(forbiddenGroupText(text), null, text);
  }
});

test("se conservan las señales con edades concretas", () => {
  for (const text of ["+14", "-18", "15 años", "16a", "sub 18"]) {
    assert.ok(minorSignal(text), text);
    assert.equal(forbiddenGroupText(text)?.kind, "menores", text);
  }
});
