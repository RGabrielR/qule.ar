/** Marca la foto como cargada; si ya estaba en caché, aparece sin fundido. */
const markLoaded = (img: HTMLImageElement | null) => {
  if (img?.complete) img.dataset.loaded = "";
};

/** `appear`: la foto entra con un fundido cuando termina de cargar (listas que se cargan de a tandas). */
export function Avatar({ src, name, size = 40, appear = false }: { src: string | null; name: string; size?: number; appear?: boolean }) {
  return src ? (
    <img
      className={`avatar ${appear ? "avatar--appear" : ""}`} src={src} alt="" width={size} height={size} style={{ width: size, height: size }}
      ref={appear ? markLoaded : undefined} onLoad={appear ? (e) => { e.currentTarget.dataset.loaded = ""; } : undefined}
    />
  ) : (
    <span className="avatar avatar--empty" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>
      <bdi>{name.trim().charAt(0).toUpperCase() || "?"}</bdi>
    </span>
  );
}
