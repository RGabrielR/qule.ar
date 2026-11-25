import { DM_EVENTS, INBOX_LIMIT, READ_RECEIPT_LIMIT, type DmReadReceipt } from "@mortero/shared/realtime";
import { and, asc, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import {
  ageFrom, authorsFor, imageUrl, isBlocked, mediaOut, newId, reactionsFor, requireProfile, requireUser, serializeDm, type AppEnv, type ReactionSummary,
} from "../lib.js";
import { emitToUser, isOnline } from "../realtime.js";
import { distanceLabel, visibleKm } from "../geo.js";
import { deleteImage, MAX_UPLOAD_BYTES, saveImage } from "../storage.js";
import { albumAccess, markAlbumNoticesRevoked, recordView } from "./premium.js";
import { myRecentToque } from "./toques.js";
import { pushTo } from "../push.js";
import { EXPIRING_GRACE_MS, EXPIRING_SECONDS } from "../expiring.js";
import { deleteImageUnlessEvidence, isUrgent, notifyModeratorsUrgent, REPORT_REASONS } from "../moderation.js";
import { limit } from "../ratelimit.js";
import { warnIfReachingAutoSuspend } from "../autoSuspend.js";

const { profile, photo, block, report, conversation, directMessage } = schema;

export const socialRoutes = new Hono<AppEnv>();
for (const p of ["/users/*", "/conversations", "/conversations/*", "/blocks", "/blocks/*", "/reports"]) {
  socialRoutes.use(p, requireUser, requireProfile);
}

// ---------- Perfiles de otras personas ----------

socialRoutes.get("/users/:id", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  if (id !== me.id && (await isBlocked(me.id, id))) return c.notFound();
  const [p] = await db.select().from(profile).where(eq(profile.userId, id));
  if (!p || (p.suspendedAt && id !== me.id)) return c.notFound();
  const allPhotos = await db.select().from(photo).where(eq(photo.userId, id)).orderBy(asc(photo.position));
  const photos = allPhotos.filter((x) => !x.isPrivate);
  const privatePhotos = allPhotos.filter((x) => x.isPrivate);
  // Qué álbumes puedo ver y hasta cuándo (null = sin límite). Cada álbum se comparte por separado.
  const albums = privatePhotos.length > 0 ? await db.select().from(schema.album).where(eq(schema.album.userId, id)).orderBy(asc(schema.album.position), asc(schema.album.createdAt)) : [];
  const access = id === me.id ? new Map(albums.map((a) => [a.id, null])) : privatePhotos.length > 0 ? await albumAccess(id, me.id) : new Map<string, Date | null>();
  const visibleAlbums = albums.flatMap((a) => {
    if (!access.has(a.id)) return [];
    const items = privatePhotos.filter((x) => x.albumId === a.id);
    if (!items.length) return [];
    const until = access.get(a.id) ?? null;
    return [{ id: a.id, name: a.name, count: items.length, videos: items.filter((x) => x.kind === "video").length, items: items.map(mediaOut), expiresAt: until ? until.toISOString() : null }];
  });
  // Lista explícita de campos públicos: nunca la fecha de nacimiento ni la celda de ubicación
  const mine = c.get("profile")!;
  await recordView(me.id, mine.incognito, id);
  const km = id === me.id ? null : visibleKm(mine, p);
  // En incógnito no se muestra si estás en línea
  const on = !p.incognito && isOnline(id);
  const [fav] = await db.select().from(schema.favorite)
    .where(and(eq(schema.favorite.userId, me.id), eq(schema.favorite.favoriteId, id)));
  // Qué álbumes míos le compartí y hasta cuándo
  const myGrants = id === me.id ? new Map<string, Date | null>() : await albumAccess(me.id, id);
  return c.json({
    id,
    displayName: p.displayName,
    age: ageFrom(p.birthdate),
    about: p.about,
    heightCm: p.heightCm,
    weightKg: p.weightKg,
    bodyType: p.bodyType,
    position: p.position,
    tribes: p.tribes,
    lookingFor: p.lookingFor,
    relationship: p.relationship,
    pronouns: p.pronouns,
    hasPlace: p.hasPlace,
    hivStatus: p.hivStatus,
    lastTested: p.lastTested,
    photos: photos.map((x) => imageUrl(x.key)),
    isMe: id === me.id,
    online: on,
    recent: !p.incognito && (on || Date.now() - p.lastSeenAt.getTime() < 15 * 60_000),
    favorite: Boolean(fav),
    // Álbumes privados: cuántas fotos y videos hay en total y, de los que te compartieron, el contenido y hasta cuándo
    // los ves. Los nombres de los álbumes que no te compartieron no se muestran.
    // items junta lo de todos los álbumes que ves (null si no ves ninguno); expiresAt es el del primero.
    privateAlbum: privatePhotos.length
      ? {
          count: privatePhotos.length,
          videos: privatePhotos.filter((x) => x.kind === "video").length,
          items: visibleAlbums.length ? visibleAlbums.flatMap((a) => a.items) : null,
          expiresAt: visibleAlbums[0]?.expiresAt ?? null,
          albums: visibleAlbums,
        }
      : null,
    iSharedAlbum: myGrants.size > 0,
    // Qué álbumes míos le compartí y hasta cuándo (expiresAt null = sin límite)
    myShares: [...myGrants].map(([albumId, until]) => ({ albumId, expiresAt: until ? until.toISOString() : null })),
    // El último toque que le mandé, si fue hace menos de 12 horas
    myToque: id === me.id ? null : await myRecentToque(me.id, id),
    sharedUntil: [...myGrants.values()].find((x) => x)?.toISOString() ?? null,
    distance: km != null ? distanceLabel(km) : null,
  });
});

// ---------- Mensajes privados ----------

const pair = (a: string, b: string) => (a < b ? { userA: a, userB: b } : { userA: b, userB: a });

async function myConversation(convId: string, userId: string) {
  const [conv] = await db.select().from(conversation).where(eq(conversation.id, convId));
  if (!conv || (conv.userA !== userId && conv.userB !== userId)) {
    throw new HTTPException(404, { message: "Conversación no encontrada" });
  }
  return { conv, otherId: conv.userA === userId ? conv.userB : conv.userA };
}

type DmReply = { id: string; authorName: string | null; body: string | null };

/** Texto corto para mostrar dentro de una cita. */
function replyPreview(m: typeof directMessage.$inferSelect): string | null {
  const body = m.body?.trim().slice(0, 160) || null;
  if (m.kind.startsWith("album")) return body ? `Álbum privado · ${body}` : "Álbum privado";
  if (m.expiring) return body ? `Foto temporal · ${body}` : "Foto temporal";
  if (m.kind === "photo" || m.photoKey) return body ?? "Foto";
  return body;
}

/** Serializa una tanda de mensajes resolviendo las citas en lote. */
async function serializeDms(
  rows: (typeof directMessage.$inferSelect)[],
  reactions: Map<string, ReactionSummary[]> = new Map(),
) {
  const replyIds = [...new Set(rows.map((m) => m.replyToId).filter((x): x is string => Boolean(x)))];
  const quoted = replyIds.length
    ? await db.select().from(directMessage).where(inArray(directMessage.id, replyIds))
    : [];
  const quotedById = new Map(quoted.map((m) => [m.id, m]));
  const authors = quoted.length ? await authorsFor(quoted.map((m) => m.senderId)) : null;
  return rows.map((m) => {
    let replyTo: DmReply | null = null;
    if (m.replyToId) {
      const q = quotedById.get(m.replyToId);
      replyTo = q && q.conversationId === m.conversationId
        ? { id: q.id, authorName: authors?.get(q.senderId)?.name ?? "Cuenta borrada", body: replyPreview(q) }
        : { id: m.replyToId, authorName: null, body: null };
    }
    return serializeDm(m, reactions.get(m.id), undefined, replyTo);
  });
}

/** Valida que el mensaje citado exista en la misma conversación. */
async function replyToIdFor(replyToId: string | undefined, conversationId: string) {
  if (!replyToId) return null;
  const [orig] = await db
    .select({ id: directMessage.id })
    .from(directMessage)
    .where(and(eq(directMessage.id, replyToId), eq(directMessage.conversationId, conversationId)))
    .limit(1);
  if (!orig) throw new HTTPException(400, { message: "Ese mensaje ya no está" });
  return orig.id;
}

/** El acceso vigente determina el estado visible. Consultarlo nunca modifica el aviso. */
async function albumNoticeStates(
  meId: string,
  rows: { message: typeof directMessage.$inferSelect; otherId: string }[],
) {
  const states = new Map<string, { kind: string; albumId: string | null; expiresAt?: string | null }>();
  const notices = rows.filter(({ message }) => message.kind === "album" || message.kind === "album_expired");
  if (!notices.length) return states;

  const peers = [...new Set(notices.map(({ otherId }) => otherId))];
  const legacyOwners = [...new Set(notices.filter(({ message }) => message.albumId == null).map(({ message }) => message.senderId))];
  const [grants, albums] = await Promise.all([
    db.select().from(schema.albumGrant).where(or(
      and(eq(schema.albumGrant.ownerId, meId), inArray(schema.albumGrant.granteeId, peers)),
      and(inArray(schema.albumGrant.ownerId, peers), eq(schema.albumGrant.granteeId, meId)),
    )),
    legacyOwners.length
      ? db.select({ id: schema.album.id, ownerId: schema.album.userId }).from(schema.album).where(inArray(schema.album.userId, legacyOwners))
      : [],
  ]);
  const byGrant = new Map(grants.map((g) => [JSON.stringify([g.albumId, g.ownerId, g.granteeId]), g]));
  const byOwner = new Map<string, string[]>();
  for (const a of albums) {
    const ids = byOwner.get(a.ownerId) ?? [];
    ids.push(a.id);
    byOwner.set(a.ownerId, ids);
  }
  const now = new Date();
  for (const { message, otherId } of notices) {
    const candidates = byOwner.get(message.senderId) ?? [];
    if (message.albumId == null && candidates.length > 1) continue;
    const albumId = message.albumId ?? candidates[0] ?? null;
    const granteeId = message.senderId === meId ? otherId : meId;
    const grant = byGrant.get(JSON.stringify([albumId, message.senderId, granteeId]));
    const active = grant && (grant.expiresAt == null || grant.expiresAt > now);
    states.set(message.id, active
      ? { kind: "album", albumId, expiresAt: grant.expiresAt?.toISOString() ?? null }
      : { kind: "album_expired", albumId });
  }
  return states;
}

socialRoutes.get("/conversations", async (c) => {
  const me = c.get("user");
  const convs = await db
    .select()
    .from(conversation)
    .where(or(eq(conversation.userA, me.id), eq(conversation.userB, me.id)))
    .orderBy(desc(conversation.lastMessageAt), desc(conversation.id))
    .limit(INBOX_LIMIT);
  if (!convs.length) return c.json([]);
  const otherIdFor = (cv: typeof conversation.$inferSelect) => cv.userA === me.id ? cv.userB : cv.userA;
  const others = convs.map(otherIdFor);
  const blockedRows = await db
    .select()
    .from(block)
    .where(or(
      and(eq(block.blockerId, me.id), inArray(block.blockedId, others)),
      and(eq(block.blockedId, me.id), inArray(block.blockerId, others)),
    ));
  const blocked = new Set(blockedRows.map((r) => (r.blockerId === me.id ? r.blockedId : r.blockerId)));

  const visible = convs.filter((cv) => !blocked.has(otherIdFor(cv)));
  if (!visible.length) return c.json([]);
  const ids = visible.map((cv) => cv.id);
  // El índice por conversación y fecha permite buscar solo el último mensaje de cada chat.
  const lastMessage = db.select().from(directMessage)
    .where(eq(directMessage.conversationId, conversation.id))
    .orderBy(desc(directMessage.createdAt), desc(directMessage.id)).limit(1).as("last_message");
  const [authors, latest, unreadCounts] = await Promise.all([
    authorsFor(visible.map(otherIdFor)),
    db.select().from(conversation).innerJoinLateral(lastMessage, sql`true`).where(inArray(conversation.id, ids)),
    db.select({ id: directMessage.conversationId, unread: sql<number>`count(*)::int` }).from(directMessage)
      .where(and(inArray(directMessage.conversationId, ids), ne(directMessage.senderId, me.id), isNull(directMessage.readAt)))
      .groupBy(directMessage.conversationId),
  ]);
  const latestById = new Map(latest.map(({ last_message }) => [last_message.conversationId, last_message]));
  const states = await albumNoticeStates(me.id, visible.flatMap((cv) => {
    const message = latestById.get(cv.id);
    return message ? [{ message, otherId: otherIdFor(cv) }] : [];
  }));
  const unreadById = new Map(unreadCounts.map((r) => [r.id, r.unread]));
  return c.json(visible.flatMap((cv) => {
    const last = latestById.get(cv.id);
    return last ? [{
      id: cv.id, lastMessageAt: cv.lastMessageAt.toISOString(),
      other: authors.get(otherIdFor(cv)), last: { ...serializeDm(last), ...states.get(last.id) }, unread: unreadById.get(cv.id) ?? 0,
    }] : [];
  }));
});

/** Abre (o crea) la conversación con alguien. */
socialRoutes.post("/conversations", async (c) => {
  const me = c.get("user");
  const { userId } = z.object({ userId: z.string() }).parse(await c.req.json());
  if (userId === me.id) throw new HTTPException(400, { message: "No podés escribirte a vos" });
  if (await isBlocked(me.id, userId)) throw new HTTPException(404, { message: "Perfil no disponible" });
  const [p] = await db.select().from(profile).where(eq(profile.userId, userId));
  if (!p) throw new HTTPException(404, { message: "Perfil no disponible" });
  const key = pair(me.id, userId);
  // Solo cuenta para el límite si es una charla nueva (abrir una que ya existe no suma)
  const [existing] = await db.select({ id: conversation.id }).from(conversation)
    .where(and(eq(conversation.userA, key.userA), eq(conversation.userB, key.userB)));
  if (existing) return c.json({ id: existing.id });
  await limit(me.id, "newChat");
  await db.insert(conversation).values({ id: newId(), ...key }).onConflictDoNothing();
  const [conv] = await db
    .select()
    .from(conversation)
    .where(and(eq(conversation.userA, key.userA), eq(conversation.userB, key.userB)));
  return c.json({ id: conv.id });
});

socialRoutes.get("/conversations/:id", async (c) => {
  const me = c.get("user");
  const { conv, otherId } = await myConversation(c.req.param("id"), me.id);
  if (await isBlocked(me.id, otherId)) return c.notFound();
  const authors = await authorsFor([otherId]);
  return c.json({ id: conv.id, other: authors.get(otherId) });
});

socialRoutes.get("/conversations/:id/summary", async (c) => {
  const me = c.get("user");
  const { conv, otherId } = await myConversation(c.req.param("id"), me.id);
  if (await isBlocked(me.id, otherId)) return c.notFound();

  const unread = alias(directMessage, "unread");
  const unreadCount = db.select({ count: sql<number>`count(*)::int` }).from(unread)
    .where(and(eq(unread.conversationId, conv.id), eq(unread.senderId, otherId), isNull(unread.readAt)));
  const [last] = await db.select({
    message: directMessage,
    unread: sql<number>`(${unreadCount})`.as("unread_count"),
  }).from(directMessage)
    .where(eq(directMessage.conversationId, conv.id))
    .orderBy(desc(directMessage.createdAt), desc(directMessage.id))
    .limit(1);
  if (!last) return c.json(null);
  const [states, authors] = await Promise.all([
    albumNoticeStates(me.id, [{ message: last.message, otherId }]),
    authorsFor([otherId]),
  ]);
  return c.json({
    id: conv.id, lastMessageAt: new Date(Math.max(conv.lastMessageAt.getTime(), last.message.createdAt.getTime())).toISOString(),
    other: authors.get(otherId), last: { ...serializeDm(last.message), ...states.get(last.message.id) }, unread: last.unread,
  });
});

socialRoutes.get("/conversations/:id/messages", async (c) => {
  const me = c.get("user");
  const { conv, otherId } = await myConversation(c.req.param("id"), me.id);
  if (await isBlocked(me.id, otherId)) return c.notFound();
  const before = c.req.query("before");
  const conds = [eq(directMessage.conversationId, conv.id)];
  if (before) conds.push(lt(directMessage.createdAt, new Date(before)));
  const rows = await db
    .select()
    .from(directMessage)
    .where(and(...conds))
    .orderBy(desc(directMessage.createdAt), desc(directMessage.id))
    .limit(50);
  const [reactions, states] = await Promise.all([
    reactionsFor(rows.map((m) => m.id)),
    albumNoticeStates(me.id, rows.map((message) => ({ message, otherId }))),
  ]);
  const messages = (await serializeDms(rows.reverse(), reactions)).map((m) => ({ ...m, ...states.get(m.id) }));
  return c.json({ messages, hasMore: rows.length === 50 });
});

socialRoutes.post("/conversations/:id/messages", async (c) => {
  const me = c.get("user");
  const { conv, otherId } = await myConversation(c.req.param("id"), me.id);
  if (await isBlocked(me.id, otherId)) throw new HTTPException(404, { message: "Perfil no disponible" });

  let body: string | null = null;
  let photoKey: string | null = null;
  let expiring = false;
  let replyToId: string | null = null;
  if ((c.req.header("content-type") ?? "").includes("multipart/form-data")) {
    await limit(me.id, "dmPhoto");
    const form = await c.req.parseBody();
    expiring = form.expiring === "1";
    const file = form.file;
    if (!(file instanceof File)) throw new HTTPException(400, { message: "Falta la foto" });
    if (file.size > MAX_UPLOAD_BYTES) throw new HTTPException(413, { message: "La foto pesa demasiado (máx. 12 MB)" });
    replyToId = await replyToIdFor(typeof form.replyToId === "string" ? form.replyToId.trim() : undefined, conv.id);
    try {
      photoKey = await saveImage(await file.arrayBuffer());
    } catch {
      throw new HTTPException(400, { message: "No pudimos leer esa imagen" });
    }
  } else {
    await limit(me.id, "dm");
    const r = z.object({
      body: z.string().trim().min(1).max(2000),
      replyToId: z.string().trim().min(1).max(64).optional(),
    }).safeParse(await c.req.json());
    if (!r.success) throw new HTTPException(400, { message: "Mensaje vacío o demasiado largo" });
    body = r.data.body;
    replyToId = await replyToIdFor(r.data.replyToId, conv.id);
  }

  const now = new Date();
  const [row] = await db
    .insert(directMessage)
    .values({ id: newId(), conversationId: conv.id, senderId: me.id, kind: photoKey ? "photo" : "text", body, photoKey, expiring, replyToId, createdAt: now })
    .returning();
  await db.update(conversation)
    .set({ lastMessageAt: sql`greatest(${conversation.lastMessageAt}, ${now.toISOString()})` })
    .where(eq(conversation.id, conv.id));
  const [msg] = await serializeDms([row]);
  emitToUser(me.id, DM_EVENTS.message, msg);
  emitToUser(otherId, DM_EVENTS.message, msg);
  // Notificación discreta (sin nombre ni contenido). Se manda siempre: si la app está abierta y a la vista,
  // el service worker no la muestra. Antes se salteaba si "estaba en línea", y en el celu con la app
  // minimizada la conexión queda abierta un rato y el aviso nunca llegaba.
  pushTo(otherId, { title: "Te llegó un mensaje", body: "Abrí el chat para leerlo.", url: `/mensajes/${conv.id}`, tag: `dm-${conv.id}`, kind: "mensajes" }).catch(() => {});
  return c.json(msg);
});

/**
 * Abrir una foto temporal. Solo quien la recibe, una sola vez.
 * Después de unos segundos el archivo se borra del servidor.
 * (No se puede evitar una captura de pantalla: eso lo avisa la app.)
 */
socialRoutes.post("/conversations/:id/messages/:mid/open", async (c) => {
  const me = c.get("user");
  const { conv } = await myConversation(c.req.param("id"), me.id);
  const [row] = await db
    .update(directMessage)
    .set({ openedAt: new Date() })
    .where(and(
      eq(directMessage.id, c.req.param("mid")),
      eq(directMessage.conversationId, conv.id),
      eq(directMessage.expiring, true),
      ne(directMessage.senderId, me.id),
      isNull(directMessage.openedAt),
    ))
    .returning();
  if (!row?.photoKey) throw new HTTPException(410, { message: "Esta foto ya se vio" });
  const key = row.photoKey;
  setTimeout(async () => {
    await deleteImageUnlessEvidence(key);
    await db.update(directMessage).set({ photoKey: null }).where(eq(directMessage.id, row.id)).catch(() => {});
  }, EXPIRING_GRACE_MS);
  emitToUser(row.senderId, DM_EVENTS.opened, { conversationId: conv.id, id: row.id });
  return c.json({ photo: imageUrl(key), seconds: EXPIRING_SECONDS });
});

/** Desenviar: borra el mensaje para las dos personas. */
socialRoutes.delete("/conversations/:id/messages/:mid", async (c) => {
  const me = c.get("user");
  const { conv, otherId } = await myConversation(c.req.param("id"), me.id);
  const [existing] = await db
    .select()
    .from(directMessage)
    .where(and(eq(directMessage.id, c.req.param("mid")), eq(directMessage.conversationId, conv.id), eq(directMessage.senderId, me.id)));
  if (!existing) return c.notFound();
  // Los avisos de álbum muestran el estado de lo compartido: no se desenvían, se actualizan solos.
  if (existing.kind === "album" || existing.kind === "album_revoked" || existing.kind === "album_expired") {
    throw new HTTPException(400, { message: "Los avisos de álbum no se pueden desenviar" });
  }
  const [row] = await db
    .delete(directMessage)
    .where(eq(directMessage.id, existing.id))
    .returning();
  if (!row) return c.notFound();
  if (row.photoKey) await deleteImageUnlessEvidence(row.photoKey);
  await db.delete(schema.reaction).where(eq(schema.reaction.messageId, row.id));
  const payload = { conversationId: conv.id, id: row.id };
  emitToUser(me.id, DM_EVENTS.deleted, payload);
  emitToUser(otherId, DM_EVENTS.deleted, payload);
  return c.json({ ok: true });
});

socialRoutes.post("/conversations/:id/read", async (c) => {
  const me = c.get("user");
  const { conv, otherId } = await myConversation(c.req.param("id"), me.id);
  if (await isBlocked(me.id, otherId)) return c.notFound();
  const messageId = z.string().min(1).max(128);
  // Las pestañas abiertas antes del despliegue todavía mandan un POST sin cuerpo.
  const legacyRequest = (await c.req.text()).length === 0;
  const input = z.object({
    messageIds: z.array(messageId).max(READ_RECEIPT_LIMIT),
    beforeId: messageId.optional(),
  })
    .safeParse(legacyRequest ? { messageIds: [] } : await c.req.json().catch(() => null));
  if (!input.success) throw new HTTPException(400, { message: "Faltan los mensajes vistos" });
  const { messageIds, beforeId } = input.data;
  if (!legacyRequest && !messageIds.length && !beforeId) return c.json({ ok: true, changed: false });
  const oldest = alias(directMessage, "oldest_loaded");
  const boundary = beforeId
    ? db.select({ createdAt: oldest.createdAt, id: oldest.id }).from(oldest)
        .where(and(eq(oldest.id, beforeId), eq(oldest.conversationId, conv.id)))
    : undefined;
  const now = new Date();
  const unreadFromOther = and(eq(directMessage.conversationId, conv.id), eq(directMessage.senderId, otherId), isNull(directMessage.readAt));
  const receipt = await db.transaction(async (tx) => {
    const explicit = messageIds.length ? await tx.update(directMessage).set({ readAt: now })
      .where(and(unreadFromOther, inArray(directMessage.id, messageIds))).returning({ id: directMessage.id }) : [];
    let through: { createdAt: string; id: string } | undefined;
    if (legacyRequest || boundary) {
      const older = tx.$with("older").as(tx.update(directMessage).set({ readAt: now })
        .where(and(unreadFromOther, boundary && sql`(${directMessage.createdAt}, ${directMessage.id}) < (${boundary})`))
        .returning({ createdAt: directMessage.createdAt, id: directMessage.id }));
      const [last] = await tx.with(older).select().from(older).orderBy(desc(older.createdAt), desc(older.id)).limit(1);
      if (last) through = { createdAt: last.createdAt.toISOString(), id: last.id };
    }
    if (!explicit.length && !through) return null;
    return { audience: "sender", conversationId: conv.id, readAt: now.toISOString(), messageIds: explicit.map(({ id }) => id), through } satisfies DmReadReceipt;
  });
  const receiptId = receipt ? newId() : null;
  if (receipt && receiptId) {
    emitToUser(otherId, DM_EVENTS.read, receipt);
    emitToUser(me.id, DM_EVENTS.read, {
      audience: "reader", conversationId: conv.id, receiptId,
    } satisfies DmReadReceipt);
  }
  return c.json({ ok: true, changed: Boolean(receiptId), receiptId });
});

// ---------- Bloqueos ----------

socialRoutes.get("/blocks", async (c) => {
  const me = c.get("user");
  const rows = await db.select().from(block).where(eq(block.blockerId, me.id)).orderBy(desc(block.createdAt));
  const authors = await authorsFor(rows.map((r) => r.blockedId));
  return c.json(rows.map((r) => authors.get(r.blockedId) ?? { id: r.blockedId, name: "Cuenta borrada", age: 0, photo: null }));
});

socialRoutes.post("/blocks", async (c) => {
  const me = c.get("user");
  const { userId } = z.object({ userId: z.string() }).parse(await c.req.json());
  if (userId === me.id) throw new HTTPException(400, { message: "No podés bloquearte a vos" });
  const added = await db.transaction(async (tx) => {
    const [row] = await tx.insert(block).values({ blockerId: me.id, blockedId: userId })
      .onConflictDoNothing().returning({ id: block.blockedId });
    if (!row) return false;
    // Al bloquear se corta el acceso a los álbumes en las dos direcciones.
    await tx.delete(schema.albumGrant).where(or(
      and(eq(schema.albumGrant.ownerId, me.id), eq(schema.albumGrant.granteeId, userId)),
      and(eq(schema.albumGrant.ownerId, userId), eq(schema.albumGrant.granteeId, me.id)),
    ));
    return true;
  });
  if (added) {
    // Los avisos de álbum quedan como revocados: al desbloquear, el chat muestra el estado real.
    // Emitimos después del commit. Si el proceso se interrumpe, las consultas igual reflejan que el acceso terminó.
    await markAlbumNoticesRevoked(me.id, userId, null);
    await markAlbumNoticesRevoked(userId, me.id, null);
    for (const id of [me.id, userId]) emitToUser(id, DM_EVENTS.access, null);
  }
  return c.json({ ok: true });
});

socialRoutes.delete("/blocks/:userId", async (c) => {
  const me = c.get("user");
  const userId = c.req.param("userId");
  const [removed] = await db.delete(block).where(and(eq(block.blockerId, me.id), eq(block.blockedId, userId))).returning({ id: block.blockedId });
  if (!removed) return c.json({ ok: true });
  for (const id of [me.id, userId]) emitToUser(id, DM_EVENTS.access, null);
  return c.json({ ok: true });
});

// ---------- Reportes ----------

export { REPORT_REASONS } from "../moderation.js";

socialRoutes.post("/reports", async (c) => {
  const me = c.get("user");
  await limit(me.id, "report");
  const r = z
    .object({
      userId: z.string().optional(),
      groupId: z.string().optional(),
      reason: z.enum(REPORT_REASONS),
      details: z.string().trim().max(1000).optional(),
      messageId: z.string().optional(),
      messageKind: z.enum(["group", "dm"]).optional(),
    })
    .safeParse(await c.req.json());
  if (!r.success) throw new HTTPException(400, { message: "Elegí un motivo" });
  const { userId: maybeUser, groupId, ...rest } = r.data;

  // Reporte de un grupo: por su nombre, su descripción o lo que pasa adentro. Se guarda copia del nombre y la descripción.
  if (groupId) {
    const [g] = await db.select().from(schema.group).where(eq(schema.group.id, groupId));
    if (!g || g.removedAt) throw new HTTPException(404, { message: "Ese grupo no existe" });
    if (g.isGeneral) throw new HTTPException(400, { message: "El chat general no se reporta: reportá el mensaje o a la persona" });
    await db.insert(report).values({
      id: newId(), reporterId: me.id, targetUserId: null, groupId: g.id,
      reason: rest.reason, details: rest.details,
      targetName: g.name, messageBody: [g.name, g.description].filter(Boolean).join(" · "),
    });
    if (isUrgent(rest.reason)) notifyModeratorsUrgent(rest.reason).catch((e) => console.error("notifyModeratorsUrgent", e));
    return c.json({ ok: true });
  }
  if (!maybeUser) throw new HTTPException(400, { message: "Falta a quién reportás" });
  const userId = maybeUser;
  // Copia para moderación (ver report en schema.ts y docs/MODERACION.md)
  let messageBody: string | null = null;
  let evidenceKeys: string[] = [];
  if (rest.messageId) {
    // El mensaje adjunto tiene que ser de la persona reportada y de una charla o grupo donde está quien reporta
    let ok = false;
    if (rest.messageKind === "dm") {
      const [m] = await db.select().from(directMessage).where(eq(directMessage.id, rest.messageId));
      const [conv] = m ? await db.select().from(conversation).where(eq(conversation.id, m.conversationId)) : [];
      ok = Boolean(m && conv && m.senderId === userId && (conv.userA === me.id || conv.userB === me.id));
      if (ok) {
        messageBody = m.body;
        evidenceKeys = m.photoKey ? [m.photoKey] : [];
      }
    } else if (rest.messageKind === "group") {
      const [m] = await db.select().from(schema.groupMessage).where(eq(schema.groupMessage.id, rest.messageId));
      const [mem] = m
        ? await db.select().from(schema.groupMember)
            .where(and(eq(schema.groupMember.groupId, m.groupId), eq(schema.groupMember.userId, me.id)))
        : [];
      ok = Boolean(m && mem && m.userId === userId);
      if (ok) messageBody = m.body;
    }
    if (!ok) throw new HTTPException(400, { message: "Ese mensaje no corresponde a este reporte" });
  } else if (isUrgent(rest.reason)) {
    // Perfil reportado por algo urgente (por ejemplo, una foto de una persona menor): sus fotos públicas quedan como prueba
    const pics = await db.select({ key: photo.key }).from(photo).where(and(eq(photo.userId, userId), eq(photo.isPrivate, false)));
    evidenceKeys = pics.map((p) => p.key);
  }
  const [target] = await db.select({ name: profile.displayName }).from(profile).where(eq(profile.userId, userId));
  await db.insert(report).values({
    id: newId(), reporterId: me.id, targetUserId: userId, ...rest,
    targetName: target?.name ?? null, messageBody, evidenceKeys,
  });
  // Lo urgente (menores, contenido íntimo sin consentimiento, amenazas) le avisa a moderación al instante
  if (isUrgent(rest.reason)) notifyModeratorsUrgent(rest.reason).catch((e) => console.error("notifyModeratorsUrgent", e));
  // Si con este reporte ya son varias personas por lo mismo, moderación tiene un día para revisarlo (ver autoSuspend.ts)
  warnIfReachingAutoSuspend(userId, rest.reason, me.id).catch((e) => console.error("warnIfReachingAutoSuspend", e));
  return c.json({ ok: true });
});
