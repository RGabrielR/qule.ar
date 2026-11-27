import { EyeOffIcon } from "../../components/Icons";

/**
 * Fotos explícitas tapadas (discusión #255). Un modelo que corre en nuestro servidor marca las fotos con genitales
 * o culo al descubierto; quien eligió taparlas (Configuración → Fotos) las ve borrosas en la grilla y en los
 * perfiles. La marca no ordena, no filtra y no sanciona: solo tapa.
 */

/** Sobre la foto tapada de un perfil: qué es y el botón para verla igual. */
export function ExplicitVeil({ onReveal }: { onReveal: () => void }) {
  return (
    <div className="explicit-veil">
      <EyeOffIcon />
      <p>Foto explícita</p>
      <button type="button" className="btn btn--small explicit-veil__btn" onClick={onReveal}>Ver foto</button>
    </div>
  );
}

/** Sobre la foto tapada de la grilla: solo el ícono (tocar la foto abre el perfil). */
export function ExplicitTileMark() {
  return <span className="tile__veil" aria-hidden="true"><EyeOffIcon /></span>;
}
