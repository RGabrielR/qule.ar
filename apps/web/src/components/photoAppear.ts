import type { SyntheticEvent } from "react";

/** Si la foto ya estaba en caché cuando se montó, se marca de entrada y aparece sin fundido. */
function markIfComplete(img: HTMLImageElement | null) {
  // Una foto que falló también figura como "completa": esa no se marca
  if (img?.complete && img.naturalWidth) img.dataset.loaded = "";
}

function markLoaded(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.dataset.loaded = "";
}

/**
 * Props para una foto que entra con un fundido cuando termina de cargar (`.photo-appear` en styles.css).
 * Se suman a la clase propia de la foto: `<img className={`tile__photo ${photoAppear.className}`} … />`.
 */
export const photoAppear = { className: "photo-appear", ref: markIfComplete, onLoad: markLoaded } as const;
