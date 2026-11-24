import { and, asc, eq, inArray, or } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { auth, type AuthUser } from "./auth.js";
import { db, schema } from "./db/index.js";

import { isOnline } from "./shared.js";

const { profile, photo, block } = schema;

export type Profile = typeof profile.$inferSelect;
export type AppEnv = { Variables: { user: AuthUser; profile: Profile | null } };

/** Exige sesión. Deja `user` y `profile` (puede ser null si falta completar el perfil). */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const s = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!s) throw new HTTPException(401, { message: "Tenés que iniciar sesión" });
  const [p] = await db.select().from(profile).where(eq(profile.userId, s.user.id));
  // Cuenta suspendida: solo puede ver su estado (GET /api/me), borrar su cuenta (DELETE /api/me) y pedir que
  // se revise la suspensión (/api/appeal, ver routes/appeals.ts)
  const allowed = (c.req.path === "/api/me" && ["GET", "DELETE"].includes(c.req.method)) || c.req.path === "/api/appeal" || c.req.path.startsWith("/api/appeal/");
  if (p?.suspendedAt && !allowed) {
    throw new HTTPException(403, { message: "Tu cuenta está suspendida" });
  }
  c.set("user", s.user);
  c.set("profile", p ?? null);
  await next();
});

/** Exige además que el perfil esté completo (fecha de nacimiento y nombre). */
export const requireProfile = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("profile")) throw new HTTPException(403, { message: "Completá tu perfil primero" });
  await next();
});

export function ageFrom(birthdate: string, now = new Date()): number {
  const [y, m, d] = birthdate.split("-").map(Number);
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age;
}

export const imageUrl = (key: string | null | undefined) => (key ? `/api/files/${key}` : null);
/** Versión chica (480 px) para grillas, avatares y listas: carga mucho más rápido. */
export const thumbUrl = (key: string | null | undefined) => (key ? `/api/files/${key}?s=thumb` : null);

/** Una foto o video del perfil/álbum, tal como lo ve la web. */
export const mediaOut = (x: { key: string; kind: string; posterKey: string | null; seconds: number | null }) => ({
  url: imageUrl(x.key)!,
  kind: x.kind === "video" ? ("video" as const) : ("photo" as const),
  // Miniatura: de las fotos, la versión chica; de los videos, el fotograma
  thumb: thumbUrl(x.kind === "video" ? x.posterKey : x.key),
  seconds: x.seconds ?? null,
});

export type Author = { id: string; name: string; age: number; photo: string | null };

/** Clave de la primera foto pública, por persona. */
export async function firstPublicPhotoKeys(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const photos = await db.selectDistinctOn([photo.userId], { userId: photo.userId, key: photo.key }).from(photo)
    .where(and(inArray(photo.userId, ids), eq(photo.isPrivate, false)))
    .orderBy(asc(photo.userId), asc(photo.position));
  return new Map(photos.map((p) => [p.userId, p.key]));
}

/**
 * Los links de un mensaje se pueden tocar solo si la cuenta que lo mandó tenía más de 24 horas en ese momento.
 * Frena a las cuentas recién creadas (bots) que entran a mandar links a todo el mundo. Vale para el chat privado y
 * para los grupos, incluido el general.
 */
export const LINKS_MIN_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;
export const canOpenLinks = (sentAt: Date, accountCreatedAt: Date) =>
  sentAt.getTime() - accountCreatedAt.getTime() >= LINKS_MIN_ACCOUNT_AGE_MS;

/** Nombre, edad y foto principal (pública) de varios usuarios. */
export async function authorsFor(ids: string[], options: { presence?: boolean } = {}): Promise<Map<string, Author>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, Author>();
  if (!unique.length) return map;
  const [profiles, firstPhoto] = await Promise.all([
    db.select({
      userId: profile.userId, displayName: profile.displayName, birthdate: profile.birthdate,
      ...(options.presence && { incognito: profile.incognito, suspendedAt: profile.suspendedAt, lastSeenAt: profile.lastSeenAt }),
    })
      .from(profile).where(inArray(profile.userId, unique)),
    firstPublicPhotoKeys(unique),
  ]);
  for (const p of profiles) {
    let presence: "online" | "recent" | undefined;
    if (options.presence && p.incognito === false && !p.suspendedAt && p.lastSeenAt) {
      if (isOnline(p.userId)) presence = "online";
      else if (Date.now() - p.lastSeenAt.getTime() < 15 * 60_000) presence = "recent";
    }
    map.set(p.userId, {
      ...(presence && { presence }),
      id: p.userId,
      name: p.displayName,
      age: ageFrom(p.birthdate),
      photo: thumbUrl(firstPhoto.get(p.userId)),
    });
  }
  return map;
}

/** Todos los usuarios con los que hay un bloqueo, en cualquier dirección. */
export async function blockedWith(userId: string): Promise<Set<string>> {
  const rows = await db
    .select()
    .from(block)
    .where(or(eq(block.blockerId, userId), eq(block.blockedId, userId)));
  return new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)));
}

export async function isBlocked(a: string, b: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(block)
    .where(or(
      and(eq(block.blockerId, a), eq(block.blockedId, b)),
      and(eq(block.blockerId, b), eq(block.blockedId, a)),
    ))
    .limit(1);
  return rows.length > 0;
}

export const newId = () => crypto.randomUUID();

export type ReactionSummary = { kind: string; by: string[] };

/**
 * Un mensaje privado como lo ve el chat. `expiresAt` solo viaja en los avisos de álbum activos:
 * hasta cuándo vale el acceso (ISO) o null si es sin límite. Ausente = vencido o de antes de guardar el álbum.
 */
export function serializeDm(
  m: typeof schema.directMessage.$inferSelect,
  reactions: ReactionSummary[] = [],
  expiresAt?: string | null,
  replyTo: { id: string; authorName: string | null; body: string | null } | null = null,
) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    kind: m.kind === "text" && m.photoKey ? "photo" : m.kind,
    body: m.body,
    ...(m.albumId ? { albumId: m.albumId } : {}),
    // Las fotos temporales nunca viajan en la lista: se piden una sola vez con /open
    photo: m.expiring ? null : imageUrl(m.photoKey),
    expiring: m.expiring,
    opened: Boolean(m.openedAt),
    readAt: m.readAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    ...(expiresAt !== undefined ? { expiresAt } : null),
    replyTo,
    reactions,
  };
}

/** Reacciones de varios mensajes, agrupadas por tipo: [{ kind: "fuego", by: [userId, ...] }]. */
export async function reactionsFor(messageIds: string[]): Promise<Map<string, ReactionSummary[]>> {
  const out = new Map<string, ReactionSummary[]>();
  if (!messageIds.length) return out;
  const rows = await db.select().from(schema.reaction)
    .where(inArray(schema.reaction.messageId, messageIds))
    .orderBy(asc(schema.reaction.createdAt));
  for (const r of rows) {
    const list = out.get(r.messageId) ?? [];
    const k = list.find((x) => x.kind === r.kind);
    if (k) k.by.push(r.userId);
    else list.push({ kind: r.kind, by: [r.userId] });
    out.set(r.messageId, list);
  }
  return out;
}
