import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, authClient } from "../api";
import { useMe } from "../App";
import { Wordmark } from "../components/Wordmark";
import { Logo } from "../components/Logo";
import { APP_NAME, APP_SLOGAN } from "../brand";
import { GoogleMark } from "../components/GoogleMark";
import { EyeIcon, EyeOffIcon } from "../components/Icons";

export function Login() {
  const { reload } = useMe();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState(false);
  const [canReset, setCanReset] = useState(false);

  useEffect(() => {
    api<{ google: boolean; passwordReset: boolean }>("/config").then((c) => { setGoogle(c.google); setCanReset(c.passwordReset); }).catch(() => {});
  }, []);

  function selectMode(next: "in" | "up") {
    if (next === mode) return;
    setShowPassword(false);
    setMode(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res =
      mode === "up"
        ? await authClient.signUp.email({ name: name || email.split("@")[0], email, password })
        : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (res.error) {
      setError(translate(res.error.code, res.error.message));
      return;
    }
    await reload();
  }

  return (
    <div className="auth">
      <div className="auth__hero">
        <Logo className="auth__logo" />
        <Wordmark big />
        <p className="auth__slogan">{APP_SLOGAN}</p>
        <p className="auth__tag">Gente cerca, grupos y charla. Gratis y de código abierto, para siempre.</p>
      </div>

      <div className="auth__card">
        {google && (
          <>
            <button
              className="btn btn--google"
              onClick={() => authClient.signIn.social({ provider: "google", callbackURL: "/" })}
            >
              <GoogleMark /> Seguir con Google
            </button>
            <div className="divider"><span>o con tu email</span></div>
          </>
        )}

        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={mode === "in"} onClick={() => selectMode("in")}>Entrar</button>
          <button role="tab" aria-selected={mode === "up"} onClick={() => selectMode("up")}>Crear cuenta</button>
        </div>

        <form onSubmit={submit} className="form">
          {mode === "up" && (
            <label className="field">
              <span>Nombre</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" maxLength={40} />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <div className="field">
            <label htmlFor="auth-password">Contraseña</label>
            <div className="password-input">
              <input
                id="auth-password"
                className="input"
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "up" ? "new-password" : "current-password"}
                autoCapitalize="none"
                spellCheck={false}
              />
              <button
                type="button"
                className="iconbtn password-input__toggle"
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                aria-controls="auth-password"
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            {mode === "up" && <small className="muted">Mínimo 8 caracteres.</small>}
            {mode === "in" && canReset && <Link to="/recuperar" className="linkbtn small forgot">¿Te olvidaste la contraseña?</Link>}
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn btn--primary" disabled={busy}>
            {busy ? "Un toque…" : mode === "up" ? "Crear cuenta" : "Entrar"}
          </button>
        </form>
        <p className="fineprint">
          Solo para mayores de 18. {APP_NAME} está en beta: la usás bajo tu propia responsabilidad. Al registrarte vas a
          leer y aceptar los <Link to="/terminos">Términos</Link> y la <Link to="/privacidad">Política de privacidad</Link>.
        </p>
      </div>
    </div>
  );
}

function translate(code: string | undefined, fallback: string | undefined) {
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD": return "Email o contraseña incorrectos.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL": return "Ya hay una cuenta con ese email.";
    case "PASSWORD_TOO_SHORT": return "La contraseña es muy corta.";
    case "INVALID_EMAIL": return "Ese email no parece válido.";
    default: return fallback ?? "No se pudo. Probá de nuevo.";
  }
}

