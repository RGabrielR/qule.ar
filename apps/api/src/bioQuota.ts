import { createHmac } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "./db/index.js";
import type { SocialProof } from "./db/schema.js";
import { dataKey } from "./crypt.js";
import { readBio, type Network } from "./socialBio.js";

const { bioQuota } = schema;
const readsPerMinute = 30;
const minute = 60_000;

export function retryAfterUntil(header: string | null, now = Date.now()) {
  const value = header?.trim() ?? "";
  if (/^\d+$/.test(value)) {
    const until = now + Number(value) * 1000;
    if (Number.isSafeInteger(until)) return until;
  } else if (/^[a-z]/i.test(value)) {
    const until = Date.parse(value);
    if (Number.isFinite(until)) return Math.max(now, until);
  }
  return now + 15 * minute;
}

type Read = typeof bioQuota.$inferSelect.reads[number];

function digest(network: Network, value: string) {
  return createHmac("sha256", dataKey()).update(`bio:${network}:${value}`).digest("hex");
}

function recentHashedReads(network: Network, reads: Read[], now: number) {
  return reads.filter(read => read.at + minute > now).map(read =>
    read.handle.startsWith("#") ? read : { ...read, handle: "#" + digest(network, read.handle) });
}

// También limpia filas sin tráfico. Bloqueamos la fila para no pisar lecturas concurrentes.
export async function sweepBioReads() {
  for (const network of ["instagram", "x"] as const) {
    await db.transaction(async tx => {
      const [row] = await tx.select().from(bioQuota).where(eq(bioQuota.network, network)).for("update");
      if (!row?.reads.length) return;
      const reads = recentHashedReads(network, row.reads, Date.now());
      if (reads.length !== row.reads.length || reads.some((v, i) => v.handle !== row.reads[i].handle)) {
        await tx.update(bioQuota).set({ reads }).where(eq(bioQuota.network, network));
      }
    });
  }
}

function networkRetryAt(recent: Read[], pausedUntil: number) {
  return Math.max(pausedUntil, recent.length >= readsPerMinute ? recent[0].at + minute : 0);
}

export async function withBioWait(network: Network, proof: SocialProof | null) {
  if (!proof || !("code" in proof)) return proof;
  const [row] = await db.select().from(bioQuota).where(eq(bioQuota.network, network));
  const now = Date.now();
  const recent = row?.reads.filter(read => read.at + minute > now) ?? [];
  const until = Math.max(proof.retryAt ?? 0, networkRetryAt(recent, row?.pausedUntil ?? 0));
  return { ...proof, retryAt: until > now ? until : 0 };
}

type QuotaTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ClaimAttempt = (tx: QuotaTransaction) => Promise<void>;

type Reservation =
  | { kind: "paused"; retryAt: number }
  | { kind: "shared" | "new"; read: Read };

export async function reserveBioRead(network: Network, handle: string, claim?: ClaimAttempt): Promise<Reservation> {
  return db.transaction<Reservation>(async tx => {
    // Si ya está llena, alcanza una lectura sin bloqueo. Para admitir un pedido
    // volvemos a comprobar el cupo con la fila bloqueada en esta misma transacción.
    const [snapshot] = await tx.select().from(bioQuota).where(eq(bioQuota.network, network));
    if (snapshot) {
      const now = Date.now();
      const until = networkRetryAt(snapshot.reads.filter(read => read.at + minute > now), snapshot.pausedUntil);
      if (until > now) return { kind: "paused", retryAt: until };
    } else {
      await tx.insert(bioQuota).values({ network }).onConflictDoNothing();
    }
    const [row] = await tx.select().from(bioQuota).where(eq(bioQuota.network, network)).for("update");
    const now = Date.now();
    const recent = recentHashedReads(network, row.reads, now);
    const retryAt = networkRetryAt(recent, row.pausedUntil);
    if (retryAt > now) return { kind: "paused", retryAt };
    await claim?.(tx);
    const key = "#" + digest(network, handle);
    const existing = recent.find(read => read.handle === key);
    if (existing) return { kind: "shared", read: existing };
    const read = { handle: key, at: now };
    await tx.update(bioQuota).set({ reads: [...recent, read] }).where(eq(bioQuota.network, network));
    return { kind: "new", read };
  });
}

export async function pauseBioReads(network: Network, until: number) {
  const [row] = await db.update(bioQuota)
    .set({ pausedUntil: sql`greatest(${bioQuota.pausedUntil}, ${until})` })
    .where(eq(bioQuota.network, network)).returning({ until: bioQuota.pausedUntil });
  return row.until;
}

function sameRead(a: Read, b: Read) {
  return a.handle === b.handle && a.at === b.at;
}

async function readAndStoreCodes(network: Network, handle: string, reserved: Read) {
  const bio = await readBio(network, handle);
  if (bio !== null && typeof bio === "object") {
    await pauseBioReads(network, retryAfterUntil(bio.retryAfter));
    return;
  }

  // El código tiene 20 caracteres hexadecimales y puede ir pegado a otro texto.
  const codes = bio !== null && bio.length <= 4096
    ? [...bio.matchAll(/(?=([a-f0-9]{20}))/g)].map(match => digest(network, match[1]))
    : null;
  await db.transaction(async tx => {
    const [row] = await tx.select().from(bioQuota).where(eq(bioQuota.network, network)).for("update");
    const reads = row.reads.map(read => sameRead(read, reserved) ? { ...read, codes } : read);
    await tx.update(bioQuota).set({ reads }).where(eq(bioQuota.network, network));
  });
}

// Los aciertos y las faltas, incluso con una lectura compartida, se publican en el mismo plazo.
// Solo guardamos huellas de posibles códigos durante la ventana, nunca la biografía.
export async function checkBioCode(network: Network, handle: string, code: string, claim?: ClaimAttempt) {
  const releaseAt = Date.now() + 9000; // readBio limita el pedido externo a 8 segundos.
  const slot = await reserveBioRead(network, handle, claim);
  if (slot.kind === "paused") return { kind: "paused", until: slot.retryAt, attemptRecorded: false } as const;
  if (slot.kind === "new") await readAndStoreCodes(network, handle, slot.read);
  await sleep(Math.max(0, releaseAt - Date.now()));
  const [row] = await db.select().from(bioQuota).where(eq(bioQuota.network, network));
  if (row.pausedUntil > Date.now()) return { kind: "paused", until: row.pausedUntil, attemptRecorded: true } as const;
  // Otra petición pudo estar leyendo la bio cuando compartimos su reserva.
  const read = slot.read.codes === undefined ? row.reads.find(r => sameRead(r, slot.read)) : slot.read;
  const codes = read?.codes;
  if (!codes) return { kind: "unavailable" } as const;
  return { kind: codes.includes(digest(network, code)) ? "verified" : "missing" } as const;
}
