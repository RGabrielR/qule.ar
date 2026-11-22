import { useEffect, useState } from "react";
import { api } from "../api";

type GroupEvent = {
  id: string; title: string; description: string | null; startsAt: string; capacity: number;
  cancelledAt: string | null; attendees: number; attending: boolean;
};
const date = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" });

export function GroupEvents({ groupId, canEdit }: { groupId: string; canEdit: boolean }) {
  const path = `/groups/${groupId}/events`;
  const [events, setEvents] = useState<GroupEvent[] | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [create, setCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [starts, setStarts] = useState("");
  const [capacity, setCapacity] = useState("10");

  useEffect(() => {
    const request = new AbortController();
    api<GroupEvent[]>(path, { signal: request.signal }).then((list) => {
      if (!request.signal.aborted) setEvents(list);
    }).catch((err) => {
      if (!request.signal.aborted) setError(err.message);
    });
    return () => request.abort();
  }, [path, revision]);

  async function change(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      setRevision((value) => value + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section form" aria-label="Agenda del grupo">
      <h2 className="section__title">Agenda</h2>
      {canEdit && !create && <button type="button" className="btn btn--small" onClick={() => setCreate(true)}>Crear evento</button>}
      {canEdit && create && (
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          void change(async () => {
            await api(path, { method: "POST", json: { title, description, startsAt: new Date(starts).toISOString(), capacity: Number(capacity) } });
            setTitle("");
            setDescription("");
            setStarts("");
            setCreate(false);
          });
        }}>
          <label className="field"><span>Título del evento</span><input className="input" required minLength={3} maxLength={70} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="field"><span>Descripción</span><textarea className="input" rows={2} maxLength={400} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <div className="grid2">
            <label className="field"><span>Fecha y hora local</span><input className="input" required type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} /></label>
            <label className="field"><span>Cupo</span><input className="input" required type="number" min={1} max={500} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></label>
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={() => setCreate(false)} disabled={busy}>Salir del formulario</button>
            <button className="btn btn--primary" disabled={busy}>Publicar evento</button>
          </div>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {events === null && !error && <p className="small muted" role="status">Cargando agenda…</p>}
      {events?.length === 0 && <p className="small muted">Todavía no hay eventos próximos.</p>}
      {!!events?.length && (
        <ul className="glist">
          {events.map((event) => (
            <li key={event.id} className="gcard gcard--static">
              <div className="gcard__text stack">
                <b>{event.title}</b>
                {event.description && <p className="group-description">{event.description}</p>}
                <p className="muted small">
                  <time dateTime={event.startsAt}>{date.format(new Date(event.startsAt))}</time>
                  {event.cancelledAt ? " · Cancelado" : ` · ${event.attendees} de ${event.capacity} lugares`}
                </p>
                {!event.cancelledAt && <div className="row">
                  <button type="button" className="btn btn--small" disabled={busy || (!event.attending && event.attendees >= event.capacity)}
                    onClick={() => change(() => api(`${path}/${event.id}/attendance`, { method: event.attending ? "DELETE" : "PUT" }))}>
                    {event.attending ? "Quitar confirmación" : event.attendees >= event.capacity ? "Sin cupo" : "Confirmar asistencia"}
                  </button>
                  {canEdit && <button type="button" className="btn btn--small btn--ghost btn--dangertext" disabled={busy}
                    onClick={() => { if (confirm("¿Cancelar este evento?")) void change(() => api(`${path}/${event.id}`, { method: "DELETE" })); }}>
                    Cancelar evento
                  </button>}
                </div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
