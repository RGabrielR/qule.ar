import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { sql } from "drizzle-orm";

/**
 * Lista de solicitudes de un grupo (joinRequests.ts): de la más nueva a la más vieja, de a páginas,
 * sin saltear ni repetir aunque varias tengan la misma fecha, y con filtros de foto, cuenta nueva y edad.
 */

const dataDir = await mkdtemp(path.join(tmpdir(), "qule-solicitudes-"));
process.env.DATABASE_URL = "";
process.env.DATA_DIR = dataDir;
process.env.DATA_KEY ??= randomBytes(32).toString("base64");
process.env.NODE_ENV = "test";

const { db, schema, runMigrations, closeDb } = await import("./db/index.js");
const { requestPage, requestFilters, decodeCursor, encodeCursor, birthdateRange, REQUESTS_PAGE } = await import("./joinRequests.js");

const NOW = new Date("2026-11-22T15:00:00Z");
const DAY = 86_400_000;
const N = 95;

type Seed = { id: string; createdAt: Date; hasPhoto: boolean; privateOnly: boolean; newAccount: boolean; birthdate: string };
const seeds: Seed[] = [];

before(async () => {
  await runMigrations();
  for (let i = 0; i < N; i++) {
    seeds.push({
      id: `r${String(i).padStart(3, "0")}`,
      // De a 7 comparten fecha exacta (y caen partidos entre páginas): el cursor tiene que desempatar por id
      createdAt: new Date(NOW.getTime() - Math.floor(i / 7) * 60_000),
      hasPhoto: i % 3 === 0,
      privateOnly: i % 3 === 1,
      newAccount: i % 4 === 0,
      birthdate: `${1960 + (i % 45)}-06-15`,
    });
  }
  await db.insert(schema.user).values([
    { id: "dueño", name: "Dueño", email: "duenio@example.test" },
    ...seeds.map((s) => ({
      id: `u-${s.id}`,
      name: s.id,
      email: `${s.id}@example.test`,
      createdAt: new Date(NOW.getTime() - (s.newAccount ? 2 : 30) * DAY),
    })),
  ]);
  await db.insert(schema.profile).values(seeds.map((s) => ({ userId: `u-${s.id}`, displayName: s.id, birthdate: s.birthdate })));
  await db.insert(schema.photo).values(seeds.flatMap((s) => [
    ...(s.hasPhoto ? [{ id: `p-${s.id}`, userId: `u-${s.id}`, key: `${s.id}.webp` }] : []),
    ...(s.privateOnly ? [{ id: `pp-${s.id}`, userId: `u-${s.id}`, key: `${s.id}-priv.webp`, isPrivate: true }] : []),
  ]));
  await db.insert(schema.group).values([{ id: "g", name: "Grupo" }, { id: "otro", name: "Otro" }]);
  await db.insert(schema.groupJoinRequest).values([
    ...seeds.map((s) => ({ id: s.id, groupId: "g", userId: `u-${s.id}`, createdAt: s.createdAt })),
    // No tienen que aparecer: ya resuelta, y de otro grupo
    { id: "zz-resuelta", groupId: "g", userId: "u-r000", status: "rejected", createdAt: NOW },
    { id: "zz-otro", groupId: "otro", userId: "u-r001", createdAt: NOW },
  ]);
  // Microsegundos: dos con el mismo milisegundo y distinto microsegundo
  await db.execute(sql`update group_join_request set created_at = created_at + interval '250 microseconds' where id in ('r000', 'r002')`);
});

after(async () => {
  await closeDb();
  await rm(dataDir, { recursive: true, force: true });
});

/** Todas las páginas seguidas, como haría "Ver más". */
async function all(query: Record<string, string>) {
  const f = requestFilters.parse(query);
  const ids: string[] = [];
  let total: number | null = null;
  let cursor: string | undefined;
  for (let pages = 0; pages < 20; pages++) {
    const page = await requestPage("g", { ...f, cursor }, NOW);
    assert.ok(page);
    if (pages === 0) total = page.total;
    else assert.equal(page.total, null);
    assert.ok(page.items.length <= REQUESTS_PAGE);
    ids.push(...page.items.map((r) => r.id));
    if (!page.nextCursor) return { ids, total };
    cursor = page.nextCursor;
  }
  throw new Error("No termina nunca");
}

/** Lo esperado, calculado a mano: más nueva primero; si empatan, id mayor primero. */
function expected(keep: (s: Seed) => boolean) {
  const micro = new Set(["r000", "r002"]);
  return seeds
    .filter(keep)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      || Number(micro.has(b.id)) - Number(micro.has(a.id))
      || b.id.localeCompare(a.id))
    .map((s) => s.id);
}

test("de la más nueva a la más vieja, de a páginas y sin repetir", async () => {
  const { ids, total } = await all({});
  assert.equal(total, N);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, expected(() => true));
  const first = await requestPage("g", {}, NOW);
  assert.equal(first?.items.length, REQUESTS_PAGE);
  assert.equal(first?.items[0].id, "r002");
});

test("filtro con foto y sin foto (solo cuenta la pública)", async () => {
  const con = await all({ foto: "con" });
  const sin = await all({ foto: "sin" });
  assert.deepEqual(con.ids, expected((s) => s.hasPhoto));
  assert.deepEqual(sin.ids, expected((s) => !s.hasPhoto));
  assert.equal((con.total ?? 0) + (sin.total ?? 0), N);
  const page = await requestPage("g", requestFilters.parse({ foto: "con" }), NOW);
  assert.ok(page?.items.every((r) => r.user.photo));
});

test("filtro de cuenta nueva", async () => {
  const { ids } = await all({ nueva: "1" });
  assert.deepEqual(ids, expected((s) => s.newAccount));
  const page = await requestPage("g", {}, NOW);
  for (const r of page!.items) assert.equal(r.newAccount, seeds.find((s) => s.id === r.id)!.newAccount);
});

test("filtro de edad (y combinado con foto)", async () => {
  const age = (s: Seed) => NOW.getFullYear() - Number(s.birthdate.slice(0, 4)) - 1; // cumplen en junio, NOW es noviembre
  const ageNow = (s: Seed) => age(s) + 1;
  const { ids } = await all({ edadMin: "30", edadMax: "40" });
  assert.deepEqual(ids, expected((s) => ageNow(s) >= 30 && ageNow(s) <= 40));
  const both = await all({ edadMin: "50", foto: "sin" });
  assert.deepEqual(both.ids, expected((s) => ageNow(s) >= 50 && !s.hasPhoto));
});

test("cursores y filtros inválidos", async () => {
  assert.equal(await requestPage("g", { cursor: "basura" }, NOW), null);
  assert.equal(await requestPage("g", { cursor: encodeCursor({ t: "no es fecha", id: "x" }) }, NOW), null);
  assert.deepEqual(decodeCursor(encodeCursor({ t: "2026-11-22 15:00:00.000250+00", id: "r0" })), { t: "2026-11-22 15:00:00.000250+00", id: "r0" });
  assert.equal(requestFilters.safeParse({ edadMin: "12" }).success, false);
  assert.equal(requestFilters.safeParse({ foto: "quizás" }).success, false);
  assert.deepEqual(birthdateRange(30, 40, new Date(2026, 10, 22)), { bornOnOrBefore: "1996-11-22", bornAfter: "1985-11-22" });
});
