import { useEffect, useRef, useState } from "react";
import type { Media } from "../api";

/** "por 3 h más", "hasta el lunes 14:30", etc. Para mostrar cuánto falta para que venza un acceso. */
export function untilLabel(iso: string | null) {
  if (!iso) return "sin límite";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "vencido";
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `${min} min más`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h más`;
  return `hasta el ${new Date(iso).toLocaleDateString("es-AR", { weekday: "long", day: "numeric" })}`;
}

export function duration(seconds: number | null) {
  if (seconds == null) return "";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Visor del álbum a pantalla completa: fotos y videos, con flechas, teclado y deslizar con el dedo.
 * No se puede evitar una captura de pantalla, pero al menos no se ofrece descargar.
 */
export function AlbumViewer({ items, start = 0, title, onClose }: { items: Media[]; start?: number; title?: string; onClose: () => void }) {
  const [i, setI] = useState(Math.min(start, items.length - 1));
  const touch = useRef<number | null>(null);
  const n = items.length;
  const go = (d: number) => setI((x) => (x + d + n) % n);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  if (!n) return null;
  const m = items[i];
  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? "Álbum"}
      onContextMenu={(e) => e.preventDefault()}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current == null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}
    >
      <header className="lightbox__bar">
        <span>{title}{n > 1 && <span className="muted"> · {i + 1} de {n}</span>}</span>
        <button className="iconbtn" onClick={onClose} aria-label="Cerrar">✕</button>
      </header>
      <div className="lightbox__stage">
        {m.kind === "video" ? (
          <video
            key={m.url}
            src={m.url}
            poster={m.thumb ?? undefined}
            controls
            autoPlay
            playsInline
            controlsList="nodownload noremoteplayback"
            disablePictureInPicture
          />
        ) : (
          <img key={m.url} src={m.url} alt={`Foto ${i + 1} de ${n}`} draggable={false} />
        )}
      </div>
      {n > 1 && (
        <>
          <button className="lightbox__nav lightbox__nav--prev" onClick={() => go(-1)} aria-label="Anterior">‹</button>
          <button className="lightbox__nav lightbox__nav--next" onClick={() => go(1)} aria-label="Siguiente">›</button>
        </>
      )}
    </div>
  );
}

/** Grilla de miniaturas del álbum (los videos llevan un ▶ y la duración). */
export function AlbumGrid({ items, onOpen }: { items: Media[]; onOpen: (i: number) => void }) {
  return (
    <div className="album__grid">
      {items.map((m, i) => (
        <button key={m.url} className="album__cell" onClick={() => onOpen(i)} aria-label={`${m.kind === "video" ? "Video" : "Foto"} ${i + 1}`}>
          {m.thumb ? <img src={m.thumb} alt="" loading="lazy" draggable={false} /> : <span className="album__nothumb" />}
          {m.kind === "video" && <span className="album__play">▶ {duration(m.seconds)}</span>}
        </button>
      ))}
    </div>
  );
}

export function albumCount(total: number, videos: number) {
  const photos = total - videos;
  const parts = [];
  if (photos) parts.push(`${photos} ${photos === 1 ? "foto" : "fotos"}`);
  if (videos) parts.push(`${videos} ${videos === 1 ? "video" : "videos"}`);
  return parts.join(" y ");
}
