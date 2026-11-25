import { useLayoutEffect, useRef } from "react";
import { CloseIcon } from "../../components/Icons";
import { Watermark } from "../photos/Watermark";

/** Visor de una foto del chat privado. `watermark`: la foto te la mandaron (lleva la marca de quién mira). */
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
          <img src={src} alt="Foto del chat" />
        </div>
        {watermark && <Watermark />}
      </div>
    </dialog>
  );
}
