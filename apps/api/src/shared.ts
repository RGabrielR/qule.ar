import cluster from "node:cluster";

/**
 * Lo que tienen que compartir todos los procesos del API cuando corre en varios núcleos (ver cluster.ts):
 * quién está en línea, los límites por persona y los avisos para olvidar datos guardados en memoria.
 *
 * El proceso principal guarda los datos y cada proceso del API le pregunta por mensajes internos (IPC),
 * sin pasar por la red. Con un solo proceso (desarrollo, o WORKERS=1) todo queda acá mismo, en memoria.
 */

export const clustered = cluster.isWorker;

/** Mensajes internos entre procesos. El campo `qule` los separa de los del chat en vivo (Socket.IO). */
export type SharedMsg =
  | { qule: "hit"; id: number; key: string; max: number; windowMs: number; force?: boolean }
  | { qule: "hit:r"; id: number; ok: boolean }
  | { qule: "socket:reserve"; userId: string; id: number }
  | { qule: "socket:release"; id: number }
  | { qule: "online:set"; userId: string; on: boolean }
  | { qule: "online:snapshot"; ids?: string[] }
  | { qule: "bcast"; ch: string; data: unknown }
  | { qule: "ready" };

export const isSharedMsg = (m: unknown): m is SharedMsg => typeof m === "object" && m !== null && "qule" in m;

// ---------- Ventanas de tiempo (límites) ----------

/**
 * Cuenta una acción en una ventana de tiempo. Devuelve false si `key` ya llegó a `max` en los últimos `windowMs`
 * (y en ese caso no la cuenta). Con `force` la cuenta igual y devuelve true.
 * La misma función corre en el proceso principal (para todos) o acá (con un solo proceso).
 */
export function countHit(store: Map<string, number[]>, key: string, max: number, windowMs: number, force = false, now = Date.now()) {
  const recent = (store.get(key) ?? []).filter((t) => t > now - windowMs);
  if (!force && recent.length >= max) {
    store.set(key, recent);
    return false;
  }
  recent.push(now);
  store.set(key, recent);
  return true;
}

/** Saca lo vencido para que el mapa no crezca sin fin. Las ventanas más largas que usamos son de una hora. */
export function sweepHits(store: Map<string, number[]>, maxWindowMs = 3_600_000, now = Date.now()) {
  for (const [key, times] of store) {
    const recent = times.filter((t) => t > now - maxWindowMs);
    if (recent.length) store.set(key, recent);
    else store.delete(key);
  }
}

const localHits = new Map<string, number[]>();
if (!clustered) setInterval(() => sweepHits(localHits), 10 * 60_000).unref();

let nextId = 1;
const pending = new Map<number, (ok: boolean) => void>();

export function hit(key: string, max: number, windowMs: number, force = false): Promise<boolean> {
  if (!clustered) return Promise.resolve(countHit(localHits, key, max, windowMs, force));
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    send({ qule: "hit", id, key, max, windowMs, force });
  });
}

// ---------- En línea ----------

/** Quién tiene la app abierta en cualquier proceso. Lo mantiene al día el proceso principal. */
const onlineIds = new Set<string>();
/** Conexiones abiertas en este proceso (con un solo proceso, es la lista completa). */
const localOnline = new Map<string, number>();
export const MAX_ACCOUNT_SOCKETS = 6;

export const isOnline = (userId: string) => (clustered ? onlineIds.has(userId) : localOnline.has(userId));

export function reserveSocket(userId: string): Promise<(() => void) | null> {
  if (!clustered) {
    const count = localOnline.get(userId) ?? 0;
    if (count >= MAX_ACCOUNT_SOCKETS) return Promise.resolve(null);
    localOnline.set(userId, count + 1);
    let released = false;
    return Promise.resolve(() => {
      if (released) return;
      released = true;
      const remaining = (localOnline.get(userId) ?? 1) - 1;
      if (remaining) localOnline.set(userId, remaining);
      else localOnline.delete(userId);
    });
  }

  return new Promise((resolve) => {
    const id = nextId++;
    const release = () => send({ qule: "socket:release", id });
    const timer = setTimeout(() => {
      pending.delete(id);
      release();
      resolve(null);
    }, 2000);
    pending.set(id, (ok) => {
      clearTimeout(timer);
      resolve(ok ? release : null);
    });
    send({ qule: "socket:reserve", userId, id });
  });
}

// ---------- Avisos a todos los procesos ----------

const listeners = new Map<string, ((data: unknown) => void)[]>();

/** Escucha un aviso que puede venir de cualquier proceso (incluido este). */
export function onBroadcast(ch: string, fn: (data: unknown) => void) {
  listeners.set(ch, [...(listeners.get(ch) ?? []), fn]);
}

/** Avisa a todos los procesos, este incluido. */
export function broadcast(ch: string, data: unknown) {
  if (!clustered) {
    for (const fn of listeners.get(ch) ?? []) fn(data);
    return;
  }
  send({ qule: "bcast", ch, data });
}

/** Le avisa al proceso principal que este proceso ya atiende pedidos. */
export function signalReady() {
  if (clustered) send({ qule: "ready" });
}

function send(m: SharedMsg) {
  process.send?.(m);
}

if (clustered) {
  process.on("message", (m: unknown) => {
    if (!isSharedMsg(m)) return;
    if (m.qule === "hit:r") {
      pending.get(m.id)?.(m.ok);
      pending.delete(m.id);
    } else if (m.qule === "online:set") {
      if (m.on) onlineIds.add(m.userId);
      else onlineIds.delete(m.userId);
    } else if (m.qule === "online:snapshot" && m.ids) {
      for (const id of m.ids) onlineIds.add(id);
    } else if (m.qule === "bcast") {
      for (const fn of listeners.get(m.ch) ?? []) fn(m.data);
    }
  });
  send({ qule: "online:snapshot" });
}
