import { useEffect, useRef, useState, type TouchEvent } from "react";
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

type Gesture = { x: number; y: number; at: number; width: number; horizontal: boolean };

/**
 * Visor del álbum a pantalla completa: fotos y videos, con flechas, teclado y arrastre horizontal.
 * Mientras se arrastra, la foto sigue al dedo; al soltar, cambia si pasó el umbral o si fue un flick.
 * Las fotos de al lado se cargan de antemano para que el cambio no parpadee.
 * No se puede evitar una captura de pantalla, pero al menos no se ofrece descargar.
 */
export function AlbumViewer({ items, start = 0, title, onClose }: { items: Media[]; start?: number; title?: string; onClose: () => void }) {
  const n = items.length;
  const [i, setI] = useState(Math.max(0, Math.min(start, n - 1)));
  const [drag, setDrag] = useState(0);
  const [sliding, setSliding] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const committed = useRef<0 | 1 | -1>(0);
  const animating = useRef(false);
  const settleTimer = useRef<number | undefined>(undefined);

  const clamp = (x: number) => Math.min(n - 1, Math.max(0, x));

  function animate(on: boolean) {
    animating.current = on;
    setSliding(on);
  }

  function finishSnap() {
    if (!animating.current) return;
    if (settleTimer.current !== undefined) {
      window.clearTimeout(settleTimer.current);
      settleTimer.current = undefined;
    }
    const d = committed.current;
    committed.current = 0;
    animate(false);
    setDrag(0);
    if (d) setI((x) => clamp(x + d));
  }

  /** Lleva la tira a la foto siguiente/anterior, o la devuelve al lugar si no hubo swipe. */
  function settle(d: 0 | 1 | -1, width: number) {
    if (settleTimer.current !== undefined) {
      window.clearTimeout(settleTimer.current);
      settleTimer.current = undefined;
    }
    if (!d || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      committed.current = 0;
      animate(false);
      setDrag(0);
      if (d) setI((x) => clamp(x + d));
      return;
    }
    committed.current = d;
    animate(true);
    setDrag(d === 1 ? -Math.max(1, width) : Math.max(1, width));
    settleTimer.current = window.setTimeout(finishSnap, 260);
  }

  function go(d: number) {
    if (animating.current) return;
    setDrag(0);
    setI((x) => clamp(x + d));
  }

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
  }, [n, onClose]);

  useEffect(() => () => {
    if (settleTimer.current !== undefined) window.clearTimeout(settleTimer.current);
  }, []);

  function onTouchStart(e: TouchEvent<HTMLDivElement>) {
    if (n < 2 || animating.current || e.touches.length !== 1) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.closest("button, a, input, [role=button]")) return;
    const t = e.touches[0];
    const video = target.closest("video");
    // Abajo del video están los controles nativos: ahí manda el video, no el swipe.
    if (video) {
      const r = video.getBoundingClientRect();
      if (t.clientY > r.bottom - 52) return;
    }
    gesture.current = {
      x: t.clientX,
      y: t.clientY,
      at: performance.now(),
      width: e.currentTarget.clientWidth || window.innerWidth,
      horizontal: false,
    };
  }

  function onTouchMove(e: TouchEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g) return;
    if (e.touches.length !== 1) {
      gesture.current = null;
      setDrag(0);
      return;
    }
    const t = e.touches[0];
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (!g.horizontal) {
      // Si el gesto arranca vertical, se lo dejamos a la página: no cambiamos de foto.
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        gesture.current = null;
        setDrag(0);
        return;
      }
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      g.horizontal = true;
    }
    const atEdge = (i === 0 && dx > 0) || (i === n - 1 && dx < 0);
    setDrag(atEdge ? dx * 0.3 : dx);
  }

  function onTouchEnd(e: TouchEvent<HTMLDivElement>) {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.horizontal) {
      if (drag) setDrag(0);
      return;
    }
    const t = e.changedTouches[0];
    if (!t) return settle(0, g.width);
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    const dt = Math.max(1, performance.now() - g.at);
    const speed = Math.abs(dx) / dt; // px por ms
    const step = dx < 0 ? 1 : -1;
    const target = i + step;
    const canGo = target >= 0 && target < n;
    const distance = Math.min(90, g.width * 0.18);
    const passed = Math.abs(dx) >= distance || speed >= 0.35;
    settle(canGo && Math.abs(dx) > Math.abs(dy) && passed ? step : 0, g.width);
  }

  function onTouchCancel() {
    const g = gesture.current;
    gesture.current = null;
    if (g?.horizontal) settle(0, g.width);
    else setDrag(0);
  }

  if (!n) return null;
  const dragCss = `calc(${-i * 100}% ${drag < 0 ? "-" : "+"} ${Math.abs(drag)}px)`;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={title ?? "Álbum"} onContextMenu={(e) => e.preventDefault()}>
      <header className="lightbox__bar">
        <span>{title}{n > 1 && <span className="muted"> · {i + 1} de {n}</span>}</span>
        <button className="iconbtn" onClick={onClose} aria-label="Cerrar">✕</button>
      </header>
      <div
        className="lightbox__stage"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        <div
          ref={track}
          className={`lightbox__track${sliding ? " lightbox__track--animate" : ""}`}
          style={{ transform: `translate3d(${dragCss}, 0, 0)` }}
          onTransitionEnd={(e) => {
            if (e.target === track.current && e.propertyName === "transform") finishSnap();
          }}
        >
          {items.map((item, idx) => {
            const current = idx === i;
            const near = Math.abs(idx - i) <= 1;
            return (
              <div className="lightbox__slide" key={`${item.url}-${idx}`} style={{ left: `${idx * 100}%` }} aria-hidden={!current}>
                {item.kind === "video" ? (
                  current ? (
                    <video
                      key={item.url}
                      src={item.url}
                      poster={item.thumb ?? undefined}
                      controls
                      autoPlay
                      playsInline
                      controlsList="nodownload noremoteplayback"
                      disablePictureInPicture
                    />
                  ) : near && item.thumb ? (
                    <img src={item.thumb} alt="" draggable={false} />
                  ) : null
                ) : near ? (
                  <img src={item.url} alt={current ? `Foto ${idx + 1} de ${n}` : ""} draggable={false} />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {i > 0 && (
        <button className="lightbox__nav lightbox__nav--prev" onClick={() => go(-1)} aria-label="Anterior">‹</button>
      )}
      {i < n - 1 && (
        <button className="lightbox__nav lightbox__nav--next" onClick={() => go(1)} aria-label="Siguiente">›</button>
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
