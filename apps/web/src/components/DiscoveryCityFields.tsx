import { DISCOVERY_COUNTRIES, DISCOVERY_NAMES, type DiscoveryCountry } from "../../../../packages/geo/discovery";

export type CityFields = { country: DiscoveryCountry | ""; city: string };

export function DiscoveryCityFields({ value, onChange, empty }: {
  value: CityFields; onChange: (value: CityFields) => void; empty: string;
}) {
  return (
    <div className="grid2">
      <label className="field">
        <span>País</span>
        <select className="input" value={value.country} onChange={(e) => {
          const country = DISCOVERY_COUNTRIES.find((code) => code === e.target.value) ?? "";
          onChange({ country, city: "" });
        }}>
          <option value="">{empty}</option>
          {DISCOVERY_COUNTRIES.map((code) => <option key={code} value={code}>{DISCOVERY_NAMES[code]}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Ciudad</span>
        <input className="input" value={value.city} maxLength={60} disabled={!value.country}
          onChange={(e) => onChange({ ...value, city: e.target.value })} />
      </label>
    </div>
  );
}
