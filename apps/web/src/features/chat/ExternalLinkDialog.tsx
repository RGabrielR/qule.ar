import { useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { APP_NAME } from "../../brand";

export function ExternalLinkDialog({ destination, onClose }: { destination: URL; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="external-link-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId}>Abrir enlace externo</h2>
      <p id={descriptionId}>
        Vas a salir de {APP_NAME} a <strong><bdi dir="ltr">{destination.host}</bdi></strong>.
      </p>
      <div className="row">
        <button className="btn" type="button" onClick={onClose}>Cancelar</button>
        <button
          className="btn btn--primary"
          type="button"
          onClick={() => {
            window.open(destination.href, "_blank", "noopener,noreferrer");
            onClose();
          }}
        >
          Continuar
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
