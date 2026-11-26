import { useState } from "react";
import { api } from "../../api";
import { EyeOffIcon } from "../../components/Icons";

const KEY = "qule:aviso-fotos-explicitas";

function wasHidden() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Aviso para las cuentas que ya existían (que arrancan con la opción apagada): la opción de tapar fotos explícitas
 * existe y se prende en un toque. Las cuentas nuevas la tienen prendida y no lo ven. Se muestra una sola vez.
 */
export function ExplicitNotice({ hideExplicit, onChange }: { hideExplicit: boolean; onChange: () => Promise<void> }) {
  const [hidden, setHidden] = useState(wasHidden);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (hidden || hideExplicit) return null;

  function hide() {
    setHidden(true);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* sin storage: se oculta solo por ahora */
    }
  }

  async function turnOn() {
    setBusy(true);
    setError(false);
    try {
      await api("/me/privacy", { method: "PUT", json: { hideExplicit: true } });
      hide();
      await onChange();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="notice locate-bar" role="region" aria-label="Tapar fotos explícitas">
      <span className="locate-bar__icon"><EyeOffIcon /></span>
      <div className="locate-bar__text">
        <p><b>Nuevo: podés tapar las fotos explícitas</b></p>
        <p className="muted small">Se ven borrosas en la grilla y en los perfiles, y las abrís si querés. Lo cambiás cuando quieras en Configuración.</p>
        {error && <p className="error">No se pudo aplicar. Probá de nuevo.</p>}
      </div>
      <div className="install__actions">
        <button className="btn btn--small btn--primary" disabled={busy} onClick={turnOn}>Taparlas</button>
        <button className="linkbtn small muted" onClick={hide}>Ahora no</button>
      </div>
    </div>
  );
}
