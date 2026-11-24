import { useState } from "react";
import { DialogFocus } from "../../components/DialogFocus";

export function ConversationActionDialog({ action, name, onConfirm, onClose }: {
  action: "remove" | "block";
  name?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const blocking = action === "block";
  const close = () => { if (!pending) onClose(); };

  async function confirm() {
    setPending(true);
    setError(false);
    try {
      await onConfirm();
      onClose();
    } catch {
      setError(true);
      setPending(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={close}>
      <div className="sheet" role="dialog" aria-modal aria-labelledby="chat-action-title" onClick={(event) => event.stopPropagation()}>
        <DialogFocus onClose={close} />
        <h2 id="chat-action-title">{blocking ? `¿Bloquear a ${name}?` : "¿Eliminar este chat?"}</h2>
        <p className="muted">
          {blocking
            ? "El bloqueo impide que se vean o se escriban y oculta sus mensajes en los grupos."
            : "El historial desaparece de tu cuenta. La otra persona conserva su copia. Si vuelven a escribirse, vas a ver los mensajes nuevos."}
        </p>
        {error && <p className="error" role="alert">{blocking ? "No se pudo bloquear." : "No se pudo eliminar el chat."} Probá de nuevo.</p>}
        <div className="row">
          <button className="btn" disabled={pending} onClick={close}>Cancelar</button>
          <button className="btn btn--danger" disabled={pending} onClick={confirm}>{blocking ? "Bloquear" : "Eliminar chat"}</button>
        </div>
      </div>
    </div>
  );
}
