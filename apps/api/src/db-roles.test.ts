import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("la cuenta de servicio puede usar tablas actuales y nuevas sin cambiar el esquema", async (t) => {
  const database = new PGlite();
  t.after(() => database.close());
  await database.exec("CREATE TABLE public.existente (valor text)");
  await database.exec("CREATE SCHEMA drizzle; CREATE TABLE drizzle.migraciones (version integer)");
  const grants = await readFile(new URL("../../../deploy/postgres-runtime.sql", import.meta.url), "utf8");
  await database.exec(grants);
  await database.exec(grants);
  await database.exec("CREATE TABLE public.futura (valor text)");
  await database.exec("SET ROLE qule_api");
  await database.exec("INSERT INTO public.existente VALUES ('dato'); UPDATE public.existente SET valor = 'nuevo'");
  const values = await database.query<{ valor: string }>("SELECT valor FROM public.existente");
  assert.deepEqual(values.rows, [{ valor: "nuevo" }]);
  await database.exec("INSERT INTO public.futura VALUES ('posterior')");
  await assert.rejects(database.exec("ALTER TABLE public.existente ADD COLUMN nuevo text"));
  await assert.rejects(database.exec("CREATE TABLE public.no_autorizada (id integer)"));
  await assert.rejects(database.exec("SELECT * FROM drizzle.migraciones"));
  await database.exec("DELETE FROM public.existente");
});
