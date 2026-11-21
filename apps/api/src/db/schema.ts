import {
  pgTable, text, timestamp, boolean, integer, date, jsonb, uniqueIndex, index, primaryKey, doublePrecision,
} from "drizzle-orm/pg-core";

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
});

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
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Perfil ----------

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
  genderIdentity: text("gender_identity"),
  genderOther: text("gender_other"),
  sexualOrientation: text("sexual_orientation"),
  orientationOther: text("orientation_other"),
  isTrans: boolean("is_trans"),
  lgbtqMember: boolean("lgbtq_member"),
  showGender: boolean("show_gender").notNull().default(false),
  showOrientation: boolean("show_orientation").notNull().default(false),
  showTrans: boolean("show_trans").notNull().default(false),
  showLgbtq: boolean("show_lgbtq").notNull().default(false),
  hivStatus: text("hiv_status"),
  lastTested: date("last_tested"),
  // Ubicación: SOLO se guarda el centro de una celda de ~500 m, nunca la posición exacta
  cellLat: doublePrecision("cell_lat"),
  cellLng: doublePrecision("cell_lng"),
  locationUpdatedAt: timestamp("location_updated_at", { withTimezone: true }),
  showDistance: boolean("show_distance").notNull().default(true),
  // Incógnito: no aparecés en la grilla, no se ve si estás en línea y tus visitas no quedan registradas
  incognito: boolean("incognito").notNull().default(false),
  // Moderación: una cuenta suspendida no puede usar la app y no aparece en ningún lado
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspendReason: text("suspend_reason"),
  // Términos y privacidad: qué versión aceptó y cuándo (prueba del consentimiento, Ley 25.326)
  termsVersion: text("terms_version"),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("profile_cell_idx").on(t.cellLat, t.cellLng)]);

export const photo = pgTable("photo", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  position: integer("position").notNull().default(0),
  isPrivate: boolean("is_private").notNull().default(false),
  // "photo" o "video". Los videos solo pueden estar en el álbum privado.
  kind: text("kind").notNull().default("photo"),
  // Miniatura del video (una foto .webp sacada del primer segundo)
  posterKey: text("poster_key"),
  seconds: integer("seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("photo_user_idx").on(t.userId, t.position)]);

/** A quién le compartiste tu álbum privado. Se puede revocar en cualquier momento. */
export const albumGrant = pgTable("album_grant", {
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  granteeId: text("grantee_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  // Hasta cuándo lo puede ver. null = sin límite.
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.granteeId] })]);

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
}, (t) => [primaryKey({ columns: [t.userId, t.favoriteId] })]);

// ---------- Seguridad ----------

export const block = pgTable("block", {
  blockerId: text("blocker_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  blockedId: text("blocked_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] })]);

export const report = pgTable("report", {
  id: text("id").primaryKey(),
  reporterId: text("reporter_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  targetUserId: text("target_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  messageId: text("message_id"),
  messageKind: text("message_kind"), // "group" | "dm"
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
  spamRules: jsonb("spam_rules").$type<SpamRules>().notNull().default(DEFAULT_SPAM_RULES),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const groupMember = pgTable("group_member", {
  groupId: text("group_id").notNull().references(() => group.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"), // owner | moderator | member
  // Silenciado: no llegan avisos de mensajes nuevos (las respuestas a tus mensajes sí)
  muted: boolean("muted").notNull().default(false),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.groupId, t.userId] })]);

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
  index("gjr_group_status_idx").on(t.groupId, t.status),
  index("gjr_user_idx").on(t.userId, t.groupId),
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
]);

// ---------- Mensajes privados ----------

export const conversation = pgTable("conversation", {
  id: text("id").primaryKey(),
  userA: text("user_a").notNull().references(() => user.id, { onDelete: "cascade" }), // siempre userA < userB
  userB: text("user_b").notNull().references(() => user.id, { onDelete: "cascade" }),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("conv_pair_idx").on(t.userA, t.userB)]);

export const directMessage = pgTable("direct_message", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversation.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("text"), // text | photo | album
  body: text("body"),
  photoKey: text("photo_key"),
  // Foto temporal: se ve una sola vez y después se borra del servidor
  expiring: boolean("expiring").notNull().default(false),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("dm_conv_idx").on(t.conversationId, t.createdAt)]);

// ---------- Toques y reacciones ----------

/** Las reacciones que existen (los íconos están en apps/web/public/reacciones). */
export const REACTIONS = ["hola", "fuego", "rayo", "lengua", "chispa", "ojitos", "ganas", "gotas"] as const;

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
}, (t) => [primaryKey({ columns: [t.messageId, t.userId] }), index("reaction_msg_idx").on(t.messageId)]);
