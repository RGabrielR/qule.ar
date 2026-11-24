import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { useMe } from "../App";
import { albumCount, AlbumViewer } from "../components/AlbumViewer";
import { EditIcon, EyeIcon, LockIcon, SettingsIcon, StarIcon } from "../components/Icons";
import { ProfileCover, ProfileStats } from "../components/ProfileContent";

export function MyProfileOverview() {
  const { me } = useMe();
  const [viewingAlbum, setViewingAlbum] = useState<string | null>(null);
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    api<{ count: number }>("/toques/unseen").then(({ count }) => setUnseen(count)).catch(() => {});
  }, []);

  if (!me?.profile) return null;
  const { profile, photos } = me;
  const publicPhotos = photos.filter((photo) => !photo.isPrivate).map((photo) => photo.url);
  // Cada álbum privado con lo que tiene adentro (los vacíos no se muestran acá)
  const albums = me.albums.flatMap((a) => {
    const items = photos.filter((photo) => photo.isPrivate && photo.albumId === a.id);
    return items.length ? [{ ...a, items, videos: items.filter((photo) => photo.kind === "video").length }] : [];
  });
  const viewing = albums.find((a) => a.id === viewingAlbum);

  return (
    <div className="page profile">
      <header className="topbar">
        <p className="topbar__title">Mi perfil</p>
        <Link to="/yo/configuracion" className="iconbtn" aria-label="Configuración" title="Configuración">
          <SettingsIcon />
        </Link>
      </header>

      <ProfileCover photos={publicPhotos} displayName={profile.displayName} age={profile.age} />

      <div className="profile__body">
        <Link to="/yo/editar" className="btn btn--primary"><EditIcon /> Editar perfil</Link>

        <section aria-labelledby="my-profile-activity">
          <h2 id="my-profile-activity" className="section__title">Tu actividad</h2>
          <nav className="quicklinks" aria-label="Tu actividad">
            <Link to="/visitas" className="quicklink"><EyeIcon /> Quién me vio</Link>
            <Link to="/favoritos" className="quicklink"><StarIcon size={18} /> Favoritos</Link>
            <Link to="/toques" className="quicklink">
              <img src="/reacciones/rayo.svg" alt="" width={18} height={18} /> Toques
              {unseen > 0 && <span className="badge badge--inline" aria-label={`${unseen} sin ver`}>{unseen}</span>}
            </Link>
            {me.user.isAdmin && <Link to="/admin" className="quicklink quicklink--wide">Moderación</Link>}
          </nav>
        </section>

        <section aria-labelledby="my-profile-details">
          <h2 id="my-profile-details" className="section__title">Sobre vos</h2>
          <div className="stack">
            <ProfileStats p={profile} empty={<p className="muted">Agregá los datos que quieras mostrar desde Editar perfil.</p>} />
          </div>
        </section>

        {albums.length ? albums.map((a) => (
          <section className="album my-profile__album" key={a.id}>
            <div>
              <h2 className="album__title"><LockIcon /> {a.name}</h2>
              <p className="muted small">{albumCount(a.items.length, a.videos)}</p>
            </div>
            <button type="button" className="btn btn--small" onClick={() => setViewingAlbum(a.id)} aria-label={`Ver ${a.name}`}>Ver álbum</button>
          </section>
        )) : (
          <section className="album my-profile__album">
            <div>
              <h2 className="album__title"><LockIcon /> Álbum privado</h2>
              <p className="muted small">Todavía no agregaste archivos.</p>
            </div>
          </section>
        )}
      </div>

      {viewing && <AlbumViewer items={viewing.items} title={viewing.name} onClose={() => setViewingAlbum(null)} />}
    </div>
  );
}
