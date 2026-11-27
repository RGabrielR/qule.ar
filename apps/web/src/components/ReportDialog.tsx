import { UserName } from "./UserName";
import { useEffect, useState } from "react";
import { api, upload } from "../api";
import { REPORT_REASONS, URGENT_REASONS } from "../options";
import { DialogFocus } from "./DialogFocus";
import { useSheetExit } from "./useSheetExit";

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

  const [capturesEnabled, setCapturesEnabled] = useState(false);
  const [capture, setCapture] = useState<File | null>(null);
  const [error, setError] = useState("");
  const { close, backdrop } = useSheetExit(onClose);
  const showCapture = capturesEnabled && Boolean(userId) && !groupId && Boolean(reason) && reason !== "menor de edad";

  useEffect(() => {
    if (!userId || groupId) return;
    const controller = new AbortController();
    void api<{ reportCapture: boolean }>("/config", { signal: controller.signal })
      .then(({ reportCapture }) => setCapturesEnabled(reportCapture)).catch(() => {});
    return () => controller.abort();
  }, [groupId, userId]);

  async function send() {
    setState("sending");
    setError("");
    try {
      const report = { userId, groupId, reason, details: details || undefined, messageId, messageKind };
      if (showCapture && capture) {
        await upload("/reports", capture, Object.fromEntries(Object.entries(report).filter((entry): entry is [string, string] => entry[1] !== undefined)));
      } else {
        await api("/reports", { method: "POST", json: report });
      }
      setState("done");
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    }
  }

  return (
    <div className="sheet-backdrop" {...backdrop}>
      <div className="sheet sheet--list report-dialog" role="dialog" aria-modal aria-labelledby="report-title" onClick={(e) => e.stopPropagation()}>
        <DialogFocus onClose={close} />
        {state === "done" ? (
          <>
            <h2 id="report-title">Gracias por avisar</h2>
            <p className="muted">
              Vamos a revisar el reporte.{groupId ? " Si sos parte del grupo, también podés salir." : <> Si te hace sentir mejor, también podés bloquear a <UserName name={name} />.</>}
            </p>
            <button className="btn btn--primary" onClick={() => close()}>Listo</button>
          </>
        ) : (
          <>
            <h2 id="report-title">Reportar {groupId ? "el grupo " : messageId ? "mensaje de " : "a "}<UserName name={name} /></h2>
            <div className="chips">
              {REPORT_REASONS.map((r) => (
                <button key={r} className={`chip ${reason === r ? "chip--on" : ""}`} disabled={state === "sending"} onClick={() => { setReason(r); if (r === "menor de edad") setCapture(null); }}>
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
            {showCapture && (
              <label className="field">
                <span>Adjuntá una captura (opcional)</span>
                <input className="input" type="file" accept="image/jpeg,image/png,image/webp" disabled={state === "sending"}
                  onChange={(e) => setCapture(e.target.files?.[0] ?? null)} />
                <span>Solo la ve el equipo autorizado de Moderación.</span>
              </label>
            )}
            {state === "error" && <p className="error" role="alert">{error || "No se pudo mandar el reporte. Probá de nuevo."}</p>}
            <div className="row">
              <button className="btn" onClick={() => close()}>Cancelar</button>
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
