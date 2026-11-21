import { createAuthClient } from "better-auth/react";
import { io, type Socket } from "socket.io-client";

export const authClient = createAuthClient({ baseURL: window.location.origin, basePath: "/api/auth" });

export class ApiError extends Error {
  constructor(public status: number, message: string) {
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
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Algo salió mal");
  return data as T;
}

export const upload = <T,>(path: string, file: File, extra: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.append("file", file);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return api<T>(path, { method: "POST", body: fd });
};

let socket: Socket | null = null;
export function getSocket(): Socket {
  if (!socket) socket = io({ path: "/socket.io", withCredentials: true });
  return socket;
}
export function closeSocket() {
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

/** Alguien con acceso a mi álbum. expiresAt null = sin límite. */
export type AlbumGrant = Author & { expiresAt: string | null };

export type Profile = {
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
  genderIdentity: string | null;
  genderOther: string | null;
  sexualOrientation: string | null;
  orientationOther: string | null;
  isTrans: boolean | null;
  lgbtqMember: boolean | null;
  showGender: boolean;
  showOrientation: boolean;
  showTrans: boolean;
  showLgbtq: boolean;
  hivStatus: string | null;
  lastTested: string | null;
};

export type Me = {
  user: { id: string; email: string; name: string; isAdmin: boolean };
  profile: (Profile & {
    hasLocation: boolean;
    showDistance: boolean;
    incognito: boolean;
    suspendedAt: string | null;
    suspendReason: string | null;
    /** Versión de los términos que aceptó (null: cuenta anterior a los términos) */
    termsVersion: string | null;
  }) | null;
  photos: (Media & { id: string; position: number; isPrivate: boolean })[];
};

export type PublicProfile = Omit<Profile, "birthdate" | "showGender" | "showOrientation" | "showTrans" | "showLgbtq"> & {
  id: string;
  photos: string[];
  isMe: boolean;
  online: boolean;
  recent: boolean;
  distance: string | null;
  favorite: boolean;
  // items es null si no te lo compartieron; expiresAt es hasta cuándo lo podés ver (null = sin límite)
  privateAlbum: { count: number; videos: number; items: Media[] | null; expiresAt: string | null } | null;
  iSharedAlbum: boolean;
  sharedUntil: string | null;
  // El último toque que le mandé, si fue hace menos de 12 horas
  myToque: { kind: string; at: string } | null;
};

export type NearbyPerson = {
  id: string;
  name: string;
  age: number;
  photo: string | null;
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
};

export type Dm = {
  id: string;
  conversationId: string;
  senderId: string;
  kind: "text" | "photo" | "album";
  body: string | null;
  photo: string | null;
  expiring: boolean;
  opened: boolean;
  readAt: string | null;
  createdAt: string;
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
  role: Role;
  memberCount: number;
  pendingCount: number;
};

export type GroupListing = {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  role: Role | null;
  pending: boolean;
  cooldownUntil: string | null;
};

export type GroupInfo = GroupListing & {
  isGeneral: boolean;
  muted: boolean;
  rules: SpamRules;
  pendingCount: number;
};

export type JoinRequest = { id: string; message: string | null; createdAt: string; user: Author };
export type Member = Author & { role: Role; joinedAt: string };

/** Dónde está una persona respecto de un grupo, para invitarla. */
export type InviteState = "member" | "invited" | "requested" | "declined" | null;
/** Alguien para invitar a un grupo, de la lista larga (como la grilla de Gente). */
export type InviteCandidate = Author & { online: boolean; distance: string | null; state: InviteState };
export type InviteCandidates = { people: InviteCandidate[]; total: number; hasMore: boolean; hasLocation: boolean };
export type InvitableGroup = { id: string; name: string; state: InviteState };
/** Invitación pendiente de un grupo (la ven dueño y moderadores). */
export type SentInvite = { id: string; createdAt: string; user: Author };
/** Invitación que me mandaron. */
export type MyInvite = {
  id: string;
  createdAt: string;
  group: { id: string; name: string; description: string | null; memberCount: number };
  invitedBy: Author | null;
};

export const ROLE_LABEL: Record<Role, string> = { owner: "Dueño", moderator: "Moderador", member: "Miembro" };

export type ConversationSummary = { id: string; other: Author; last: Dm; unread: number };

export type Viewer = Author & { viewedAt: string };
