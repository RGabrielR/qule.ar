import { useState } from "react";
import { CloseIcon, PollIcon } from "../../components/Icons";
import { DialogFocus } from "../../components/DialogFocus";
import { POLL_MAX_OPTIONS, POLL_MIN_OPTIONS, POLL_OPTION_MAX, POLL_QUESTION_MAX } from "./polls";

/** Botón del composer del grupo para abrir una encuesta. */
export function CreatePollButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="iconbtn" aria-label="Crear encuesta" disabled={disabled} onClick={onClick}>
      <PollIcon />
    </button>
  );
}

/**
 * Hoja para crear una encuesta: una pregunta y entre 2 y 5 opciones.
 * Sale como cualquier mensaje del grupo: si te toca esperar, queda en cola.
 */
export function CreatePollDialog({ groupName, onCreate, onClose }: {
  groupName: string;
  onCreate: (question: string, options: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [state, setState] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);

  const filled = options.map((o) => o.trim());
  const repeated = new Set(filled.map((o) => o.toLocaleLowerCase("es-AR"))).size !== filled.length;
  const ready = question.trim().length > 0 && filled.every(Boolean) && !repeated;

  function setOption(i: number, value: string) {
    setOptions((list) => list.map((o, j) => (j === i ? value : o)));
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || state === "sending") return;
    setState("sending");
    setError(null);
    try {
      await onCreate(question.trim(), filled);
      onClose();
    } catch (err) {
      setError((err as Error).message || "No se pudo publicar la encuesta. Probá de nuevo.");
      setState("idle");
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet poll-form" role="dialog" aria-modal aria-labelledby="poll-title" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <DialogFocus onClose={onClose} />
        <h2 id="poll-title">Nueva encuesta en #{groupName}</h2>
        <label className="field">
          <span>Pregunta</span>
          <input className="input" maxLength={POLL_QUESTION_MAX} placeholder="¿Cuándo hacemos la próxima juntada?"
            value={question} onChange={(e) => { setQuestion(e.target.value); setError(null); }} />
        </label>
        <fieldset className="field">
          <legend>Opciones</legend>
          <ol className="poll-form__options">
            {options.map((o, i) => (
              <li key={i}>
                <input className="input" aria-label={`Opción ${i + 1}`} maxLength={POLL_OPTION_MAX} value={o}
                  onChange={(e) => setOption(i, e.target.value)} />
                {options.length > POLL_MIN_OPTIONS && (
                  <button type="button" className="iconbtn" aria-label={`Sacar la opción ${i + 1}`}
                    onClick={() => setOptions((list) => list.filter((_, j) => j !== i))}>
                    <CloseIcon />
                  </button>
                )}
              </li>
            ))}
          </ol>
          {options.length < POLL_MAX_OPTIONS && (
            <button type="button" className="linkbtn poll-form__add" onClick={() => setOptions((list) => [...list, ""])}>
              Sumar una opción
            </button>
          )}
        </fieldset>
        <p className="small muted">Cada miembro vota una vez y puede cambiar su voto. Solo se ven los totales.</p>
        {repeated && filled.every(Boolean) && <p className="error">Hay opciones repetidas.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={!ready || state === "sending"}>
            {state === "sending" ? "Publicando…" : "Publicar"}
          </button>
        </div>
      </form>
    </div>
  );
}
