import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, ApiError, upload, type AlbumGrant, type Me, type Profile } from "../api";
import { useMe } from "../App";
import { APP_NAME } from "../brand";
import { AlbumViewer, duration, untilLabel } from "../components/AlbumViewer";
import { Avatar } from "../components/Avatar";
import { BackIcon, ChevronRightIcon, LockIcon, PlusIcon } from "../components/Icons";
import { PhotoCrop } from "../components/PhotoCrop";
import { preparePhotoForCrop } from "../features/photos/preparePhoto";
import { BODY_TYPES, HIV_STATUS, LOOKING_FOR, POSITIONS, PRONOUNS, RELATIONSHIP, TRIBES } from "../options";

type Form = Omit<Profile, "birthdate" | "age">;

function Select({ label, value, options, onChange }: { label: string; value: string | null; options: string[]; onChange: (v: string | null) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Sin especificar</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function MultiChips({ label, value, options, onChange, max = 10 }: { label: string; value: string[]; options: string[]; onChange: (v: string[]) => void; max?: number }) {
  return (
    <fieldset className="field">
      <legend>{label}</legend>
      <div className="chips">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <button
              type="button"
              key={o}
              className={`chip ${on ? "chip--on" : ""}`}
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== o) : value.length < max ? [...value, o] : value)}
            >
              {o}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

const numOrNull = (s: string) => (s === "" ? null : Number(s));

const MAX_PROFILE_PHOTOS = 6;
const MAX_ALBUM_ITEMS = 40;

/** Fotos elegidas que se van subiendo de a una: las fotos pasan por el recorte, los videos del álbum suben directo. */
type MediaBatch = { files: File[]; index: number; isPrivate: boolean; slots: number };

function profileForm(p: Profile): Form {
  return {
    displayName: p.displayName, about: p.about, heightCm: p.heightCm, weightKg: p.weightKg,
    bodyType: p.bodyType, position: p.position, tribes: p.tribes, lookingFor: p.lookingFor,
    relationship: p.relationship, pronouns: p.pronouns, hivStatus: p.hivStatus, lastTested: p.lastTested,
  };
}

type Photos = Me["photos"];

function PhotoOrder({ index, total, disabled, onMove }: {
  index: number; total: number; disabled: boolean; onMove: (direction: -1 | 1) => void;
}) {
  if (total < 2) return null;
  return (
    <div className="photos__order" role="group" aria-label={`Orden del archivo ${index + 1}`}>
      <button type="button" className="iconbtn" aria-label="Mover antes" title="Mover antes" disabled={disabled || index === 0} onClick={() => onMove(-1)}><BackIcon /></button>
      <button type="button" className="iconbtn" aria-label="Mover después" title="Mover después" disabled={disabled || index === total - 1} onClick={() => onMove(1)}><ChevronRightIcon /></button>
    </div>
  );
}

function PhotoPreparing() {
  return (
    <div className="photos__add" role="status">
      <span className="photos__spinner" aria-hidden="true" />
      <span>Preparando foto…</span>
    </div>
  );
}

export function EditProfile() {
  const { me, reload } = useMe();
  return me?.profile ? <ProfileEditor key={me.user.id} profile={me.profile} photos={me.photos} reload={reload} /> : null;
}

function ProfileEditor({ profile, photos, reload }: { profile: Profile; photos: Photos; reload: () => Promise<void> }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const isNew = params.get("nuevo") === "1";
  const [initialForm] = useState(() => profileForm(profile));
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const publicFileRef = useRef<HTMLInputElement>(null);
  const privateFileRef = useRef<HTMLInputElement>(null);
  const [grants, setGrants] = useState<AlbumGrant[]>([]);
  const [grantFeedback, setGrantFeedback] = useState("");
  const grantsHeading = useRef<HTMLHeadingElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; video: boolean } | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [cropBatch, setCropBatch] = useState<(MediaBatch & { image: HTMLImageElement }) | null>(null);
  const [preparing, setPreparing] = useState<"public" | "private" | null>(null);
  const [photoError, setPhotoError] = useState("");

  useEffect(() => {
    if (!photoError) return;
    const timer = window.setTimeout(() => setPhotoError(""), 5000);
    return () => window.clearTimeout(timer);
  }, [photoError]);

  useEffect(() => {
    api<AlbumGrant[]>("/album/grants").then(setGrants).catch(() => setMediaError("No pudimos cargar los accesos al álbum."));
  }, []);

  const publicPhotos = photos.filter((p) => !p.isPrivate);
  const privatePhotos = photos.filter((p) => p.isPrivate);
  const mediaLocked = preparing !== null || uploading || mediaBusy || saving;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((previous) => ({ ...previous, [k]: v }));
    setError("");
  };

  function leave() {
    if (JSON.stringify(form) !== JSON.stringify(initialForm) && !confirm("¿Descartar los cambios de Sobre vos?")) return;
    navigate("/yo", { replace: true });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api("/me/profile", { method: "PUT", json: form });
      await reload();
      navigate("/yo", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No pudimos guardar los cambios. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  function selectFiles(e: ChangeEvent<HTMLInputElement>, isPrivate: boolean) {
    const files = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = "";
    if (!files.length) return;
    const slots = isPrivate ? MAX_ALBUM_ITEMS - privatePhotos.length : MAX_PROFILE_PHOTOS - publicPhotos.length;
    setMediaError("");
    setPhotoError("");
    void advanceBatch({ files, index: 0, isPrivate, slots });
  }

  async function changeMedia(action: () => Promise<void>) {
    setMediaBusy(true);
    setMediaError("");
    try {
      await action();
    } catch (err) {
      setMediaError(err instanceof ApiError ? err.message : "No pudimos aplicar el cambio. Probá de nuevo.");
    } finally {
      setMediaBusy(false);
    }
  }

  function setPrivate(photoId: string, isPrivate: boolean) {
    if (!isPrivate && !confirm("¿Mostrar esta foto en tu perfil público?")) return;
    return changeMedia(async () => {
      await api(`/me/photos/${photoId}`, { method: "PATCH", json: { isPrivate } });
      await reload();
    });
  }

  function revoke(userId: string) {
    return changeMedia(async () => {
      await api(`/album/grants/${userId}`, { method: "DELETE" });
      setGrants((g) => g.filter((x) => x.id !== userId));
    });
  }

  function revokeAll() {
    if (!confirm("¿Quitar todos los accesos a tu álbum privado?")) return;
    return changeMedia(async () => {
      await api("/album/grants", { method: "DELETE" });
      grantsHeading.current?.focus();
      setGrants([]);
      setGrantFeedback("Quitaste todos los accesos.");
    });
  }

  function blockFromAlbum(g: AlbumGrant) {
    if (!confirm(`¿Bloquear a ${g.name}? Pierde el acceso a tu álbum y no van a poder verse ni escribirse.`)) return;
    return changeMedia(async () => {
      await api("/blocks", { method: "POST", json: { userId: g.id } });
      setGrants((x) => x.filter((y) => y.id !== g.id));
    });
  }

  /** Sube la foto ya recortada y sigue con el resto de la tanda. */
  async function uploadCrop(batch: MediaBatch, file: File) {
    const { isPrivate, index, slots } = batch;
    await upload("/me/photos", file, isPrivate ? { private: "1" } : {});
    await reload().catch(() => setMediaError("Recargá para ver las fotos que subiste."));
    await advanceBatch({ ...batch, index: index + 1, slots: slots - 1 });
  }

  /**
   * Sube los archivos en el orden en que se eligieron. Los videos del álbum suben directo (de a uno, así el servidor
   * los procesa sin trabarse). En cada foto se detiene para que se confirme el recorte.
   */
  async function advanceBatch({ files, index, isPrivate, slots }: MediaBatch) {
    setCropBatch(null);
    const errors: string[] = [];
    const photoErrors: string[] = [];
    let uploadedVideo = false;
    let image: HTMLImageElement | undefined;
    while (index < files.length && slots > 0) {
      const file = files[index];
      if (!isPrivate || !file.type.startsWith("video/")) {
        setPreparing(isPrivate ? "private" : "public");
        try {
          image = await preparePhotoForCrop(file);
          break;
        } catch (err) {
          const message = err instanceof Error ? err.message : "No pudimos preparar la foto.";
          photoErrors.push(`${file.name} · ${message}`);
          index++;
          continue;
        } finally {
          setPreparing(null);
        }
      }
      setUploading(true);
      setProgress({ done: index, total: files.length, video: true });
      try {
        await upload("/me/photos", file, { private: "1" });
        slots--;
        uploadedVideo = true;
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "No se pudo subir el video. Probá de nuevo.";
        errors.push(`${file.name} · ${message}`);
        if (/hasta \d+/.test(message)) slots = 0;
      }
      index++;
    }
    if (uploadedVideo) {
      await reload().catch(() => setMediaError("Recargá para ver los archivos que subiste."));
    }
    setProgress(null);
    setUploading(false);
    if (index < files.length && slots === 0) {
      errors.push(isPrivate
        ? `Tu álbum ya tiene ${MAX_ALBUM_ITEMS} fotos y videos. No se subieron los archivos que quedaban.`
        : `Tu perfil ya tiene ${MAX_PROFILE_PHOTOS} fotos. No se subieron las que quedaban.`);
    }
    if (errors.length) setMediaError((previous) => [previous, ...errors].filter(Boolean).join(" · "));
    if (photoErrors.length) setPhotoError(photoErrors.join(" · "));
    if (image) setCropBatch({ files, index, isPrivate, slots, image });
  }

  function removePhoto(photoId: string) {
    if (!confirm("¿Borrar este archivo?")) return;
    return changeMedia(async () => {
      await api(`/me/photos/${photoId}`, { method: "DELETE" });
      await reload();
    });
  }

  function reorder(items: Photos, from: number, to: number) {
    const ordered = items.slice();
    const [selected] = ordered.splice(from, 1);
    ordered.splice(to, 0, selected);
    let index = 0;
    const ids = photos.map((photo) => photo.isPrivate === selected.isPrivate ? ordered[index++].id : photo.id);
    return changeMedia(async () => {
      await api("/me/photos/order", { method: "PUT", json: ids });
      await reload();
    });
  }

  const photoNotice = photoError && <div className="toast toast--upload-error" role="alert">{photoError}</div>;

  return (
    <div className="page">
      <header className="topbar topbar--thread">
        <button type="button" className="iconbtn" aria-label="Volver a Mi perfil" onClick={leave} disabled={mediaLocked}><BackIcon /></button>
        <h1 className="topbar__title">Editar perfil</h1>
      </header>
      {isNew && (
        <p className="notice notice--info welcome">
          ¡Bienvenide a {APP_NAME}! Subí una foto y completá lo que quieras.
        </p>
      )}

      {!cropBatch && photoNotice && createPortal(photoNotice, document.body)}
      {mediaError && <p className="notice notice--error" role="alert">{mediaError}</p>}
      <section className="section">
        <h2 className="section__title">Fotos <span className="muted">{publicPhotos.length}/6</span></h2>
        <p className="muted small lead">Los cambios en fotos y en el álbum se aplican en el momento.</p>
        <div className="photos">
          {publicPhotos.map((p, i) => (
            <div key={p.id}>
              <div className="photos__item">
                <img src={p.thumb ?? p.url} alt={`Tu foto ${i + 1}`} />
                {i === 0 ? <span className="photos__main">Principal</span> : (
                  <button className="photos__action" disabled={mediaLocked} onClick={() => reorder(publicPhotos, i, 0)}>Hacer principal</button>
                )}
                <button className="photos__remove" aria-label="Borrar foto" disabled={mediaLocked} onClick={() => removePhoto(p.id)}>✕</button>
                <button className="photos__lock" aria-label="Pasar al álbum privado" title="Pasar al álbum privado" disabled={mediaLocked} onClick={() => setPrivate(p.id, true)}><LockIcon /></button>
              </div>
              <PhotoOrder index={i} total={publicPhotos.length} disabled={mediaLocked} onMove={(step) => reorder(publicPhotos, i, i + step)} />
            </div>
          ))}
          {publicPhotos.length < 6 && (
            preparing === "public" ? <PhotoPreparing /> : (
              <button className="photos__add" onClick={() => publicFileRef.current?.click()} disabled={mediaLocked}>
                {uploading ? "Subiendo…" : <><PlusIcon /> Agregar</>}
              </button>
            )
          )}
        </div>
        <input ref={publicFileRef} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => selectFiles(e, false)} />
        <p className="muted small">Al subir una foto le borramos los metadatos, incluida la ubicación GPS.</p>
      </section>

      <section className="section">
        <h2 className="section__title"><LockIcon /> Álbum privado <span className="muted">{privatePhotos.length}/40</span></h2>
        <p className="muted small lead">
          Fotos y videos (hasta 1 minuto) que solo ve la gente a la que se lo compartís desde su perfil, por 1 hora, 24 horas, 7 días o sin límite. Podés quitar el acceso cuando quieras.
        </p>
        <div className="photos">
          {privatePhotos.map((p, i) => (
            <div key={p.id}>
              <div className="photos__item">
                <button className="photos__open" onClick={() => setViewing(i)} aria-label={`Ver ${p.kind === "video" ? "video" : "foto"} ${i + 1}`}>
                  {p.thumb ? <img src={p.thumb} alt="" /> : <span className="album__nothumb" />}
                  {p.kind === "video" && <span className="album__play">▶ {duration(p.seconds)}</span>}
                </button>
                {p.kind === "photo" && <button className="photos__action" disabled={mediaLocked} onClick={() => setPrivate(p.id, false)}>Hacer pública</button>}
                <button className="photos__remove" aria-label="Borrar archivo" disabled={mediaLocked} onClick={() => removePhoto(p.id)}>✕</button>
              </div>
              <PhotoOrder index={i} total={privatePhotos.length} disabled={mediaLocked} onMove={(step) => reorder(privatePhotos, i, i + step)} />
            </div>
          ))}
          {privatePhotos.length < 40 && (
            preparing === "private" ? <PhotoPreparing /> : (
              <button className="photos__add" onClick={() => privateFileRef.current?.click()} disabled={mediaLocked}>
                {uploading ? "Subiendo…" : <><PlusIcon /> Fotos y videos</>}
              </button>
            )
          )}
        </div>
        {progress && (
          <p className="muted small" role="status">
            Subiendo {progress.done + 1} de {progress.total}{progress.video ? " · los videos tardan un poco más en procesarse" : ""}…
          </p>
        )}
        <div className="album-access__heading">
          <h3 className="subhead" ref={grantsHeading} tabIndex={-1}>Acceso al álbum</h3>
          {!!grants.length && <button type="button" className="btn btn--small btn--ghost btn--dangertext" disabled={mediaLocked} onClick={revokeAll}>Quitar todos los accesos</button>}
        </div>
        {grantFeedback && <p className="muted small" role="status">{grantFeedback}</p>}
        {grants.length > 0 && (
          <>
            <ul className="blocked grants">
              {grants.map((g) => (
                <li key={g.id}>
                  <Avatar src={g.photo} name={g.name} size={36} />
                  <span className="grants__who">
                    <Link to={`/perfil/${g.id}`}>{g.name}</Link>
                    <small className="muted">{untilLabel(g.expiresAt)}</small>
                  </span>
                  <button className="linkbtn" disabled={mediaLocked} onClick={() => revoke(g.id)}>Quitar</button>
                  <button className="linkbtn linkbtn--danger" disabled={mediaLocked} onClick={() => blockFromAlbum(g)}>Bloquear</button>
                </li>
              ))}
            </ul>
          </>
        )}
        <input ref={privateFileRef} type="file" accept="image/*,.heic,.heif,video/*" multiple hidden onChange={(e) => selectFiles(e, true)} />
        {cropBatch && (
          <PhotoCrop
            key={`${cropBatch.isPrivate}-${cropBatch.index}`}
            image={cropBatch.image}
            fileName={cropBatch.files[cropBatch.index].name}
            notice={photoNotice}
            number={cropBatch.index + 1}
            total={cropBatch.files.length}
            isPrivate={cropBatch.isPrivate}
            onSkip={() => { void advanceBatch({ ...cropBatch, index: cropBatch.index + 1 }); }}
            onUpload={(file) => uploadCrop(cropBatch, file)}
          />
        )}
        {viewing != null && (
          <AlbumViewer items={privatePhotos} start={viewing} title="Tu álbum privado" onClose={() => setViewing(null)} />
        )}
      </section>

      <form className="section form profile-editor__form" onSubmit={save}>
        <h2 className="section__title">Sobre vos <span className="muted">{profile.age} años</span></h2>
        <label className="field">
          <span>Nombre</span>
          <input className="input" required maxLength={40} value={form.displayName} onChange={(e) => set("displayName", e.target.value)} />
        </label>
        <label className="field">
          <span>Sobre mí</span>
          <textarea className="input" rows={3} maxLength={500} value={form.about ?? ""} onChange={(e) => set("about", e.target.value || null)} />
        </label>
        <div className="grid2">
          <label className="field">
            <span>Altura (cm)</span>
            <input className="input" type="number" inputMode="numeric" min={120} max={230} value={form.heightCm ?? ""} onChange={(e) => set("heightCm", numOrNull(e.target.value))} />
          </label>
          <label className="field">
            <span>Peso (kg)</span>
            <input className="input" type="number" inputMode="numeric" min={35} max={250} value={form.weightKg ?? ""} onChange={(e) => set("weightKg", numOrNull(e.target.value))} />
          </label>
          <Select label="Contextura" value={form.bodyType} options={BODY_TYPES} onChange={(v) => set("bodyType", v)} />
          <Select label="Rol" value={form.position} options={POSITIONS} onChange={(v) => set("position", v)} />
          <Select label="Relación" value={form.relationship} options={RELATIONSHIP} onChange={(v) => set("relationship", v)} />
          <Select label="Pronombres" value={form.pronouns} options={PRONOUNS} onChange={(v) => set("pronouns", v)} />
        </div>
        <MultiChips label="Tribus" value={form.tribes} options={TRIBES} onChange={(v) => set("tribes", v)} />
        <MultiChips label="Busco" value={form.lookingFor} options={LOOKING_FOR} onChange={(v) => set("lookingFor", v)} />
        <div className="grid2">
          <Select label="Estado serológico" value={form.hivStatus} options={HIV_STATUS} onChange={(v) => set("hivStatus", v)} />
          <label className="field">
            <span>Último test</span>
            <input className="input" type="date" max={new Date().toISOString().slice(0, 10)} value={form.lastTested ?? ""} onChange={(e) => set("lastTested", e.target.value || null)} />
          </label>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row profile-editor__actions">
          <button type="button" className="btn btn--ghost" onClick={leave} disabled={mediaLocked}>Cancelar</button>
          <button className="btn btn--primary" disabled={mediaLocked}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </form>
    </div>
  );
}
