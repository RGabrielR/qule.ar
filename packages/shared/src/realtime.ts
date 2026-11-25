export const DM_EVENTS = {
  message: "dm:message",
  updated: "dm:updated",
  read: "dm:read",
  deleted: "dm:deleted",
  opened: "dm:opened",
  typing: "dm:typing",
  access: "dm:access",
} as const;

/**
 * Por qué el servidor rechaza una conexión en vivo. Los pasajeros (el cupo de intentos por minuto y el de
 * conexiones abiertas por cuenta) se reintentan solos desde la app; sin sesión o sin perfil, no tiene sentido.
 */
export const SOCKET_ERRORS = {
  noSession: "sin sesión",
  noProfile: "perfil no disponible",
  tooManyAttempts: "Demasiados intentos de conexión",
  tooManySockets: "No pudimos abrir más conexiones para esta cuenta",
  closed: "conexión cerrada",
} as const;

export const SOCKET_RETRY_ERRORS: readonly string[] = [SOCKET_ERRORS.tooManyAttempts, SOCKET_ERRORS.tooManySockets, SOCKET_ERRORS.closed];

export const INBOX_LIMIT = 100;
export const READ_RECEIPT_LIMIT = 100;

export type DmReadReceipt = {
  audience: "sender";
  conversationId: string;
  messageIds: string[];
  through?: { createdAt: string; id: string };
  readAt: string;
} | {
  audience: "reader";
  conversationId: string;
  receiptId: string;
};

export function compareDmOrder(
  a: { createdAt: string; id: string },
  b: { createdAt: string; id: string },
) {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
