import mate from "../../brand/icono.svg";
import { photoAppear } from "./photoAppear";

/**
 * La imagen de un grupo: su foto si el dueño puso una, la inicial si no.
 * El chat general muestra el mate culo, el logo de la app.
 * `appear`: la foto entra con un fundido cuando termina de cargar (listas).
 */
export function GroupAvatar({ name, photo, general = false, size, appear = false }: {
  name: string;
  photo?: string | null;
  general?: boolean;
  size?: "sm" | "big";
  appear?: boolean;
}) {
  const cls = `gcard__icon${size ? ` gcard__icon--${size}` : ""}`;
  if (general) {
    return (
      <span className={`${cls} gcard__icon--logo`} aria-hidden>
        <img src={mate} alt="" />
      </span>
    );
  }
  if (photo && appear) {
    return <img className={`${cls} gcard__icon--photo ${photoAppear.className}`} src={photo} alt="" loading="lazy" ref={photoAppear.ref} onLoad={photoAppear.onLoad} />;
  }
  if (photo) return <img className={`${cls} gcard__icon--photo`} src={photo} alt="" loading="lazy" />;
  return <span className={cls} aria-hidden>{name.trim().charAt(0).toUpperCase()}</span>;
}
