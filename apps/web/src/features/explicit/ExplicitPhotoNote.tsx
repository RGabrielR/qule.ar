import type { ExplicitMark } from "../../api";
import { EyeOffIcon } from "../../components/Icons";

/**
 * Debajo de una foto propia del perfil: si está tapada para quien eligió no ver fotos explícitas, y el pedido de
 * revisión por si el modelo se equivocó. Vos tus fotos las ves siempre normales.
 */
export function ExplicitPhotoNote({ photo, disabled, onRequest }: { photo: ExplicitMark; disabled: boolean; onRequest: () => void }) {
  if (!photo.explicit && photo.explicitReview !== "requested") return null;
  return (
    <div className="explicit-note">
      <span className="explicit-note__label"><EyeOffIcon /> Tapada</span>
      {photo.explicitReview === "requested" ? (
        <span className="muted">Revisión pedida</span>
      ) : photo.explicitReview === "reviewed" ? (
        <span className="muted">Revisada</span>
      ) : (
        <button type="button" className="linkbtn explicit-note__ask" disabled={disabled} onClick={onRequest}>Pedir revisión</button>
      )}
    </div>
  );
}

/** Explicación arriba de las fotos, solo si alguna está tapada. */
export const EXPLICIT_PHOTOS_HELP =
  "Las fotos marcadas como explícitas se ven borrosas para quien eligió taparlas. Siguen en tu perfil y nadie recibe una sanción por eso. Si alguna no lo es, pedí que la revisen.";
