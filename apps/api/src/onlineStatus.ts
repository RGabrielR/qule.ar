import type { OnlineStatus } from "@mortero/shared/onlineStatus";
import { isOnline } from "./shared.js";

/** El estado visible es una preferencia de la cuenta. Las conexiones siguen siendo necesarias para el chat. */
export function isPubliclyOnline({ userId, onlineStatus, incognito, suspendedAt }: {
  userId: string;
  onlineStatus: OnlineStatus;
  incognito?: boolean;
  suspendedAt?: Date | null;
}) {
  if (incognito || suspendedAt || onlineStatus === "never") return false;
  return onlineStatus === "always" || isOnline(userId);
}
