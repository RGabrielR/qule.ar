import type { SuspensionDuration } from "@mortero/shared/suspension";
import { sql, type SQLWrapper } from "drizzle-orm";
import { profile } from "./db/schema.js";

type Suspension = Pick<typeof profile.$inferSelect, "suspendedAt" | "suspendedUntil">;

export function isSuspended(value: Partial<Suspension> | null | undefined, now = Date.now()) {
  return Boolean(value?.suspendedAt && (value.suspendedUntil == null || value.suspendedUntil.getTime() > now));
}

export function activeSuspension(at: SQLWrapper = profile.suspendedAt, until: SQLWrapper = profile.suspendedUntil) {
  return sql`(${at} is not null and (${until} is null or ${until} > statement_timestamp()))`;
}

export function suspensionEnd(start: Date, duration: SuspensionDuration): Date {
  const { unit, amount } = duration;
  if (unit !== "months") return new Date(start.getTime() + amount * (unit === "days" ? 24 : 1) * 3_600_000);
  // Un mes calendario conserva la hora UTC y usa el último día si el mes de destino es más corto.
  const end = new Date(start);
  end.setUTCMonth(start.getUTCMonth() + amount + 1, 0);
  end.setUTCDate(Math.min(start.getUTCDate(), end.getUTCDate()));
  return end;
}
