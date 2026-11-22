import type { Server as HttpServer } from "node:http";
import { and, eq, inArray, lte } from "drizzle-orm";
import { createAdapter } from "@socket.io/cluster-adapter";
import { Server } from "socket.io";
import { auth } from "./auth.js";
import { db, schema } from "./db/index.js";
import { authorsFor, blockedWith, reactionsFor } from "./lib.js";
import { notifyGroupMessage } from "./groupNotify.js";
import { clustered, socketClosed, socketOpened } from "./shared.js";

const { groupMember, groupMessage } = schema;

let io: Server | null = null;

/** Quién tiene la app abierta ahora, en cualquier proceso del API (ver shared.ts). */
export { isOnline } from "./shared.js";

function touchLastSeen(userId: string) {
  db.update(schema.profile)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.profile.userId, userId))
    .catch(() => {});
}

export const userRoom = (id: string) => `user:${id}`;
export const groupRoom = (id: string) => `group:${id}`;

/**
 * El socket solo recibe: todo lo que se manda pasa por la API HTTP.
 * Con varios procesos, cada evento llega a los sockets de todos (adaptador de cluster) y la conexión es solo
 * por WebSocket: así cada conexión queda en un proceso, sin necesidad de "sesiones pegajosas".
 * `publishQueued`: este proceso publica los mensajes en cola (uno solo, el líder).
 */
export function attachRealtime(server: HttpServer, opts: { publishQueued: boolean }) {
  io = new Server(server, {
    path: "/socket.io",
    ...(clustered ? { adapter: createAdapter(), transports: ["websocket"] } : {}),
  });

  io.use(async (socket, next) => {
    const headers = new Headers();
    for (const [k, v] of Object.entries(socket.handshake.headers)) {
      if (typeof v === "string") headers.set(k, v);
    }
    const s = await auth.api.getSession({ headers });
    if (!s) return next(new Error("sin sesión"));
    const [p] = await db.select({ suspendedAt: schema.profile.suspendedAt }).from(schema.profile)
      .where(eq(schema.profile.userId, s.user.id));
    if (p?.suspendedAt) return next(new Error("cuenta suspendida"));
    socket.data.userId = s.user.id;
    next();
  });

  io.on("connection", async (socket) => {
    const userId: string = socket.data.userId;
    socket.join(userRoom(userId));
    socketOpened(userId);
    touchLastSeen(userId);
    // "Escribiendo…": lo único que el socket acepta del cliente. Se verifica que sea parte de la charla.
    const convOther = new Map<string, string | null>();
    let lastTyping = 0;
    socket.on("dm:typing", async (p: unknown) => {
      const conversationId = typeof p === "object" && p && "conversationId" in p ? String((p as { conversationId: unknown }).conversationId) : "";
      if (!conversationId || Date.now() - lastTyping < 1000) return;
      lastTyping = Date.now();
      if (!convOther.has(conversationId)) {
        const [conv] = await db.select().from(schema.conversation).where(eq(schema.conversation.id, conversationId));
        const other = conv && (conv.userA === userId ? conv.userB : conv.userB === userId ? conv.userA : null);
        convOther.set(conversationId, other ?? null);
      }
      const other = convOther.get(conversationId);
      if (other) io?.to(userRoom(other)).emit("dm:typing", { conversationId });
    });
    socket.on("disconnect", () => {
      socketClosed(userId);
      touchLastSeen(userId);
    });
    const groups = await db.select().from(groupMember).where(eq(groupMember.userId, userId));
    for (const g of groups) socket.join(groupRoom(g.groupId));
  });

  if (opts.publishQueued) setInterval(() => publishDue().catch((e) => console.error("publishDue", e)), 1000);
}

/** Hace que todos los sockets de un usuario entren a (o salgan de) la sala de un grupo. */
export function syncGroupRoom(userId: string, groupId: string, join: boolean) {
  if (!io) return;
  if (join) io.in(userRoom(userId)).socketsJoin(groupRoom(groupId));
  else io.in(userRoom(userId)).socketsLeave(groupRoom(groupId));
}

/** Corta todas las conexiones en vivo de alguien (por ejemplo, al suspenderlo). */
export function disconnectUser(userId: string) {
  io?.in(userRoom(userId)).disconnectSockets(true);
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(userRoom(userId)).emit(event, payload);
}

/** Manda un evento a un grupo, salteando a quienes tienen un bloqueo con el autor. */
export async function emitToGroup(groupId: string, authorId: string, event: string, payload: unknown) {
  if (!io) return;
  const blocked = [...(await blockedWith(authorId))].map(userRoom);
  io.to(groupRoom(groupId)).except(blocked).emit(event, payload);
}

export async function serializeGroupMessages(rows: (typeof groupMessage.$inferSelect)[], viewerId?: string) {
  // Mensajes citados (respuestas)
  const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((x): x is string => Boolean(x)))];
  const quoted = replyIds.length
    ? await db.select().from(groupMessage).where(inArray(groupMessage.id, replyIds))
    : [];
  const quotedById = new Map(quoted.map((q) => [q.id, q]));
  const authors = await authorsFor([...rows.map((r) => r.userId), ...quoted.map((q) => q.userId)]);
  const reactions = await reactionsFor("group", rows.filter((r) => r.status === "published").map((r) => r.id));
  // En los grupos se muestra solo el nombre y la foto, sin la edad
  const author = (id: string) => {
    const a = authors.get(id);
    return a ? { id: a.id, name: a.name, photo: a.photo } : { id, name: "Cuenta borrada", photo: null };
  };
  return rows.map((r) => {
    const q = r.replyToId ? quotedById.get(r.replyToId) : undefined;
    return {
      id: r.id,
      idempotencyKey: r.userId === viewerId ? r.idempotencyKey : undefined,
      groupId: r.groupId,
      body: r.status === "deleted" ? null : r.body,
      status: r.status,
      scheduledAt: r.scheduledAt.toISOString(),
      author: author(r.userId),
      reactions: reactions.get(r.id) ?? [],
      replyTo: q
        ? { id: q.id, authorName: author(q.userId).name, body: q.status === "published" ? q.body.slice(0, 160) : null }
        : null,
    };
  });
}

/** La clave de reintento solo vuelve a los dispositivos del remitente. */
export async function emitPublishedMessage(message: Awaited<ReturnType<typeof serializeGroupMessages>>[number], key: string | null) {
  if (!io) return;
  const authorId = message.author.id;
  const excluded = [...(await blockedWith(authorId)), authorId].map(userRoom);
  io.to(groupRoom(message.groupId)).except(excluded).emit("group:message", { ...message, idempotencyKey: undefined });
  emitToUser(authorId, "group:message", { ...message, idempotencyKey: key });
}

/** Publica los mensajes en cola a los que ya les tocó salir. */
async function publishDue() {
  const due = await db
    .update(groupMessage)
    .set({ status: "published" })
    .where(and(eq(groupMessage.status, "queued"), lte(groupMessage.scheduledAt, new Date())))
    .returning();
  if (!due.length) return;
  const out = await serializeGroupMessages(due);
  for (const [index, message] of out.entries()) {
    await emitPublishedMessage(message, due[index].idempotencyKey);
  }
  for (const row of due) notifyGroupMessage(row).catch((e) => console.error("notifyGroupMessage", e));
}
