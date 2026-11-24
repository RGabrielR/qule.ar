import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrations = path.resolve(here, "../drizzle");

test("la migración a varios álbumes pasa todo al álbum por defecto sin perder nada", async (t) => {
  // Una copia de las migraciones que termina justo antes de la de álbumes, para cargar datos con el esquema viejo
  const dir = await mkdtemp(path.join(tmpdir(), "qule-albumes-migracion-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const before = path.join(dir, "drizzle");
  await cp(migrations, before, { recursive: true });
  const journalPath = path.join(before, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: { tag: string }[] };
  const cut = journal.entries.findIndex((e) => e.tag.endsWith("_albumes_privados"));
  assert.ok(cut > 0);
  journal.entries = journal.entries.slice(0, cut);
  await writeFile(journalPath, JSON.stringify(journal));

  const client = new PGlite();
  t.after(() => client.close());
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: before });

  const q = (sql: string, params: unknown[] = []) => client.query(sql, params);
  for (const id of ["ana", "luz", "sol", "teo"]) {
    await q(`insert into "user" (id, name, email) values ($1, $1, $1 || '@example.test')`, [id]);
  }
  // Ana: dos privadas y una pública, y le compartió el álbum a Luz (sin límite) y a Sol (con vencimiento)
  // Luz: no tiene fotos privadas, pero le compartió su álbum (vacío) a Ana
  // Sol: solo una pública. Teo: nada.
  await q(`insert into photo (id, user_id, key, position, is_private, kind) values
    ('p1', 'ana', 'a1.webp', 0, false, 'photo'),
    ('p2', 'ana', 'a2.webp', 1, true, 'photo'),
    ('p3', 'ana', 'a3.mp4', 2, true, 'video'),
    ('p4', 'sol', 's1.webp', 0, false, 'photo')`);
  const until = new Date(Date.now() + 3_600_000);
  await q(`insert into album_grant (owner_id, grantee_id, expires_at) values
    ('ana', 'luz', null), ('ana', 'sol', $1), ('luz', 'ana', null)`, [until]);

  await migrate(db, { migrationsFolder: migrations });

  const albums = (await q(`select id, user_id, name, position from album order by user_id`)).rows as
    { id: string; user_id: string; name: string; position: number }[];
  assert.deepEqual(albums.map((a) => [a.user_id, a.name, a.position]), [["ana", "Álbum privado", 0], ["luz", "Álbum privado", 0]]);
  const ana = albums[0].id;
  const luz = albums[1].id;

  const photos = (await q(`select id, is_private, album_id from photo order by id`)).rows;
  assert.deepEqual(photos, [
    { id: "p1", is_private: false, album_id: null },
    { id: "p2", is_private: true, album_id: ana },
    { id: "p3", is_private: true, album_id: ana },
    { id: "p4", is_private: false, album_id: null },
  ]);

  const grants = (await q(`select album_id, owner_id, grantee_id, expires_at from album_grant order by owner_id, grantee_id`)).rows as
    { album_id: string; owner_id: string; grantee_id: string; expires_at: Date | null }[];
  assert.deepEqual(grants.map((g) => [g.album_id, g.owner_id, g.grantee_id, g.expires_at?.getTime() ?? null]), [
    [ana, "ana", "luz", null],
    [ana, "ana", "sol", until.getTime()],
    [luz, "luz", "ana", null],
  ]);
});
