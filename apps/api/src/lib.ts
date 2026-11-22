import { and, asc, eq, inArray, or } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { auth, type AuthUser } from "./auth.js";
import { db, schema } from "./db/index.js";

const { profile, photo, block } = schema;

export type Profile = typeof profile.$inferSelect;
export type AppEnv = { Variables: { user: AuthUser; profile: Profile | null } };

/** Exige sesión. Deja `user` y `profile` (puede ser null si falta completar el perfil). */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const s = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!s) throw new HTTPException(401, { message: "Tenés que iniciar sesión" });
  const [p] = await db.select().from(profile).where(eq(profile.userId, s.user.id));
  // Cuenta suspendida: solo puede ver su estado (GET /api/me) y borrar su cuenta (DELETE /api/me)
  if (p?.suspendedAt && !(c.req.path === "/api/me" && ["GET", "DELETE"].includes(c.req.method))) {
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

/** Nombre, edad y foto principal (pública) de varios usuarios. */
export async function authorsFor(ids: string[]): Promise<Map<string, Author>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, Author>();
  if (!unique.length) return map;
  const [profiles, firstPhoto] = await Promise.all([
    db.select({ userId: profile.userId, displayName: profile.displayName, birthdate: profile.birthdate })
      .from(profile).where(inArray(profile.userId, unique)),
    firstPublicPhotoKeys(unique),
  ]);
  for (const p of profiles) {
    map.set(p.userId, {
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

/** Reacciones de varios mensajes, agrupadas por tipo: [{ kind: "fuego", by: [userId, ...] }]. */
export async function reactionsFor(scope: "dm" | "group", messageIds: string[]): Promise<Map<string, ReactionSummary[]>> {
  const out = new Map<string, ReactionSummary[]>();
  if (!messageIds.length) return out;
  const rows = await db.select().from(schema.reaction)
    .where(and(eq(schema.reaction.scope, scope), inArray(schema.reaction.messageId, messageIds)))
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

/** Los clientes anteriores mandan mensajes sin clave de reintento. */
export function messageKey(value: string | undefined) {
  if (value === undefined) return null;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
    throw new HTTPException(400, { message: "Identificador de mensaje inválido" });
  return value;
}
