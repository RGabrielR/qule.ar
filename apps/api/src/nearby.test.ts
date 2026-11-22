import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { inArray } from "drizzle-orm";

/**
 * La grilla de Cerca filtra y ordena en Postgres (routes/nearby.ts). Esta prueba arma miles de perfiles al azar
 * y compara cada página con la cuenta hecha a mano en JavaScript, como se hacía antes: mismos filtros, bloqueos,
 * ocultos por reportes, incógnito, suspendidos, distancia escondida, fotos privadas y paginación.
 */

const dataDir = await mkdtemp(path.join(tmpdir(), "qule-nearby-"));
process.env.DATA_DIR = dataDir;
process.env.DATA_KEY ??= randomBytes(32).toString("base64");

const { db, schema, runMigrations, closeDb } = await import("./db/index.js");
const { nearbyPage, parseNearbyFilters } = await import("./routes/nearby.js");
const { ageFrom, thumbUrl } = await import("./lib.js");
const { distanceLabel, visibleKm } = await import("./geo.js");
const { REPORT_REASONS } = await import("./moderation.js");

// Azar con semilla: la prueba siempre arma los mismos datos
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const some = <T>(xs: readonly T[]) => xs.filter(() => rand() < 0.3);
const maybe = <T>(x: T, p = 0.8) => (rand() < p ? x : null);

const BODY = ["delgado", "atletico", "promedio", "grande"];
const POS = ["activo", "pasivo", "versatil"];
const REL = ["soltero", "pareja", "abierta"];
const TRIBES = ["oso", "nutria", "twink", "geek", "deportista"];
const LOOKING = ["chat", "amistad", "citas", "ya"];
const N = 1500;
const ME = "me";

before(async () => {
  await runMigrations();
  const ids = Array.from({ length: N }, (_, i) => `u${i}`);
  await db.insert(schema.user).values([ME, ...ids].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  const now = Date.now();
  await db.insert(schema.profile).values([
    { userId: ME, displayName: "Yo", birthdate: "1990-05-05", cellLat: -34.6, cellLng: -58.4 },
    ...ids.map((id, i) => {
      const y = 1950 + Math.floor(rand() * 57);
      const m = 1 + Math.floor(rand() * 12);
      const d = 1 + Math.floor(rand() * 28);
      const located = rand() < 0.85;
      return {
        userId: id,
        displayName: `Persona ${i}`,
        birthdate: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        heightCm: maybe(150 + Math.floor(rand() * 50)),
        weightKg: maybe(50 + Math.floor(rand() * 60)),
        bodyType: maybe(pick(BODY)),
        position: maybe(pick(POS)),
        relationship: maybe(pick(REL)),
        tribes: some(TRIBES),
        lookingFor: some(LOOKING),
        // Varias personas en la misma celda, para que se desempate por última vez visto
        cellLat: located ? -34.6 + Math.floor(rand() * 40) * 0.05 : null,
        cellLng: located ? -58.4 + Math.floor(rand() * 40) * 0.05 : null,
        showDistance: rand() < 0.9,
        incognito: rand() < 0.05,
        suspendedAt: rand() < 0.03 ? new Date() : null,
        lastSeenAt: new Date(now - i * 60_000 - Math.floor(rand() * 30_000)),
      };
    }),
  ]);
  const photos = ids.flatMap((id) => {
    const r = rand();
    if (r < 0.2) return []; // sin fotos
    if (r < 0.3) return [{ id: `${id}-p`, userId: id, key: `${id}-privada.jpg`, position: 0, isPrivate: true }];
    return [
      { id: `${id}-a`, userId: id, key: `${id}-a.jpg`, position: 1, isPrivate: false },
      { id: `${id}-b`, userId: id, key: `${id}-b.jpg`, position: 0, isPrivate: rand() < 0.3 },
    ];
  });
  await db.insert(schema.photo).values(photos);
  await db.insert(schema.block).values([
    ...ids.slice(3, 23).map((id) => ({ blockerId: ME, blockedId: id })),
    ...ids.slice(40, 60).map((id) => ({ blockerId: id, blockedId: ME })),
    { blockerId: "u100", blockedId: "u101" }, // bloqueo entre otros: no afecta mi grilla
  ]);
  await db.insert(schema.favorite).values(ids.filter((_, i) => i % 37 === 0).map((id) => ({ userId: ME, favoriteId: id })));
  await db.update(schema.profile).set({ incognito: false, suspendedAt: null }).where(inArray(schema.profile.userId, ["u700", "u800"]));
  // u700 tiene 3 reportes urgentes de personas distintas (se oculta); u800 solo 2 (no se oculta)
  const urgent = REPORT_REASONS[0];
  await db.insert(schema.report).values([
    ...["u200", "u201", "u202"].map((r, i) => ({ id: `r700-${i}`, reporterId: r, targetUserId: "u700", reason: urgent })),
    ...["u200", "u201"].map((r, i) => ({ id: `r800-${i}`, reporterId: r, targetUserId: "u800", reason: urgent })),
  ]);
});

after(async () => {
  await closeDb();
  await rm(dataDir, { recursive: true, force: true });
});

/** Cómo se calculaba la grilla antes: todo el perfil a memoria y filtros en JavaScript. */
async function reference(me: { userId: string; cellLat: number | null; cellLng: number | null; showDistance: boolean }, q: Record<string, string>) {
  const f = parseNearbyFilters(q);
  const all = await db.select().from(schema.profile);
  const blocks = await db.select().from(schema.block);
  const blocked = new Set(blocks.flatMap((b) => (b.blockerId === me.userId ? [b.blockedId] : b.blockedId === me.userId ? [b.blockerId] : [])));
  const favs = new Set((await db.select().from(schema.favorite)).filter((x) => x.userId === me.userId).map((x) => x.favoriteId));
  const photos = (await db.select().from(schema.photo)).filter((p) => !p.isPrivate).sort((a, b) => a.position - b.position);
  const first = new Map<string, string>();
  for (const p of photos) if (!first.has(p.userId)) first.set(p.userId, p.key);
  const anyOf = (w: string[], v: string | null) => !w.length || (v != null && w.includes(v));
  const overlap = (w: string[], vs: string[]) => !w.length || vs.some((v) => w.includes(v));
  const inRange = (v: number | null, min?: number, max?: number) =>
    (min == null && max == null) || (v != null && (min == null || v >= min) && (max == null || v <= max));
  const list = all
    .filter((p) => p.userId !== me.userId && !p.incognito && !p.suspendedAt && !blocked.has(p.userId) && p.userId !== "u700")
    .filter((p) => !f.favorites || favs.has(p.userId))
    .map((p) => ({ p, km: visibleKm(me, p), age: ageFrom(p.birthdate) }))
    .filter(({ p, age }) =>
      inRange(age, f.ageMin, f.ageMax) && inRange(p.heightCm, f.heightMin, f.heightMax) && inRange(p.weightKg, f.weightMin, f.weightMax) &&
      anyOf(f.bodyType, p.bodyType) && anyOf(f.position, p.position) && anyOf(f.relationship, p.relationship) &&
      overlap(f.tribes, p.tribes) && overlap(f.lookingFor, p.lookingFor) && (!f.withPhoto || first.has(p.userId)) && !f.online)
    .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity) || b.p.lastSeenAt.getTime() - a.p.lastSeenAt.getTime());
  const page = list.slice(f.offset, f.offset + 60);
  return {
    hasMore: list.length > f.offset + 60,
    total: list.length,
    people: page.map(({ p, km, age }) => ({
      id: p.userId, name: p.displayName, age, photo: thumbUrl(first.get(p.userId)), online: false,
      recent: Date.now() - p.lastSeenAt.getTime() < 15 * 60_000, favorite: favs.has(p.userId),
      distance: km != null ? distanceLabel(km) : null,
    })),
  };
}

const CASES: Record<string, string>[] = [
  {},
  { offset: "60" },
  { offset: "600" },
  { offset: "1440" },
  { ageMin: "30", ageMax: "45" },
  { ageMin: "18", ageMax: "18" },
  { ageMax: "40", heightMin: "170", weightMax: "80" },
  { bodyType: "atletico,grande", position: "versatil" },
  { relationship: "soltero" },
  { tribes: "oso,geek" },
  { lookingFor: "citas", tribes: "nutria" },
  { withPhoto: "1" },
  { withPhoto: "1", offset: "120" },
  { favorites: "1" },
  { online: "1" },
  { bodyType: "inexistente" },
  { ageMin: "25", withPhoto: "1", lookingFor: "chat,ya", offset: "60" },
];

const MES = {
  "con ubicación": { userId: ME, cellLat: -34.6, cellLng: -58.4, showDistance: true },
  "sin ubicación": { userId: ME, cellLat: null, cellLng: null, showDistance: true },
  "distancia escondida": { userId: ME, cellLat: -34.6, cellLng: -58.4, showDistance: false },
};

for (const [label, me] of Object.entries(MES)) {
  test(`grilla de Cerca igual a la cuenta en memoria (${label})`, async () => {
    for (const q of CASES) {
      const got = await nearbyPage(me, parseNearbyFilters(q));
      const want = await reference(me, q);
      assert.equal(got.hasLocation, me.cellLat != null);
      assert.deepEqual({ hasMore: got.hasMore, total: got.total, people: got.people }, want, JSON.stringify(q));
    }
  });
}

test("no aparecen bloqueos, ocultos por reportes, incógnito ni suspendidos", async () => {
  const got = await nearbyPage(MES["con ubicación"], parseNearbyFilters({ offset: "0" }));
  const seen = new Set<string>();
  for (let offset = 0; ; offset += 60) {
    const page = await nearbyPage(MES["con ubicación"], parseNearbyFilters({ offset: String(offset) }));
    for (const p of page.people) seen.add(p.id);
    if (!page.hasMore) break;
  }
  assert.equal(seen.size, got.total);
  for (const id of ["u3", "u22", "u40", "u59", "u700", ME]) assert.ok(!seen.has(id), id);
  assert.ok(seen.has("u800"), "dos reportes no alcanzan para ocultar");
});

test("explorar una ciudad incluye solo perfiles visibles que eligieron compartirla", async () => {
  const ids = ["ciudad-visible", "ciudad-oculta", "ciudad-otro-pais", "ciudad-sin-publicar"];
  await db.insert(schema.user).values(ids.map((id) => ({ id, name: id, email: `${id}@example.test` })));
  const common = { birthdate: "1990-01-01", displayName: "Perfil de prueba" };
  await db.insert(schema.profile).values([
    { ...common, userId: ids[0], discoveryCountry: "MX", discoveryCity: "Ciudad de México", discoveryCityKey: "ciudad de mexico" },
    { ...common, userId: ids[1], discoveryCountry: "MX", discoveryCity: "Ciudad de México", discoveryCityKey: "ciudad de mexico", incognito: true },
    { ...common, userId: ids[2], discoveryCountry: "AR", discoveryCity: "Ciudad de México", discoveryCityKey: "ciudad de mexico" },
    { ...common, userId: ids[3] },
  ]);
  try {
    const filter = parseNearbyFilters({ country: "MX", city: "ciudad DE   mexico" });
    const results = await nearbyPage(MES["sin ubicación"], filter);
    assert.deepEqual(results.people.map(({ id, distance }) => ({ id, distance })), [{ id: ids[0], distance: null }]);
    const missingCountry = parseNearbyFilters({ city: "Ciudad de México" });
    await assert.rejects(nearbyPage(MES["sin ubicación"], missingCountry), { status: 400 });
  } finally {
    await db.delete(schema.user).where(inArray(schema.user.id, ids));
  }
});
