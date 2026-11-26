import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readOrCreateDevFile } from "./devFile.js";

test("las claves de desarrollo se crean una sola vez y solo las lee el dueño", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "qule-devfile-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "sub", "clave");

  let created = 0;
  const make = () => `clave-${++created}`;
  // Varias lecturas seguidas (como varios procesos al arrancar) ven siempre la misma clave
  const values = [readOrCreateDevFile(file, make), readOrCreateDevFile(file, make), readOrCreateDevFile(file, make)];
  assert.deepEqual(new Set(values), new Set(["clave-1"]));

  if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
});
