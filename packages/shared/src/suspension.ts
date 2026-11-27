export const SUSPENSION_UNITS = ["hours", "days", "months"] as const;

export const MAX_SUSPENSION_AMOUNT = { hours: 87_600, days: 3_650, months: 120 };

export type SuspensionDuration = { unit: (typeof SUSPENSION_UNITS)[number]; amount: number };

export type SuspensionWindow = { suspendedAt: string; suspendedUntil: string | null };

/** Los plazos se informan en horas y, cuando hace falta, también en minutos. */
export function formatSuspensionHours(ms: number) {
  if (ms > 0 && ms < 60_000) return "menos de 1 minuto";
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [];
  if (hours) parts.push(hours === 1 ? "1 hora" : `${hours} horas`);
  if (rest || !hours) parts.push(rest === 1 ? "1 minuto" : `${rest} minutos`);
  return parts.join(" y ");
}
