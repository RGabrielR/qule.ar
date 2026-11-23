import { useEffect, useState } from "react";
import { api, type StaffAccess } from "../api";
import { PERMISSION_LABELS } from "../staff";
import { DialogFocus } from "./DialogFocus";

type Perm = Exclude<StaffAccess, "owner">;

/** Desde el perfil de alguien: darle o sacarle permisos de moderación. Solo para la administración general. */
export function StaffDialog({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const [owner, setOwner] = useState(false);
  const [saved, setSaved] = useState<Perm[] | null>(null);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ owner: boolean; permissions: Perm[] }>(`/admin/team/${userId}`)
      .then((r) => {
        setOwner(r.owner);
        setSaved(r.permissions);
        setPerms(r.permissions);
      })
      .catch((e) => setError((e as Error).message));
  }, [userId]);

  const toggle = (p: Perm) => setPerms((list) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]));
  const changed = saved != null && (perms.length !== saved.length || perms.some((p) => !saved.includes(p)));

  async function save() {
    setState("saving");
    setError("");
    try {
      await api("/admin/team", { method: "POST", json: { account: userId, permissions: perms } });
      setSaved(perms);
      setState("done");
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal aria-labelledby="staff-title" onClick={(e) => e.stopPropagation()}>
        <DialogFocus onClose={onClose} />
        <h2 id="staff-title">Moderación: {name}</h2>
        {state === "done" ? (
          <>
            <p className="muted">
              {perms.length
                ? `Listo. ${name} ya puede entrar a Moderación con estos permisos.`
                : `Listo. ${name} ya no tiene permisos de moderación.`}
            </p>
            <button className="btn btn--primary" onClick={onClose}>Listo</button>
          </>
        ) : saved == null ? (
          error ? <p className="error" role="alert">{error}</p> : <p className="muted">Cargando…</p>
        ) : owner ? (
          <>
            <p className="muted">{name} tiene administración general. Eso se cambia en la configuración del servidor, no desde acá.</p>
            <button className="btn" onClick={onClose}>Cerrar</button>
          </>
        ) : (
          <>
            <p className="muted small">Dale solo lo que necesita. Nadie del equipo ve mails ni datos de salud, ni puede dar de baja grupos o cambiar permisos.</p>
            <div className="stack">
              {PERMISSION_LABELS.map((p) => (
                <label key={p.id} className="field--inline small">
                  <input type="checkbox" checked={perms.includes(p.id)} disabled={state === "saving"} onChange={() => toggle(p.id)} />
                  <span><b>{p.label}</b> <span className="muted">· {p.hint}</span></span>
                </label>
              ))}
            </div>
            {error && <p className="error small" role="alert">{error}</p>}
            <div className="row">
              <button className="btn" onClick={onClose}>Cancelar</button>
              <button className="btn btn--primary" disabled={!changed || state === "saving"} onClick={save}>
                {perms.length === 0 && saved.length > 0 ? "Sacar permisos" : "Guardar"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
