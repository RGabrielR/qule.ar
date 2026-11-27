import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

test("la nota de un favorito se guarda cifrada y se lee igual", async (t) => {
  const client = new PGlite();
  t.after(() => client.close());
  process.env.DATA_KEY ??= randomBytes(32).toString("base64");
  const schema = await import("./db/schema.js");
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle/", import.meta.url)) });

  await db.insert(schema.user).values([
    { id: "ana", name: "Ana", email: "ana@example.test" },
    { id: "beto", name: "Beto", email: "beto@example.test" },
  ]);
  const nota = "Me contó que se testeó la semana pasada";
  await db.insert(schema.favorite).values({ userId: "ana", favoriteId: "beto", note: nota });

  // En la base no se lee: quien vea la base o un backup sin DATA_KEY no la puede leer
  const raw = await client.query<{ note: string }>(`SELECT "note" FROM "favorite"`);
  assert.match(raw.rows[0]!.note, /^v1:/);
  assert.doesNotMatch(raw.rows[0]!.note, /testeó/);

  // La app la lee igual
  const [row] = await db.select({ note: schema.favorite.note }).from(schema.favorite);
  assert.equal(row!.note, nota);

  // Sin nota sigue siendo null
  await db.insert(schema.favorite).values({ userId: "beto", favoriteId: "ana" });
  const rows = await client.query<{ note: string | null }>(`SELECT "note" FROM "favorite" WHERE "user_id" = 'beto'`);
  assert.equal(rows.rows[0]!.note, null);
});
