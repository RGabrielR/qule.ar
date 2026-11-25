import { useState } from "react";
import { api, type GroupInfo, type SpamRules } from "../../api";

export function GroupSettings({ info, onSaved }: { info: GroupInfo; onSaved: (name: string) => void }) {
  const [name, setName] = useState(info.name);
  const [description, setDescription] = useState(info.description ?? "");
  const [rules, setRules] = useState<SpamRules>(info.rules);
  const [state, setState] = useState<"idle" | "saving" | "ok">("idle");
  const [error, setError] = useState("");

  const setRule = (k: keyof SpamRules, v: string) => {
    setRules({ ...rules, [k]: Number(v) });
    setState("idle");
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    setError("");
    try {
      await api(`/groups/${info.id}`, { method: "PATCH", json: { name, description: description || null, rules } });
      setState("ok");
      onSaved(name.trim());
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  }

  return (
    <form className="section form" onSubmit={save}>
      <label className="field">
        <span>Nombre</span>
        <input className="input" required minLength={3} maxLength={40} value={name} onChange={(e) => { setName(e.target.value); setState("idle"); }} />
      </label>
      <label className="field">
        <span>Descripción</span>
        <textarea className="input" rows={3} maxLength={300} value={description} onChange={(e) => { setDescription(e.target.value); setState("idle"); }} />
      </label>

      <h2 className="subhead">Antispam</h2>
      <p className="muted small">
        Cada persona puede mandar <b>{rules.burst}</b> {rules.burst === 1 ? "mensaje" : "mensajes"} cada <b>{fmtSecs(rules.burst * rules.intervalSeconds)}</b>.
        Lo que mande de más queda en cola. Si tiene {rules.rotationMax} o más de los últimos {rules.rotationWindow} mensajes, espera el doble.
      </p>
      <div className="grid2">
        <label className="field">
          <span>Segundos por mensaje</span>
          <input className="input" type="number" min={5} max={3600} value={rules.intervalSeconds} onChange={(e) => setRule("intervalSeconds", e.target.value)} />
        </label>
        <label className="field">
          <span>Ráfaga (mensajes seguidos)</span>
          <input className="input" type="number" min={1} max={10} value={rules.burst} onChange={(e) => setRule("burst", e.target.value)} />
        </label>
        <label className="field">
          <span>Rotación: mirar los últimos</span>
          <input className="input" type="number" min={5} max={100} value={rules.rotationWindow} onChange={(e) => setRule("rotationWindow", e.target.value)} />
        </label>
        <label className="field">
          <span>Rotación: máximo tuyos</span>
          <input className="input" type="number" min={1} max={50} value={rules.rotationMax} onChange={(e) => setRule("rotationMax", e.target.value)} />
        </label>
        <label className="field">
          <span>Horas de cuenta nueva</span>
          <input className="input" type="number" min={0} max={720} value={rules.newAccountHours} onChange={(e) => setRule("newAccountHours", e.target.value)} />
        </label>
        <label className="field">
          <span>Máximo en cola</span>
          <input className="input" type="number" min={1} max={10} value={rules.maxQueued} onChange={(e) => setRule("maxQueued", e.target.value)} />
        </label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn--primary" disabled={state === "saving"}>
        {state === "saving" ? "Guardando…" : state === "ok" ? "Guardado" : "Guardar cambios"}
      </button>
    </form>
  );
}

function fmtSecs(s: number) {
  if (s < 60) return `${s} s`;
  const m = Math.round((s / 60) * 10) / 10;
  return `${m} min`;
}
