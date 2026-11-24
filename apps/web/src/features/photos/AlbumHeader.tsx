import { useState, type FormEvent } from "react";
import type { MyAlbum } from "../../api";
import { albumCount } from "../../components/AlbumViewer";

/** Largo máximo del nombre de un álbum (igual que en la API). */
export const MAX_ALBUM_NAME = 30;

/**
 * Título de uno de mis álbumes privados en la edición del perfil, con renombrar y borrar.
 * Al borrar un álbum con archivos se elige si pasan a otro álbum o se borran con él.
 */
export function AlbumHeader({ album, count, videos, others, disabled, onRename, onDelete }: {
  album: MyAlbum;
  count: number;
  videos: number;
  others: MyAlbum[];
  disabled: boolean;
  onRename: (name: string) => Promise<void>;
  onDelete: (moveTo: string | null) => Promise<void>;
}) {
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const [name, setName] = useState(album.name);
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? "");

  async function rename(e: FormEvent) {
    e.preventDefault();
    await onRename(name.trim());
    setMode("view");
  }

  if (mode === "rename") {
    return (
      <form className="album-edit__rename" onSubmit={rename}>
        <label className="field">
          <span>Nombre del álbum</span>
          <input className="input" autoFocus required maxLength={MAX_ALBUM_NAME} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="row">
          <button type="button" className="btn btn--ghost btn--small" onClick={() => { setName(album.name); setMode("view"); }}>Cancelar</button>
          <button className="btn btn--primary btn--small" disabled={disabled || !name.trim()}>Guardar</button>
        </div>
      </form>
    );
  }

  return (
    <div className="album-edit__head">
      <div className="album-edit__title">
        <h3 className="subhead">{album.name}</h3>
        <span className="muted small">{count ? albumCount(count, videos) : "Vacío"}</span>
      </div>
      {mode === "view" ? (
        <div className="album-edit__actions">
          <button type="button" className="linkbtn" disabled={disabled} onClick={() => setMode("rename")}>Renombrar</button>
          <button type="button" className="linkbtn linkbtn--danger" disabled={disabled} onClick={() => (count ? setMode("delete") : onDelete(null))}>Borrar</button>
        </div>
      ) : (
        <div className="album-edit__delete" role="group" aria-label={`Borrar ${album.name}`}>
          <p className="small">¿Qué hacemos con {count === 1 ? "el archivo" : `los ${count} archivos`} de «{album.name}»? Quien tenía acceso a este álbum lo pierde.</p>
          {others.length > 0 && (
            <div className="album-edit__move">
              <select className="input" aria-label="Álbum al que pasan" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <button type="button" className="btn btn--small" disabled={disabled || !moveTo} onClick={() => onDelete(moveTo)}>{count === 1 ? "Pasarlo ahí" : "Pasarlos ahí"}</button>
            </div>
          )}
          <div className="row">
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setMode("view")}>Cancelar</button>
            <button type="button" className="btn btn--danger btn--small" disabled={disabled} onClick={() => onDelete(null)}>Borrar todo</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Formulario chico para crear un álbum nuevo. */
export function NewAlbum({ disabled, onCreate }: { disabled: boolean; onCreate: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  async function create(e: FormEvent) {
    e.preventDefault();
    await onCreate(name.trim());
    setName("");
    setOpen(false);
  }

  if (!open) {
    return <button type="button" className="btn btn--ghost btn--small" disabled={disabled} onClick={() => setOpen(true)}>Nuevo álbum</button>;
  }
  return (
    <form className="album-edit__rename" onSubmit={create}>
      <label className="field">
        <span>Nombre del álbum nuevo</span>
        <input className="input" autoFocus required maxLength={MAX_ALBUM_NAME} placeholder="Por ejemplo, Activo" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="row">
        <button type="button" className="btn btn--ghost btn--small" onClick={() => { setName(""); setOpen(false); }}>Cancelar</button>
        <button className="btn btn--primary btn--small" disabled={disabled || !name.trim()}>Crear</button>
      </div>
    </form>
  );
}

/** Selector compacto sobre cada archivo para pasarlo a otro álbum (o al perfil, si es una foto). */
export function MoveTo({ current, albums, canGoPublic, disabled, onMove }: {
  current: string | null;
  albums: MyAlbum[];
  canGoPublic: boolean;
  disabled: boolean;
  onMove: (target: string | "public") => void;
}) {
  const targets = albums.filter((a) => a.id !== current);
  if (!targets.length && !canGoPublic) return null;
  return (
    <select
      className="photos__move"
      aria-label="Mover a"
      value=""
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value;
        e.target.value = "";
        if (v) onMove(v);
      }}
    >
      <option value="" disabled>Mover</option>
      {targets.map((a) => <option key={a.id} value={a.id}>A {a.name}</option>)}
      {canGoPublic && <option value="public">Al perfil público</option>}
    </select>
  );
}
