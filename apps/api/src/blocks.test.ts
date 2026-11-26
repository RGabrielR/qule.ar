import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

/** Personas bloqueadas: paginación, orden por fecha, búsqueda sin tildes y cuentas borradas. */

const dataDir = await mkdtemp(path.join(tmpdir(), "qule-blocks-"));
process.env.DATA_DIR = dataDir;
process.env.DATA_KEY ??= randomBytes(32).toString("base64");

const { db, schema, runMigrations, closeDb } = await import("./db/index.js");
const { blockedPage, blocksQuerySchema, BLOCKS_PAGE } = await import("./blocks.js");

const NAMES = ["Rocío", "Rodrigo", "Ana", "Beto", "Santiago 50%", "Ana_Clara"];
const page = (meId: string, q: Record<string, string> = {}) => blockedPage(meId, blocksQuerySchema.parse(q));

before(async () => {
  await runMigrations();
  const others = Array.from({ length: 70 }, (_, i) => `u${String(i).padStart(2, "0")}`);
  await db.insert(schema.user).values(["me", "otra", ...others, "borrada"].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  await db.insert(schema.profile).values([
    { userId: "me", displayName: "Yo", birthdate: "1990-01-01" },
    { userId: "otra", displayName: "Otra", birthdate: "1990-01-01" },
    ...others.map((id, i) => ({ userId: id, displayName: NAMES[i] ?? `Persona ${i}`, birthdate: "1990-01-01" })),
  ]);
  // El de índice más alto es el bloqueo más reciente; "borrada" no tiene perfil
  const t0 = Date.parse("2026-01-01T00:00:00Z");
  await db.insert(schema.block).values([
    ...others.map((id, i) => ({ blockerId: "me", blockedId: id, createdAt: new Date(t0 + i * 60_000) })),
    { blockerId: "me", blockedId: "borrada", createdAt: new Date(t0 - 60_000) },
    { blockerId: "otra", blockedId: "u00" }, // bloqueos de otra persona no aparecen
  ]);
});

after(async () => {
  await closeDb();
  await rm(dataDir, { recursive: true, force: true });
});

test("pagina de la más reciente a la más vieja, sin repetir ni saltear a nadie", async () => {
  const seen: string[] = [];
  let offset = 0;
  for (;;) {
    const r = await page("me", { offset: String(offset) });
    assert.equal(r.total, 71);
    assert.ok(r.people.length <= BLOCKS_PAGE);
    seen.push(...r.people.map((p) => p.id));
    offset += r.people.length;
    if (!r.hasMore) break;
  }
  assert.equal(seen.length, 71);
  assert.equal(new Set(seen).size, 71);
  assert.equal(seen[0], "u69");
  assert.equal(seen.at(-1), "borrada");
  const last = (await page("me", { offset: "70" })).people[0];
  assert.deepEqual({ name: last.name, photo: last.photo }, { name: "Cuenta borrada", photo: null });
});

test("busca por nombre sin importar tildes ni mayúsculas, y los comodines son texto", async () => {
  const names = async (q: string) => (await page("me", { q })).people.map((p) => p.name).sort();
  assert.deepEqual(await names("rocio"), ["Rocío"]);
  assert.deepEqual(await names("RO"), ["Rocío", "Rodrigo"]);
  assert.deepEqual(await names("  ana  "), ["Ana", "Ana_Clara"]);
  assert.deepEqual(await names("a_c"), ["Ana_Clara"]);
  assert.deepEqual(await names("50%"), ["Santiago 50%"]);
  assert.deepEqual(await names("%"), ["Santiago 50%"]);
  assert.deepEqual(await names("nadie así"), []);
  assert.equal((await page("me", { q: "borrada" })).total, 0);
});

test("con limit 0 solo cuenta", async () => {
  const r = await page("me", { limit: "0" });
  assert.deepEqual(r, { people: [], total: 71, hasMore: true });
  assert.equal((await page("otra", { limit: "0" })).total, 1);
});
