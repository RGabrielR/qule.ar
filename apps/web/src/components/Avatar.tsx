import { photoAppear } from "./photoAppear";

/** `appear`: la foto entra con un fundido cuando termina de cargar (listas que se cargan de a tandas). */
export function Avatar({ src, name, size = 40, appear = false }: { src: string | null; name: string; size?: number; appear?: boolean }) {
  return src ? (
    <img
      className={`avatar ${appear ? photoAppear.className : ""}`} src={src} alt="" width={size} height={size} style={{ width: size, height: size }}
      ref={appear ? photoAppear.ref : undefined} onLoad={appear ? photoAppear.onLoad : undefined}
    />
  ) : (
    <span className="avatar avatar--empty" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
