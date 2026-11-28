import { useState } from "react";
import { api, type GroupInfo, type SpamRules } from "../../api";
import { GroupTagEditor } from "./GroupTags";

export function GroupSettings({ info, onSaved }: { info: GroupInfo; onSaved: (name: string, tags: string[]) => void }) {
  const [name, setName] = useState(info.name);
  const [description, setDescription] = useState(info.description ?? "");
  const [tags, setTags] = useState(info.tags ?? []);
  // Lo que está escrito en cada campo, como texto: así se puede borrar y volver a escribir sin que aparezca "0" o "05"
  const [draft, setDraft] = useState(() => rulesToDraft(info.rules));
  const [state, setState] = useState<"idle" | "saving" | "ok">("idle");
  const [error, setError] = useState("");
  const checked = checkRules(draft);
  // El resumen usa lo último válido de cada campo
  const [rules, setRules] = useState<SpamRules>(info.rules);

  const setRule = (k: keyof SpamRules, v: string) => {
    const text = v.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    setDraft({ ...draft, [k]: text });
    const n = parseRule(k, text);
    if (n !== null) setRules({ ...rules, [k]: n });
    setState("idle");
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!checked.ok) {
      setError("Revisá los números marcados.");
      return;
    }
    setState("saving");
    setError("");
    try {
      await api(`/groups/${info.id}`, { method: "PATCH", json: { name, description: description || null, tags, rules: checked.rules } });
      setState("ok");
      onSaved(name.trim(), tags);
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

      <GroupTagEditor tags={tags} onChange={(next) => { setTags(next); setState("idle"); }} />

      <h3 className="subhead">Antispam</h3>
      <p className="muted small">
        Cada persona puede mandar <b>{rules.burst}</b> {rules.burst === 1 ? "mensaje" : "mensajes"} cada <b>{fmtSecs(rules.burst * rules.intervalSeconds)}</b>.
        Lo que mande de más queda en cola. Si tiene {rules.rotationMax} o más de los últimos {rules.rotationWindow} mensajes, espera el doble.
      </p>
      <div className="grid2">
        {RULE_FIELDS.map((f) => {
          const bad = checked.bad.includes(f.key);
          return (
            <label className="field" key={f.key}>
              <span>{f.label}</span>
              <input
                className="input" type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
                value={draft[f.key]} aria-invalid={bad} aria-describedby={`regla-${f.key}`}
                onChange={(e) => setRule(f.key, e.target.value)}
              />
              <small id={`regla-${f.key}`} className={bad ? "error small" : "muted small"}>Entre {f.min} y {f.max}</small>
            </label>
          );
        })}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn--primary" disabled={state === "saving"}>
        {state === "saving" ? "Guardando…" : state === "ok" ? "Guardado" : "Guardar cambios"}
      </button>
    </form>
  );
}

const RULE_FIELDS: { key: keyof SpamRules; label: string; min: number; max: number }[] = [
  { key: "intervalSeconds", label: "Segundos por mensaje", min: 5, max: 3600 },
  { key: "burst", label: "Ráfaga (mensajes seguidos)", min: 1, max: 10 },
  { key: "rotationWindow", label: "Rotación: mirar los últimos", min: 5, max: 100 },
  { key: "rotationMax", label: "Rotación: máximo tuyos", min: 1, max: 50 },
  { key: "newAccountHours", label: "Horas de cuenta nueva", min: 0, max: 720 },
  { key: "maxQueued", label: "Máximo en cola", min: 1, max: 10 },
];

type RulesDraft = Record<keyof SpamRules, string>;

function rulesToDraft(rules: SpamRules): RulesDraft {
  return Object.fromEntries(RULE_FIELDS.map((f) => [f.key, String(rules[f.key])])) as RulesDraft;
}

/** El número de un campo si está dentro de su rango; si no, null. */
function parseRule(key: keyof SpamRules, text: string): number | null {
  const f = RULE_FIELDS.find((r) => r.key === key)!;
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= f.min && n <= f.max ? n : null;
}

function checkRules(draft: RulesDraft): { ok: true; rules: SpamRules; bad: (keyof SpamRules)[] } | { ok: false; bad: (keyof SpamRules)[] } {
  const bad = RULE_FIELDS.filter((f) => parseRule(f.key, draft[f.key]) === null).map((f) => f.key);
  if (bad.length) return { ok: false, bad };
  return { ok: true, bad: [], rules: Object.fromEntries(RULE_FIELDS.map((f) => [f.key, Number(draft[f.key])])) as SpamRules };
}

function fmtSecs(s: number) {
  if (s < 60) return `${s} s`;
  const m = Math.round((s / 60) * 10) / 10;
  return `${m} min`;
}
