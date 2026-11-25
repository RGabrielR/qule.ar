import { DM_EVENTS, SOCKET_ERRORS } from "@mortero/shared/realtime";
import type { Server as HttpServer } from "node:http";
import { and, eq, inArray, lte } from "drizzle-orm";
import { createAdapter } from "@socket.io/cluster-adapter";
import { Server } from "socket.io";
import { auth } from "./auth.js";
import { db, schema } from "./db/index.js";
import { authorsFor, blockedWith, canOpenLinks, reactionsFor } from "./lib.js";
import { notifyGroupMessage } from "./groupNotify.js";
import { clustered, reserveSocket } from "./shared.js";
import { env } from "./env.js";
import { limit } from "./ratelimit.js";

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
  const origin = new URL(env.APP_URL).origin;
  io = new Server(server, {
    path: "/socket.io",
    maxHttpBufferSize: 8 * 1024,
    allowRequest: (req, done) => done(null, !req.headers.origin || req.headers.origin === origin),
    ...(clustered ? { adapter: createAdapter(), transports: ["websocket"] } : {}),
  });

  io.use(async (socket, next) => {
    const headers = new Headers();
    for (const [k, v] of Object.entries(socket.handshake.headers)) {
      if (typeof v === "string") headers.set(k, v);
    }
    const s = await auth.api.getSession({ headers });
    if (!s) return next(new Error(SOCKET_ERRORS.noSession));
    try {
      await limit(s.user.id, "socket");
    } catch {
      return next(new Error(SOCKET_ERRORS.tooManyAttempts));
    }
    const [p] = await db.select({ suspendedAt: schema.profile.suspendedAt }).from(schema.profile)
      .where(eq(schema.profile.userId, s.user.id));
    if (!p || p.suspendedAt) return next(new Error(SOCKET_ERRORS.noProfile));
    const release = await reserveSocket(s.user.id);
    if (!release) return next(new Error(SOCKET_ERRORS.tooManySockets));
    if (socket.conn.readyState !== "open") {
      release();
      return next(new Error(SOCKET_ERRORS.closed));
    }
    const onClose = () => {
      socket.conn.off("close", onClose);
      socket.off("disconnect", onClose);
      release();
    };
    socket.conn.once("close", onClose);
    socket.once("disconnect", onClose);
    socket.data.userId = s.user.id;
    next();
  });

  io.on("connection", async (socket) => {
    const userId: string = socket.data.userId;
    socket.join(userRoom(userId));
    touchLastSeen(userId);
    // "Escribiendo…": lo único que el socket acepta del cliente. Se verifica que sea parte de la charla.
    const convOther = new Map<string, string | null>();
    let lastTyping = 0;
    socket.on(DM_EVENTS.typing, async (p: unknown) => {
      const conversationId = typeof p === "object" && p && "conversationId" in p ? p.conversationId : "";
      if (typeof conversationId !== "string" || !conversationId || conversationId.length > 128 || Date.now() - lastTyping < 1000) return;
      lastTyping = Date.now();
      if (!convOther.has(conversationId)) {
        const [conv] = await db.select().from(schema.conversation).where(eq(schema.conversation.id, conversationId));
        const other = conv && (conv.userA === userId ? conv.userB : conv.userB === userId ? conv.userA : null);
        if (convOther.size >= 100) {
          const oldest = convOther.keys().next().value;
          if (oldest !== undefined) convOther.delete(oldest);
        }
        convOther.set(conversationId, other ?? null);
      }
      const other = convOther.get(conversationId);
      if (other) io?.to(userRoom(other)).emit(DM_EVENTS.typing, { conversationId });
    });
    socket.on("disconnect", () => {
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

/** Manda un evento a todo el grupo, sin mirar bloqueos (por ejemplo, para borrar mensajes que ya nadie debe ver). */
export function emitToGroupRoom(groupId: string, event: string, payload: unknown) {
  io?.to(groupRoom(groupId)).emit(event, payload);
}

/** Manda un evento a un grupo, salteando a quienes tienen un bloqueo con el autor. */
export async function emitToGroup(groupId: string, authorId: string, event: string, payload: unknown) {
  if (!io) return;
  const blocked = [...(await blockedWith(authorId))].map(userRoom);
  io.to(groupRoom(groupId)).except(blocked).emit(event, payload);
}

export async function serializeGroupMessages(rows: (typeof groupMessage.$inferSelect)[]) {
  // Mensajes citados (respuestas)
  const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((x): x is string => Boolean(x)))];
  const quoted = replyIds.length
    ? await db.select().from(groupMessage).where(inArray(groupMessage.id, replyIds))
    : [];
  const quotedById = new Map(quoted.map((q) => [q.id, q]));
  const authors = await authorsFor([...rows.map((r) => r.userId), ...quoted.map((q) => q.userId)]);
  const reactions = await reactionsFor(rows.filter((r) => r.status === "published").map((r) => r.id));
  // Cuándo se creó cada cuenta, para saber si sus links se pueden tocar (ver canOpenLinks en lib.ts)
  const senderIds = [...new Set(rows.map((r) => r.userId))];
  const created = senderIds.length
    ? new Map((await db.select({ id: schema.user.id, createdAt: schema.user.createdAt }).from(schema.user)
        .where(inArray(schema.user.id, senderIds))).map((u) => [u.id, u.createdAt]))
    : new Map<string, Date>();
  // En los grupos se muestra solo el nombre y la foto, sin la edad
  const author = (id: string) => {
    const a = authors.get(id);
    return a ? { id: a.id, name: a.name, photo: a.photo } : { id, name: "Cuenta borrada", photo: null };
  };
  return rows.map((r) => {
    const q = r.replyToId ? quotedById.get(r.replyToId) : undefined;
    return {
      id: r.id,
      groupId: r.groupId,
      body: r.status === "deleted" ? null : r.body,
      status: r.status,
      scheduledAt: r.scheduledAt.toISOString(),
      author: author(r.userId),
      reactions: reactions.get(r.id) ?? [],
      canOpenLinks: created.has(r.userId) && canOpenLinks(r.scheduledAt, created.get(r.userId)!),
      replyTo: q
        ? { id: q.id, authorName: author(q.userId).name, body: q.status === "published" ? q.body.slice(0, 160) : null }
        : null,
    };
  });
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
  for (const m of out) {
    await emitToGroup(m.groupId, m.author.id, "group:message", m);
  }
  for (const row of due) notifyGroupMessage(row).catch((e) => console.error("notifyGroupMessage", e));
}
