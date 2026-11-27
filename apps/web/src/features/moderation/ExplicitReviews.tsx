import { useEffect, useState } from "react";
import { api, type Author } from "../../api";
import { ExplicitVeil } from "../explicit/ExplicitVeil";

type Item = { id: string; url: string; person: Author | null; score: number | null; checkedAt: string | null; requestedAt: string | null };
type Status = "requested" | "marked";

const FILTERS: { id: Status; label: string }[] = [
  { id: "requested", label: "Revisión pedida" },
  { id: "marked", label: "Marcadas por el modelo" },
];

const fmt = (iso: string) => new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Fotos tapadas (permiso Reportes): corregir al modelo de fotos explícitas. No es un reporte ni una medida: la
 * marca solo tapa la foto a quien eligió no ver fotos explícitas. Lo que decide moderación, el modelo no lo pisa.
 */
export function ExplicitReviews() {
  const [status, setStatus] = useState<Status>("requested");
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setItems(null);
    api<Item[]>(`/admin/explicit?status=${status}`, { signal: ctrl.signal })
      .then((r) => { setItems(r); setError(""); })
      .catch((e) => { if (!ctrl.signal.aborted) setError((e as Error).message); });
    return () => ctrl.abort();
  }, [status, version]);

  async function decide(id: string, explicit: boolean) {
    setError("");
    try {
      await api(`/admin/explicit/${id}`, { method: "POST", json: { explicit } });
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section aria-label="Fotos tapadas">
      <p className="muted small explicit-reviews__help">
        Un modelo marca las fotos del perfil con genitales o culo al descubierto, para taparlas a quien eligió no verlas. Torsos y ropa interior no cuentan. La marca no sanciona a nadie: acá solo se corrige cuando se equivoca.
      </p>
      <div className="rcard__actions admin__subtabs">
        {FILTERS.map((f) => (
          <button key={f.id} className={`btn btn--small${status === f.id ? " btn--primary" : ""}`} aria-pressed={status === f.id} onClick={() => setStatus(f.id)}>{f.label}</button>
        ))}
      </div>
      {error && <div className="notice notice--error" role="alert">{error}</div>}
      {items && items.length === 0 && (
        <div className="empty"><p className="muted">{status === "requested" ? "No hay pedidos de revisión." : "No hay fotos marcadas sin revisar."}</p></div>
      )}
      {items && items.length > 0 && (
        <ul className="reports">
          {items.map((item) => <ExplicitItem key={item.id} item={item} onDecide={(explicit) => decide(item.id, explicit)} />)}
        </ul>
      )}
    </section>
  );
}

function ExplicitItem({ item, onDecide }: { item: Item; onDecide: (explicit: boolean) => void }) {
  const [shown, setShown] = useState(false);
  return (
    <li className="rcard">
      <div className="explicit-reviews__photo">
        <div className={shown ? "profile__cover-media" : "profile__cover-media profile__cover-media--blur"}>
          <img src={`${item.url}?s=cover`} alt={item.person ? `Foto de ${item.person.name}` : "Foto"} />
        </div>
        {!shown && <ExplicitVeil onReveal={() => setShown(true)} />}
      </div>
      {item.person && (
        // Sin avatar: suele ser esta misma foto, sin tapar
        <p><b>{item.person.name}</b></p>
      )}
      <p className="muted small">
        {item.requestedAt ? `Pidió revisión el ${fmt(item.requestedAt)}` : item.checkedAt ? `Marcada el ${fmt(item.checkedAt)}` : null}
        {item.score != null && ` · el modelo estaba ${Math.round(item.score * 100)}% seguro`}
      </p>
      <div className="row">
        <button className="btn btn--small" onClick={() => onDecide(false)}>No es explícita</button>
        <button className="btn btn--small btn--ghost" onClick={() => onDecide(true)}>Sí, dejarla tapada</button>
      </div>
    </li>
  );
}
