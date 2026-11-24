import { useEffect, useId, useRef } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "../../components/Icons";
import type { ProfileSwipe } from "./useProfileSwipe";

/** Botones para pasar al perfil anterior o siguiente de la grilla. También se puede deslizar o usar las flechas. */
export function ProfileSwitcher({ swipe, className = "" }: { swipe: ProfileSwipe; className?: string }) {
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const describedBy = useId();
  const { current, prev, next, hasMore, loading, failed, position, total, focus, go } = swipe;
  const nextMissing = !next && !hasMore;

  // Si llegaste tocando un botón, el foco queda en el mismo botón del perfil nuevo.
  useEffect(() => {
    if (!focus) return;
    const wanted = focus === "prev" ? prevRef.current : nextRef.current;
    const other = focus === "prev" ? nextRef.current : prevRef.current;
    (wanted && !wanted.disabled ? wanted : other)?.focus({ preventScroll: true });
  }, [focus]);

  if (!current) return null;
  return (
    <nav className={`profile-switch ${className}`} aria-label="Perfiles de Gente">
      <p id={describedBy} className="sr-only">
        {`Estás viendo a ${current.name}, ${position} de ${total}${hasMore ? " por ahora" : ""}. También podés deslizar o usar las flechas.`}
      </p>
      <button
        ref={prevRef}
        className="iconbtn profile-switch__btn"
        disabled={!prev}
        onClick={() => void go(-1, "button")}
        aria-label={prev ? `Perfil anterior: ${prev.name}` : "No hay un perfil anterior"}
        aria-describedby={describedBy}
        title="Perfil anterior"
      >
        <ChevronLeftIcon />
      </button>
      <button
        ref={nextRef}
        className="iconbtn profile-switch__btn"
        disabled={nextMissing || (loading && !next)}
        aria-busy={loading && !next}
        onClick={() => void go(1, "button")}
        aria-label={next ? `Perfil siguiente: ${next.name}` : nextMissing ? "No hay más perfiles" : "Perfil siguiente"}
        aria-describedby={describedBy}
        title="Perfil siguiente"
      >
        <ChevronRightIcon />
      </button>
      <p className="sr-only" role="status">{failed ? "No pudimos traer más perfiles. Probá de nuevo." : loading && !next ? "Buscando más perfiles…" : ""}</p>
    </nav>
  );
}
