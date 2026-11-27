import type { AiOrigin } from "../../api";
import { WarningIcon } from "../../components/Icons";

const EXPLANATION = "Hecha con IA: los datos del archivo dicen que esta imagen fue creada con inteligencia artificial.";

/**
 * Aviso sobre una imagen creada con IA. No la esconde ni la bloquea: solo avisa.
 *
 * Sale solo con "generated" (la imagen la creó una IA). Las fotos reales retocadas con IA ("edited") no lo llevan:
 * marcar como IA una foto real con un retoque chico confunde más de lo que ayuda (le pasó a Meta en 2024).
 * `compact` es para miniaturas: muestra solo "IA".
 */
export function AiChip({ origin, compact = false, className = "" }: { origin: AiOrigin | undefined; compact?: boolean; className?: string }) {
  if (origin !== "generated") return null;
  return (
    <span className={`ai-chip${compact ? " ai-chip--compact" : ""}${className ? ` ${className}` : ""}`} role="note" aria-label={EXPLANATION} title={EXPLANATION}>
      <WarningIcon size={compact ? 11 : 13} />
      <span aria-hidden="true">{compact ? "IA" : "Hecha con IA"}</span>
    </span>
  );
}
