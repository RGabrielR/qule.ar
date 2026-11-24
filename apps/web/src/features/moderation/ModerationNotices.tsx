import { useState } from "react";
import { api, type NotifyKind } from "../../api";
import { useMe } from "../../App";
import { BellIcon } from "../../components/Icons";
import { staffNotices } from "./notices";

/** Prender o apagar los avisos de moderación desde el mismo panel (es lo mismo que en Configuración). */
export function ModerationNotices({ owner }: { owner: boolean }) {
  const { me } = useMe();
  const [prefs, setPrefs] = useState<Partial<Record<NotifyKind, boolean>>>(me?.profile?.notifyPrefs ?? {});
  const [error, setError] = useState("");

  async function toggle(kind: NotifyKind) {
    const on = prefs[kind] !== false;
    const before = prefs;
    setPrefs({ ...prefs, [kind]: !on });
    setError("");
    try {
      const r = await api<{ notifyPrefs: Partial<Record<NotifyKind, boolean>> }>("/me/notificaciones", { method: "PUT", json: { [kind]: !on } });
      setPrefs(r.notifyPrefs);
    } catch {
      setPrefs(before);
      setError("No pudimos guardar el cambio. Probá de nuevo.");
    }
  }

  const notices = staffNotices(owner);
  const allOn = notices.every((n) => prefs[n.kind] !== false);
  return (
    <details className="modnotices">
      <summary>
        <BellIcon />
        <span>Tus avisos de moderación</span>
        <span className="muted small">{allOn ? "prendidos" : notices.some((n) => prefs[n.kind] !== false) ? "algunos apagados" : "apagados"}</span>
      </summary>
      <ul className="prefs">
        {notices.map((n) => {
          const on = prefs[n.kind] !== false;
          return (
            <li key={n.kind} className="setting">
              <div>
                <p>{n.label}</p>
                {n.hint && <p className="muted small">{n.hint}</p>}
              </div>
              <button className={`switch ${on ? "switch--on" : ""}`} role="switch" aria-checked={on} aria-label={n.label} onClick={() => toggle(n.kind)}>
                <span />
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="error small hint" role="alert">{error}</p>}
    </details>
  );
}
