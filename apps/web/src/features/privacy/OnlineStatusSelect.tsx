import { DEFAULT_ONLINE_STATUS, ONLINE_STATUS_OPTIONS, type OnlineStatus } from "@mortero/shared/onlineStatus";
import { useId } from "react";

const label: Record<OnlineStatus, string> = {
  always: "Siempre",
  connected: "Solo cuando estás conectado",
  never: "Nunca",
};

export function OnlineStatusSelect({ value, incognito, busy, onChange }: {
  value: OnlineStatus;
  incognito: boolean;
  busy: boolean;
  onChange: (value: OnlineStatus) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="field">
      <label htmlFor={id}>Mostrarme en línea</label>
      <select id={id} className="input" value={incognito ? "never" : value ?? DEFAULT_ONLINE_STATUS} aria-describedby={hintId}
        disabled={incognito || busy} onChange={(event) => {
          const next = ONLINE_STATUS_OPTIONS.find((option) => option === event.currentTarget.value);
          if (next) onChange(next);
        }}>
        {ONLINE_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{label[option]}</option>)}
      </select>
      <span id={hintId} className="muted small">
        {incognito ? "Desactivá Incógnito para ver o cambiar tu preferencia guardada."
          : "En incógnito, tu estado en línea siempre queda oculto."}
      </span>
    </div>
  );
}
