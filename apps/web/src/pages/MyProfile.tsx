import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api, authClient, closeSocket, upload, type AlbumGrant, type Author, type Profile } from "../api";
import { useMe } from "../App";
import { APP_NAME, THEME_LABELS, themes, type ThemeName } from "../brand";
import { AlbumViewer, duration, untilLabel } from "../components/AlbumViewer";
import { Avatar } from "../components/Avatar";
import { EyeIcon, LockIcon, PlusIcon, StarIcon } from "../components/Icons";
import { getTheme, setTheme } from "../theme";
import { disablePush, enablePush, pushHelp, pushState, testPush, type PushState } from "../push";
import { BODY_TYPES, GENDER_IDENTITIES, HIV_STATUS, LOOKING_FOR, POSITIONS, PRONOUNS, RELATIONSHIP, SEXUAL_ORIENTATIONS, TRIBES } from "../options";

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

function NotificationsSetting() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState("");
  useEffect(() => {
    pushState().then(setState).catch(() => setState("unsupported"));
  }, []);
  if (!state || state === "disabled") return null;

  async function toggle() {
    setBusy(true);
    setTest("");
    try {
      const next = state === "on" ? await disablePush() : await enablePush();
      setState(next);
      if (next === "on") await sendTest();
    } catch {
      setState(await pushState().catch(() => "unsupported" as const));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setTest("Mandando…");
    const sent = await testPush().catch(() => 0);
    setTest(sent ? `Mandamos una de prueba a ${sent === 1 ? "tu dispositivo" : `tus ${sent} dispositivos`}. Si no la ves, revisá que el navegador tenga permiso para mostrar notificaciones en tu sistema.` : "No pudimos mandarla. Probá desactivarlas y activarlas de nuevo.");
  }

  return (
    <section className="section">
      <div className="setting">
        <div>
          <h2 className="section__title section__title--tight">Notificaciones</h2>
          <p className="muted small">{pushHelp(state, APP_NAME)}</p>
        </div>
        {(state === "on" || state === "off") && (
          <button className={`switch ${state === "on" ? "switch--on" : ""}`} role="switch" aria-checked={state === "on"} aria-label="Notificaciones" disabled={busy} onClick={toggle}>
            <span />
          </button>
        )}
      </div>
      {state === "on" && (
        <p className="small hint">
          <button className="linkbtn" onClick={sendTest} disabled={busy}>Mandarme una de prueba</button>
          {test && <span className="muted" role="status"> · {test}</span>}
        </p>
      )}
    </section>
  );
}

function ThemeSetting() {
  const [theme, setCurrent] = useState(getTheme);
  const choose = (t: ThemeName) => { setTheme(t); setCurrent(t); };
  return (
    <section className="section">
      <h2 className="section__title section__title--tight">Tema</h2>
      <p className="muted small lead">Penumbra es un oscuro más suave, para usar de día o con mucho brillo.</p>
      <div className="segmented" role="radiogroup" aria-label="Tema">
        {(Object.keys(themes) as ThemeName[]).map((t) => (
          <button key={t} role="radio" aria-checked={theme === t} onClick={() => choose(t)}>{THEME_LABELS[t]}</button>
        ))}
      </div>
    </section>
  );
}

export function MyProfile() {
  const { me, reload } = useMe();
  const [params] = useSearchParams();
  const isNew = params.get("nuevo") === "1";
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [blocked, setBlocked] = useState<Author[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const nextPrivate = useRef(false);
  const [grants, setGrants] = useState<AlbumGrant[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number; video: boolean } | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [toquesNew, setToquesNew] = useState(0);

  useEffect(() => {
    if (me?.profile) {
      const p = me.profile;
      setForm({
        displayName: p.displayName, about: p.about, heightCm: p.heightCm, weightKg: p.weightKg,
        bodyType: p.bodyType, position: p.position, tribes: p.tribes, lookingFor: p.lookingFor,
        relationship: p.relationship, pronouns: p.pronouns, hivStatus: p.hivStatus, lastTested: p.lastTested,
        genderIdentity: p.genderIdentity, genderOther: p.genderOther, sexualOrientation: p.sexualOrientation,
        orientationOther: p.orientationOther, isTrans: p.isTrans, lgbtqMember: p.lgbtqMember,
        showGender: p.showGender, showOrientation: p.showOrientation, showTrans: p.showTrans, showLgbtq: p.showLgbtq,
      });
    }
  }, [me?.profile]);

  useEffect(() => {
    api<Author[]>("/blocks").then(setBlocked).catch(() => {});
    api<{ count: number }>("/toques/unseen").then((r) => setToquesNew(r.count)).catch(() => {});
    api<AlbumGrant[]>("/album/grants").then(setGrants).catch(() => {});
  }, []);

  if (!me?.profile || !form) return null;
  const publicPhotos = me.photos.filter((p) => !p.isPrivate);
  const privatePhotos = me.photos.filter((p) => p.isPrivate);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm({ ...form, [k]: v });
    setSaved("idle");
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved("saving");
    setError("");
    try {
      await api("/me/profile", { method: "PUT", json: form });
      await reload();
      setSaved("ok");
    } catch (err) {
      setSaved("error");
      setError((err as Error).message);
    }
  }

  function pick(priv: boolean) {
    nextPrivate.current = priv;
    const input = fileRef.current;
    if (!input) return;
    // Al álbum se pueden subir fotos y videos; al perfil, solo fotos
    input.accept = priv ? "image/*,video/*" : "image/*";
    input.click();
  }

  async function setPrivate(photoId: string, isPrivate: boolean) {
    await api(`/me/photos/${photoId}`, { method: "PATCH", json: { isPrivate } });
    await reload();
  }

  async function revoke(userId: string) {
    await api(`/album/grants/${userId}`, { method: "DELETE" });
    setGrants((g) => g.filter((x) => x.id !== userId));
  }

  async function blockFromAlbum(g: AlbumGrant) {
    if (!confirm(`¿Bloquear a ${g.name}? Pierde el acceso a tu álbum y no van a poder verse ni escribirse.`)) return;
    await api("/blocks", { method: "POST", json: { userId: g.id } });
    setGrants((x) => x.filter((y) => y.id !== g.id));
    setBlocked((b) => [{ id: g.id, name: g.name, age: g.age, photo: g.photo }, ...b]);
  }

  /** Sube varios archivos seguidos (de a uno, así el servidor procesa los videos sin trabarse). */
  async function addFiles(files: File[], priv = false) {
    if (!files.length) return;
    setUploading(true);
    setError("");
    const errors: string[] = [];
    for (const [i, file] of files.entries()) {
      setProgress({ done: i, total: files.length, video: file.type.startsWith("video/") });
      try {
        await upload("/me/photos", file, priv ? { private: "1" } : {});
      } catch (err) {
        errors.push(`${file.name}: ${(err as Error).message}`);
        // Si se llenó el álbum o el perfil, no tiene sentido seguir
        if (/hasta \d+/.test((err as Error).message)) break;
      }
    }
    await reload();
    setProgress(null);
    setUploading(false);
    if (errors.length) setError(errors.join(" · "));
  }

  async function removePhoto(photoId: string) {
    await api(`/me/photos/${photoId}`, { method: "DELETE" });
    await reload();
  }

  async function makeMain(photoId: string) {
    const ids = [photoId, ...me!.photos.map((p) => p.id).filter((x) => x !== photoId)];
    // (las privadas no cuentan para la principal: se toma la primera pública)
    await api("/me/photos/order", { method: "PUT", json: ids });
    await reload();
  }

  async function unblock(userId: string) {
    await api(`/blocks/${userId}`, { method: "DELETE" });
    setBlocked((b) => b.filter((x) => x.id !== userId));
  }

  async function logout() {
    await authClient.signOut();
    closeSocket();
    await reload();
  }

  async function deleteAccount() {
    await api("/me", { method: "DELETE" });
    closeSocket();
    await reload();
  }

  return (
    <div className="page">
      <header className="topbar">
        <h1 className="topbar__title">Mi perfil</h1>
        <Link to={`/perfil/${me.user.id}`} className="linkbtn">Ver como lo ven</Link>
      </header>

      {isNew && (
        <div className="notice notice--info welcome">
          ¡Bienvenide a {APP_NAME}! Subí una foto y completá lo que quieras. Todo es opcional y lo podés cambiar cuando quieras.
        </div>
      )}

      <nav className="quicklinks" aria-label="Accesos">
        <Link to="/visitas" className="quicklink"><EyeIcon /> Quién me vio</Link>
        <Link to="/favoritos" className="quicklink"><StarIcon size={18} /> Favoritos</Link>
        <Link to="/toques" className="quicklink quicklink--full">
          <img src="/reacciones/rayo.svg" alt="" width={18} height={18} /> Toques
          {toquesNew > 0 && <b className="badge badge--inline">{toquesNew}</b>}
        </Link>
        {me.user.isAdmin && <Link to="/admin" className="quicklink quicklink--wide">Moderación</Link>}
      </nav>

      <NotificationsSetting />
      <ThemeSetting />

      <section className="section">
        <h2 className="section__title">Fotos <span className="muted">{publicPhotos.length}/6</span></h2>
        <div className="photos">
          {publicPhotos.map((p, i) => (
            <div key={p.id} className="photos__item">
              <img src={p.thumb ?? p.url} alt={`Tu foto ${i + 1}`} />
              {i === 0 ? <span className="photos__main">Principal</span> : (
                <button className="photos__action" onClick={() => makeMain(p.id)}>Hacer principal</button>
              )}
              <button className="photos__remove" aria-label="Borrar foto" onClick={() => removePhoto(p.id)}>✕</button>
              <button className="photos__lock" aria-label="Pasar al álbum privado" title="Pasar al álbum privado" onClick={() => setPrivate(p.id, true)}><LockIcon /></button>
            </div>
          ))}
          {publicPhotos.length < 6 && (
            <button className="photos__add" onClick={() => pick(false)} disabled={uploading}>
              {uploading ? "Subiendo…" : <><PlusIcon /> Agregar</>}
            </button>
          )}
        </div>
        <p className="muted small">Al subir una foto le borramos los metadatos, incluida la ubicación GPS.</p>
      </section>

      <section className="section">
        <h2 className="section__title"><LockIcon /> Álbum privado <span className="muted">{privatePhotos.length}/40</span></h2>
        <p className="muted small lead">
          Fotos y videos (hasta 1 minuto) que solo ve la gente a la que se lo compartís desde su perfil, por 1 hora, 24 horas, 7 días o sin límite. Podés quitar el acceso cuando quieras.
        </p>
        <div className="photos">
          {privatePhotos.map((p, i) => (
            <div key={p.id} className="photos__item">
              <button className="photos__open" onClick={() => setViewing(i)} aria-label={`Ver ${p.kind === "video" ? "video" : "foto"} ${i + 1}`}>
                {p.thumb ? <img src={p.thumb} alt="" /> : <span className="album__nothumb" />}
                {p.kind === "video" && <span className="album__play">▶ {duration(p.seconds)}</span>}
              </button>
              {p.kind === "photo" && <button className="photos__action" onClick={() => setPrivate(p.id, false)}>Hacer pública</button>}
              <button className="photos__remove" aria-label="Borrar" onClick={() => removePhoto(p.id)}>✕</button>
            </div>
          ))}
          {privatePhotos.length < 40 && (
            <button className="photos__add" onClick={() => pick(true)} disabled={uploading}>
              {uploading ? "Subiendo…" : <><PlusIcon /> Fotos y videos</>}
            </button>
          )}
        </div>
        {progress && (
          <p className="muted small" role="status">
            Subiendo {progress.done + 1} de {progress.total}{progress.video ? " · los videos tardan un poco más en procesarse" : ""}…
          </p>
        )}
        {grants.length > 0 && (
          <>
            <h3 className="subhead subhead--spaced">Lo pueden ver</h3>
            <ul className="blocked grants">
              {grants.map((g) => (
                <li key={g.id}>
                  <Avatar src={g.photo} name={g.name} size={36} />
                  <span className="grants__who">
                    <Link to={`/perfil/${g.id}`}>{g.name}</Link>
                    <small className="muted">{untilLabel(g.expiresAt)}</small>
                  </span>
                  <button className="linkbtn" onClick={() => revoke(g.id)}>Quitar</button>
                  <button className="linkbtn linkbtn--danger" onClick={() => blockFromAlbum(g)}>Bloquear</button>
                </li>
              ))}
            </ul>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            addFiles(files, nextPrivate.current);
            e.target.value = "";
          }}
        />
        {viewing != null && (
          <AlbumViewer items={privatePhotos} start={viewing} title="Tu álbum privado" onClose={() => setViewing(null)} />
        )}
      </section>

      <form className="section form" onSubmit={save}>
        <h2 className="section__title">Sobre vos <span className="muted">{me.profile.age} años</span></h2>
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
        <section className="profile__section">
          <h3>Identidad y orientación <span className="muted small">Opcional</span></h3>
          <p className="muted small">Solo se muestran en tu perfil y se usan en filtros si activás cada opción.</p>
          <div className="form">
            <Select
              label="Género"
              value={form.genderIdentity}
              options={GENDER_IDENTITIES}
              onChange={(v) => {
                setForm({ ...form, genderIdentity: v, genderOther: v === "Otra identidad" ? form.genderOther : null });
                setSaved("idle");
              }}
            />
            {form.genderIdentity === "Otra identidad" && (
              <label className="field">
                <span>¿Cómo describís tu género?</span>
                <input className="input" maxLength={60} value={form.genderOther ?? ""} onChange={(e) => set("genderOther", e.target.value || null)} />
              </label>
            )}
            <Select
              label="Orientación"
              value={form.sexualOrientation}
              options={SEXUAL_ORIENTATIONS}
              onChange={(v) => {
                setForm({ ...form, sexualOrientation: v, orientationOther: v === "Otra orientación" ? form.orientationOther : null });
                setSaved("idle");
              }}
            />
            {form.sexualOrientation === "Otra orientación" && (
              <label className="field">
                <span>¿Cómo describís tu orientación?</span>
                <input className="input" maxLength={60} value={form.orientationOther ?? ""} onChange={(e) => set("orientationOther", e.target.value || null)} />
              </label>
            )}
            <label className="field">
              <span>¿Te identificás como una persona trans?</span>
              <select className="input" value={form.isTrans == null ? "" : form.isTrans ? "si" : "no"} onChange={(e) => {
                const isTrans = e.target.value === "" ? null : e.target.value === "si";
                setForm({ ...form, isTrans, showTrans: isTrans === true && form.showTrans });
                setSaved("idle");
              }}>
                <option value="">Prefiero no decir</option>
                <option value="si">Sí</option>
                <option value="no">No</option>
              </select>
            </label>
            <label className="field">
              <span>¿Te identificás como parte de la comunidad LGBTIQ+?</span>
              <select className="input" value={form.lgbtqMember == null ? "" : form.lgbtqMember ? "si" : "no"} onChange={(e) => {
                const lgbtqMember = e.target.value === "" ? null : e.target.value === "si";
                setForm({ ...form, lgbtqMember, showLgbtq: lgbtqMember != null && form.showLgbtq });
                setSaved("idle");
              }}>
                <option value="">Prefiero no decir</option>
                <option value="si">Sí</option>
                <option value="no">No</option>
              </select>
              <small className="muted">Es opcional y no cambia a quién ves.</small>
            </label>
            <div className="stack">
              <label className="check">
                <input type="checkbox" checked={form.showGender} onChange={(e) => set("showGender", e.target.checked)} />
                <span>Mostrar mi género en el perfil y permitir usarlo en filtros</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={form.showOrientation} onChange={(e) => set("showOrientation", e.target.checked)} />
                <span>Mostrar mi orientación en el perfil y permitir usarla en filtros</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={form.showTrans} disabled={form.isTrans !== true} onChange={(e) => set("showTrans", e.target.checked)} />
                <span>Mostrar que soy una persona trans y permitir usarlo en filtros</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={form.showLgbtq} disabled={form.lgbtqMember == null} onChange={(e) => set("showLgbtq", e.target.checked)} />
                <span>Mostrar si pertenezco a la comunidad LGBTIQ+</span>
              </label>
            </div>
          </div>
        </section>
        <div className="grid2">
          <Select label="Estado serológico" value={form.hivStatus} options={HIV_STATUS} onChange={(v) => set("hivStatus", v)} />
          <label className="field">
            <span>Último test</span>
            <input className="input" type="date" max={new Date().toISOString().slice(0, 10)} value={form.lastTested ?? ""} onChange={(e) => set("lastTested", e.target.value || null)} />
          </label>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="savebar">
          <button className="btn btn--primary btn--grow" disabled={saved === "saving"}>
            {saved === "saving" ? "Guardando…" : saved === "ok" ? "Guardado ✓" : "Guardar cambios"}
          </button>
        </div>
      </form>

      <section className="section">
        <h2 className="section__title">Ubicación y privacidad</h2>
        <div className="stack">
          <p className="muted small">
            {me.profile.hasLocation
              ? "Aparecés en la grilla con tu distancia. Mientras usás la app, tu zona se actualiza sola. Guardamos solo una zona de ~500 m, nunca tu posición exacta."
              : "No compartiste tu ubicación: aparecés en la grilla, pero sin distancia."}
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={me.profile.incognito}
              onChange={async (e) => {
                await api("/me/privacy", { method: "PUT", json: { incognito: e.target.checked } });
                await reload();
              }}
            />
            <span><b>Modo incógnito.</b> No aparecés en la grilla, nadie ve si estás en línea y tus visitas a perfiles no quedan registradas. Podés seguir chateando con quien quieras.</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={me.profile.showDistance}
              onChange={async (e) => {
                await api("/me/privacy", { method: "PUT", json: { showDistance: e.target.checked } });
                await reload();
              }}
            />
            <span>Mostrar a qué distancia estoy. Si lo apagás, tampoco vas a ver la distancia de los demás.</span>
          </label>
          {me.profile.hasLocation && (
            <button
              className="btn btn--ghost"
              onClick={async () => {
                await api("/me/location", { method: "DELETE" });
                await reload();
              }}
            >
              Borrar mi ubicación y salir de la grilla
            </button>
          )}
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">Bloqueados</h2>
        {blocked.length === 0 ? (
          <p className="muted">No bloqueaste a nadie.</p>
        ) : (
          <ul className="blocked">
            {blocked.map((b) => (
              <li key={b.id}>
                <Avatar src={b.photo} name={b.name} size={36} />
                <span>{b.name}</span>
                <button className="linkbtn" onClick={() => unblock(b.id)}>Desbloquear</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <h2 className="section__title">Cuenta</h2>
        <p className="muted small">{me.user.email}</p>
        <div className="stack">
          <button className="btn" onClick={logout}>Cerrar sesión</button>
          {deleting ? (
            <div className="confirm confirm--danger">
              <p>Se borran tu perfil, tus fotos y tus mensajes. <b>No se puede deshacer.</b> Escribí <b>borrar</b> para confirmar.</p>
              <input className="input" value={deleteText} onChange={(e) => setDeleteText(e.target.value)} aria-label="Escribí borrar para confirmar" />
              <div className="row">
                <button className="btn" onClick={() => { setDeleting(false); setDeleteText(""); }}>Cancelar</button>
                <button className="btn btn--danger" disabled={deleteText.trim().toLowerCase() !== "borrar"} onClick={deleteAccount}>Borrar mi cuenta</button>
              </div>
            </div>
          ) : (
            <button className="btn btn--ghost btn--dangertext" onClick={() => setDeleting(true)}>Borrar mi cuenta</button>
          )}
        </div>
        <p className="fineprint">
          {APP_NAME} es software libre (AGPL-3.0), hecho en comunidad. Está en beta:{" "}
          <Link to="/terminos">Términos</Link> · <Link to="/privacidad">Privacidad</Link>.
        </p>
      </section>
    </div>
  );
}
