import { useEffect, useState } from "react";
import { api, authClient, closeSocket, type Appeal, type Me } from "../api";
import { Logo } from "../components/Logo";
import { Wordmark } from "../components/Wordmark";

const fmt = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long" });

/**
 * Cuenta suspendida: el motivo y la forma de pedir que se revise, en privado y dentro de la app.
 * Mientras tanto no puede usar nada más (lo frena el servidor, ver requireUser en apps/api/src/lib.ts).
 */
export function Suspended({ me, onSignedOut }: { me: Me; onSignedOut: () => Promise<void> | void }) {
  const [appeal, setAppeal] = useState<Appeal | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Appeal | null>("/appeal").then(setAppeal).catch(() => setAppeal(null));
  }, []);

  async function signOut() {
    await authClient.signOut();
    closeSocket();
    await onSignedOut();
  }

  return (
    <div className="auth">
      <div className="auth__hero">
        <Logo className="auth__logo" />
        <Wordmark big />
      </div>
      <div className="auth__card">
        <h2 className="auth__title">Tu cuenta está suspendida</h2>
        {me.profile?.suspendReason && <p className="muted">Motivo: {me.profile.suspendReason}</p>}
        <p className="muted small">Mientras esté suspendida no aparecés en la app ni podés usarla.</p>

        {appeal === undefined ? null : appeal === null ? (
          <AppealForm onSent={setAppeal} onError={setError} />
        ) : (
          <AppealStatus appeal={appeal} onChange={setAppeal} onError={setError} />
        )}
        {error && <p className="error" role="alert">{error}</p>}

        <button className="btn btn--ghost" onClick={signOut}>Cerrar sesión</button>
      </div>
    </div>
  );
}

function AppealForm({ onSent, onError }: { onSent: (a: Appeal) => void; onError: (e: string) => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    onError("");
    try {
      onSent(await api<Appeal>("/appeal", { method: "POST", json: { body } }));
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <p className="small">
        Si creés que es un error, pedí que la revisemos. Es privado: lo lee alguien del equipo de moderación y te respondemos
        acá mismo.
      </p>
      <label className="field">
        <span>Contanos qué pasó</span>
        <textarea className="input" rows={5} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <p className="muted small">Podés mandar un pedido por suspensión. No incluyas datos de otras personas.</p>
      <button className="btn btn--primary" disabled={busy || body.trim().length < 20} onClick={send}>
        {busy ? "Mandando…" : "Pedir revisión"}
      </button>
    </div>
  );
}

function AppealStatus({ appeal, onChange, onError }: { appeal: Appeal; onChange: (a: Appeal) => void; onError: (e: string) => void }) {
  const [extra, setExtra] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  async function sendExtra() {
    setBusy(true);
    onError("");
    try {
      onChange(await api<Appeal>("/appeal/extra", { method: "POST", json: { extra } }));
      setAdding(false);
    } catch (e) {
      onError((e as Error).message);
    }
    setBusy(false);
  }
  return (
    <div className="stack">
      {appeal.status === "open" ? (
        <p className="small"><b>Pediste una revisión el {fmt(appeal.createdAt)}.</b> Todavía la estamos viendo. Cuando haya una respuesta, la vas a leer acá y te avisamos por mail.</p>
      ) : (
        <>
          <p className="small"><b>Revisamos tu pedido.</b> Decidimos mantener la suspensión.</p>
          {appeal.response && <blockquote className="appeal__response">{appeal.response}</blockquote>}
        </>
      )}
      <details>
        <summary className="muted small">Lo que nos mandaste</summary>
        <p className="small appeal__text">{appeal.body}</p>
        {appeal.extra && <p className="small appeal__text">{appeal.extra}</p>}
      </details>
      {appeal.status === "open" && !appeal.extra && (
        adding ? (
          <>
            <label className="field">
              <span>¿Querés sumar algo? Podés hacerlo una vez.</span>
              <textarea className="input" rows={3} maxLength={1000} value={extra} onChange={(e) => setExtra(e.target.value)} />
            </label>
            <button className="btn" disabled={busy || extra.trim().length < 5} onClick={sendExtra}>{busy ? "Mandando…" : "Sumar al pedido"}</button>
          </>
        ) : (
          <button className="linkbtn small" onClick={() => setAdding(true)}>Sumar algo más</button>
        )
      )}
    </div>
  );
}
