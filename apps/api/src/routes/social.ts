import { and, asc, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import {
  ageFrom, authorsFor, imageUrl, isBlocked, mediaOut, newId, reactionsFor, type ReactionSummary, requireProfile, requireUser, type AppEnv,
} from "../lib.js";
import { emitToUser, isOnline } from "../realtime.js";
import { distanceLabel, visibleKm } from "../geo.js";
import { deleteImage, MAX_UPLOAD_BYTES, saveImage } from "../storage.js";
import { albumAccessUntil, recordView } from "./premium.js";
import { myRecentToque } from "./toques.js";
import { pushTo } from "../push.js";
import { APP_NAME } from "../brand.js";
import { EXPIRING_GRACE_MS, EXPIRING_SECONDS } from "../expiring.js";
import { deleteImageUnlessEvidence, isUrgent, notifyModeratorsUrgent, REPORT_REASONS } from "../moderation.js";
import { limit } from "../ratelimit.js";

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
  // undefined = no tiene acceso; null = sin límite; Date = hasta esa fecha
  const albumUntil = privatePhotos.length > 0 ? (id === me.id ? null : await albumAccessUntil(id, me.id)) : undefined;
  // Lista explícita de campos públicos: nunca la fecha de nacimiento ni la celda de ubicación
  const mine = c.get("profile")!;
  await recordView(me.id, mine.incognito, id);
  const km = id === me.id ? null : visibleKm(mine, p);
  // En incógnito no se muestra si estás en línea
  const on = !p.incognito && isOnline(id);
  const [fav] = await db.select().from(schema.favorite)
    .where(and(eq(schema.favorite.userId, me.id), eq(schema.favorite.favoriteId, id)));
  // Si yo le compartí mi álbum y hasta cuándo
  const myGrant = id === me.id ? undefined : await albumAccessUntil(me.id, id);
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
    hivStatus: p.hivStatus,
    lastTested: p.lastTested,
    photos: photos.map((x) => imageUrl(x.key)),
    isMe: id === me.id,
    online: on,
    recent: !p.incognito && (on || Date.now() - p.lastSeenAt.getTime() < 15 * 60_000),
    favorite: Boolean(fav),
    // Álbum privado: cuántas fotos y videos hay y, si te lo compartieron, el contenido y hasta cuándo lo ves
    privateAlbum: privatePhotos.length
      ? {
          count: privatePhotos.length,
          videos: privatePhotos.filter((x) => x.kind === "video").length,
          items: albumUntil !== undefined ? privatePhotos.map(mediaOut) : null,
          expiresAt: albumUntil ? albumUntil.toISOString() : null,
        }
      : null,
    iSharedAlbum: myGrant !== undefined,
    // El último toque que le mandé, si fue hace menos de 12 horas
    myToque: id === me.id ? null : await myRecentToque(me.id, id),
    sharedUntil: myGrant ? myGrant.toISOString() : null,
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

function serializeDm(m: typeof directMessage.$inferSelect, reactions: ReactionSummary[] = []) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    kind: m.kind === "text" && m.photoKey ? "photo" : m.kind,
    body: m.body,
    // Las fotos temporales nunca viajan en la lista: se piden una sola vez con /open
    photo: m.expiring ? null : imageUrl(m.photoKey),
    expiring: m.expiring,
    opened: Boolean(m.openedAt),
    readAt: m.readAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    reactions,
  };
}


socialRoutes.get("/conversations", async (c) => {
  const me = c.get("user");
  const convs = await db
    .select()
    .from(conversation)
    .where(or(eq(conversation.userA, me.id), eq(conversation.userB, me.id)))
    .orderBy(desc(conversation.lastMessageAt))
    .limit(100);
  if (!convs.length) return c.json([]);
  const others = convs.map((cv) => (cv.userA === me.id ? cv.userB : cv.userA));
  const authors = await authorsFor(others);
  const blockedRows = await db
    .select()
    .from(block)
    .where(or(
      and(eq(block.blockerId, me.id), inArray(block.blockedId, others)),
      and(eq(block.blockedId, me.id), inArray(block.blockerId, others)),
    ));
  const blocked = new Set(blockedRows.map((r) => (r.blockerId === me.id ? r.blockedId : r.blockerId)));

  const out = [];
  for (const cv of convs) {
    const otherId = cv.userA === me.id ? cv.userB : cv.userA;
    if (blocked.has(otherId)) continue;
    const [last] = await db
      .select()
      .from(directMessage)
      .where(eq(directMessage.conversationId, cv.id))
      .orderBy(desc(directMessage.createdAt))
      .limit(1);
    if (!last) continue;
    const [{ unread }] = await db
      .select({ unread: sql<number>`count(*)::int` })
      .from(directMessage)
      .where(and(eq(directMessage.conversationId, cv.id), ne(directMessage.senderId, me.id), isNull(directMessage.readAt)));
    out.push({ id: cv.id, other: authors.get(otherId), last: serializeDm(last), unread });
  }
  return c.json(out);
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
  limit(me.id, "newChat");
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
    .orderBy(desc(directMessage.createdAt))
    .limit(50);
  const reactions = await reactionsFor(rows.map((m) => m.id));
  return c.json({ messages: rows.reverse().map((m) => serializeDm(m, reactions.get(m.id))), hasMore: rows.length === 50 });
});

socialRoutes.post("/conversations/:id/messages", async (c) => {
  const me = c.get("user");
  const { conv, otherId } = await myConversation(c.req.param("id"), me.id);
  if (await isBlocked(me.id, otherId)) throw new HTTPException(404, { message: "Perfil no disponible" });

  let body: string | null = null;
  let photoKey: string | null = null;
  let expiring = false;
  if ((c.req.header("content-type") ?? "").includes("multipart/form-data")) {
    limit(me.id, "dmPhoto");
    const form = await c.req.parseBody();
    expiring = form.expiring === "1";
    const file = form.file;
    if (!(file instanceof File)) throw new HTTPException(400, { message: "Falta la foto" });
    if (file.size > MAX_UPLOAD_BYTES) throw new HTTPException(413, { message: "La foto pesa demasiado (máx. 12 MB)" });
    try {
      photoKey = await saveImage(await file.arrayBuffer());
    } catch {
      throw new HTTPException(400, { message: "No pudimos leer esa imagen" });
    }
  } else {
    limit(me.id, "dm");
    const r = z.object({ body: z.string().trim().min(1).max(2000) }).safeParse(await c.req.json());
    if (!r.success) throw new HTTPException(400, { message: "Mensaje vacío o demasiado largo" });
    body = r.data.body;
  }

  const now = new Date();
  const [row] = await db
    .insert(directMessage)
    .values({ id: newId(), conversationId: conv.id, senderId: me.id, kind: photoKey ? "photo" : "text", body, photoKey, expiring, createdAt: now })
    .returning();
  await db.update(conversation).set({ lastMessageAt: now }).where(eq(conversation.id, conv.id));
  const msg = serializeDm(row);
  emitToUser(me.id, "dm:message", msg);
  emitToUser(otherId, "dm:message", msg);
  // Notificación discreta (sin nombre ni contenido). Se manda siempre: si la app está abierta y a la vista,
  // el service worker no la muestra. Antes se salteaba si "estaba en línea", y en el celu con la app
  // minimizada la conexión queda abierta un rato y el aviso nunca llegaba.
  pushTo(otherId, { title: APP_NAME, body: "Tenés un mensaje nuevo", url: `/mensajes/${conv.id}`, tag: `dm-${conv.id}` }).catch(() => {});
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
  emitToUser(row.senderId, "dm:opened", { conversationId: conv.id, id: row.id });
  return c.json({ photo: imageUrl(key), seconds: EXPIRING_SECONDS });
});

/** Desenviar: borra el mensaje para las dos personas. */
socialRoutes.delete("/conversations/:id/messages/:mid", async (c) => {
  const me = c.get("user");
  const { conv, otherId } = await myConversation(c.req.param("id"), me.id);
  const [row] = await db
    .delete(directMessage)
    .where(and(eq(directMessage.id, c.req.param("mid")), eq(directMessage.conversationId, conv.id), eq(directMessage.senderId, me.id)))
    .returning();
  if (!row) return c.notFound();
  if (row.photoKey) await deleteImageUnlessEvidence(row.photoKey);
  await db.delete(schema.reaction).where(eq(schema.reaction.messageId, row.id));
  const payload = { conversationId: conv.id, id: row.id };
  emitToUser(me.id, "dm:deleted", payload);
  emitToUser(otherId, "dm:deleted", payload);
  return c.json({ ok: true });
});

socialRoutes.post("/conversations/:id/read", async (c) => {
  const me = c.get("user");
  const { conv, otherId } = await myConversation(c.req.param("id"), me.id);
  const now = new Date();
  const updated = await db
    .update(directMessage)
    .set({ readAt: now })
    .where(and(eq(directMessage.conversationId, conv.id), eq(directMessage.senderId, otherId), isNull(directMessage.readAt)))
    .returning({ id: directMessage.id });
  if (updated.length) emitToUser(otherId, "dm:read", { conversationId: conv.id, readAt: now.toISOString() });
  return c.json({ ok: true });
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
  await db.insert(block).values({ blockerId: me.id, blockedId: userId }).onConflictDoNothing();
  // Al bloquear se corta el acceso a los álbumes en las dos direcciones
  await db.delete(schema.albumGrant).where(or(
    and(eq(schema.albumGrant.ownerId, me.id), eq(schema.albumGrant.granteeId, userId)),
    and(eq(schema.albumGrant.ownerId, userId), eq(schema.albumGrant.granteeId, me.id)),
  ));
  return c.json({ ok: true });
});

socialRoutes.delete("/blocks/:userId", async (c) => {
  const me = c.get("user");
  await db.delete(block).where(and(eq(block.blockerId, me.id), eq(block.blockedId, c.req.param("userId"))));
  return c.json({ ok: true });
});

// ---------- Reportes ----------

export { REPORT_REASONS } from "../moderation.js";

socialRoutes.post("/reports", async (c) => {
  const me = c.get("user");
  limit(me.id, "report");
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
    if (isUrgent(rest.reason)) notifyModeratorsUrgent().catch((e) => console.error("notifyModeratorsUrgent", e));
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
  if (isUrgent(rest.reason)) notifyModeratorsUrgent().catch((e) => console.error("notifyModeratorsUrgent", e));
  return c.json({ ok: true });
});
