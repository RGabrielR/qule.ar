// Toques (avisarle a alguien que te gusta) y reacciones a mensajes.
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { REACTIONS } from "../db/schema.js";
import { authorsFor, blockedWith, isBlocked, newId, reactionsFor, requireProfile, requireUser, type AppEnv } from "../lib.js";
import { limit } from "../ratelimit.js";
import { emitToGroup, emitToUser } from "../realtime.js";
import { pushTo } from "../push.js";

const { toque, reaction, profile, directMessage, conversation, groupMessage, groupMember } = schema;

/** Cada cuánto se le puede mandar un toque a la misma persona. */
export const TOQUE_EVERY_MS = 12 * 3_600_000;
const TOQUES_DAYS = 30;

const kindInput = z.enum(REACTIONS);

export const toqueRoutes = new Hono<AppEnv>();
for (const p of ["/toques", "/toques/*", "/users/:id/toques", "/reactions/*"]) {
  toqueRoutes.use(p, requireUser, requireProfile);
}

/** El último toque que le mandé a alguien, si fue hace menos de 12 horas (para mostrar el botón ya usado). */
export async function myRecentToque(fromId: string, toId: string) {
  const [t] = await db.select().from(toque)
    .where(and(eq(toque.fromId, fromId), eq(toque.toId, toId), gt(toque.createdAt, new Date(Date.now() - TOQUE_EVERY_MS))))
    .orderBy(desc(toque.createdAt)).limit(1);
  return t ? { kind: t.kind, at: t.createdAt.toISOString() } : null;
}

toqueRoutes.post("/users/:id/toques", async (c) => {
  const me = c.get("user");
  const to = c.req.param("id");
  const r = z.object({ kind: kindInput }).safeParse(await c.req.json().catch(() => ({})));
  if (!r.success) throw new HTTPException(400, { message: "Reacción inválida" });
  if (to === me.id) throw new HTTPException(400, { message: "No te podés mandar un toque a vos" });
  if (await isBlocked(me.id, to)) throw new HTTPException(404, { message: "Perfil no disponible" });
  const [p] = await db.select({ suspendedAt: profile.suspendedAt }).from(profile).where(eq(profile.userId, to));
  if (!p || p.suspendedAt) throw new HTTPException(404, { message: "Perfil no disponible" });
  if (await myRecentToque(me.id, to)) throw new HTTPException(429, { message: "Ya le mandaste un toque hace poco" });
  await limit(me.id, "toque");

  const now = new Date();
  const id = newId();
  await db.insert(toque).values({ id, fromId: me.id, toId: to, kind: r.data.kind, createdAt: now });
  const [author] = (await authorsFor([me.id])).values();
  emitToUser(to, "toque", { id, kind: r.data.kind, from: author, createdAt: now.toISOString() });
  // Discreto, como los mensajes: no dice quién ni qué
  pushTo(to, { title: "Te mandaron un toque", body: "Abrí Toques para verlo.", url: "/toques", tag: "toques", kind: "toques" }).catch(() => {});
  return c.json({ kind: r.data.kind, at: now.toISOString() });
});

/** Los toques que recibí en los últimos 30 días, el más nuevo primero (uno por persona). */
toqueRoutes.get("/toques", async (c) => {
  const me = c.get("user");
  const since = new Date(Date.now() - TOQUES_DAYS * 86_400_000);
  const rows = await db.select().from(toque)
    .where(and(eq(toque.toId, me.id), gt(toque.createdAt, since)))
    .orderBy(desc(toque.createdAt)).limit(300);
  const blocked = await blockedWith(me.id);
  const seen = new Set<string>();
  const latest = rows.filter((r) => !blocked.has(r.fromId) && !seen.has(r.fromId) && seen.add(r.fromId));
  const authors = await authorsFor(latest.map((r) => r.fromId));
  return c.json(latest.flatMap((r) => {
    const a = authors.get(r.fromId);
    return a ? [{ ...a, kind: r.kind, at: r.createdAt.toISOString(), unseen: !r.seenAt }] : [];
  }));
});

toqueRoutes.get("/toques/unseen", async (c) => {
  const me = c.get("user");
  const since = new Date(Date.now() - TOQUES_DAYS * 86_400_000);
  const rows = await db.select({ fromId: toque.fromId }).from(toque)
    .where(and(eq(toque.toId, me.id), isNull(toque.seenAt), gt(toque.createdAt, since)));
  const blocked = await blockedWith(me.id);
  return c.json({ count: new Set(rows.map((r) => r.fromId).filter((id) => !blocked.has(id))).size });
});

toqueRoutes.post("/toques/seen", async (c) => {
  const me = c.get("user");
  await db.update(toque).set({ seenAt: new Date() }).where(and(eq(toque.toId, me.id), isNull(toque.seenAt)));
  return c.json({ ok: true });
});

// ---------- Reacciones a mensajes ----------

/**
 * Poner, cambiar o sacar mi reacción a un mensaje. kind = null la saca; si mandás la misma que ya tenías, también.
 * A quienes están en la charla les llega el resumen actualizado en vivo.
 */
toqueRoutes.put("/reactions/:scope{dm|group}/:messageId", async (c) => {
  const me = c.get("user");
  const scope = c.req.param("scope") as "dm" | "group";
  const messageId = c.req.param("messageId");
  const r = z.object({ kind: kindInput.nullable() }).safeParse(await c.req.json().catch(() => ({})));
  if (!r.success) throw new HTTPException(400, { message: "Reacción inválida" });

  // Que el mensaje exista y que yo esté en esa charla
  let deliver: (payload: unknown) => Promise<void>;
  let where: { conversationId?: string; groupId?: string };
  if (scope === "dm") {
    const [m] = await db.select().from(directMessage).where(eq(directMessage.id, messageId));
    const [conv] = m ? await db.select().from(conversation).where(eq(conversation.id, m.conversationId)) : [];
    if (!m || !conv || (conv.userA !== me.id && conv.userB !== me.id) || m.kind === "album") throw new HTTPException(404, { message: "Mensaje no encontrado" });
    const other = conv.userA === me.id ? conv.userB : conv.userA;
    if (await isBlocked(me.id, other)) throw new HTTPException(404, { message: "Mensaje no encontrado" });
    where = { conversationId: conv.id };
    deliver = async (p) => { emitToUser(me.id, "reaction", p); emitToUser(other, "reaction", p); };
  } else {
    const [m] = await db.select().from(groupMessage).where(eq(groupMessage.id, messageId));
    if (!m || m.status !== "published") throw new HTTPException(404, { message: "Mensaje no encontrado" });
    const [mem] = await db.select().from(groupMember).where(and(eq(groupMember.groupId, m.groupId), eq(groupMember.userId, me.id)));
    if (!mem) throw new HTTPException(403, { message: "No sos parte de este grupo" });
    where = { groupId: m.groupId };
    deliver = (p) => emitToGroup(m.groupId, me.id, "reaction", p);
  }

  const [current] = await db.select().from(reaction).where(and(eq(reaction.messageId, messageId), eq(reaction.userId, me.id)));
  const kind = r.data.kind;
  if (!kind || current?.kind === kind) {
    await db.delete(reaction).where(and(eq(reaction.messageId, messageId), eq(reaction.userId, me.id)));
  } else {
    await db.insert(reaction).values({ messageId, scope, userId: me.id, kind })
      .onConflictDoUpdate({ target: [reaction.messageId, reaction.userId], set: { kind, createdAt: new Date() } });
  }
  const reactions = (await reactionsFor([messageId])).get(messageId) ?? [];
  await deliver({ scope, messageId, ...where, reactions });
  return c.json({ reactions });
});
