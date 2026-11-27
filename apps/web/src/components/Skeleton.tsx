import type { ReactNode } from "react";

/*
 * Esqueletos: la forma de lo que va a llegar, mientras se espera la primera respuesta (ver "Movimiento" en docs/LOOK.md).
 * Aparecen recién si la espera pasa de un instante (así una respuesta rápida no hace parpadear nada) y laten despacio.
 * Tienen el mismo alto que el contenido real, para que no salte nada cuando llega.
 */

/** Una pieza suelta (botón, chip, foto…). La forma y el tamaño los pone `className`. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden />;
}

/** Contenedor de una espera: avisa "Cargando…" a los lectores de pantalla y hace el fundido de entrada. */
export function SkeletonWait({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`skeleton-wait ${className}`} role="status">
      <span className="sr-only">Cargando…</span>
      <div className="skeleton-wait__shapes" aria-hidden>{children}</div>
    </div>
  );
}

/** Líneas de texto; la última más corta, como un párrafo. */
export function SkeletonText({ lines = 2 }: { lines?: number }) {
  return (
    <span className="skeleton-text">
      {Array.from({ length: lines }, (_, i) => <span key={i} className="skeleton skeleton-line" />)}
    </span>
  );
}

/**
 * Filas de una lista: foto (redonda o cuadrada) y líneas de texto. `flush`: sin margen propio, para listas que
 * ya están dentro de una sección con padding (los miembros de un grupo).
 */
export function SkeletonRows({ count = 6, avatar, square = false, lines = 2, flush = false, className = "" }: {
  count?: number; avatar?: number; square?: boolean; lines?: number; flush?: boolean; className?: string;
}) {
  return (
    <SkeletonWait className={`skeleton-rows ${flush ? "skeleton-rows--flush" : ""} ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-row">
          {avatar != null && (
            <span className={`skeleton ${square ? "skeleton--square" : "skeleton--round"}`} style={{ width: avatar, height: avatar }} />
          )}
          <SkeletonText lines={lines} />
        </div>
      ))}
    </SkeletonWait>
  );
}

/** La grilla de fotos de Gente, Visitas, Favoritos y Toques. */
export function SkeletonGrid({ count = 18, className = "" }: { count?: number; className?: string }) {
  return (
    <SkeletonWait className={`grid ${className}`}>
      {Array.from({ length: count }, (_, i) => <span key={i} className="skeleton skeleton-tile" />)}
    </SkeletonWait>
  );
}
