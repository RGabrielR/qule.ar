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
      onClose={(event) => { if (!event.currentTarget.open) onClose(); }}
    >
      <h2 id={titleId}>Abrir enlace externo</h2>
      <p id={descriptionId}>
        Vas a salir de {APP_NAME} a <strong><bdi dir="ltr">{destination.host}</bdi></strong>.
      </p>
      <form method="dialog" className="row">
        <button className="btn" type="submit">Cancelar</button>
        <a
          className="btn btn--primary"
          href={destination.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => dialogRef.current?.close()}
        >
          Continuar
        </a>
      </form>
    </dialog>,
    document.body,
  );
}
