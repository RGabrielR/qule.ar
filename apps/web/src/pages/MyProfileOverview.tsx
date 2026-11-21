import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { useMe } from "../App";
import { albumCount, AlbumViewer } from "../components/AlbumViewer";
import { EditIcon, EyeIcon, LockIcon, SettingsIcon, StarIcon } from "../components/Icons";
import { ProfileCover, ProfileStats } from "../components/ProfileContent";

export function MyProfileOverview() {
  const { me } = useMe();
  const [viewingAlbum, setViewingAlbum] = useState(false);
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    api<{ count: number }>("/toques/unseen").then(({ count }) => setUnseen(count)).catch(() => {});
  }, []);

  if (!me?.profile) return null;
  const { profile, photos } = me;
  const publicPhotos = photos.filter((photo) => !photo.isPrivate).map((photo) => photo.url);
  const album = photos.filter((photo) => photo.isPrivate);
  const videos = album.filter((photo) => photo.kind === "video").length;

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
          </nav>
        </section>

        <section aria-labelledby="my-profile-details">
          <h2 id="my-profile-details" className="section__title">Sobre vos</h2>
          <div className="stack">
            <ProfileStats p={profile} empty={<p className="muted">Agregá los datos que quieras mostrar desde Editar perfil.</p>} />
          </div>
        </section>

        <section className="album my-profile__album">
          <div>
            <h2 className="album__title"><LockIcon /> Álbum privado</h2>
            <p className="muted small">{album.length ? albumCount(album.length, videos) : "Todavía no agregaste archivos."}</p>
          </div>
          {album.length > 0 && (
            <button type="button" className="btn btn--small" onClick={() => setViewingAlbum(true)}>Ver álbum</button>
          )}
        </section>
      </div>

      {viewingAlbum && album.length > 0 && (
        <AlbumViewer items={album} title="Tu álbum privado" onClose={() => setViewingAlbum(false)} />
      )}
    </div>
  );
}
