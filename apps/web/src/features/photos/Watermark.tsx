import { useEffect, useMemo } from "react";
import { useMe } from "../../App";

/**
 * Marca de agua con quién está mirando (idea de @Saantiames en la discusión #155).
 *
 * Una PWA no puede bloquear las capturas de pantalla: las saca el sistema, por fuera del navegador. Lo que sí podemos
 * hacer es que la captura lleve escrito quién la sacó. Así difundir una foto privada deja de ser gratis y, si se filtra,
 * se sabe de qué cuenta salió.
 *
 * Va encima de las fotos privadas ajenas: álbumes privados, fotos que te mandan por privado y temporales. Se dibuja
 * en el navegador, sin tocar la foto guardada ni el servidor. Lleva el nombre, un ID corto (el nombre se puede repetir
 * o cambiar) y la fecha y hora.
 */
export function Watermark() {
  const { me } = useMe();
  const label = useMemo(() => {
    if (!me) return null;
    const name = me.profile?.displayName || me.user.name;
    const when = new Date().toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    return <><bdi>{name}</bdi> · {me.user.id.slice(0, 8)} · {when}</>;
  }, [me]);
  if (!label) return null;
  return (
    <div className="watermark" aria-hidden="true">
      <div className="watermark__tile">
        {Array.from({ length: 48 }, (_, i) => <span key={i}>{label}</span>)}
      </div>
    </div>
  );
}

/**
 * Esconde las fotos privadas (las que tienen la clase `private-media`) cuando la app pierde el foco: al cambiar de
 * app, abrir el selector de apps (que guarda una imagen de la pantalla) o, en algunas compus, al usar la herramienta
 * de recorte. No impide una captura, pero evita las más fáciles. Se usa una sola vez, en App.
 */
export function useHidePrivateMediaWhenAway() {
  useEffect(() => {
    const root = document.documentElement;
    const set = (away: boolean) => root.classList.toggle("app-away", away);
    const onVisibility = () => set(document.visibilityState === "hidden");
    const away = () => set(true);
    const back = () => set(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", away);
    window.addEventListener("focus", back);
    window.addEventListener("pagehide", away);
    window.addEventListener("pageshow", back);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", away);
      window.removeEventListener("focus", back);
      window.removeEventListener("pagehide", away);
      window.removeEventListener("pageshow", back);
      set(false);
    };
  }, []);
}
