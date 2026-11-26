import { useEffect, useRef, useState } from "react";
import { api, upload, type AiOrigin } from "../api";
import { aiFieldsFor } from "../features/photos/aiOrigin";
import { preparePhotoForUpload } from "../features/photos/preparePhoto";
import { GroupAvatar } from "./GroupAvatar";

/** Botón que abre el selector de fotos del celu. */
function PickButton({ label, disabled, onFile }: { label: string; disabled?: boolean; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="btn btn--small" disabled={disabled} onClick={() => input.current?.click()}>{label}</button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) onFile(f);
        }}
      />
    </>
  );
}

/** Al crear un grupo: elegir una foto (opcional). Se sube recién cuando el grupo existe. */
export function PhotoPicker({ name, file, onPick }: { name: string; file: File | null; onPick: (f: File | null) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div className="group-photo">
      <GroupAvatar name={name} photo={preview} />
      <PickButton label={file ? "Cambiar foto" : "Elegir foto"} onFile={onPick} />
      {file ? (
        <button type="button" className="linkbtn" onClick={() => onPick(null)}>Sacar</button>
      ) : (
        <span className="muted small">Opcional</span>
      )}
    </div>
  );
}

/** En la edición del grupo: el dueño pone, cambia o saca la foto. */
export function GroupPhotoSetting({ groupId, photo, onChange }: { groupId: string; photo: string | null; onChange: (photo: string | null, photoAi: AiOrigin) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<{ photo: string | null; photoAi?: AiOrigin }>) {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      onChange(r.photo, r.photoAi ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="group-photo__actions">
      <div className="row">
        <PickButton
          label={busy ? "Subiendo…" : photo ? "Cambiar foto" : "Poner foto"}
          disabled={busy}
          onFile={(f) => run(async () => upload<{ photo: string; photoAi: AiOrigin }>(`/groups/${groupId}/photo`, await preparePhotoForUpload(f), await aiFieldsFor(f)))}
        />
        {photo && (
          <button type="button" className="linkbtn" disabled={busy} onClick={() => run(() => api<{ photo: null }>(`/groups/${groupId}/photo`, { method: "DELETE" }))}>
            Sacar foto
          </button>
        )}
      </div>
      <p className="muted small">La ve cualquiera que busque grupos. Solo vos, como dueño, la podés cambiar.</p>
      {error && <p className="error small" role="alert">{error}</p>}
    </div>
  );
}
