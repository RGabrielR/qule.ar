import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ApiError } from "../api";

const PREVIEW_WIDTH = 320;
const PREVIEW_HEIGHT = 400;
const ASPECT_RATIO = PREVIEW_WIDTH / PREVIEW_HEIGHT;
const MAX_OUTPUT_HEIGHT = 1200;

type View = { x: number; y: number; zoom: number };
type Crop = { x: number; y: number; width: number; height: number };
type Props = {
  file: File;
  number: number;
  total: number;
  isPrivate: boolean;
  onSkip: () => void;
  onUpload: (file: File) => Promise<void>;
};

function clamp(value: number, max: number) {
  return Math.max(0, Math.min(value, max));
}

function getCrop(image: HTMLImageElement, { x, y, zoom }: View): Crop {
  const width = Math.min(image.naturalWidth, image.naturalHeight * ASPECT_RATIO) / zoom;
  const height = width / ASPECT_RATIO;
  return {
    x: clamp(x * image.naturalWidth - width / 2, image.naturalWidth - width),
    y: clamp(y * image.naturalHeight - height / 2, image.naturalHeight - height),
    width,
    height,
  };
}

function drawCrop(canvas: HTMLCanvasElement, image: HTMLImageElement, crop: Crop) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No pudimos preparar la foto.");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
}

async function exportCrop(image: HTMLImageElement, crop: Crop, originalName: string) {
  const canvas = document.createElement("canvas");
  const units = Math.max(1, Math.floor(Math.min(crop.height, MAX_OUTPUT_HEIGHT) / 5));
  canvas.width = units * 4;
  canvas.height = units * 5;
  drawCrop(canvas, image, crop);
  // PNG evita comprimir dos veces: el servidor guarda el resultado en WebP.
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("No pudimos preparar la foto."));
    });
  });
  return new File([blob], `${originalName.replace(/\.[^.]+$/, "")}.png`, { type: blob.type });
}

const KEY_MOVES: Record<string, [number, number]> = {
  ArrowLeft: [-0.04, 0],
  ArrowRight: [0.04, 0],
  ArrowUp: [0, -0.04],
  ArrowDown: [0, 0.04],
};

export function PhotoCrop({ file, number, total, isPrivate, onSkip, onUpload }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [view, setView] = useState<View>({ x: 0.5, y: 0.5, zoom: 1 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const source = new Image();
    source.onload = () => setImage(source);
    source.onerror = () => setError("No pudimos leer esta imagen. Probá con otra.");
    source.src = url;
    return () => {
      source.onload = null;
      source.onerror = null;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    if (!image || !previewRef.current) return;
    try {
      drawCrop(previewRef.current, image, getCrop(image, view));
    } catch {
      setImage(null);
      setError("No pudimos mostrar esta imagen. Probá con otra.");
    }
  }, [image, view]);

  function movePhoto(dx: number, dy: number) {
    if (!image || busy) return;
    setView((current) => {
      const crop = getCrop(image, current);
      const x = clamp(crop.x - dx * crop.width, image.naturalWidth - crop.width);
      const y = clamp(crop.y - dy * crop.height, image.naturalHeight - crop.height);
      return {
        ...current,
        x: (x + crop.width / 2) / image.naturalWidth,
        y: (y + crop.height / 2) / image.naturalHeight,
      };
    });
  }

  function startDrag(event: PointerEvent<HTMLCanvasElement>) {
    if (!image || busy || !event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function drag(event: PointerEvent<HTMLCanvasElement>) {
    const start = pointer.current;
    if (!start || start.id !== event.pointerId) return;
    const frame = event.currentTarget.getBoundingClientRect();
    movePhoto((event.clientX - start.x) / frame.width, (event.clientY - start.y) / frame.height);
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function moveWithKeys(event: KeyboardEvent<HTMLCanvasElement>) {
    const move = KEY_MOVES[event.key];
    if (!move) return;
    event.preventDefault();
    movePhoto(...move);
  }

  async function confirm() {
    if (!image || busy) return;
    setBusy(true);
    setError("");
    try {
      const cropped = await exportCrop(image, getCrop(image, view), file.name);
      if (dialogRef.current?.open) await onUpload(cropped);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo subir la foto. Probá de nuevo.");
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="photo-crop"
      aria-labelledby="photo-crop-title"
      onCancel={(e) => { e.preventDefault(); if (!busy) onSkip(); }}
    >
      <header className="photo-crop__head">
        <h2 id="photo-crop-title">Recortá la foto</h2>
        {total > 1 && <span className="muted small">{number} de {total}</span>}
      </header>
      <canvas
        ref={previewRef}
        className="photo-crop__preview"
        width={PREVIEW_WIDTH}
        height={PREVIEW_HEIGHT}
        tabIndex={0}
        aria-label="Encuadre de la foto"
        aria-describedby="photo-crop-help"
        onKeyDown={moveWithKeys}
        onPointerDown={startDrag}
        onPointerMove={drag}
        onLostPointerCapture={() => { pointer.current = null; }}
      />
      <p id="photo-crop-help" className="muted small">Arrastrá la foto o movela con las flechas.</p>
      <label className="photo-crop__zoom">
        <span>Zoom</span>
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={view.zoom}
          disabled={!image || busy}
          onChange={(e) => {
            const zoom = e.currentTarget.valueAsNumber;
            setView((current) => ({ ...current, zoom }));
          }}
        />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button type="button" className="btn btn--ghost" onClick={onSkip} disabled={busy}>
          {total > 1 ? "Omitir foto" : "Cancelar"}
        </button>
        <button type="button" className="btn btn--primary" onClick={confirm} disabled={!image || busy}>
          {busy ? "Subiendo…" : isPrivate ? "Subir al álbum" : "Subir foto"}
        </button>
      </div>
    </dialog>
  );
}
