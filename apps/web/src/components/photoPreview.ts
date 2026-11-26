import type { CSSProperties, SyntheticEvent } from "react";

/**
 * "Blur-up" para las grillas de fotos: la primera vez que una foto carga se guarda una versión de 8×8 píxeles
 * (unos cientos de bytes). Cuando la grilla se vuelve a mostrar, cada ficha pinta al instante esa versión
 * borrosa con los colores de la foto y la foto nítida aparece encima con un fundido, sin cuadros vacíos.
 */
const previews = new Map<string, string>();
const LIMIT = 400;
const SIZE = 8;

function remember(src: string, img: HTMLImageElement) {
  if (previews.has(src) || !img.naturalWidth) return;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    previews.set(src, canvas.toDataURL());
    if (previews.size > LIMIT) previews.delete(previews.keys().next().value!);
  } catch {
    // Una foto de otro origen no se puede leer: queda sin vista previa
  }
}

/** Fondo de la ficha con la vista previa borrosa, si ya se vio esa foto. */
export function previewStyle(src: string | null | undefined): CSSProperties | undefined {
  const preview = src ? previews.get(src) : undefined;
  return preview ? { backgroundImage: `url("${preview}")` } : undefined;
}

/**
 * Props de la foto de una ficha: entra con un fundido al cargar (sin fundido si ya estaba lista) y guarda su
 * vista previa para la próxima vez.
 */
export function gridPhoto(src: string) {
  return {
    src,
    className: "photo-appear",
    ref: (img: HTMLImageElement | null) => {
      // Una foto que falló también figura como "completa": esa queda oculta y se ve la vista previa
      if (!img?.complete || !img.naturalWidth) return;
      img.dataset.loaded = "";
      remember(src, img);
    },
    onLoad: (event: SyntheticEvent<HTMLImageElement>) => {
      event.currentTarget.dataset.loaded = "";
      remember(src, event.currentTarget);
    },
  };
}
