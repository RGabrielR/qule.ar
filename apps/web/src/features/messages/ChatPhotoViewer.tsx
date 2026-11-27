import { useLayoutEffect, useRef } from "react";
import { CloseIcon } from "../../components/Icons";

/** Visor de una foto del chat. `watermark`: la foto te la mandaron (el servidor ya le escribió quién la mira). */
export function ChatPhotoViewer({ src, onClose, watermark = false }: { src: string; onClose: () => void; watermark?: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
  }, []);

  return (
    <dialog ref={dialogRef} className={`lightbox chat-photo-viewer${watermark ? " private-media" : ""}`} aria-label="Foto del chat" onClose={onClose}>
      <header className="lightbox__bar">
        <span>Foto del chat</span>
        <button type="button" className="iconbtn" aria-label="Cerrar foto" onClick={() => dialogRef.current?.close()}>
          <CloseIcon />
        </button>
      </header>
      <div className="lightbox__stage">
        <div className="lightbox__slide">
          {/* La foto ajena ya trae escrito quién la mira (lo hace el servidor) */}
          <img src={src} alt="Foto del chat" draggable={false} onContextMenu={watermark ? (e) => e.preventDefault() : undefined} />
        </div>
      </div>
    </dialog>
  );
}
