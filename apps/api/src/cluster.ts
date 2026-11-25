import cluster, { type Worker } from "node:cluster";
import { availableParallelism } from "node:os";
import { setupPrimary } from "@socket.io/cluster-adapter";
import { countHit, isSharedMsg, MAX_ACCOUNT_SOCKETS, sweepHits, type SharedMsg } from "./shared.js";

/**
 * Cuántos procesos del API corren a la vez. Node usa un solo núcleo por proceso, así que con varios se
 * aprovechan todos los núcleos del servidor.
 * - WORKERS en el entorno manda. WORKERS=1 vuelve a un solo proceso, como antes.
 * - Si no está: en producción, uno por núcleo menos uno (ese queda para Postgres), hasta 4.
 * - En desarrollo, siempre uno: la base local (PGlite) solo la puede abrir un proceso.
 */
export function workerCount(env = process.env): number {
  if (!env.DATABASE_URL) return 1;
  const asked = Number(env.WORKERS);
  if (Number.isInteger(asked) && asked >= 1) return Math.min(asked, 16);
  return Math.max(1, Math.min(availableParallelism() - 1, 4));
}

/**
 * Proceso principal: no atiende pedidos. Reparte las conexiones entre los procesos del API, guarda lo que
 * comparten (shared.ts) y vuelve a levantar el que se caiga.
 *
 * Arranca primero el proceso "líder" (LEADER=1): corre las migraciones y las tareas que no se pueden repetir
 * (publicar mensajes en cola, borrar fotos vencidas). Recién cuando escucha se levantan los demás.
 */
export function runPrimary(workers: number) {
  setupPrimary(); // chat en vivo: los eventos de un proceso llegan a los sockets de los otros

  const hits = new Map<string, number[]>();
  setInterval(() => sweepHits(hits), 10 * 60_000).unref();

  // Conexiones abiertas por proceso y por persona. "En línea" es tener al menos una en cualquier proceso.
  const perWorker = new Map<number, Map<string, number>>();
  const total = new Map<string, number>();
  const toAll = (m: SharedMsg) => {
    for (const w of Object.values(cluster.workers ?? {})) if (w?.isConnected()) w.send(m);
  };
  const changeOnline = (wid: number, userId: string, delta: number) => {
    const mine = perWorker.get(wid) ?? new Map<string, number>();
    perWorker.set(wid, mine);
    const old = mine.get(userId) ?? 0;
    const n = Math.max(0, old + delta);
    if (n) mine.set(userId, n);
    else mine.delete(userId);
    const before = total.get(userId) ?? 0;
    const after = Math.max(0, before + n - old);
    if (after) total.set(userId, after);
    else total.delete(userId);
    if (!before !== !after) toAll({ qule: "online:set", userId, on: after > 0 });
  };

  let stopping = false;
  let leaderReady = false;

  const fork = (leader: boolean) => {
    const w = cluster.fork({ LEADER: leader ? "1" : "0" });
    const reservations = new Map<number, string>();
    w.on("message", (m: unknown) => {
      if (!isSharedMsg(m)) return;
      if (m.qule === "hit") {
        w.send({ qule: "hit:r", id: m.id, ok: countHit(hits, m.key, m.max, m.windowMs, m.force) } satisfies SharedMsg);
      } else if (m.qule === "socket:reserve") {
        const ok = (total.get(m.userId) ?? 0) < MAX_ACCOUNT_SOCKETS;
        if (ok) {
          reservations.set(m.id, m.userId);
          changeOnline(w.id, m.userId, 1);
        }
        w.send({ qule: "hit:r", id: m.id, ok } satisfies SharedMsg);
      } else if (m.qule === "socket:release") {
        const userId = reservations.get(m.id);
        if (userId) {
          reservations.delete(m.id);
          changeOnline(w.id, userId, -1);
        }
      } else if (m.qule === "online:snapshot") {
        w.send({ qule: "online:snapshot", ids: [...total.keys()] } satisfies SharedMsg);
      } else if (m.qule === "bcast") {
        toAll(m);
      } else if (m.qule === "ready" && leader && !leaderReady) {
        leaderReady = true;
        for (let i = 1; i < workers; i++) fork(false);
      }
    });
    w.on("exit", (code, signal) => {
      // Lo que tenía abierto ese proceso ya no está
      for (const [userId, n] of perWorker.get(w.id) ?? []) changeOnline(w.id, userId, -n);
      perWorker.delete(w.id);
      if (stopping) return;
      // Si el líder no llega a arrancar (por ejemplo, falla una migración), no tiene sentido insistir:
      // se corta todo y Docker lo reinicia, con el error a la vista en el log.
      if (leader && !leaderReady) {
        console.error(`El proceso líder no pudo arrancar (código ${code ?? signal}).`);
        process.exit(1);
      }
      console.error(`Se cayó un proceso del API (código ${code ?? signal}). Lo levanto de nuevo.`);
      fork(leader);
    });
    return w;
  };

  console.log(`Arrancando ${workers} procesos del API`);
  fork(true);

  // docker stop: cada proceso cierra su servidor y su conexión a la base; después sale el principal
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: cerrando ${Object.keys(cluster.workers ?? {}).length} procesos…`);
    setTimeout(() => process.exit(1), 8_000).unref();
    for (const w of Object.values(cluster.workers ?? {})) w?.process.kill("SIGTERM");
    const check = setInterval(() => {
      if (!Object.values(cluster.workers ?? {}).some((w: Worker | undefined) => w && !w.isDead())) {
        clearInterval(check);
        process.exit(0);
      }
    }, 100);
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => shutdown(signal));
}
