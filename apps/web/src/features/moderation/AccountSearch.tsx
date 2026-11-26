import { useState, type FormEvent } from "react";
import { api } from "../../api";

export type AccountMatch = { id: string; name: string };
type TeamMatch = AccountMatch & { email: string; owner: boolean };
export type SanctionMatch = AccountMatch & { suspendedAt: string | null };

export function AccountSearch(props:
  | { mode: "team"; disabled?: boolean; onSelect: (account: TeamMatch | null) => void }
  | { mode: "sanctions"; disabled?: boolean; onSelect: (account: SanctionMatch) => void }
) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [matches, setMatches] = useState<TeamMatch[]>([]);
  const [match, setMatch] = useState<SanctionMatch | null>(null);
  const team = props.mode === "team";
  const valid = team ? query.trim().length >= 3 : /^[a-zA-Z0-9_-]{8,64}$/.test(query.trim());

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || busy || props.disabled) return;
    setBusy(true);
    setError("");
    setStatus("");
    setMatches([]);
    setMatch(null);
    if (props.mode === "team") props.onSelect(null);
    try {
      const input = { method: "POST", json: { query: query.trim() } };
      if (team) {
        const result = await api<{ accounts: TeamMatch[]; more: boolean }>("/admin/team/search", input);
        setMatches(result.accounts);
        if (result.more) setStatus("Hay más resultados. Afiná la búsqueda.");
        if (!result.accounts.length) setStatus("No encontramos ninguna cuenta.");
      } else {
        const result = await api<{ account: SanctionMatch | null; ambiguous: boolean }>("/admin/accounts/search", input);
        setMatch(result.account);
        if (result.ambiguous) setStatus("Este código coincide con más de una cuenta. Buscá por ID completo.");
        else if (!result.account) setStatus("No encontramos ninguna cuenta.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <form className="stack" onSubmit={search}>
        <label className="field">
          <span>{team ? "Mail, nombre de perfil o ID" : "ID de la cuenta o código de la captura"}</span>
          <input className="input" value={query} maxLength={team ? 200 : 64} disabled={busy || props.disabled}
            onChange={(event) => {
              setQuery(event.target.value);
              setMatches([]);
              setMatch(null);
              setStatus("");
              setError("");
              if (props.mode === "team") props.onSelect(null);
            }} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </label>
        <button className="btn" disabled={!valid || busy || props.disabled}>{busy ? "Buscando…" : "Buscar cuenta"}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {status && <p className="muted small" role="status">{status}</p>}
      {props.mode === "team" && matches.length > 0 && (
        <ul className="reports">
          {matches.map((account) => (
            <li key={account.id} className="rcard">
              <p><b>{account.name}</b></p>
              <p className="muted small admin-account-detail">{account.email} · {account.id}</p>
              {account.owner ? <p className="small">Administración general</p>
                : <button className="btn btn--small" disabled={props.disabled} onClick={() => props.onSelect(account)}>Elegir a {account.name}</button>}
            </li>
          ))}
        </ul>
      )}
      {props.mode === "sanctions" && match && (
        <div className="rcard">
          <p><b>{match.name}</b></p>
          <p className="muted small admin-account-detail">ID {match.id}</p>
          {match.suspendedAt ? <p className="small">Cuenta suspendida</p>
            : <button className="btn btn--small btn--danger" onClick={() => props.onSelect(match)}>Suspender cuenta</button>}
        </div>
      )}
    </div>
  );
}
