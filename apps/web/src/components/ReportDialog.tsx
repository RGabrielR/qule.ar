import { useState } from "react";
import { api } from "../api";
import { REPORT_REASONS, URGENT_REASONS } from "../options";

type Props = {
  // Se reporta a una persona (userId) o a un grupo (groupId)
  userId?: string;
  groupId?: string;
  name: string;
  messageId?: string;
  messageKind?: "group" | "dm";
  onClose: () => void;
};

export function ReportDialog({ userId, groupId, name, messageId, messageKind, onClose }: Props) {
  const [reason, setReason] = useState<string>("");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function send() {
    setState("sending");
    try {
      await api("/reports", { method: "POST", json: { userId, groupId, reason, details: details || undefined, messageId, messageKind } });
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal aria-labelledby="report-title" onClick={(e) => e.stopPropagation()}>
        {state === "done" ? (
          <>
            <h2 id="report-title">Gracias por avisar</h2>
            <p className="muted">
              Vamos a revisar el reporte.{groupId ? " Si sos parte del grupo, también podés salir." : ` Si te hace sentir mejor, también podés bloquear a ${name}.`}
            </p>
            <button className="btn btn--primary" onClick={onClose}>Listo</button>
          </>
        ) : (
          <>
            <h2 id="report-title">Reportar {groupId ? "el grupo " : messageId ? "mensaje de " : "a "}{name}</h2>
            <div className="chips">
              {REPORT_REASONS.map((r) => (
                <button key={r} className={`chip ${reason === r ? "chip--on" : ""}`} onClick={() => setReason(r)}>
                  {r}
                </button>
              ))}
            </div>
            {URGENT_REASONS.includes(reason) && (
              <p className="report-urgent small">
                Esto lo revisamos primero. Si alguien está en peligro ahora, llamá al 911. Si es contenido íntimo tuyo
                compartido sin tu permiso, no lo borres de tus chats: puede servirte para denunciar.
              </p>
            )}
            <textarea
              className="input"
              placeholder="Contanos más (opcional)"
              rows={3}
              maxLength={1000}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
            {state === "error" && <p className="error">No se pudo mandar el reporte. Probá de nuevo.</p>}
            <div className="row">
              <button className="btn" onClick={onClose}>Cancelar</button>
              <button className="btn btn--danger" disabled={!reason || state === "sending"} onClick={send}>
                {state === "sending" ? "Mandando…" : "Reportar"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
