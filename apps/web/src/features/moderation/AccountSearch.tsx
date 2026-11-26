import { useState, type FormEvent } from "react";
import { api } from "../../api";

export type SanctionMatch = { id: string; name: string; suspendedAt: string | null };

/**
 * Buscar una cuenta por ID completo o por el código de ocho caracteres de la marca visible de una captura.
 * Es para quien tiene Suspensiones; la administración general tiene además la pestaña Personas.
 */
export function AccountSearch({ onSelect }: { onSelect: (account: SanctionMatch) => void }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [match, setMatch] = useState<SanctionMatch | null>(null);
  const valid = /^[a-zA-Z0-9_-]{8,64}$/.test(query.trim());

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    setMatch(null);
    try {
      const result = await api<{ account: SanctionMatch | null; ambiguous: boolean }>("/admin/accounts/search", { method: "POST", json: { query: query.trim() } });
      setMatch(result.account);
      if (result.ambiguous) setStatus("Este código coincide con más de una cuenta. Buscá por ID completo.");
      else if (!result.account) setStatus("No encontramos ninguna cuenta.");
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
          <span>ID de la cuenta o código de la captura</span>
          <input className="input" value={query} maxLength={64} disabled={busy}
            onChange={(event) => { setQuery(event.target.value); setMatch(null); setStatus(""); setError(""); }}
            autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </label>
        <button className="btn" disabled={!valid || busy}>{busy ? "Buscando…" : "Buscar cuenta"}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {status && <p className="muted small" role="status">{status}</p>}
      {match && (
        <div className="rcard">
          <p><b><bdi>{match.name}</bdi></b></p>
          <p className="muted small admin-account-detail">ID {match.id}</p>
          {match.suspendedAt ? <p className="small">Cuenta suspendida</p>
            : <button className="btn btn--small btn--danger" onClick={() => onSelect(match)}>Suspender cuenta</button>}
        </div>
      )}
    </div>
  );
}
