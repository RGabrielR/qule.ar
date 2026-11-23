// Lo que en otras apps es "premium", acá es gratis para todo el mundo.
import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { authorsFor, blockedWith, isBlocked, newId, requireProfile, requireUser, type AppEnv } from "../lib.js";
import { emitToUser } from "../realtime.js";
import { pushTo } from "../push.js";

const { albumGrant, profileView, favorite, conversation, directMessage, profile } = schema;

/** Cuántos días se guardan las visitas a tu perfil. */
const VIEWS_DAYS = 30;

export const premiumRoutes = new Hono<AppEnv>();
for (const p of ["/me/views", "/favorites", "/favorites/*", "/album/*"]) {
  premiumRoutes.use(p, requireUser, requireProfile);
}

// ---------- Quién me vio ----------

/** Registra una visita, salvo que quien mira esté en incógnito o se esté mirando a sí mismo. */
export async function recordView(viewerId: string, viewerIncognito: boolean, viewedId: string) {
  if (viewerId === viewedId || viewerIncognito) return;
  await db
    .insert(profileView)
    .values({ viewerId, viewedId, viewedAt: new Date() })
    .onConflictDoUpdate({ target: [profileView.viewerId, profileView.viewedId], set: { viewedAt: new Date() } });
}

premiumRoutes.get("/me/views", async (c) => {
  const u = c.get("user");
  const since = new Date(Date.now() - VIEWS_DAYS * 86_400_000);
  const rows = await db
    .select({ viewerId: profileView.viewerId, viewedAt: profileView.viewedAt, incognito: profile.incognito })
    .from(profileView)
    .innerJoin(profile, eq(profile.userId, profileView.viewerId))
    .where(and(eq(profileView.viewedId, u.id), gt(profileView.viewedAt, since)))
    .orderBy(desc(profileView.viewedAt))
    .limit(200);
  const blocked = await blockedWith(u.id);
  // Si después se pusieron en incógnito, también dejan de aparecer
  const visible = rows.filter((r) => !blocked.has(r.viewerId) && !r.incognito);
  const authors = await authorsFor(visible.map((r) => r.viewerId));
  return c.json(visible.flatMap((r) => {
    const a = authors.get(r.viewerId);
    return a ? [{ ...a, viewedAt: r.viewedAt.toISOString() }] : [];
  }));
});

// ---------- Favoritos ----------

premiumRoutes.get("/favorites", async (c) => {
  const u = c.get("user");
  const rows = await db.select().from(favorite).where(eq(favorite.userId, u.id)).orderBy(desc(favorite.createdAt));
  const blocked = await blockedWith(u.id);
  const ids = rows.map((r) => r.favoriteId).filter((id) => !blocked.has(id));
  const authors = await authorsFor(ids);
  return c.json(ids.flatMap((id) => (authors.get(id) ? [authors.get(id)!] : [])));
});

premiumRoutes.put("/favorites/:userId", async (c) => {
  const u = c.get("user");
  const target = c.req.param("userId");
  if (target === u.id) throw new HTTPException(400, { message: "No podés marcarte como favorito" });
  await db.insert(favorite).values({ userId: u.id, favoriteId: target }).onConflictDoNothing();
  return c.json({ ok: true });
});

premiumRoutes.delete("/favorites/:userId", async (c) => {
  const u = c.get("user");
  await db.delete(favorite).where(and(eq(favorite.userId, u.id), eq(favorite.favoriteId, c.req.param("userId"))));
  return c.json({ ok: true });
});

// ---------- Álbum privado ----------

/** Por cuánto tiempo se puede compartir el álbum, en horas. null = sin límite. */
export const ALBUM_DURATIONS = [1, 24, 168] as const;

function durationLabel(hours: number | null) {
  if (hours == null) return null;
  if (hours === 1) return "1 hora";
  if (hours === 168) return "7 días";
  return `${hours} horas`;
}

const activeGrant = (now = new Date()) => or(isNull(albumGrant.expiresAt), gt(albumGrant.expiresAt, now));

export async function hasAlbumAccess(ownerId: string, viewerId: string) {
  if (ownerId === viewerId) return true;
  const [g] = await db
    .select()
    .from(albumGrant)
    .where(and(eq(albumGrant.ownerId, ownerId), eq(albumGrant.granteeId, viewerId), activeGrant()));
  return Boolean(g);
}

/** Hasta cuándo `viewerId` puede ver el álbum de `ownerId` (undefined = no puede; null = sin límite). */
export async function albumAccessUntil(ownerId: string, viewerId: string): Promise<Date | null | undefined> {
  const [g] = await db
    .select()
    .from(albumGrant)
    .where(and(eq(albumGrant.ownerId, ownerId), eq(albumGrant.granteeId, viewerId), activeGrant()));
  return g ? g.expiresAt : undefined;
}

/** Con quién compartí mi álbum privado (solo los accesos vigentes). */
premiumRoutes.get("/album/grants", async (c) => {
  const u = c.get("user");
  // Los vencidos se limpian acá
  await db.delete(albumGrant).where(and(eq(albumGrant.ownerId, u.id), lte(albumGrant.expiresAt, new Date())));
  const rows = await db.select().from(albumGrant).where(eq(albumGrant.ownerId, u.id)).orderBy(desc(albumGrant.createdAt));
  const authors = await authorsFor(rows.map((r) => r.granteeId));
  return c.json(rows.flatMap((r) => {
    const a = authors.get(r.granteeId);
    return a ? [{ ...a, expiresAt: r.expiresAt?.toISOString() ?? null }] : [];
  }));
});

/**
 * Compartir mi álbum privado con alguien, por un tiempo o sin límite. Si ya lo tenía, se actualiza el plazo.
 * Le llega como mensaje en el chat (solo si no lo tenía vigente).
 */
premiumRoutes.put("/album/grants/:userId", async (c) => {
  const u = c.get("user");
  const target = c.req.param("userId");
  const { hours } = z
    .object({ hours: z.union([z.literal(1), z.literal(24), z.literal(168), z.null()]).default(null) })
    .parse(await c.req.json().catch(() => ({})));
  if (target === u.id) throw new HTTPException(400, { message: "Ya ves tu propio álbum" });
  if (await isBlocked(u.id, target)) throw new HTTPException(404, { message: "Perfil no disponible" });
  const [p] = await db.select().from(profile).where(eq(profile.userId, target));
  if (!p) throw new HTTPException(404, { message: "Perfil no disponible" });

  const hadAccess = (await albumAccessUntil(u.id, target)) !== undefined;
  const now = new Date();
  const expiresAt = hours == null ? null : new Date(now.getTime() + hours * 3_600_000);
  await db
    .insert(albumGrant)
    .values({ ownerId: u.id, granteeId: target, expiresAt, createdAt: now })
    .onConflictDoUpdate({ target: [albumGrant.ownerId, albumGrant.granteeId], set: { expiresAt, createdAt: now } });

  if (!hadAccess) {
    // Aviso en la conversación (la crea si no existe). El cuerpo dice por cuánto tiempo.
    const key = u.id < target ? { userA: u.id, userB: target } : { userA: target, userB: u.id };
    await db.insert(conversation).values({ id: newId(), ...key }).onConflictDoNothing();
    const [conv] = await db.select().from(conversation)
      .where(and(eq(conversation.userA, key.userA), eq(conversation.userB, key.userB)));
    const body = durationLabel(hours);
    const [row] = await db.insert(directMessage)
      .values({ id: newId(), conversationId: conv.id, senderId: u.id, kind: "album", body, createdAt: now })
      .returning();
    await db.update(conversation).set({ lastMessageAt: now }).where(eq(conversation.id, conv.id));
    const msg = {
      id: row.id, conversationId: conv.id, senderId: u.id, kind: "album", body, photo: null,
      expiring: false, opened: false, readAt: null, createdAt: now.toISOString(),
    };
    emitToUser(u.id, "dm:message", msg);
    emitToUser(target, "dm:message", msg);
    pushTo(target, { title: "Te llegó un mensaje", body: "Abrí el chat para leerlo.", url: `/mensajes/${conv.id}`, tag: `dm-${conv.id}`, kind: "mensajes" }).catch(() => {});
  }
  return c.json({ ok: true, expiresAt: expiresAt?.toISOString() ?? null });
});

premiumRoutes.delete("/album/grants/:userId", async (c) => {
  const u = c.get("user");
  await db.delete(albumGrant).where(and(eq(albumGrant.ownerId, u.id), eq(albumGrant.granteeId, c.req.param("userId"))));
  return c.json({ ok: true });
});

/** Quita de una vez todos los accesos al álbum de quien inició sesión. */
premiumRoutes.delete("/album/grants", async (c) => {
  const u = c.get("user");
  await db.delete(albumGrant).where(eq(albumGrant.ownerId, u.id));
  return c.json({ ok: true });
});
