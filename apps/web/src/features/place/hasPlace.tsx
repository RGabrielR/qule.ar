// "Tengo lugar": dato opcional del perfil. Lo elige cada persona (sí, no o sin decir) y se puede borrar.
// La app nunca lo deduce de otra cosa. Los valores tienen que coincidir con HAS_PLACE de la API (db/schema.ts).

export type HasPlace = "si" | "no";

/** Cómo se lee en el perfil de otra persona. */
export const HAS_PLACE_LABEL: Record<HasPlace, string> = { si: "Tiene lugar", no: "No tiene lugar" };
/** Cómo se elige en el propio perfil. */
const OWN_LABEL: Record<HasPlace, string> = { si: "Tengo lugar", no: "No tengo lugar" };
const VALUES: HasPlace[] = ["si", "no"];

export function hasPlaceLabel(v: string | null | undefined) {
  return v === "si" || v === "no" ? HAS_PLACE_LABEL[v] : null;
}

export function HasPlaceSelect({ value, onChange }: { value: HasPlace | null; onChange: (v: HasPlace | null) => void }) {
  return (
    <label className="field">
      <span>Lugar</span>
      <select className="input" value={value ?? ""} onChange={(e) => onChange((e.target.value || null) as HasPlace | null)}>
        <option value="">Sin especificar</option>
        {VALUES.map((v) => <option key={v} value={v}>{OWN_LABEL[v]}</option>)}
      </select>
    </label>
  );
}

/** Filtro de Gente: sin nada elegido no deja a nadie afuera. */
export function HasPlaceChips({ value, onChange }: { value: HasPlace[]; onChange: (v: HasPlace[]) => void }) {
  return (
    <fieldset className="field">
      <legend>Lugar</legend>
      <div className="chips">
        {VALUES.map((v) => {
          const on = value.includes(v);
          return (
            <button type="button" key={v} className={`chip ${on ? "chip--on" : ""}`} aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== v) : [...value, v])}>
              {HAS_PLACE_LABEL[v]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
