import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { api, type PublicProfile } from "../api";
import { BackIcon, LockIcon, StarIcon } from "../components/Icons";
import { useMe } from "../App";
import { InviteToGroups } from "../components/Invite";
import { ReportDialog } from "../components/ReportDialog";
import { AlbumGrid, AlbumViewer, untilLabel } from "../components/AlbumViewer";
import { ReactionIcon, ReactionPicker } from "../components/Reactions";
import { reactionLabel } from "../reactions";

const SHARE_OPTIONS: { hours: number | null; label: string }[] = [
  { hours: 1, label: "1 hora" },
  { hours: 24, label: "24 horas" },
  { hours: 168, label: "7 días" },
  { hours: null, label: "Sin límite" },
];

type StatsInput = Pick<PublicProfile, "about" | "heightCm" | "weightKg" | "bodyType" | "position" | "relationship" | "pronouns" | "hivStatus" | "lastTested" | "tribes" | "lookingFor" | "genderIdentity" | "genderOther" | "sexualOrientation" | "orientationOther" | "isTrans" | "lgbtqMember">;

export function ProfileStats({ p }: { p: StatsInput }) {
  const rows: [string, string | null][] = [
    ["Altura", p.heightCm ? `${p.heightCm} cm` : null],
    ["Peso", p.weightKg ? `${p.weightKg} kg` : null],
    ["Contextura", p.bodyType],
    ["Rol", p.position],
    ["Relación", p.relationship],
    ["Pronombres", p.pronouns],
    ["Género", p.genderIdentity === "Otra identidad" ? p.genderOther || p.genderIdentity : p.genderIdentity],
    ["Orientación", p.sexualOrientation === "Otra orientación" ? p.orientationOther || p.sexualOrientation : p.sexualOrientation],
    ["Identidad trans", p.isTrans ? "Sí" : null],
    ["Parte de la comunidad LGBTIQ+", p.lgbtqMember == null ? null : p.lgbtqMember ? "Sí" : "No"],
    ["Estado serológico", p.hivStatus],
    ["Último test", p.lastTested ? new Date(p.lastTested + "T12:00").toLocaleDateString("es-AR", { month: "long", year: "numeric" }) : null],
  ];
  const visible = rows.filter(([, v]) => v);
  return (
    <>
      {p.about && <p className="profile__about">{p.about}</p>}
      {visible.length > 0 && (
        <dl className="stats">
          {visible.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      )}
      {p.tribes.length > 0 && (
        <section className="profile__section">
          <h3>Tribus</h3>
          <div className="chips">{p.tribes.map((t) => <span key={t} className="chip chip--static">{t}</span>)}</div>
        </section>
      )}
      {p.lookingFor.length > 0 && (
        <section className="profile__section">
          <h3>Busca</h3>
          <div className="chips">{p.lookingFor.map((t) => <span key={t} className="chip chip--static">{t}</span>)}</div>
        </section>
      )}
    </>
  );
}

export function ProfilePage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [p, setP] = useState<PublicProfile | null>(null);
  const [missing, setMissing] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [reporting, setReporting] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const { me } = useMe();
  const hasOwnAlbum = Boolean(me?.photos.some((x) => x.isPrivate));
  const [params, setParams] = useSearchParams();
  // ?album=1 (desde el mensaje del chat) abre el álbum directo
  const [viewing, setViewing] = useState<number | null>(null);
  const [sharing, setSharing] = useState(false);
  const [toquePicker, setToquePicker] = useState(false);
  const [toqueMsg, setToqueMsg] = useState("");

  useEffect(() => {
    setP(null);
    setMissing(false);
    setPhotoIdx(0);
    api<PublicProfile>(`/users/${id}`).then((x) => {
      setP(x);
      if (params.get("album") === "1" && x.privateAlbum?.items?.length) setViewing(0);
    }).catch(() => setMissing(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function closeViewer() {
    setViewing(null);
    if (params.get("album")) setParams({}, { replace: true });
  }

  async function message() {
    const { id: convId } = await api<{ id: string }>("/conversations", { method: "POST", json: { userId: id } });
    nav(`/mensajes/${convId}`);
  }

  async function toggleFavorite() {
    if (!p) return;
    const fav = !p.favorite;
    setP({ ...p, favorite: fav });
    await api(`/favorites/${id}`, { method: fav ? "PUT" : "DELETE" }).catch(() => setP({ ...p, favorite: !fav }));
  }

  async function shareAlbum(hours: number | null) {
    if (!p) return;
    const r = await api<{ expiresAt: string | null }>(`/album/grants/${id}`, { method: "PUT", json: { hours } });
    setP({ ...p, iSharedAlbum: true, sharedUntil: r.expiresAt });
    setSharing(false);
  }

  async function unshareAlbum() {
    if (!p) return;
    await api(`/album/grants/${id}`, { method: "DELETE" });
    setP({ ...p, iSharedAlbum: false, sharedUntil: null });
  }

  /** Mandar un toque: a la otra persona le llega un aviso. Uno cada 12 horas por persona. */
  async function sendToque(kind: string) {
    if (!p) return;
    setToquePicker(false);
    try {
      const t = await api<{ kind: string; at: string }>(`/users/${id}/toques`, { method: "POST", json: { kind } });
      setP({ ...p, myToque: t });
      setToqueMsg(`Le mandaste un toque: ${reactionLabel(kind)}`);
    } catch (err) {
      setToqueMsg((err as Error).message);
    }
  }

  async function doBlock() {
    await api("/blocks", { method: "POST", json: { userId: id } });
    nav(-1);
  }

  if (missing) {
    return (
      <div className="page">
        <header className="topbar"><button className="iconbtn" onClick={() => nav(-1)} aria-label="Volver"><BackIcon /></button></header>
        <div className="empty"><p className="empty__title">Este perfil no está disponible</p></div>
      </div>
    );
  }
  if (!p) return <div className="page" />;

  return (
    <div className="page profile">
      <div className="profile__photo">
        {p.photos.length ? (
          <img src={p.photos[photoIdx]} alt={`Foto de ${p.displayName}`} />
        ) : (
          <div className="profile__nophoto">{p.displayName.charAt(0).toUpperCase()}</div>
        )}
        <button className="iconbtn iconbtn--float" onClick={() => nav(-1)} aria-label="Volver"><BackIcon /></button>
        {p.photos.length > 1 && (
          <div className="profile__dots">
            {p.photos.map((_, i) => (
              <button key={i} aria-label={`Foto ${i + 1}`} className={i === photoIdx ? "on" : ""} onClick={() => setPhotoIdx(i)} />
            ))}
          </div>
        )}
        {p.photos.length > 1 && (
          <>
            <button className="profile__tap profile__tap--prev" aria-label="Foto anterior" onClick={() => setPhotoIdx((i) => (i - 1 + p.photos.length) % p.photos.length)} />
            <button className="profile__tap profile__tap--next" aria-label="Foto siguiente" onClick={() => setPhotoIdx((i) => (i + 1) % p.photos.length)} />
          </>
        )}
        <div className="profile__name">
          <div className="profile__nameline">
            <h1>{p.displayName}</h1>
            <span>{p.age}</span>
          </div>
          {(p.online || p.recent || p.distance) && (
            <p className="profile__status">
              {p.online ? <><i className="dot dot--on" /> En línea</> : p.recent ? <><i className="dot dot--recent" /> Hace un rato</> : null}
              {(p.online || p.recent) && p.distance && " · "}
              {p.distance}
            </p>
          )}
        </div>
      </div>

      <div className="profile__body">
        {!p.isMe && (
          <div className="row">
            <button className="btn btn--primary btn--grow" onClick={message}>Mandar mensaje</button>
            <button
              className={`btn btn--icon btn--toque ${p.myToque ? "btn--toque-sent" : ""}`}
              onClick={() => (p.myToque ? setToqueMsg(`Ya le mandaste un toque (${reactionLabel(p.myToque.kind)}). Vas a poder mandarle otro en unas horas.`) : setToquePicker(!toquePicker))}
              aria-expanded={toquePicker}
              aria-label={p.myToque ? `Ya le mandaste un toque: ${reactionLabel(p.myToque.kind)}` : "Mandar un toque"}
              title="Mandar un toque"
            >
              {p.myToque ? <ReactionIcon kind={p.myToque.kind} size={24} /> : <img src="/reacciones/toque.svg" alt="" width={24} height={24} />}
            </button>
            <button
              className={`btn btn--icon ${p.favorite ? "btn--fav" : ""}`}
              onClick={toggleFavorite}
              aria-pressed={p.favorite}
              aria-label={p.favorite ? "Sacar de favoritos" : "Agregar a favoritos"}
              title="Favoritos (privado: no se entera)"
            >
              <StarIcon filled={p.favorite} />
            </button>
          </div>
        )}
        {toquePicker && (
          <div className="toque-picker">
            <p className="muted small">Mandale un toque: le llega un aviso y lo ve en sus Toques.</p>
            <ReactionPicker onPick={sendToque} label="Elegí un toque" />
          </div>
        )}
        {toqueMsg && <p className="muted small toque-msg" role="status">{toqueMsg}</p>}

        {p.privateAlbum && (
          <section className="album">
            <h3 className="album__title">
              <LockIcon /> Álbum privado · {albumCount(p.privateAlbum.count, p.privateAlbum.videos)}
            </h3>
            {p.privateAlbum.items ? (
              <>
                {!p.isMe && <p className="muted small album__until">Lo podés ver {untilLabel(p.privateAlbum.expiresAt)}.</p>}
                <AlbumGrid items={p.privateAlbum.items} onOpen={setViewing} />
              </>
            ) : (
              <p className="muted small">{p.displayName} todavía no te compartió su álbum.</p>
            )}
          </section>
        )}

        <ProfileStats p={p} />

        {!p.isMe && hasOwnAlbum && (
          <div className="share-album">
            {p.iSharedAlbum ? (
              <>
                <p className="small"><LockIcon /> Le compartiste tu álbum · {untilLabel(p.sharedUntil)}</p>
                <div className="row">
                  <button className="btn btn--ghost" onClick={() => setSharing(!sharing)}>Cambiar plazo</button>
                  <button className="btn btn--ghost" onClick={unshareAlbum}>Dejar de compartir</button>
                </div>
              </>
            ) : (
              <button className="btn btn--ghost" onClick={() => setSharing(!sharing)} aria-expanded={sharing}>
                <LockIcon /> Compartirle mi álbum privado
              </button>
            )}
            {sharing && (
              <div className="share-album__options" role="group" aria-label="Por cuánto tiempo">
                <p className="muted small">¿Por cuánto tiempo lo puede ver?</p>
                <div className="chips">
                  {SHARE_OPTIONS.map((o) => (
                    <button key={o.label} className="chip" onClick={() => shareAlbum(o.hours)}>{o.label}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {!p.isMe && <InviteToGroups userId={p.id} name={p.displayName} />}

        {!p.isMe && (
          <div className="profile__safety">
            {confirmBlock ? (
              <div className="confirm">
                <p>¿Bloquear a {p.displayName}? No van a poder verse ni escribirse, y dejás de ver sus mensajes en los grupos.</p>
                <div className="row">
                  <button className="btn" onClick={() => setConfirmBlock(false)}>Cancelar</button>
                  <button className="btn btn--danger" onClick={doBlock}>Bloquear</button>
                </div>
              </div>
            ) : (
              <div className="row">
                <button className="btn btn--ghost" onClick={() => setConfirmBlock(true)}>Bloquear</button>
                <button className="btn btn--ghost" onClick={() => setReporting(true)}>Reportar</button>
              </div>
            )}
          </div>
        )}
      </div>
      {viewing != null && p.privateAlbum?.items && (
        <AlbumViewer items={p.privateAlbum.items} start={viewing} title={`Álbum de ${p.displayName}`} onClose={closeViewer} />
      )}
      {reporting && <ReportDialog userId={p.id} name={p.displayName} onClose={() => setReporting(false)} />}
    </div>
  );
}

function albumCount(total: number, videos: number) {
  const photos = total - videos;
  const parts = [];
  if (photos) parts.push(`${photos} ${photos === 1 ? "foto" : "fotos"}`);
  if (videos) parts.push(`${videos} ${videos === 1 ? "video" : "videos"}`);
  return parts.join(" y ");
}
