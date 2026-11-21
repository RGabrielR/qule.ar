import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, ApiError, authClient, closeSocket, type Author } from "../api";
import { useMe } from "../App";
import { APP_NAME, THEME_LABELS, themes, type ThemeName } from "../brand";
import { Avatar } from "../components/Avatar";
import { BackIcon } from "../components/Icons";
import { disablePush, enablePush, pushHelp, pushState, testPush, type PushState } from "../push";
import { getTheme, setTheme } from "../theme";

function NotificationsSetting() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState("");
  useEffect(() => {
    pushState().then(setState).catch(() => setState("unsupported"));
  }, []);
  if (!state || state === "disabled") return null;

  async function toggle() {
    setBusy(true);
    setTest("");
    try {
      const next = state === "on" ? await disablePush() : await enablePush();
      setState(next);
      if (next === "on") await sendTest();
    } catch {
      setState(await pushState().catch(() => "unsupported" as const));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setTest("Mandando…");
    const sent = await testPush().catch(() => 0);
    setTest(sent ? `Mandamos una de prueba a ${sent === 1 ? "tu dispositivo" : `tus ${sent} dispositivos`}. Si no la ves, revisá que el navegador tenga permiso para mostrar notificaciones en tu sistema.` : "No pudimos mandarla. Probá desactivarlas y activarlas de nuevo.");
  }

  return (
    <section className="section">
      <div className="setting">
        <div>
          <h2 className="section__title section__title--tight">Notificaciones</h2>
          <p className="muted small">{pushHelp(state, APP_NAME)}</p>
        </div>
        {(state === "on" || state === "off") && (
          <button className={`switch ${state === "on" ? "switch--on" : ""}`} role="switch" aria-checked={state === "on"} aria-label="Notificaciones" disabled={busy} onClick={toggle}>
            <span />
          </button>
        )}
      </div>
      {state === "on" && (
        <p className="small hint">
          <button className="linkbtn" onClick={sendTest} disabled={busy}>Mandarme una de prueba</button>
          {test && <span className="muted" role="status"> · {test}</span>}
        </p>
      )}
    </section>
  );
}

function ThemeSetting() {
  const [theme, setCurrent] = useState(getTheme);
  const choose = (t: ThemeName) => { setTheme(t); setCurrent(t); };
  return (
    <section className="section">
      <h2 className="section__title section__title--tight">Apariencia</h2>
      <p className="muted small lead">Penumbra es un oscuro más suave, para usar de día o con mucho brillo.</p>
      <div className="segmented" role="radiogroup" aria-label="Tema">
        {(Object.keys(themes) as ThemeName[]).map((t) => (
          <button key={t} role="radio" aria-checked={theme === t} onClick={() => choose(t)}>{THEME_LABELS[t]}</button>
        ))}
      </div>
    </section>
  );
}

export function Settings() {
  const { me, reload } = useMe();
  const [blocked, setBlocked] = useState<Author[] | null>(null);
  const [blocksError, setBlocksError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Author[]>("/blocks").then(setBlocked).catch(() => setBlocksError(true));
  }, []);

  if (!me?.profile) return null;

  async function change(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo aplicar el cambio. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  function updatePrivacy(json: { incognito?: boolean; showDistance?: boolean }) {
    return change(async () => {
      await api("/me/privacy", { method: "PUT", json });
      await reload();
    });
  }

  function clearLocation() {
    return change(async () => {
      await api("/me/location", { method: "DELETE" });
      await reload();
    });
  }

  function unblock(userId: string) {
    return change(async () => {
      await api(`/blocks/${userId}`, { method: "DELETE" });
      setBlocked((items) => items?.filter((person) => person.id !== userId) ?? null);
    });
  }

  function logout() {
    return change(async () => {
      const result = await authClient.signOut();
      if (result.error) throw new Error();
      closeSocket();
      await reload();
    });
  }

  function deleteAccount() {
    return change(async () => {
      await api("/me", { method: "DELETE" });
      closeSocket();
      await reload();
    });
  }

  return (
    <div className="page">
      <header className="topbar topbar--thread">
        <Link to="/yo" className="iconbtn" aria-label="Volver a Mi perfil"><BackIcon /></Link>
        <h1 className="topbar__title">Configuración</h1>
      </header>

      <ThemeSetting />
      <NotificationsSetting />
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      <section className="section">
        <h2 className="section__title">Privacidad y ubicación</h2>
        <div className="stack">
          <p className="muted small">
            {me.profile.hasLocation
              ? "Mientras usás la app, tu zona se actualiza sola. Guardamos una zona de unos 500 m."
              : "Todavía no compartiste tu ubicación."}
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={me.profile.incognito}
              disabled={busy}
              onChange={(e) => updatePrivacy({ incognito: e.currentTarget.checked })}
            />
            <span><b>Modo incógnito.</b> No aparecés en la grilla, nadie ve si estás en línea y tus visitas a perfiles no quedan registradas. Podés seguir chateando con quien quieras.</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={me.profile.showDistance}
              disabled={busy}
              onChange={(e) => updatePrivacy({ showDistance: e.currentTarget.checked })}
            />
            <span>Mostrar a qué distancia estoy. Si lo apagás, tampoco vas a ver la distancia de los demás.</span>
          </label>
          {me.profile.hasLocation && (
            <button
              className="btn btn--ghost settings__clear-location"
              disabled={busy}
              onClick={clearLocation}
            >
              Borrar mi ubicación
            </button>
          )}
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">Personas bloqueadas</h2>
        {!blocked ? (
          <p className="muted">{blocksError ? "No pudimos cargar la lista." : "Cargando…"}</p>
        ) : blocked.length === 0 ? (
          <p className="muted">No bloqueaste a nadie.</p>
        ) : (
          <ul className="blocked">
            {blocked.map((b) => (
              <li key={b.id}>
                <Avatar src={b.photo} name={b.name} size={36} />
                <span>{b.name}</span>
                <button className="linkbtn" disabled={busy} onClick={() => unblock(b.id)}>Desbloquear</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <h2 className="section__title">Cuenta</h2>
        <p className="muted small">{me.user.email}</p>
        <div className="stack settings__account-actions">
          <button className="btn" onClick={logout} disabled={busy}>Cerrar sesión</button>
          {me.user.isAdmin && <Link to="/admin" className="btn btn--ghost">Moderación</Link>}
          {deleting ? (
            <div className="confirm confirm--danger">
              <p>Se borran tu perfil, tus fotos y tus mensajes. <b>No se puede deshacer.</b> Escribí <b>borrar</b> para confirmar.</p>
              <input className="input" value={deleteText} onChange={(e) => setDeleteText(e.target.value)} aria-label="Escribí borrar para confirmar" />
              <div className="row">
                <button className="btn" onClick={() => { setDeleting(false); setDeleteText(""); }}>Cancelar</button>
                <button className="btn btn--danger" disabled={busy || deleteText.trim().toLowerCase() !== "borrar"} onClick={deleteAccount}>Borrar mi cuenta</button>
              </div>
            </div>
          ) : (
            <button className="btn btn--ghost btn--dangertext" onClick={() => setDeleting(true)}>Borrar mi cuenta</button>
          )}
        </div>
        <p className="fineprint">
          {APP_NAME} es software libre (AGPL-3.0), hecho en comunidad. Está en beta:{" "}
          <Link to="/terminos">Términos</Link> · <Link to="/privacidad">Privacidad</Link>.
        </p>
      </section>
    </div>
  );
}
