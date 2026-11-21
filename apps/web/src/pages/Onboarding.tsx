import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, authClient } from "../api";
import { useMe } from "../App";
import { APP_NAME } from "../brand";
import { Wordmark } from "../components/Wordmark";
import { Logo } from "../components/Logo";
import { Markdown } from "../components/Markdown";
import terminos from "../legal/terminos.md?raw";

function maxBirthdate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().slice(0, 10);
}

export function Onboarding() {
  const { me, reload } = useMe();
  const nav = useNavigate();
  const [displayName, setDisplayName] = useState(me?.user.name ?? "");
  const [birthdate, setBirthdate] = useState("");
  const [adult, setAdult] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  // Los términos se leen acá mismo; el tilde de aceptarlos se habilita recién cuando se abren
  const [showTerms, setShowTerms] = useState(false);
  const [openedTerms, setOpenedTerms] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/me/profile", { method: "PUT", json: { displayName, birthdate, acceptTerms } });
      await reload();
      nav("/yo/editar?nuevo=1", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth__hero">
        <Logo className="auth__logo" />
        <Wordmark big />
        <p className="auth__tag">Dos datos y entrás.</p>
      </div>
      <form className="auth__card form" onSubmit={submit}>
        <label className="field">
          <span>¿Cómo querés que te vean?</span>
          <input className="input" required maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label className="field">
          <span>Fecha de nacimiento</span>
          <input className="input" type="date" required max={maxBirthdate()} value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
          <small className="muted">Solo mostramos tu edad. La fecha no se puede cambiar después.</small>
        </label>
        <label className="check">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          <span>Confirmo que tengo 18 años o más.</span>
        </label>
        <div className="beta-notice" role="note">
          <p className="beta-notice__title">Antes de entrar, leé esto</p>
          <ul className="beta-notice__list">
            <li>{APP_NAME} está en <b>beta</b>: puede fallar, cambiar o perder datos.</li>
            <li>Te registrás y la usás <b>bajo tu propia responsabilidad</b>.</li>
            <li>
              Quienes la desarrollamos respondemos <b>solo por el funcionamiento de la app</b>, no por lo que hagan otras
              personas ni por lo que pase fuera de ella.
            </li>
          </ul>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            aria-expanded={showTerms}
            onClick={() => {
              setShowTerms((v) => !v);
              setOpenedTerms(true);
            }}
          >
            {showTerms ? "Ocultar los términos" : "Leer los Términos y condiciones"}
          </button>
          {showTerms && (
            <div className="beta-notice__terms legal__body" tabIndex={0} aria-label="Términos y condiciones">
              <Markdown source={terminos} />
            </div>
          )}
        </div>
        <label className={`check ${openedTerms ? "" : "check--disabled"}`}>
          <input type="checkbox" disabled={!openedTerms} checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} />
          <span>
            Leí los Términos y condiciones y la <Link to="/privacidad" target="_blank">Política de privacidad</Link>, y los
            acepto. Entiendo que {APP_NAME} está en beta y que la uso bajo mi propia responsabilidad.
            {!openedTerms && <small className="muted check__hint">Para aceptarlos, primero abrí los términos.</small>}
          </span>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn--primary" disabled={!adult || !acceptTerms || busy}>{busy ? "Un toque…" : `Entrar a ${APP_NAME}`}</button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={async () => {
            await authClient.signOut();
            await reload();
          }}
        >
          Salir
        </button>
      </form>
    </div>
  );
}
