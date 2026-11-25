import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "bio-quota-"));
process.env.DATA_DIR = dir;
const { closeDb, runMigrations } = await import("./db/index.js");
const { reserveBioRead, pauseBioReads, withBioWait, retryAfterUntil } = await import("./bioQuota.js");
after(async () => { await closeDb(); await rm(dir, { recursive: true, force: true }); });

test("31 pedidos simultáneos comparten treinta lecturas por red", async () => {
  await runMigrations();
  let claims = 0;
  const slots = await Promise.all(Array.from({ length: 31 }, (_, i) =>
    reserveBioRead("instagram", "cuenta" + i, async () => { claims++; })));
  assert.equal(claims, 30);
  assert.equal(slots.filter(s => s.kind === "new").length, 30);
  const { schema, db } = await import("./db/index.js");
  const { eq } = await import("drizzle-orm");
  await assert.rejects(reserveBioRead("x", "cuenta0", async tx => {
    await tx.update(schema.bioQuota).set({ pausedUntil: Date.now() + 60000 }).where(eq(schema.bioQuota.network, "x"));
    throw new Error("intento desactualizado");
  }), /intento desactualizado/);
  assert.equal((await db.select().from(schema.bioQuota).where(eq(schema.bioQuota.network, "x"))).length, 0);
  const first = await reserveBioRead("x", "cuenta0");
  assert.equal(first.kind, "new");
  assert.equal((await reserveBioRead("x", "cuenta0")).kind, "shared");
  const pending = { code: "pendiente", expires: Date.now() + 1800000 };
  assert.deepEqual(await withBioWait("x", pending), { ...pending, retryAt: 0 });
  assert.deepEqual(await withBioWait("x", { ...pending, retryAt: first.read.at + 60_000 }), { ...pending, retryAt: first.read.at + 60_000 });
  const deadline = Date.now() + 900000;
  await pauseBioReads("x", deadline);
  await pauseBioReads("x", deadline - 30000);
  assert.deepEqual(await reserveBioRead("x", "otra"), { kind: "paused", retryAt: deadline });
});

test("Retry-After admite segundos, fechas HTTP y una pausa por defecto", () => {
  const now = Date.UTC(2026, 10, 25);
  assert.equal(retryAfterUntil("120", now), now + 120000);
  assert.equal(retryAfterUntil(new Date(now + 300000).toUTCString(), now), now + 300000);
  for (const header of [null, "", "inválido"]) assert.equal(retryAfterUntil(header, now), now + 900000);
});

test("la limpieza conserva las pausas y quita los identificadores vencidos sin una consulta nueva", async () => {
  const { db, schema } = await import("./db/index.js");
  const { eq } = await import("drizzle-orm");
  const { sweepBioReads } = await import("./bioQuota.js");
  const now = Date.now();
  const row = () => db.select().from(schema.bioQuota).where(eq(schema.bioQuota.network, "x"));
  const until = now + 90000;
  await db.update(schema.bioQuota).set({ pausedUntil: until, reads: [
    { handle: "anterior", at: now - 61000 }, { handle: "reciente", at: now },
  ] }).where(eq(schema.bioQuota.network, "x"));
  await sweepBioReads();
  const [clean] = await row();
  assert.equal(clean.reads.length, 1);
  assert.match(clean.reads[0].handle, /^#[0-9a-f]{64}$/);
  assert.equal(clean.pausedUntil, until);
});

test("dos verificaciones comparten una lectura y comparan cada código por separado", async t => {
  const { db, schema } = await import("./db/index.js");
  const { eq } = await import("drizzle-orm");
  const { checkBioCode } = await import("./bioQuota.js");
  await db.update(schema.bioQuota).set({ pausedUntil: 0, reads: [] }).where(eq(schema.bioQuota.network, "x"));
  const code = "1234567890abcdef1234";
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(
    `<head><meta property="og:url" content="https://x.com/compartida"><meta name="twitter:creator" content="@compartida"><meta name="description" content="Mi bio: ${code}"></head>`,
    { headers: { "content-type": "text/html" } },
  ));
  const [first, second] = await Promise.all([
    checkBioCode("x", "compartida", "00000000000000000000"),
    checkBioCode("x", "compartida", code),
  ]);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(first.kind, "missing");
  assert.equal(second.kind, "verified");
  const [row] = await db.select().from(schema.bioQuota).where(eq(schema.bioQuota.network, "x"));
  assert.doesNotMatch(JSON.stringify(row.reads), /compartida|1234567890abcdef1234|Mi bio/);
});
