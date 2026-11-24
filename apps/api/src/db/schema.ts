import {
  pgTable, text, timestamp, boolean, integer, date, jsonb, uniqueIndex, index, primaryKey, doublePrecision,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { encryptedMessageText, encryptedText } from "../crypt.js";

// ---------- Better Auth (no cambiar nombres de campos) ----------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (t) => [index("session_user_idx").on(t.userId)]);

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("account_user_idx").on(t.userId)]);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Perfil ----------

/** Valores posibles de profile.hasPlace. Sin dato (null) es "sin decir". */
export const HAS_PLACE = ["si", "no"] as const;

export const profile = pgTable("profile", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  birthdate: date("birthdate").notNull(),
  about: text("about"),
  heightCm: integer("height_cm"),
  weightKg: integer("weight_kg"),
  bodyType: text("body_type"),
  position: text("position"),
  tribes: jsonb("tribes").$type<string[]>().notNull().default([]),
  lookingFor: jsonb("looking_for").$type<string[]>().notNull().default([]),
  relationship: text("relationship"),
  pronouns: text("pronouns"),
  // Si tiene lugar para recibir: "si", "no" o null (sin decir). Opcional, lo elige cada persona; nunca se deduce de otra cosa.
  hasPlace: text("has_place"),
  // Datos de salud (sensibles, Ley 25.326 art. 2 y 7): se guardan cifrados con DATA_KEY. Ver src/crypt.ts
  hivStatus: encryptedText("hiv_status"),
  lastTested: encryptedText("last_tested"),
  // Ubicación: SOLO se guarda el centro de una celda de ~500 m, nunca la posición exacta
  cellLat: doublePrecision("cell_lat"),
  cellLng: doublePrecision("cell_lng"),
  locationUpdatedAt: timestamp("location_updated_at", { withTimezone: true }),
  showDistance: boolean("show_distance").notNull().default(true),
  // Incógnito: no aparecés en la grilla, no se ve si estás en línea y tus visitas no quedan registradas
  incognito: boolean("incognito").notNull().default(false),
  // Qué avisos quiere recibir. Lo que no está guardado cuenta como "sí" (ver NOTIFY_KINDS en push.ts).
  notifyPrefs: jsonb("notify_prefs").$type<Partial<Record<string, boolean>>>().notNull().default({}),
  // Moderación: una cuenta suspendida no puede usar la app y no aparece en ningún lado
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspendReason: text("suspend_reason"),
  // Quién suspendió (para que la apelación la revise, si se puede, otra persona). null en las suspensiones viejas.
  suspendedBy: text("suspended_by"),
  // Términos y privacidad: qué versión aceptó y cuándo (prueba del consentimiento, Ley 25.326)
  termsVersion: text("terms_version"),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("profile_cell_idx").on(t.cellLat, t.cellLng),
  // La grilla de Cerca: solo quienes se muestran, de la última vez vista hacia atrás (ver routes/nearby.ts)
  index("profile_grid_idx").on(t.lastSeenAt.desc()).where(sql`${t.incognito} = false and ${t.suspendedAt} is null`),
]);

/**
 * Álbumes privados de cada persona (por ejemplo, uno para cuando es activo y otro para cuando es pasivo).
 * Cada uno se comparte por separado. El primero (position 0) es el álbum por defecto: ahí van las fotos y
 * videos que se suben sin elegir álbum y, con la migración 0019, todo lo que ya estaba en el álbum único.
 */
export const album = pgTable("album", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("album_user_idx").on(t.userId, t.position)]);

export const photo = pgTable("photo", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  position: integer("position").notNull().default(0),
  isPrivate: boolean("is_private").notNull().default(false),
  // En qué álbum privado está. Solo tiene valor si isPrivate; al borrar el álbum se borran sus archivos (ver premium.ts).
  albumId: text("album_id").references(() => album.id),
  // "photo" o "video". Los videos solo pueden estar en el álbum privado.
  kind: text("kind").notNull().default("photo"),
  // Miniatura del video (una foto .webp sacada del primer segundo)
  posterKey: text("poster_key"),
  seconds: integer("seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("photo_user_idx").on(t.userId, t.position),
  // /files/:key busca la foto por archivo en cada imagen que se muestra
  index("photo_key_idx").on(t.key),
  index("photo_poster_key_idx").on(t.posterKey),
]);

/** A quién le compartiste cada álbum privado. Se puede revocar en cualquier momento. */
export const albumGrant = pgTable("album_grant", {
  albumId: text("album_id").notNull().references(() => album.id, { onDelete: "cascade" }),
  // Dueño del álbum, repetido para revocar todo de una (bloqueos, "quitar todos los accesos")
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  granteeId: text("grantee_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  // Hasta cuándo lo puede ver. null = sin límite.
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.albumId, t.granteeId] }),
  index("album_grant_grantee_idx").on(t.granteeId),
  index("album_grant_owner_idx").on(t.ownerId, t.granteeId),
]);

/** Quién vio tu perfil (una fila por persona, con la última visita). */
export const profileView = pgTable("profile_view", {
  viewerId: text("viewer_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  viewedId: text("viewed_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.viewerId, t.viewedId] }), index("pv_viewed_idx").on(t.viewedId, t.viewedAt)]);

export const favorite = pgTable("favorite", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  favoriteId: text("favorite_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.favoriteId] }), index("favorite_favorite_idx").on(t.favoriteId)]);

// ---------- Seguridad ----------

export const block = pgTable("block", {
  blockerId: text("blocker_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  blockedId: text("blocked_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index("block_blocked_idx").on(t.blockedId)]);

export const report = pgTable("report", {
  id: text("id").primaryKey(),
  // Si se borra la cuenta de quien reportó o de quien fue reportado, el reporte queda (con la copia de abajo):
  // es la prueba que moderación tiene que poder preservar (ver docs/MODERACION.md).
  reporterId: text("reporter_id").references(() => user.id, { onDelete: "set null" }),
  targetUserId: text("target_user_id").references(() => user.id, { onDelete: "set null" }),
  messageId: text("message_id"),
  messageKind: text("message_kind"), // "group" | "dm"
  // Reporte de un grupo (por su nombre, su descripción o lo que pasa adentro). Si el grupo se purga, queda la copia.
  groupId: text("group_id").references(() => group.id, { onDelete: "set null" }),
  // Copia al momento del reporte: el nombre visible, el texto del mensaje y los archivos (la foto del mensaje
  // o, si se reporta un perfil por algo urgente, sus fotos públicas). Esos archivos no se borran mientras
  // el reporte esté abierto o haya terminado en una medida; si se descarta, se liberan.
  targetName: text("target_name"),
  // Cifrada (ver src/crypt.ts): no se puede comparar en la base, se compara después de leerla
  messageBody: encryptedMessageText("message_body"),
  evidenceKeys: jsonb("evidence_keys").$type<string[]>().notNull().default([]),
  reason: text("reason").notNull(),
  details: text("details"),
  status: text("status").notNull().default("open"), // open | dismissed | actioned
  resolvedBy: text("resolved_by").references(() => user.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolution: text("resolution"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("report_status_idx").on(t.status, t.createdAt)]);

/** Suscripciones de notificaciones push (una por navegador o dispositivo). */
export const pushSubscription = pgTable("push_subscription", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  // Dominio desde el que se activó (las suscripciones son por dominio). null = de antes de guardarlo.
  origin: text("origin"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("push_user_idx").on(t.userId)]);

// ---------- Grupos ----------

export type SpamRules = {
  intervalSeconds: number; // segundos por mensaje
  burst: number;           // mensajes seguidos permitidos
  rotationWindow: number;  // últimos N mensajes que se miran
  rotationMax: number;     // si tenés esta cantidad o más entre los últimos N, se duplica el cooldown
  newAccountHours: number; // horas en que una cuenta se considera nueva
  maxQueued: number;       // mensajes en cola por persona
};

export const DEFAULT_SPAM_RULES: SpamRules = {
  intervalSeconds: 60,
  burst: 2,
  rotationWindow: 20,
  rotationMax: 3,
  newAccountHours: 24,
  maxQueued: 3,
};

export const group = pgTable("group", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
  isGeneral: boolean("is_general").notNull().default(false),
  // Foto del grupo (la pone el dueño). El general no tiene: muestra el logo de la app.
  photoKey: text("photo_key"),
  spamRules: jsonb("spam_rules").$type<SpamRules>().notNull().default(DEFAULT_SPAM_RULES),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Dado de baja (por moderación, o por su dueño si tenía reportes): desaparece para todo el mundo pero queda
  // guardado 90 días como prueba (ver moderation.ts y docs/MODERACION.md). null = activo.
  removedAt: timestamp("removed_at", { withTimezone: true }),
  removedReason: text("removed_reason"),
});

export const groupMember = pgTable("group_member", {
  groupId: text("group_id").notNull().references(() => group.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"), // owner | moderator | member
  // Silenciado: no llegan avisos de mensajes nuevos (las respuestas a tus mensajes sí)
  muted: boolean("muted").notNull().default(false),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.groupId, t.userId] }), index("group_member_user_idx").on(t.userId)]);

/**
 * Solicitudes de ingreso. Nadie puede meter a otra persona en un grupo: se entra pidiendo o aceptando una invitación (group_invite).
 * status: pending | accepted | rejected | cancelled | removed (expulsión, sirve para el período de espera)
 */
export const groupJoinRequest = pgTable("group_join_request", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => group.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  message: text("message"),
  status: text("status").notNull().default("pending"),
  resolvedBy: text("resolved_by").references(() => user.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Lista paginada de solicitudes: pendientes de un grupo, de la más nueva a la más vieja
  index("gjr_group_status_created_idx").on(t.groupId, t.status, t.createdAt, t.id),
  index("gjr_user_idx").on(t.userId, t.groupId),
  index("gjr_resolved_by_idx").on(t.resolvedBy),
]);

/**
 * Invitaciones: dueño o moderadores invitan a alguien y esa persona elige si entra.
 * Nadie queda adentro de un grupo sin haberlo aceptado.
 * status: pending | accepted | declined | cancelled
 */
export const groupInvite = pgTable("group_invite", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => group.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pending"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("gi_group_status_idx").on(t.groupId, t.status),
  index("gi_user_status_idx").on(t.userId, t.status),
]);

export const groupMessage = pgTable("group_message", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => group.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  // Mensaje citado al responder (del mismo grupo)
  replyToId: text("reply_to_id"),
  status: text("status").notNull(), // queued | published | cancelled | deleted
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("gm_group_sched_idx").on(t.groupId, t.status, t.scheduledAt),
  index("gm_user_idx").on(t.groupId, t.userId, t.scheduledAt),
  // Al borrar una cuenta se borran sus mensajes: sin esto había que recorrer la tabla entera
  index("gm_author_idx").on(t.userId),
]);

// ---------- Mensajes privados ----------

export const conversation = pgTable("conversation", {
  id: text("id").primaryKey(),
  userA: text("user_a").notNull().references(() => user.id, { onDelete: "cascade" }), // siempre userA < userB
  userB: text("user_b").notNull().references(() => user.id, { onDelete: "cascade" }),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("conv_pair_idx").on(t.userA, t.userB), index("conv_user_b_idx").on(t.userB)]);

export const directMessage = pgTable("direct_message", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversation.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("text"), // text | photo | album | album_revoked | album_expired
  // Identificador histórico del álbum, incluso después de borrarlo. Null en avisos anteriores a la columna.
  albumId: text("album_id"),
  // Cifrado en la base con DATA_KEY (ver src/crypt.ts). No se puede buscar por texto en la base.
  body: encryptedMessageText("body"),
  // Mensaje citado al responder (de la misma conversación). Sin FK a propósito:
  // si se borra el original, la cita queda huérfana y se muestra "Mensaje borrado".
  replyToId: text("reply_to_id"),
  photoKey: text("photo_key"),
  // Foto temporal: se ve una sola vez y después se borra del servidor
  expiring: boolean("expiring").notNull().default(false),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("dm_conv_idx").on(t.conversationId, t.createdAt),
  // /files/:key busca si el archivo es foto de un mensaje privado
  index("dm_photo_key_idx").on(t.photoKey),
  // Al borrar una cuenta se borran sus mensajes: sin esto había que recorrer la tabla entera
  index("dm_sender_idx").on(t.senderId),
  // Un solo aviso por álbum en cada conversación: el aviso muestra el estado actual y se actualiza en su
  // lugar en vez de duplicarse. Parcial: los mensajes comunes y los avisos viejos sin álbum quedan afuera
  // (Postgres trata los NULL como distintos, así que esos nunca chocan).
  uniqueIndex("dm_notice_album_idx")
    .on(t.conversationId, t.senderId, t.albumId)
    .where(sql`${t.kind} in ('album', 'album_revoked', 'album_expired') and ${t.albumId} is not null`),
]);

// ---------- Toques y reacciones ----------

/** Las reacciones que existen (los íconos están en apps/web/public/reacciones). */
export const REACTIONS = ["hola", "fuego", "rayo", "lengua", "chispa", "ojitos", "ganas", "gotas"] as const;
/** A los mensajes también se les puede reaccionar con risa (no es un toque). */
export const MESSAGE_REACTIONS = [...REACTIONS, "risa"] as const;

/** Un toque: avisarle a alguien que te gusta, con una reacción. A diferencia de la estrella, la otra persona se entera. */
export const toque = pgTable("toque", {
  id: text("id").primaryKey(),
  fromId: text("from_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  toId: text("to_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  seenAt: timestamp("seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("toque_to_idx").on(t.toId, t.createdAt), index("toque_pair_idx").on(t.fromId, t.toId, t.createdAt)]);

/** Reacción a un mensaje (privado o de grupo). Una por persona por mensaje. */
export const reaction = pgTable("reaction", {
  messageId: text("message_id").notNull(),
  scope: text("scope").notNull(), // "dm" | "group"
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.messageId, t.userId] }), index("reaction_msg_idx").on(t.messageId), index("reaction_user_idx").on(t.userId)]);

// ---------- Moderación: permisos, apelaciones y registro ----------

/**
 * Permisos chicos del panel de moderación. Quien administra en general (ADMIN_USER_IDS / ADMIN_EMAILS en el
 * servidor) tiene todo; al resto se le dan de a uno desde el panel. Ver STAFF_PERMISSIONS en staff.ts.
 */
export const staffPermission = pgTable("staff_permission", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  permission: text("permission").notNull(), // reports | sanctions | appeals
  grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.permission] })]);

/**
 * Pedido de revisión de una suspensión, hecho desde la app por la persona suspendida. Uno por suspensión
 * (suspendedAt identifica cuál). Si la cuenta se borra, se borra con ella.
 */
export const appeal = pgTable("appeal", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }).notNull(),
  // Copia del motivo y de quién suspendió, por si la suspensión cambia o se levanta
  suspendReason: text("suspend_reason"),
  suspendedBy: text("suspended_by"),
  body: text("body").notNull(),
  // Una sola ampliación mientras está abierta
  extra: text("extra"),
  extraAt: timestamp("extra_at", { withTimezone: true }),
  status: text("status").notNull().default("open"), // open | upheld | lifted
  response: text("response"),
  reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("appeal_suspension_idx").on(t.userId, t.suspendedAt), index("appeal_status_idx").on(t.status, t.createdAt)]);

/** Registro de lo que hace moderación: quién, cuándo, sobre qué y por qué. Lo ve solo quien administra. */
export const modAction = pgTable("mod_action", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  // Cuenta, grupo o reporte sobre el que se actuó (sin FK: el registro queda aunque se borren)
  targetId: text("target_id"),
  details: text("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("mod_action_created_idx").on(t.createdAt)]);

/**
 * Mails mandados, para los topes (general por día y por dirección). No guarda la dirección: solo un hash.
 * Se borra lo de más de 2 días.
 */
export const mailLog = pgTable("mail_log", {
  id: text("id").primaryKey(),
  toHash: text("to_hash").notNull(),
  kind: text("kind").notNull(), // reset | account
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("mail_log_created_idx").on(t.createdAt), index("mail_log_to_idx").on(t.toHash, t.createdAt)]);
