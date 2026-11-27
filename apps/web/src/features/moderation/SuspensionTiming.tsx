import { formatSuspensionHours } from "@mortero/shared/suspension";
import { useEffect, useState } from "react";

export function SuspensionTiming({ suspendedAt, suspendedUntil, lifted = false, own = false }: {
  suspendedAt: string;
  suspendedUntil?: string | null;
  lifted?: boolean;
  own?: boolean;
}) {
  const end = suspendedUntil ? Date.parse(suspendedUntil) : null;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (end === null || lifted || Date.now() >= end) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= end) window.clearInterval(timer);
    }, Math.min(30_000, end - Date.now()));
    return () => window.clearInterval(timer);
  }, [end, lifted]);

  if (end === null) return lifted ? null : <>Sin vencimiento automático</>;
  const total = formatSuspensionHours(end - Date.parse(suspendedAt));
  if (lifted) return <>Duración prevista: {total} · La suspensión se levantó</>;
  if (now >= end) return <>Duración prevista: {total} · El plazo terminó</>;
  return <>
    Duración: {total} · {own ? "Podés volver en" : "Puede volver en"} {formatSuspensionHours(end - now)} (
    <time dateTime={suspendedUntil ?? undefined}>
      {new Date(end).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" })}
    </time>)
  </>;
}
