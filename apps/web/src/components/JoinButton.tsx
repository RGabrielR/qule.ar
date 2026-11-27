import { useState } from "react";
import { Link } from "react-router";
import { api, type GroupListing } from "../api";
import { DialogFocus } from "./DialogFocus";
import { useSheetExit } from "./useSheetExit";

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long" });

/** Botón de estado de un grupo: entrar, pedir ingreso, solicitud enviada o en espera. */
export function JoinButton({ g, onChange }: { g: GroupListing; onChange: () => void }) {
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sheet = useSheetExit(() => setAsking(false));

  if (g.role) return <Link className="btn btn--small" to={`/grupos/${g.id}`}>Abrir</Link>;
  if (g.cooldownUntil) return <span className="pill">Podés volver a pedir el {fmtDate(g.cooldownUntil)}</span>;
  if (g.pending) {
    return (
      <div className="joinstate">
        <span className="pill pill--wait">Solicitud enviada</span>
        <button
          className="linkbtn small"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await api(`/groups/${g.id}/requests/mine`, { method: "DELETE" }).catch(() => {});
            setBusy(false);
            onChange();
          }}
        >
          Cancelar
        </button>
      </div>
    );
  }

  async function send() {
    setBusy(true);
    setError("");
    try {
      await api(`/groups/${g.id}/requests`, { method: "POST", json: { message: message || undefined } });
      // La hoja baja y recién ahí el botón pasa a "Solicitud enviada"
      sheet.close(() => {
        setAsking(false);
        setMessage("");
        onChange();
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn btn--small btn--primary" onClick={() => setAsking(true)}>Pedir ingreso</button>
      {asking && (
        <div className="sheet-backdrop" {...sheet.backdrop}>
          <div className="sheet" role="dialog" aria-modal aria-labelledby="join-title" onClick={(e) => e.stopPropagation()}>
            <DialogFocus onClose={sheet.close} />
            <h2 id="join-title">Pedir ingreso a {g.name}</h2>
            <p className="muted small">El dueño o los moderadores del grupo aceptan o rechazan tu solicitud.</p>
            <textarea
              className="input"
              rows={3}
              maxLength={300}
              placeholder="Contales algo de vos (opcional)"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            {error && <p className="error" role="alert">{error}</p>}
            <div className="row">
              <button className="btn" onClick={() => sheet.close()}>Cancelar</button>
              <button className="btn btn--primary" disabled={busy} onClick={send}>{busy ? "Mandando…" : "Mandar solicitud"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
