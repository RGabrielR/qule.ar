import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
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
import { usePageTransition } from "../features/navigation/pageTransition";
import { useSectionBack } from "../useSectionBack";
import { Skeleton, SkeletonText, SkeletonWait } from "../components/Skeleton";

export function ProfilePage() {
  const { id = "" } = useParams();
  // Cada perfil arranca de cero (sin diálogos abiertos ni scroll), también al deslizar al siguiente.
  return <ProfileView key={id} id={id} />;
}

function ProfileView({ id }: { id: string }) {
  const nav = useNavigate();
  const location = useLocation();
  // Deslizar al perfil siguiente reemplaza la pantalla (REPLACE): ahí anima useProfileSwipe, no esto
  const enter = usePageTransition();
  const goBack = useSectionBack("/cerca");
  const [p, setP] = useState<PublicProfile | null>(null);
  const [missing, setMissing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [staffing, setStaffing] = useState(false);
  const { me } = useMe();
  const isOwner = Boolean(me?.user.access?.includes("owner"));
  const { refreshAfterBlock } = useTabData();
  const [params, setParams] = useSearchParams();
  const requestedAlbum = params.get("album");
  const [viewing, setViewing] = useState<{ items: Media[]; start: number; title: string; fromChat?: boolean } | null>(null);
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
      const albums = x.privateAlbum?.albums;
      const selected = requestedAlbum === "1" ? albums?.[0] : albums?.find((album) => album.id === requestedAlbum);
      if (selected) setViewing({ items: selected.items, start: 0, title: selected.name, fromChat: Boolean(location.state?.fromChat) });
    }).catch(() => setMissing(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function closeViewer() {
    // Si el álbum se abrió desde el chat, cerrarlo vuelve al chat
    if (viewing?.fromChat) {
      nav(-1);
      return;
    }
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
      <div className={`page ${enter}${swipeClass}`} {...swipeProps}>
        <header className="topbar">
          <button className="iconbtn" onClick={goBack} aria-label="Volver"><BackIcon /></button>
          {swipe.active && <ProfileSwitcher swipe={swipe} className="topbar__actions" />}
        </header>
        <div className="empty"><p className="empty__title">Este perfil no está disponible</p></div>
      </div>
    );
  }
  const content = p && (
    <>
      {/* El perfil siempre llega después de la espera: el contenido sube suave en vez de reemplazar al esqueleto de golpe */}
      <div className="profile__body arrive">
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
            <ReactionPicker onPick={sendToque} label="Elegí un toque" toque />
          </div>
        )}
        {toqueMsg && <p className="muted small toque-msg" role="status">{toqueMsg}</p>}

        {p.privateAlbum && (p.privateAlbum.albums.length ? p.privateAlbum.albums.map((a) => (
          <section className="album" key={a.id}>
            <h3 className="album__title">
              <LockIcon /> {a.name} · {albumCount(a.count, a.videos)}
            </h3>
            {!p.isMe && <p className="muted small album__until">Lo podés ver {untilLabel(a.expiresAt)}. Las fotos llevan tu nombre encima: no las compartas.</p>}
            <AlbumGrid items={a.items} watermark={!p.isMe} onOpen={(start) => setViewing({ items: a.items, start, title: p.isMe ? a.name : `${a.name} · ${p.displayName}` })} />
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
      {viewing && <AlbumViewer items={viewing.items} start={viewing.start} title={viewing.title} onClose={closeViewer} watermark={!p.isMe} />}
      {reporting && <ReportDialog userId={p.id} name={p.displayName} onClose={() => setReporting(false)} />}
      {staffing && <StaffDialog userId={p.id} name={p.displayName} onClose={() => setStaffing(false)} />}
    </>
  );

  return (
    <div className={`page profile ${enter}${swipeClass}`} {...swipeProps}>
      <ProfileCover
        photos={p?.photos}
        photosBlur={p?.photosBlur}
        coverPhoto={swipe.current?.coverPhoto}
        coverBlur={swipe.current?.blur}
        displayName={p?.displayName}
        age={p?.age}
        status={p ?? undefined}
        back={<button className="iconbtn iconbtn--float" onClick={goBack} aria-label="Volver"><BackIcon /></button>}
        aside={swipe.active && <ProfileSwitcher swipe={swipe} className="profile-switch--cover" />}
      />
      {content ?? <ProfileSkeleton />}
    </div>
  );
}

/** Mientras llega el perfil: los botones de arriba, el texto y la tabla de datos, con su forma. */
function ProfileSkeleton() {
  return (
    <SkeletonWait className="profile__body">
      <div className="row">
        <Skeleton className="skeleton--btn skeleton--grow" />
        <Skeleton className="skeleton--btn skeleton--icon" />
        <Skeleton className="skeleton--btn skeleton--icon" />
      </div>
      <SkeletonText lines={2} />
      <Skeleton className="skeleton--stats" />
    </SkeletonWait>
  );
}
