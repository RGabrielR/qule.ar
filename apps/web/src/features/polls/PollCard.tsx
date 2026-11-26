import type { Poll } from "../../api";
import { CheckIcon } from "../../components/Icons";
import { percent, votesLabel } from "./polls";

/**
 * Encuesta dentro del chat del grupo. Se elige una opción tocándola; tocar otra cambia el voto.
 * Solo se ven los totales: nunca quién votó qué. En cola todavía no se puede votar.
 */
export function PollCard({ question, poll, canVote, onVote }: {
  question: string;
  poll: Poll;
  canVote: boolean;
  onVote: (option: number | null) => void;
}) {
  const mine = poll.myVote ?? null;
  return (
    <div className="poll" role="group" aria-label={`Encuesta: ${question}`}>
      <p className="poll__label">Encuesta</p>
      <p className="poll__question">{question}</p>
      <ul className="poll__options">
        {poll.options.map((option, i) => {
          const n = poll.counts[i] ?? 0;
          const pct = percent(n, poll.total);
          const chosen = mine === i;
          return (
            <li key={i}>
              <button
                type="button"
                className={`poll__option ${chosen ? "poll__option--mine" : ""}`}
                aria-pressed={chosen}
                aria-label={`${option}: ${votesLabel(n)}${chosen ? ", tu voto" : ""}`}
                disabled={!canVote}
                onClick={() => onVote(i)}
              >
                {/* El ancho de la barra se calcula con los votos */}
                <span className="poll__bar" style={{ width: `${pct}%` }} aria-hidden="true" />
                <span className="poll__text">
                  {chosen && <CheckIcon />}
                  <span className="poll__option-name">{option}</span>
                </span>
                <span className="poll__count" aria-hidden="true">{pct} %</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="poll__footer">
        <span>{votesLabel(poll.total)} · nadie ve quién votó qué</span>
        {canVote && mine !== null && (
          <button type="button" className="linkbtn" onClick={() => onVote(null)}>Sacar mi voto</button>
        )}
      </div>
    </div>
  );
}
