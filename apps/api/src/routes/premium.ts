import { DM_EVENTS } from "@mortero/shared/realtime";
// Lo que en otras apps es "premium", acá es gratis para todo el mundo.
import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { authorsFor, blockedWith, isBlocked, newId, requireProfile, requireUser, type AppEnv } from "../lib.js";
import { emitToUser } from "../realtime.js";
import { pushTo } from "../push.js";
import { deleteImageUnlessEvidence } from "../moderation.js";
import { defaultAlbum, MAX_ALBUM_NAME, MAX_ALBUMS, myAlbums, renumberPhotos } from "../albums.js";

const { album, albumGrant, photo, profileView, favorite, conversation, directMessage, profile } = schema;

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

// ---------- Álbumes privados ----------

/** Por cuánto tiempo se puede compartir un álbum, en horas. null = sin límite. */
export const ALBUM_DURATIONS = [1, 24, 168] as const;

function durationLabel(hours: number | null) {
  if (hours == null) return null;
  if (hours === 1) return "1 hora";
  if (hours === 168) return "7 días";
  return `${hours} horas`;
}

const activeGrant = (now = new Date()) => or(isNull(albumGrant.expiresAt), gt(albumGrant.expiresAt, now));

/**
 * Si `viewerId` puede ver un archivo del álbum `albumId` de `ownerId`.
 * Cada álbum se comparte por separado: tener acceso a uno no abre los demás.
 * Un archivo privado sin álbum (no debería pasar) solo lo ve su dueño.
 */
export async function hasAlbumAccess(ownerId: string, viewerId: string, albumId: string | null) {
  if (ownerId === viewerId) return true;
  if (!albumId) return false;
  const [g] = await db
    .select({ albumId: albumGrant.albumId })
    .from(albumGrant)
    .where(and(eq(albumGrant.albumId, albumId), eq(albumGrant.ownerId, ownerId), eq(albumGrant.granteeId, viewerId), activeGrant()));
  return Boolean(g);
}

/** Qué álbumes de `ownerId` puede ver `viewerId` y hasta cuándo (null = sin límite). */
export async function albumAccess(ownerId: string, viewerId: string): Promise<Map<string, Date | null>> {
  const rows = await db
    .select({ albumId: albumGrant.albumId, expiresAt: albumGrant.expiresAt })
    .from(albumGrant)
    .where(and(eq(albumGrant.ownerId, ownerId), eq(albumGrant.granteeId, viewerId), activeGrant()));
  return new Map(rows.map((r) => [r.albumId, r.expiresAt]));
}

/** Un álbum de quien inició sesión, o 404. */
async function ownAlbum(userId: string, albumId: string) {
  const [a] = await db.select().from(album).where(and(eq(album.id, albumId), eq(album.userId, userId)));
  if (!a) throw new HTTPException(404, { message: "Ese álbum no existe" });
  return a;
}

const albumName = z.string().trim().min(1, "Ponele un nombre al álbum").max(MAX_ALBUM_NAME, `El nombre puede tener hasta ${MAX_ALBUM_NAME} letras`);
const durationInput = z.object({ hours: z.union([z.literal(1), z.literal(24), z.literal(168), z.null()]).default(null) });

function parse<T>(schemaIn: z.ZodType<T>, value: unknown): T {
  const r = schemaIn.safeParse(value);
  if (!r.success) throw new HTTPException(400, { message: r.error.issues[0].message });
  return r.data;
}

/** Mis álbumes, con cuántos archivos tiene cada uno y con cuánta gente está compartido. */
premiumRoutes.get("/album/albums", async (c) => {
  const u = c.get("user");
  const albums = await myAlbums(u.id);
  const items = await db.select({ albumId: photo.albumId, kind: photo.kind }).from(photo)
    .where(and(eq(photo.userId, u.id), eq(photo.isPrivate, true)));
  const grants = await db.select({ albumId: albumGrant.albumId }).from(albumGrant)
    .where(and(eq(albumGrant.ownerId, u.id), activeGrant()));
  return c.json(albums.map((a) => ({
    id: a.id,
    name: a.name,
    count: items.filter((x) => x.albumId === a.id).length,
    videos: items.filter((x) => x.albumId === a.id && x.kind === "video").length,
    shares: grants.filter((g) => g.albumId === a.id).length,
  })));
});

premiumRoutes.post("/album/albums", async (c) => {
  const u = c.get("user");
  const { name } = parse(z.object({ name: albumName }), await c.req.json().catch(() => ({})));
  const albums = await myAlbums(u.id);
  if (albums.length >= MAX_ALBUMS) throw new HTTPException(400, { message: `Podés tener hasta ${MAX_ALBUMS} álbumes` });
  const position = albums.length ? albums[albums.length - 1].position + 1 : 0;
  const [row] = await db.insert(album).values({ id: newId(), userId: u.id, name, position }).returning();
  return c.json({ id: row.id, name: row.name });
});

premiumRoutes.patch("/album/albums/:id", async (c) => {
  const u = c.get("user");
  const a = await ownAlbum(u.id, c.req.param("id"));
  const { name } = parse(z.object({ name: albumName }), await c.req.json().catch(() => ({})));
  await db.update(album).set({ name }).where(eq(album.id, a.id));
  return c.json({ id: a.id, name });
});

/**
 * Borra un álbum y sus accesos. Con `moveTo`, sus fotos y videos pasan a ese otro álbum;
 * sin `moveTo`, se borran junto con el álbum.
 */
premiumRoutes.delete("/album/albums/:id", async (c) => {
  const u = c.get("user");
  const a = await ownAlbum(u.id, c.req.param("id"));
  const moveTo = c.req.query("moveTo");
  if (moveTo) {
    if (moveTo === a.id) throw new HTTPException(400, { message: "Elegí otro álbum" });
    const target = await ownAlbum(u.id, moveTo);
    await db.update(photo).set({ albumId: target.id }).where(and(eq(photo.userId, u.id), eq(photo.albumId, a.id)));
  } else {
    const gone = await db.delete(photo).where(and(eq(photo.userId, u.id), eq(photo.albumId, a.id))).returning();
    for (const p of gone) {
      await deleteImageUnlessEvidence(p.key);
      if (p.posterKey) await deleteImageUnlessEvidence(p.posterKey);
    }
    if (gone.length) await renumberPhotos(u.id);
  }
  // Los accesos se van en cascada con el álbum
  await db.delete(album).where(eq(album.id, a.id));
  return c.json({ ok: true });
});

/** Con quién compartí mis álbumes (solo los accesos vigentes), una fila por persona y álbum. */
premiumRoutes.get("/album/grants", async (c) => {
  const u = c.get("user");
  // Los vencidos se limpian acá
  await db.delete(albumGrant).where(and(eq(albumGrant.ownerId, u.id), lte(albumGrant.expiresAt, new Date())));
  const rows = await db
    .select({ granteeId: albumGrant.granteeId, expiresAt: albumGrant.expiresAt, albumId: albumGrant.albumId, albumName: album.name })
    .from(albumGrant)
    .innerJoin(album, eq(album.id, albumGrant.albumId))
    .where(eq(albumGrant.ownerId, u.id))
    .orderBy(desc(albumGrant.createdAt));
  const authors = await authorsFor(rows.map((r) => r.granteeId));
  return c.json(rows.flatMap((r) => {
    const a = authors.get(r.granteeId);
    return a ? [{ ...a, expiresAt: r.expiresAt?.toISOString() ?? null, albumId: r.albumId, albumName: r.albumName }] : [];
  }));
});

/**
 * Compartir un álbum con alguien, por un tiempo o sin límite. Si ya lo tenía, se actualiza el plazo.
 * Le llega como mensaje en el chat (solo si no lo tenía vigente).
 */
async function shareAlbum(ownerId: string, albumId: string, target: string, hours: number | null) {
  if (target === ownerId) throw new HTTPException(400, { message: "Ya ves tus propios álbumes" });
  if (await isBlocked(ownerId, target)) throw new HTTPException(404, { message: "Perfil no disponible" });
  const [p] = await db.select().from(profile).where(eq(profile.userId, target));
  if (!p) throw new HTTPException(404, { message: "Perfil no disponible" });

  const hadAccess = (await albumAccess(ownerId, target)).has(albumId);
  const now = new Date();
  const expiresAt = hours == null ? null : new Date(now.getTime() + hours * 3_600_000);
  await db
    .insert(albumGrant)
    .values({ albumId, ownerId, granteeId: target, expiresAt, createdAt: now })
    .onConflictDoUpdate({ target: [albumGrant.albumId, albumGrant.granteeId], set: { expiresAt, createdAt: now } });

  if (!hadAccess) {
    // Aviso en la conversación (la crea si no existe). El cuerpo dice por cuánto tiempo.
    const key = ownerId < target ? { userA: ownerId, userB: target } : { userA: target, userB: ownerId };
    await db.insert(conversation).values({ id: newId(), ...key }).onConflictDoNothing();
    const [conv] = await db.select().from(conversation)
      .where(and(eq(conversation.userA, key.userA), eq(conversation.userB, key.userB)));
    const body = durationLabel(hours);
    const [row] = await db.insert(directMessage)
      .values({ id: newId(), conversationId: conv.id, senderId: ownerId, kind: "album", body, createdAt: now })
      .returning();
    await db.update(conversation)
      .set({ lastMessageAt: sql`greatest(${conversation.lastMessageAt}, ${now.toISOString()})` })
      .where(eq(conversation.id, conv.id));
    const msg = {
      id: row.id, conversationId: conv.id, senderId: ownerId, kind: "album", body, photo: null,
      expiring: false, opened: false, readAt: null, createdAt: now.toISOString(),
    };
    emitToUser(ownerId, DM_EVENTS.message, msg);
    emitToUser(target, DM_EVENTS.message, msg);
    pushTo(target, { title: "Te llegó un mensaje", body: "Abrí el chat para leerlo.", url: `/mensajes/${conv.id}`, tag: `dm-${conv.id}`, kind: "mensajes" }).catch(() => {});
  }
  return expiresAt;
}

premiumRoutes.put("/album/albums/:id/grants/:userId", async (c) => {
  const u = c.get("user");
  const a = await ownAlbum(u.id, c.req.param("id"));
  const { hours } = parse(durationInput, await c.req.json().catch(() => ({})));
  const expiresAt = await shareAlbum(u.id, a.id, c.req.param("userId"), hours);
  return c.json({ ok: true, albumId: a.id, expiresAt: expiresAt?.toISOString() ?? null });
});

premiumRoutes.delete("/album/albums/:id/grants/:userId", async (c) => {
  const u = c.get("user");
  const a = await ownAlbum(u.id, c.req.param("id"));
  await db.delete(albumGrant).where(and(eq(albumGrant.albumId, a.id), eq(albumGrant.granteeId, c.req.param("userId"))));
  return c.json({ ok: true });
});

/** Compartir sin elegir álbum (versiones viejas de la web): comparte el álbum por defecto. */
premiumRoutes.put("/album/grants/:userId", async (c) => {
  const u = c.get("user");
  const { hours } = parse(durationInput, await c.req.json().catch(() => ({})));
  const first = await defaultAlbum(u.id);
  const expiresAt = await shareAlbum(u.id, first.id, c.req.param("userId"), hours);
  return c.json({ ok: true, albumId: first.id, expiresAt: expiresAt?.toISOString() ?? null });
});

/** Le quita a alguien el acceso a todos mis álbumes. */
premiumRoutes.delete("/album/grants/:userId", async (c) => {
  const u = c.get("user");
  await db.delete(albumGrant).where(and(eq(albumGrant.ownerId, u.id), eq(albumGrant.granteeId, c.req.param("userId"))));
  return c.json({ ok: true });
});

/** Quita de una vez todos los accesos a todos los álbumes de quien inició sesión. */
premiumRoutes.delete("/album/grants", async (c) => {
  const u = c.get("user");
  await db.delete(albumGrant).where(eq(albumGrant.ownerId, u.id));
  return c.json({ ok: true });
});
