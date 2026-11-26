import assert from "node:assert/strict";
import { isOnline, MAX_ACCOUNT_SOCKETS, reserveSocket } from "./shared.js";
import { limit, LIMITS } from "./ratelimit.js";
import { availableParallelism } from "node:os";
import { test } from "node:test";
import { workerCount } from "./cluster.js";
import { countHit, sweepHits } from "./shared.js";

test("cuántos procesos del API arrancan", () => {
  assert.equal(workerCount({}), 1, "sin Postgres (PGlite) siempre uno");
  assert.equal(workerCount({ DATABASE_URL: "postgres://x", WORKERS: "3" }), 3);
  assert.equal(workerCount({ DATABASE_URL: "postgres://x", WORKERS: "1" }), 1);
  assert.equal(workerCount({ DATABASE_URL: "postgres://x", WORKERS: "99" }), 16, "con un tope");
  const auto = workerCount({ DATABASE_URL: "postgres://x", WORKERS: "cualquier cosa" });
  assert.equal(auto, Math.max(1, Math.min(availableParallelism() - 1, 4)));
});

test("ventana de tiempo de los límites", () => {
  const store = new Map<string, number[]>();
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(countHit(store, "k", 3, 60_000, false, t0 + i), true);
  assert.equal(countHit(store, "k", 3, 60_000, false, t0 + 10), false, "el cuarto en el mismo minuto se frena");
  assert.equal(store.get("k")?.length, 3, "lo frenado no se cuenta");
  assert.equal(countHit(store, "k", 3, 60_000, true, t0 + 20), true, "forzado se cuenta igual");
  assert.equal(countHit(store, "k", 3, 60_000, false, t0 + 60_021), true, "pasado el minuto vuelve a andar");
  sweepHits(store, 60_000, t0 + 200_000);
  assert.equal(store.has("k"), false, "la limpieza saca lo vencido");
});
test("las conexiones simultáneas tienen cupo por cuenta y liberar dos veces conserva el conteo", async () => {
  const account = "cuenta-socket-prueba";
  const sessions = await Promise.all(Array.from({ length: MAX_ACCOUNT_SOCKETS }, () => reserveSocket(account)));
  assert.ok(sessions.every(Boolean));
  assert.equal(isOnline(account), true);
  assert.equal(await reserveSocket(account), null);
  sessions[0]?.();
  sessions[0]?.();
  const resumed = await reserveSocket(account);
  assert.ok(resumed);
  assert.equal(await reserveSocket(account), null);
  sessions.slice(1).forEach((close) => close?.());
  resumed();
  assert.equal(isOnline(account), false);
});

test("la cuota de Gente se aplica por cuenta", async () => {
  for (let i = 0; i < LIMITS.nearby.max; i++) await limit("cerca-uno", "nearby");
  await assert.rejects(limit("cerca-uno", "nearby"), { status: 429 });
  await limit("cerca-dos", "nearby");
});
