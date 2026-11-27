import { useLayoutEffect, useRef, useState } from "react";
import { api } from "../../api";
import { EditIcon } from "../../components/Icons";
import { motionMs } from "../../motion";

/** Igual que MAX_FAVORITE_NOTE en el API. */
const MAX_NOTE = 300;

/**
 * Nota privada sobre una persona que tenés en favoritos, como en Grindr: solo texto, solo la ves vos y se borra si
 * la sacás de favoritos.
 */
/** `appear`: recién se marcó como favorita (se anima la entrada). Al abrir el perfil de alguien que ya era favorito, no. */
export function FavoriteNote({ userId, note, onSaved, appear = false }: {
  userId: string;
  note: string | null;
  onSaved: (note: string | null) => void;
  appear?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const card = useRef<HTMLElement>(null);

  // Al marcarla como favorita, el recuadro baja desde la estrella: crece hasta su alto (empujando suave lo de abajo)
  // y aparece. Se anima con el alto medido, así dura parejo sea cual sea el largo de la nota.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !appear || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const { height, paddingTop, paddingBottom } = getComputedStyle(el);
    const easing = getComputedStyle(document.documentElement).getPropertyValue("--ease-sheet").trim() || "ease-out";
    const growing = el.animate(
      [
        { height: "0px", paddingTop: "0px", paddingBottom: "0px", opacity: 0 },
        { opacity: 1, offset: 0.4 },
        { height, paddingTop, paddingBottom, opacity: 1 },
      ],
      { duration: motionMs("--dur-sheet"), easing },
    );
    return () => growing.cancel();
    // Solo al aparecer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function edit() {
    setDraft(note ?? "");
    setError("");
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const saved = await api<{ note: string | null }>(`/favorites/${userId}/note`, { method: "PUT", json: { note: draft } });
      onSaved(saved.note);
      setEditing(false);
    } catch (err) {
      setError((err as Error).message || "No se pudo guardar la nota. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    // Va pegado a la estrella de favoritos, que se estira hasta acá (.btn--fav-tab): un solo contorno para las dos cosas
    <section className={`fav-card ${appear ? "fav-card--in" : ""}`} ref={card} aria-label="Tu nota sobre esta persona">
      {editing ? (
        <form className="fav-card__form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <textarea
            className="input" rows={3} maxLength={MAX_NOTE} value={draft} autoFocus aria-label="Tu nota"
            placeholder="Algo para acordarte de esta persona" onChange={(e) => setDraft(e.target.value)}
          />
          <div className="fav-card__foot">
            <span className="muted small">Solo la ves vos · {draft.length}/{MAX_NOTE}</span>
            <div className="row">
              <button type="button" className="btn btn--small" disabled={saving} onClick={() => setEditing(false)}>Cancelar</button>
              <button type="submit" className="btn btn--small btn--primary" disabled={saving}>Guardar</button>
            </div>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      ) : note ? (
        <div className="fav-card__noted">
          <p className="fav-card__note">{note}</p>
          <button type="button" className="iconbtn fav-card__edit" aria-label="Editar la nota" onClick={edit}><EditIcon /></button>
        </div>
      ) : (
        <button type="button" className="fav-card__add" onClick={edit}>
          <EditIcon /> Agregar una nota
        </button>
      )}
    </section>
  );
}
