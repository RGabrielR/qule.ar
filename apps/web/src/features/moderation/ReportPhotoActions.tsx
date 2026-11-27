import { UserName } from "../../components/UserName";
import { useState, type FormEvent } from "react";
import { api } from "../../api";
import { suspendReportAccount } from "./suspendReportAccount";
import type { Report } from "./types";

export type ReportReply = { response: string | null; respondedAt: string | null };

export type Measure = "removed" | "suspended";

type Props = {
  report: Report;
  path: string;
  reply: ReportReply;
  onReply: (reply: ReportReply) => void;
  measure?: Measure;
  onMeasure: (measure: Measure) => void;
  canSuspend: boolean;
  matchedTarget: boolean;
  onClose: () => void;
};

export function ReportPhotoActions({ report, path, reply, onReply, measure, onMeasure, canSuspend, matchedTarget, onClose }: Props) {
  const [response, setResponse] = useState("");
  const [reason, setReason] = useState("");
  const [suspendReason, setSuspendReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<"reply" | "remove" | "suspend" | null>(null);
  const [error, setError] = useState("");
  const open = report.status === "open" && !measure;
  const canRemove = open && report.messageId && !report.message?.deleted;
  const maySuspend = open && canSuspend && matchedTarget && report.target?.id && !report.targetSuspendedAt;

  async function sendResponse(e: FormEvent) {
    e.preventDefault();
    if (pending || !response.trim()) return;
    setPending("reply");
    setError("");
    try {
      onReply(await api<ReportReply>(`${path}/response`, { method: "POST", json: { response } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function remove(e: FormEvent) {
    e.preventDefault();
    if (pending || reason.trim().length < 3) return;
    setPending("remove");
    setError("");
    try {
      await api(`/admin/reports/${encodeURIComponent(report.id)}/delete-message`, { method: "POST", json: { verified: true, reason } });
      onMeasure("removed");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function suspend(e: FormEvent) {
    e.preventDefault();
    if (pending || !maySuspend || suspendReason.trim().length < 3) return;
    setPending("suspend");
    setError("");
    try {
      await suspendReportAccount(report, suspendReason, true);
      setConfirming(false);
      onMeasure("suspended");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="verify-photo__form" role="tabpanel" id="report-photo-actions" aria-labelledby="report-photo-actions-tab">
      <div className="verify-photo__body">
        <section className="stack" aria-labelledby="report-photo-measure">
          <h3 id="report-photo-measure">Cuenta reportada</h3>
          <p><strong><UserName name={report.target?.name ?? "Cuenta sin perfil"} /></strong></p>
          {(measure === "suspended" || report.targetSuspendedAt) && <p className="small" role="status">Cuenta suspendida.</p>}
          {measure === "removed" && <p className="small" role="status">Mensaje borrado.</p>}
          {open && !matchedTarget && <p className="muted small">La copia verificada corresponde a otra cuenta.</p>}
          {canRemove && (
            <details>
              <summary>Borrar mensaje</summary>
              <form className="stack" onSubmit={remove}>
                <label className="field">
                  <span>Motivo (queda registrado)</span>
                  <textarea className="input" rows={2} maxLength={300} value={reason} disabled={pending !== null}
                    onChange={(e) => setReason(e.target.value)} />
                </label>
                <button type="submit" className="btn btn--danger" disabled={pending !== null || reason.trim().length < 3}>
                  {pending === "remove" ? "Borrando…" : "Confirmar que se borra el mensaje"}
                </button>
              </form>
            </details>
          )}
          {maySuspend && (confirming ? (
            <form className="stack" onSubmit={suspend}>
              <p className="muted small">Se cierran sus sesiones y sus reportes abiertos. La cuenta se puede reactivar después.</p>
              <label className="field">
                <span>Motivo de la suspensión (la persona lo va a ver)</span>
                <textarea className="input" rows={3} maxLength={300} value={suspendReason} disabled={pending !== null}
                  onChange={(e) => setSuspendReason(e.target.value)} />
              </label>
              <div className="rcard__actions">
                <button type="button" className="btn" disabled={pending !== null} onClick={() => setConfirming(false)}>Cancelar suspensión</button>
                <button type="submit" className="btn btn--danger" disabled={pending !== null || suspendReason.trim().length < 3}>
                  {pending === "suspend" ? "Suspendiendo…" : "Confirmar suspensión"}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="btn btn--danger" disabled={pending !== null} onClick={() => setConfirming(true)}>Suspender cuenta</button>
          ))}
        </section>
        <section className="stack" aria-labelledby="report-photo-reply">
          <h3 id="report-photo-reply">Responder a quien reportó</h3>
          {reply.response ? (
            <blockquote className="rcard__msg">
              <span className="muted small">Respuesta enviada</span>
              <p>{reply.response}</p>
            </blockquote>
          ) : (
            <form className="stack" onSubmit={sendResponse}>
              <label className="field">
                <span>Respuesta privada</span>
                <textarea className="input" rows={4} maxLength={1000} value={response} disabled={pending !== null}
                  onChange={(e) => setResponse(e.target.value)} />
              </label>
              <button type="submit" className="btn btn--primary" disabled={pending !== null || !response.trim()}>
                {pending === "reply" ? "Enviando…" : "Enviar respuesta"}
              </button>
            </form>
          )}
        </section>
        {error && <p className="notice notice--error" role="alert">{error}</p>}
      </div>
      <div className="verify-photo__footer">
        <div className="rcard__actions">
          <button type="button" className="btn" onClick={onClose}>Volver al reporte</button>
        </div>
      </div>
    </div>
  );
}
