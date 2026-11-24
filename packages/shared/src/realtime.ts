export const DM_EVENTS = {
  message: "dm:message",
  read: "dm:read",
  deleted: "dm:deleted",
  opened: "dm:opened",
  typing: "dm:typing",
  access: "dm:access",
} as const;

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
