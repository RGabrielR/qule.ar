import type { HasPlace } from "./features/place/hasPlace";
import { createAuthClient } from "better-auth/react";
import { io, type Socket } from "socket.io-client";
import { SOCKET_RETRY_ERRORS } from "@mortero/shared/realtime";

export const authClient = createAuthClient({ baseURL: window.location.origin, basePath: "/api/auth" });

export class ApiError extends Error {
  constructor(public status: number, message: string, public retrySeconds = 0) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    ...rest,
    headers: json !== undefined ? { "content-type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Algo salió mal", Number(res.headers.get("Retry-After")) || 0);
  return data as T;
}

export const upload = <T,>(path: string, file: File, extra: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.append("file", file);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return api<T>(path, { method: "POST", body: fd });
};

let socket: Socket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
/** Espera antes de reintentar: crece de a poco (2 s, 4 s, 8 s…) hasta un minuto como mucho. */
const retryDelay = (n: number) => Math.min(60_000, 2_000 * 2 ** n) * (0.75 + Math.random() / 2);

export function getSocket(): Socket {
  if (socket) return socket;
  // Solo WebSocket: el API corre en varios procesos y así cada conexión queda entera en uno (ver apps/api/src/cluster.ts)
  const s = io({ path: "/socket.io", withCredentials: true, transports: ["websocket"] });
  // Si el servidor rechaza la conexión por un cupo pasajero (muchos intentos o muchas pestañas abiertas),
  // Socket.IO no reintenta solo: sin esto, la pestaña quedaría sin chat en vivo hasta recargar.
  let retries = 0;
  s.on("connect", () => { retries = 0; });
  s.on("connect_error", (err) => {
    if (s.active || !SOCKET_RETRY_ERRORS.includes(err.message)) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (socket === s && !s.connected) s.connect(); }, retryDelay(retries++));
  });
  socket = s;
  return s;
}
export function closeSocket() {
  clearTimeout(retryTimer);
  socket?.disconnect();
  socket = null;
}

// ---------- Tipos ----------

export type Author = { id: string; name: string; age: number; photo: string | null };

/** Un toque recibido. */
export type Toque = Author & { kind: string; at: string; unseen: boolean };

/** Evento en vivo cuando cambian las reacciones de un mensaje. */
export type ReactionEvent = { scope: "dm" | "group"; messageId: string; conversationId?: string; groupId?: string; reactions: { kind: string; by: string[] }[] };

/** Una foto o video del perfil o del álbum. `thumb` es la miniatura (en los videos, un fotograma). */
export type Media = { url: string; kind: "photo" | "video"; thumb: string | null; seconds: number | null };

/** Alguien con acceso a uno de mis álbumes (una fila por persona y álbum). expiresAt null = sin límite. */
export type AlbumGrant = Author & { expiresAt: string | null; albumId: string; albumName: string };

/** Uno de mis álbumes privados. El primero es el álbum por defecto. */
export type MyAlbum = { id: string; name: string };

/** Un álbum privado de otra persona que me compartieron (o mío, en mi propio perfil). */
export type SharedAlbum = { id: string; name: string; count: number; videos: number; items: Media[]; expiresAt: string | null };

export type SocialProof = { verified: true; verifiedAt?: string } | { code: string; expires: number; retryAt?: number } | null;

export type Profile = {
  xUsername: string | null;
  instagramUsername: string | null;
  xProof?: SocialProof;
  instagramProof?: SocialProof;
  displayName: string;
  birthdate: string;
  age: number;
  about: string | null;
  heightCm: number | null;
  weightKg: number | null;
  bodyType: string | null;
  position: string | null;
  tribes: string[];
  lookingFor: string[];
  relationship: string | null;
  pronouns: string | null;
  /** "si", "no" o null (sin decir). Ver features/place. */
  hasPlace: HasPlace | null;
  hivStatus: string | null;
  lastTested: string | null;
};

/** Tipos de aviso que se pueden apagar. Tienen que coincidir con NOTIFY_KINDS de la API (push.ts). */
export type NotifyKind = "mensajes" | "toques" | "respuestas" | "grupos" | "solicitudes" | "moderacion" | "moderacion_urgente";

export type StaffAccess = "owner" | "reports" | "sanctions" | "appeals";

/** Pedido de revisión de una suspensión, como lo ve la persona suspendida. */
export type Appeal = {
  status: "open" | "upheld" | "lifted";
  body: string;
  extra: string | null;
  response: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export type Me = {
  /** isAdmin: entra al panel de moderación. access: qué puede hacer ahí ("owner" es la administración general). */
  /** emailVerified: si confirmó el mail. listed: si aparece en Gente (las cuentas nuevas, recién al confirmarlo). */
  user: { id: string; email: string; name: string; isAdmin: boolean; access: StaffAccess[]; emailVerified: boolean; listed: boolean };
  profile: (Profile & {
    hasLocation: boolean;
    showDistance: boolean;
    incognito: boolean;
    /** Avisos que apagó (false). Lo que no está cuenta como prendido. */
    notifyPrefs: Partial<Record<NotifyKind, boolean>>;
    suspendedAt: string | null;
    suspendReason: string | null;
    /** Versión de los términos que aceptó (null: cuenta anterior a los términos) */
    termsVersion: string | null;
  }) | null;
  photos: (Media & { id: string; position: number; isPrivate: boolean; albumId: string | null })[];
  albums: MyAlbum[];
};

export type PublicProfile = Omit<Profile, "birthdate"> & {
  id: string;
  photos: string[];
  isMe: boolean;
  online: boolean;
  recent: boolean;
  distance: string | null;
  favorite: boolean;
  // count y videos suman todos sus álbumes; albums son solo los que te compartió (items junta su contenido, null si ninguno)
  privateAlbum: { count: number; videos: number; items: Media[] | null; expiresAt: string | null; albums: SharedAlbum[] } | null;
  iSharedAlbum: boolean;
  sharedUntil: string | null;
  // Qué álbumes míos le compartí y hasta cuándo (expiresAt null = sin límite)
  myShares: { albumId: string; expiresAt: string | null }[];
  // El último toque que le mandé, si fue hace menos de 12 horas
  myToque: { kind: string; at: string } | null;
};

export type NearbyPerson = {
  id: string;
  name: string;
  age: number;
  photo: string | null;
  coverPhoto: string | null;
  online: boolean;
  recent: boolean;
  distance: string | null;
  favorite: boolean;
};

export type GroupMessage = {
  id: string;
  groupId: string;
  body: string | null;
  status: "queued" | "published" | "cancelled" | "deleted";
  scheduledAt: string;
  // En los grupos solo se muestra nombre y foto, sin la edad
  author: Pick<Author, "id" | "name" | "photo">;
  replyTo: { id: string; authorName: string; body: string | null } | null;
  reactions: { kind: string; by: string[] }[];
  /** Si los links se pueden tocar: la cuenta que lo mandó tenía más de 24 h (ver canOpenLinks en el API). */
  canOpenLinks?: boolean;
};

export type Dm = {
  id: string;
  conversationId: string;
  senderId: string;
  kind: "text" | "photo" | "album" | "album_revoked" | "album_expired";
  albumId?: string | null;
  // Solo en avisos de álbum activos: hasta cuándo vale el acceso (ISO) o null si es sin límite.
  expiresAt?: string | null;
  body: string | null;
  canOpenLinks?: boolean;
  photo: string | null;
  expiring: boolean;
  opened: boolean;
  readAt: string | null;
  createdAt: string;
  replyTo: { id: string; authorName: string | null; body: string | null } | null;
  reactions: { kind: string; by: string[] }[];
};

export type Role = "owner" | "moderator" | "member";

export type SpamRules = {
  intervalSeconds: number;
  burst: number;
  rotationWindow: number;
  rotationMax: number;
  newAccountHours: number;
  maxQueued: number;
};

export type MyGroup = {
  id: string;
  name: string;
  description: string | null;
  isGeneral: boolean;
  /** Foto del grupo (miniatura). null: sin foto. */
  photo: string | null;
  role: Role;
  memberCount: number;
  pendingCount: number;
};

export type GroupListing = {
  id: string;
  name: string;
  description: string | null;
  photo: string | null;
  memberCount: number;
  role: Role | null;
  pending: boolean;
  cooldownUntil: string | null;
};

export type GroupInfo = GroupListing & {
  isGeneral: boolean;
  pendingMessage: string | null;
  muted: boolean;
  rules: SpamRules;
  pendingCount: number;
};

export type JoinRequest = { id: string; message: string | null; createdAt: string; newAccount: boolean; user: Author };
/** Una página de solicitudes: `total` (con los filtros puestos) viene solo en la primera. */
export type JoinRequestPage = { items: JoinRequest[]; nextCursor: string | null; total: number | null };
export type Member = Author & { role: Role; joinedAt: string };
export type MemberPage = { members: Member[]; nextOffset: number | null };

/** Dónde está una persona respecto de un grupo, para invitarla. */
export type InviteState = "member" | "invited" | "requested" | "declined" | null;
/** Alguien para invitar a un grupo, de la lista larga (como la grilla de Gente). */
export type InviteCandidate = Author & { online: boolean; distance: string | null; state: InviteState };
export type InviteCandidates = { people: InviteCandidate[]; total: number; hasMore: boolean; hasLocation: boolean };
export type InvitableGroup = { id: string; name: string; photo: string | null; state: InviteState };
/** Invitación pendiente de un grupo (la ven dueño y moderadores). */
export type SentInvite = { id: string; createdAt: string; user: Author };
/** Invitación que me mandaron. */
export type MyInvite = {
  id: string;
  createdAt: string;
  group: { id: string; name: string; description: string | null; photo: string | null; memberCount: number };
  invitedBy: Author | null;
};

export const ROLE_LABEL: Record<Role, string> = { owner: "Dueño", moderator: "Moderador", member: "Miembro" };

export type ChatContact = Author & { presence?: "online" | "recent" };
export type ConversationSummary = { id: string; lastMessageAt: string; other: ChatContact; last: Dm; unread: number };

export type Viewer = Author & { viewedAt: string };
