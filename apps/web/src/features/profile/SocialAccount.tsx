import { useEffect, useRef, useState } from "react";
import { api, ApiError, type SocialProof } from "../../api";
import { InstagramIcon, XSocialIcon } from "../../components/Icons";

type Props = {
  network: "instagram" | "x";
  saved: string | null;
  proof?: SocialProof;
  reload: () => Promise<void>;
};

export function SocialAccount({ network, saved, proof, reload }: Props) {
  const [handle, setHandle] = useState(saved ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const label = network === "instagram" ? "Instagram" : "X";
  const codeRef = useRef<HTMLElement>(null);
  const same = handle.trim().toLowerCase() === saved?.toLowerCase();
  const verified = proof && "verified" in proof;
  const pending = same && proof && "code" in proof && proof.expires > Date.now() ? proof : null;

  const [lastWait, setLastWait] = useState<{ code: string; until: number } | null>(null);
  const [now, setNow] = useState(Date.now);
  const retryAt = Math.max(lastWait && lastWait.code === pending?.code ? lastWait.until : 0, pending?.retryAt ?? 0);
  const seconds = pending ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const sync = () => setNow(Date.now());
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [pending]);

  let buttonLabel = pending ? "Verificar" : "Generar código";
  if (busy) {
    buttonLabel = pending ? "Comprobando…" : "Un momento…";
  } else if (seconds > 0) {
    const minutes = Math.floor(seconds / 60);
    const remainder = String(seconds % 60).padStart(2, "0");
    buttonLabel = `Verificar en ${minutes}:${remainder}`;
  }

  async function submit(action: "start" | "verify" | "remove") {
    setBusy(true);
    setMessage("");
    try {
      const version = proof && "code" in proof ? "code:" + proof.code
        : proof && "verified" in proof ? "verified:" + (proof.verifiedAt ?? "") : "legacy";
      await api(`/me/social/${network}/${action}`, { method: "POST", json: action === "remove" ? { handle: saved, version } : { handle } });
      if (action === "remove") setHandle("");
      await reload();
      if (action === "verify") setMessage("Ya podés borrar el código de tu biografía.");
    } catch (err) {
      if (action === "remove" && err instanceof ApiError && err.status === 409) await reload();
      if (action === "verify" && err instanceof ApiError && err.retrySeconds > 0 && pending) {
        const time = Date.now();
        setLastWait({ code: pending.code, until: time + err.retrySeconds * 1000 });
        setNow(time);
      }
      setMessage(err instanceof ApiError ? err.message : "No pudimos actualizar la cuenta. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!pending || !codeRef.current) return;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(pending.code);
        setMessage("Código copiado al portapapeles.");
        return;
      } catch {
        // Algunos navegadores móviles solo permiten copiar desde una selección.
      }
    }
    const range = document.createRange();
    range.selectNodeContents(codeRef.current);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    try {
      if (document.execCommand("copy")) {
        selection?.removeAllRanges();
        setMessage("Código copiado al portapapeles.");
        return;
      }
    } catch {
      // La selección sigue disponible para copiar desde el menú del celular.
    }
    setMessage("Para copiarlo, mantené presionado el código y elegí Copiar.");
  }

  return <div className="field" role="group" aria-label={label}>
    {verified ? <>
      <span className="profile-editor__social-label">{network === "instagram" ? <InstagramIcon /> : <XSocialIcon />} {label}</span>
      <strong className="social-account__handle">@{saved}</strong>
      <span>Cuenta verificada</span>
      <small className="muted">Al cambiarla, se quita el enlace de tu perfil.</small>
      <button type="button" className="btn btn--small btn--ghost" disabled={busy} onClick={() => submit("remove")}>Cambiar</button>
    </> : <>
      <label className="field">
        <span className="profile-editor__social-label">{network === "instagram" ? <InstagramIcon /> : <XSocialIcon />} Usuario de {label}</span>
        <span className="profile-editor__handle"><span aria-hidden="true">@</span>
          <input className="input" autoCapitalize="none" spellCheck={false} disabled={busy} value={handle}
            maxLength={network === "x" ? 16 : 31} onChange={e => { setHandle(e.target.value.replace(/^\s*@/, "")); setMessage(""); }} />
        </span>
      </label>

      {pending && <>
        <p>Pegá este código en la biografía de @{saved} y guardá los cambios en {label}.</p>
        <div className="chips social-account__code-row">
          <strong ref={codeRef}>{pending.code}</strong>
          <button type="button" className="chip" onClick={copyCode}>Copiar código</button>
        </div>
        <small className="muted">Después volvé acá y tocá Verificar. El código vence a las {new Date(pending.expires).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}.</small>
      </>}
      {seconds > 0 && <small>Podés volver a verificar a las {new Date(retryAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.</small>}
      <div className="chips">
        <button className="btn btn--primary btn--small" type="button" disabled={busy || !handle.trim() || seconds > 0} onClick={() => submit(pending ? "verify" : "start")}>
          {buttonLabel}
        </button>
        {saved && <button className="chip" disabled={busy} type="button" onClick={() => submit("remove")}>Cancelar</button>}
      </div>
    </>}
    <span role="status">{message}</span>
  </div>;
}
