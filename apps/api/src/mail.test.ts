import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

/**
 * Topes de mails (mail.ts): recuperar la contraseña tiene un tope por dirección (3 por día, uno por minuto) y todo
 * junto tiene un tope general por día. Se cuentan en la base para que valgan entre los varios procesos del API.
 */

const dataDir = await mkdtemp(path.join(tmpdir(), "qule-mail-"));
process.env.DATA_DIR = dataDir;
process.env.DATA_KEY ??= randomBytes(32).toString("base64");
process.env.MAIL_DAILY_CAP = "10";

const { db, schema, runMigrations, closeDb } = await import("./db/index.js");
const { allowMail } = await import("./mail.js");

before(async () => {
  await runMigrations();
});
after(async () => {
  await closeDb();
  await rm(dataDir, { recursive: true, force: true });
});

const at = (min: number) => new Date(Date.UTC(2026, 10, 22, 12, min));

test("recuperar la contraseña: tres pedidos en el día pasan, el cuarto no, y no dos en el mismo minuto", async () => {
  await db.delete(schema.mailLog);
  assert.equal(await allowMail("Ana@Ejemplo.com", "reset", at(0)), true);
  // Mismo minuto (y la dirección se compara sin mayúsculas): no
  assert.equal(await allowMail("ana@ejemplo.com", "reset", at(0.5)), false);
  assert.equal(await allowMail("ana@ejemplo.com", "reset", at(5)), true);
  assert.equal(await allowMail("ana@ejemplo.com", "reset", at(30)), true);
  assert.equal(await allowMail("ana@ejemplo.com", "reset", at(60)), false);
  // Otra dirección no se ve afectada
  assert.equal(await allowMail("beto@ejemplo.com", "reset", at(60)), true);
  // Los avisos de la cuenta no tienen tope por dirección
  assert.equal(await allowMail("ana@ejemplo.com", "account", at(61)), true);
});

test("tope general: pasado el límite del día no sale ningún mail, y al día siguiente vuelve", async () => {
  await db.delete(schema.mailLog);
  for (let i = 0; i < 10; i++) assert.equal(await allowMail(`p${i}@ejemplo.com`, "reset", at(i)), true);
  assert.equal(await allowMail("otra@ejemplo.com", "reset", at(20)), false);
  assert.equal(await allowMail("otra@ejemplo.com", "account", at(20)), false);
  assert.equal(await allowMail("otra@ejemplo.com", "reset", new Date(at(30).getTime() + 86_400_000)), true);
});

test("tope general con muchos pedidos a la vez: nunca sale más del límite", async () => {
  await db.delete(schema.mailLog);
  const results = await Promise.all(Array.from({ length: 25 }, (_, i) => allowMail(`c${i}@ejemplo.com`, "account", at(i % 50))));
  assert.equal(results.filter(Boolean).length, 10);
  // Lo que no salió no queda anotado
  const rows = await db.select().from(schema.mailLog);
  assert.equal(rows.length, results.filter(Boolean).length);
});

test("no se guarda la dirección, solo un hash", async () => {
  const rows = await db.select().from(schema.mailLog);
  assert.ok(rows.length > 0);
  for (const r of rows) assert.match(r.toHash, /^[0-9a-f]{64}$/);
});
