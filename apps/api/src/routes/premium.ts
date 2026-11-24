import { DM_EVENTS } from "@mortero/shared/realtime";
// Lo que en otras apps es "premium", acá es gratis para todo el mundo.
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { authorsFor, blockedWith, isBlocked, newId, reactionsFor, requireProfile, requireUser, serializeDm, type AppEnv } from "../lib.js";
import { emitToUser } from "../realtime.js";
import { pushDm } from "../push.js";
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
  const albumId = c.req.param("id");
  const moveTo = c.req.query("moveTo");
  if (moveTo === albumId) throw new HTTPException(400, { message: "Elegí otro álbum" });
  const { removed, notices } = await db.transaction(async (tx) => {
    const owned = await tx.select({ id: album.id }).from(album)
      .where(and(eq(album.userId, u.id), inArray(album.id, moveTo ? [albumId, moveTo] : [albumId])))
      .orderBy(asc(album.id)).for("update");
    if (owned.length !== (moveTo ? 2 : 1)) throw new HTTPException(404, { message: "Álbum no disponible" });

    const photos = and(eq(photo.userId, u.id), eq(photo.albumId, albumId));
    const removed = [];
    if (moveTo) {
      await tx.update(photo).set({ albumId: moveTo }).where(photos);
    } else {
      removed.push(...await tx.delete(photo).where(photos).returning());
    }
    const albums = await tx.select({ id: album.id }).from(album).where(eq(album.userId, u.id)).limit(2);
    // Los avisos anteriores al identificador solo se pueden atribuir si había un único álbum.
    const changed = await tx.update(directMessage).set({ kind: "album_revoked", albumId })
      .where(and(
        eq(directMessage.senderId, u.id),
        eq(directMessage.albumId, albumId),
        inArray(directMessage.kind, ["album", "album_expired"]),
      )).returning();
    if (albums.length === 1) {
      const legacy = await tx.update(directMessage).set({ kind: "album_revoked" })
        .where(and(eq(directMessage.senderId, u.id), isNull(directMessage.albumId),
          inArray(directMessage.kind, ["album", "album_expired"]))).returning();
      changed.push(...legacy);
    }
    await tx.delete(album).where(eq(album.id, albumId));
    const conversationIds = [...new Set(changed.map((notice) => notice.conversationId))];
    const chats = conversationIds.length
      ? await tx.select().from(conversation).where(inArray(conversation.id, conversationIds))
      : [];
    const peers = new Map(chats.map((chat) => [chat.id, chat.userA === u.id ? chat.userB : chat.userA]));
    return { removed, notices: changed.flatMap((row) => {
      const other = peers.get(row.conversationId);
      return other ? [{ row, other }] : [];
    }) };
  });
  for (const { row, other } of notices) await emitNoticeUpdated(u.id, other, row);
  for (const p of removed) {
    await deleteImageUnlessEvidence(p.key);
    if (p.posterKey) await deleteImageUnlessEvidence(p.posterKey);
  }
  if (removed.length) await renumberPhotos(u.id);
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

/** La conversación entre dos personas, creándola si no existe. */
async function conversationBetween(a: string, b: string, database: Pick<typeof db, "insert" | "select">) {
  const key = a < b ? { userA: a, userB: b } : { userA: b, userB: a };
  await database.insert(conversation).values({ id: newId(), ...key }).onConflictDoNothing();
  const [conv] = await database.select().from(conversation)
    .where(and(eq(conversation.userA, key.userA), eq(conversation.userB, key.userB)));
  return conv;
}

/**
 * Los avisos de álbum (activos, revocados o vencidos) que alguien puso en una conversación, del más viejo al más nuevo.
 * Con `albumId`, solo los de ese álbum; los avisos de antes de guardar el álbum (albumId null) solo se
 * pueden atribuir si hay un único álbum.
 */
async function albumNotices(conversationId: string, senderId: string, albumId?: string, database: Pick<typeof db, "select"> = db) {
  const rows = await database.select().from(directMessage)
    .where(and(
      eq(directMessage.conversationId, conversationId),
      eq(directMessage.senderId, senderId),
      inArray(directMessage.kind, ["album", "album_revoked", "album_expired"]),
    ))
    .orderBy(asc(directMessage.createdAt), asc(directMessage.id));
  if (albumId === undefined) return rows;
  const hasLegacy = rows.some((m) => m.albumId == null && m.kind !== "album_revoked");
  const adoptLegacy = hasLegacy && (await database.select({ id: album.id }).from(album).where(eq(album.userId, senderId)).limit(2)).length === 1;
  return rows.filter((m) => m.albumId === albumId || (adoptLegacy && m.albumId == null && m.kind !== "album_revoked"));
}

/** Avisa a los dos en vivo que un aviso cambió (las reacciones no cambian y se conservan). */
async function emitNoticeUpdated(ownerId: string, otherId: string, row: typeof directMessage.$inferSelect, expiresAt?: string | null) {
  const reactions = await reactionsFor([row.id]);
  const msg = serializeDm(row, reactions.get(row.id), expiresAt);
  emitToUser(ownerId, DM_EVENTS.updated, msg);
  emitToUser(otherId, DM_EVENTS.updated, msg);
}

/**
 * Compartir un álbum con alguien, por un tiempo o sin límite. Si ya lo tenía, se actualiza el plazo.
 * El aviso del chat muestra siempre el estado actual: hay uno por álbum, se actualiza al cambiar el plazo
 * o al volver a compartir, y los duplicados viejos se borran. El push solo llega cuando alguien recibe
 * acceso que no tenía (la primera vez o al recuperarlo después de una revocación).
 */
async function shareAlbum(ownerId: string, albumId: string, target: string, hours: number | null) {
  if (target === ownerId) throw new HTTPException(400, { message: "Ya ves tus propios álbumes" });
  if (await isBlocked(ownerId, target)) throw new HTTPException(404, { message: "Perfil no disponible" });
  const [p] = await db.select().from(profile).where(eq(profile.userId, target));
  if (!p) throw new HTTPException(404, { message: "Perfil no disponible" });

  const result = await db.transaction(async (tx) => {
    const [owned] = await tx.select({ id: album.id }).from(album)
      .where(and(eq(album.id, albumId), eq(album.userId, ownerId))).for("update");
    if (!owned) throw new HTTPException(404, { message: "Álbum no disponible" });

    const now = new Date();
    const [grant] = await tx.select().from(albumGrant)
      .where(and(eq(albumGrant.albumId, albumId), eq(albumGrant.granteeId, target), activeGrant(now)));
    const expiresAt = hours == null ? null : new Date(now.getTime() + hours * 3_600_000);
    await tx.insert(albumGrant).values({ albumId, ownerId, granteeId: target, expiresAt, createdAt: now })
      .onConflictDoUpdate({ target: [albumGrant.albumId, albumGrant.granteeId], set: { expiresAt, createdAt: now } });

    const conv = await conversationBetween(ownerId, target, tx);
    const notices = await albumNotices(conv.id, ownerId, albumId, tx);
    const existing = notices.find((m) => m.albumId === albumId) ?? notices.at(-1);
    const duplicates = notices.filter((m) => m.id !== existing?.id).map((m) => m.id);
    if (duplicates.length) {
      await tx.delete(directMessage).where(inArray(directMessage.id, duplicates));
      await tx.delete(schema.reaction).where(inArray(schema.reaction.messageId, duplicates));
    }
    const reactivating = Boolean(existing && (!grant || existing.kind === "album_revoked"));
    const stamp = existing && reactivating ? new Date(Math.max(now.getTime(), existing.createdAt.getTime() + 1)) : now;
    const fields = { kind: "album", body: durationLabel(hours), albumId };
    const [row] = existing
      ? await tx.update(directMessage).set({ ...fields, ...(reactivating ? { createdAt: stamp, readAt: null } : {}) })
        .where(eq(directMessage.id, existing.id)).returning()
      : await tx.insert(directMessage).values({ ...fields, id: newId(), conversationId: conv.id, senderId: ownerId, createdAt: stamp }).returning();
    if (!existing || reactivating) {
      await tx.update(conversation)
        .set({ lastMessageAt: sql`greatest(${conversation.lastMessageAt}, ${stamp.toISOString()})` })
        .where(eq(conversation.id, conv.id));
    }
    return { row, conv, expiresAt, duplicates, isNew: !existing, hadAccess: Boolean(grant) };
  });

  const { row, conv, expiresAt, duplicates, isNew, hadAccess } = result;
  for (const id of duplicates) {
    const gone = { conversationId: conv.id, id };
    emitToUser(ownerId, DM_EVENTS.deleted, gone);
    emitToUser(target, DM_EVENTS.deleted, gone);
  }
  const expiresAtIso = expiresAt?.toISOString() ?? null;
  if (isNew) {
    const msg = serializeDm(row, [], expiresAtIso);
    emitToUser(ownerId, DM_EVENTS.message, msg);
    emitToUser(target, DM_EVENTS.message, msg);
  } else {
    await emitNoticeUpdated(ownerId, target, row, expiresAtIso);
  }
  if (!hadAccess) {
    pushDm(target, conv.id).catch(() => {});
  }
  return expiresAt;
}

/** Conserva el aviso identificado y elimina los duplicados anteriores. */
async function revokeNoticeGroup(
  database: Pick<typeof db, "delete" | "update">,
  notices: (typeof directMessage.$inferSelect)[],
  albumId: string | null,
) {
  const latest = (albumId != null ? notices.find((m) => m.albumId === albumId) : undefined) ?? notices.at(-1);
  if (!latest) return null;
  const duplicates = notices.filter((m) => m.id !== latest.id).map((m) => m.id);
  if (duplicates.length) {
    await database.delete(directMessage).where(inArray(directMessage.id, duplicates));
    await database.delete(schema.reaction).where(inArray(schema.reaction.messageId, duplicates));
  }
  const [row] = latest.kind === "album_revoked" ? [] : await database.update(directMessage)
    .set({ kind: "album_revoked", albumId })
    .where(eq(directMessage.id, latest.id))
    .returning();
  return { row, duplicates, conversationId: latest.conversationId };
}

async function publishRevocation(ownerId: string, otherId: string, result: Awaited<ReturnType<typeof revokeNoticeGroup>>) {
  if (!result) return;
  for (const id of result.duplicates) {
    const payload = { conversationId: result.conversationId, id };
    emitToUser(ownerId, DM_EVENTS.deleted, payload);
    emitToUser(otherId, DM_EVENTS.deleted, payload);
  }
  if (result.row) await emitNoticeUpdated(ownerId, otherId, result.row);
}

/** Con un único álbum se pueden atribuir los avisos anteriores al identificador. */
async function adoptedAlbumId(ownerId: string, notices: Pick<typeof directMessage.$inferSelect, "albumId" | "kind">[]) {
  if (!notices.some((m) => m.albumId == null && m.kind !== "album_revoked")) return null;
  const albums = await myAlbums(ownerId);
  return albums.length === 1 ? albums[0].id : null;
}

/**
 * Marca como revocados los avisos de álbum de alguien en su chat con otra persona (de un álbum o,
 * con null, de todos) y avisa a los dos en vivo. Queda un solo aviso por álbum: los duplicados se van.
 * Al revocar todo, los avisos viejos sin álbum también se revocan: como se corta todo acceso, no hay
 * riesgo de atribuir mal (distinto de share, que solo toca los del álbum que se comparte).
 * Si no hay conversación o no hay avisos, no hace nada.
 */
export async function markAlbumNoticesRevoked(ownerId: string, granteeId: string, albumId: string | null) {
  const key = ownerId < granteeId ? { userA: ownerId, userB: granteeId } : { userA: granteeId, userB: ownerId };
  const [conv] = await db.select().from(conversation)
    .where(and(eq(conversation.userA, key.userA), eq(conversation.userB, key.userB)));
  if (!conv) return;
  const notices = albumId === null
    ? await albumNotices(conv.id, ownerId)
    : await albumNotices(conv.id, ownerId, albumId);
  if (!notices.length) return;
  const adopted = await adoptedAlbumId(ownerId, notices);
  const groups = new Map<string, { albumId: string | null; list: typeof notices }>();
  for (const m of notices) {
    const id = m.albumId ?? (m.kind === "album_revoked" ? null : adopted);
    const k = id ?? (m.kind === "album_revoked" ? m.id : "legacy");
    const g = groups.get(k) ?? { albumId: id, list: [] };
    g.list.push(m);
    groups.set(k, g);
  }
  for (const g of groups.values()) {
    await publishRevocation(ownerId, granteeId, await db.transaction((tx) => revokeNoticeGroup(tx, g.list, g.albumId)));
  }
}

/** Marca como revocados todos los avisos de álbum de alguien, en todos sus chats, avisando en vivo. */
async function markAllMyNoticesRevoked(ownerId: string) {
  const rows = await db.select({ m: directMessage, userA: conversation.userA, userB: conversation.userB })
    .from(directMessage)
    .innerJoin(conversation, eq(conversation.id, directMessage.conversationId))
    .where(and(eq(directMessage.senderId, ownerId), inArray(directMessage.kind, ["album", "album_revoked", "album_expired"])))
    .orderBy(asc(directMessage.createdAt), asc(directMessage.id));
  if (!rows.length) return;
  const adopted = await adoptedAlbumId(ownerId, rows.map((r) => r.m));
  const groups = new Map<string, { other: string; albumId: string | null; list: (typeof directMessage.$inferSelect)[] }>();
  for (const r of rows) {
    const id = r.m.albumId ?? (r.m.kind === "album_revoked" ? null : adopted);
    const k = `${r.m.conversationId} ${id ?? (r.m.kind === "album_revoked" ? r.m.id : "legacy")}`;
    const g = groups.get(k) ?? { other: r.userA === ownerId ? r.userB : r.userA, albumId: id, list: [] };
    g.list.push(r.m);
    groups.set(k, g);
  }
  for (const g of groups.values()) {
    await publishRevocation(ownerId, g.other, await db.transaction((tx) => revokeNoticeGroup(tx, g.list, g.albumId)));
  }
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
  const albumId = c.req.param("id");
  const target = c.req.param("userId");
  const result = await db.transaction(async (tx) => {
    const [owned] = await tx.select({ id: album.id }).from(album)
      .where(and(eq(album.id, albumId), eq(album.userId, u.id))).for("update");
    if (!owned) throw new HTTPException(404, { message: "Álbum no disponible" });
    await tx.delete(albumGrant).where(and(eq(albumGrant.albumId, albumId), eq(albumGrant.granteeId, target)));
    const key = u.id < target ? { userA: u.id, userB: target } : { userA: target, userB: u.id };
    const [conv] = await tx.select().from(conversation)
      .where(and(eq(conversation.userA, key.userA), eq(conversation.userB, key.userB)));
    return conv ? revokeNoticeGroup(tx, await albumNotices(conv.id, u.id, albumId, tx), albumId) : null;
  });
  await publishRevocation(u.id, target, result);
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
  const target = c.req.param("userId");
  await db.delete(albumGrant).where(and(eq(albumGrant.ownerId, u.id), eq(albumGrant.granteeId, target)));
  await markAlbumNoticesRevoked(u.id, target, null);
  return c.json({ ok: true });
});

/** Quita de una vez todos los accesos a todos los álbumes de quien inició sesión. */
premiumRoutes.delete("/album/grants", async (c) => {
  const u = c.get("user");
  await db.delete(albumGrant).where(eq(albumGrant.ownerId, u.id));
  await markAllMyNoticesRevoked(u.id);
  return c.json({ ok: true });
});
