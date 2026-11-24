import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { api, type Media, type PublicProfile } from "../api";
import { BackIcon, LockIcon, StarIcon } from "../components/Icons";
import { useMe } from "../App";
import { useTabData } from "../features/navigation/tabData";
import { InviteToGroups } from "../components/Invite";
import { ReportDialog } from "../components/ReportDialog";
import { StaffDialog } from "../components/StaffDialog";
import { albumCount, AlbumGrid, AlbumViewer, untilLabel } from "../components/AlbumViewer";
import { ProfileCover, ProfileStats } from "../components/ProfileContent";
import { ReactionIcon, ReactionPicker } from "../components/Reactions";
import { reactionLabel } from "../reactions";
import { ProfileSwitcher } from "../features/profileSwipe/ProfileSwitcher";
import { useProfileSwipe } from "../features/profileSwipe/useProfileSwipe";
import { ShareAlbums } from "../features/photos/ShareAlbums";

export function ProfilePage() {
  const { id = "" } = useParams();
  // Cada perfil arranca de cero (sin diálogos abiertos ni scroll), también al deslizar al siguiente.
  return <ProfileView key={id} id={id} />;
}

function ProfileView({ id }: { id: string }) {
  const nav = useNavigate();
  const [p, setP] = useState<PublicProfile | null>(null);
  const [missing, setMissing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [staffing, setStaffing] = useState(false);
  const { me } = useMe();
  const isOwner = Boolean(me?.user.access?.includes("owner"));
  const { refreshAfterBlock } = useTabData();
  const [params, setParams] = useSearchParams();
  // ?album=1 (desde el mensaje del chat) abre el álbum directo
  const [viewing, setViewing] = useState<{ items: Media[]; start: number; title: string } | null>(null);
  const [toquePicker, setToquePicker] = useState(false);
  const [toqueMsg, setToqueMsg] = useState("");
  const swipe = useProfileSwipe(id, viewing == null && !reporting && !staffing);
  const swipeProps = { ref: swipe.page, ...swipe.handlers };
  const swipeClass = swipe.active ? " profile--swipe" : "";

  useEffect(() => {
    setP(null);
    setMissing(false);
    api<PublicProfile>(`/users/${id}`).then((x) => {
      setP(x);
      const first = x.privateAlbum?.albums[0];
      if (params.get("album") === "1" && first) setViewing({ items: first.items, start: 0, title: first.name });
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
    refreshAfterBlock();
    nav(-1);
  }

  if (missing) {
    return (
      <div className={`page${swipeClass}`} {...swipeProps}>
        <header className="topbar">
          <button className="iconbtn" onClick={() => nav(-1)} aria-label="Volver"><BackIcon /></button>
          {swipe.active && <ProfileSwitcher swipe={swipe} className="topbar__actions" />}
        </header>
        <div className="empty"><p className="empty__title">Este perfil no está disponible</p></div>
      </div>
    );
  }
  if (!p) {
    // Mientras carga, si venís de la grilla ya se ve su foto chica.
    const thumb = swipe.current?.photo;
    return (
      <div className={`page profile${swipeClass}`} {...swipeProps}>
        {thumb && <div className="profile__photo"><img src={thumb} alt="" /></div>}
      </div>
    );
  }

  return (
    <div className={`page profile${swipeClass}`} {...swipeProps}>
      <ProfileCover
        key={p.id}
        photos={p.photos}
        displayName={p.displayName}
        age={p.age}
        status={p}
        back={<button className="iconbtn iconbtn--float" onClick={() => nav(-1)} aria-label="Volver"><BackIcon /></button>}
        aside={swipe.active && <ProfileSwitcher swipe={swipe} className="profile-switch--cover" />}
      />

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

        {p.privateAlbum && (p.privateAlbum.albums.length ? p.privateAlbum.albums.map((a) => (
          <section className="album" key={a.id}>
            <h3 className="album__title">
              <LockIcon /> {a.name} · {albumCount(a.count, a.videos)}
            </h3>
            {!p.isMe && <p className="muted small album__until">Lo podés ver {untilLabel(a.expiresAt)}.</p>}
            <AlbumGrid items={a.items} onOpen={(start) => setViewing({ items: a.items, start, title: p.isMe ? a.name : `${a.name} · ${p.displayName}` })} />
          </section>
        )) : (
          <section className="album">
            <h3 className="album__title">
              <LockIcon /> Álbum privado · {albumCount(p.privateAlbum.count, p.privateAlbum.videos)}
            </h3>
            <p className="muted small">{p.displayName} todavía no te compartió ningún álbum.</p>
          </section>
        ))}

        <ProfileStats p={p} />

        {!p.isMe && me && (
          <ShareAlbums
            userId={p.id}
            name={p.displayName}
            me={me}
            shares={p.myShares}
            onChange={(myShares) => setP({ ...p, myShares, iSharedAlbum: myShares.length > 0 })}
          />
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
                {isOwner && <button className="btn btn--ghost" onClick={() => setStaffing(true)}>Moderación</button>}
              </div>
            )}
          </div>
        )}
      </div>
      {viewing && <AlbumViewer items={viewing.items} start={viewing.start} title={viewing.title} onClose={closeViewer} />}
      {reporting && <ReportDialog userId={p.id} name={p.displayName} onClose={() => setReporting(false)} />}
      {staffing && <StaffDialog userId={p.id} name={p.displayName} onClose={() => setStaffing(false)} />}
    </div>
  );
}
