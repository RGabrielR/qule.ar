import { MAX_SUSPENSION_AMOUNT, SUSPENSION_UNITS, type SuspensionDuration } from "@mortero/shared/suspension";

type DurationUnit = SuspensionDuration["unit"] | "permanent" | "";

export type DurationInput = { unit: DurationUnit; amount: string };
export const EMPTY_DURATION: DurationInput = { unit: "", amount: "1" };

/** undefined = falta una duración válida, null = permanente. */
export function parseSuspensionDuration({ unit, amount }: DurationInput): SuspensionDuration | null | undefined {
  if (unit === "permanent") return null;
  if (!unit) return undefined;
  const value = Number(amount);
  if (!Number.isInteger(value) || value < 1 || value > MAX_SUSPENSION_AMOUNT[unit]) return undefined;
  return { unit, amount: value };
}

const unitLabel = { hours: "Horas", days: "Días", months: "Meses" };

export function SuspensionDurationField({ value, onChange, disabled }: {
  value: DurationInput; onChange: (value: DurationInput) => void; disabled: boolean;
}) {
  const { unit, amount } = value;
  return (
    <>
      <label className="field">
        <span>Duración</span>
        <select className="input" value={unit} disabled={disabled}
          onChange={(e) => onChange({ unit: e.currentTarget.value as DurationUnit, amount })}>
          <option value="" disabled>Elegí la duración</option>
          {SUSPENSION_UNITS.map((item) => <option key={item} value={item}>{unitLabel[item]}</option>)}
          <option value="permanent">Permanente</option>
        </select>
      </label>
      {unit && unit !== "permanent" && (
        <label className="field">
          <span>Cantidad de {unitLabel[unit].toLowerCase()}</span>
          <input className="input" type="number" min={1} max={MAX_SUSPENSION_AMOUNT[unit]} step={1}
            value={amount} disabled={disabled} onChange={(e) => onChange({ unit, amount: e.currentTarget.value })} />
        </label>
      )}
    </>
  );
}
