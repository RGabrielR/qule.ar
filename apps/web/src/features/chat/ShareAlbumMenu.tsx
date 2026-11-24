import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../../api";
import { useMe } from "../../App";
import { BackIcon, LockIcon } from "../../components/Icons";
import { ShareAlbums } from "../photos/ShareAlbums";

type Share = { albumId: string; expiresAt: string | null };

/**
 * Compartir los álbumes privados desde el chat, cada uno con su plazo, igual que en el perfil.
 * El aviso le llega a la otra persona como mensaje en esta conversación (lo manda la API por el socket).
 */
export function ShareAlbumMenu({ userId, name, onBack }: { userId: string; name: string; onBack: () => void }) {
  const { me } = useMe();
  const hasAlbum = Boolean(me?.photos.some((x) => x.isPrivate));
  // undefined: cargando
  const [shares, setShares] = useState<Share[] | undefined>(undefined);

  useEffect(() => {
    if (!hasAlbum) return;
    let alive = true;
    api<{ id: string; albumId: string; expiresAt: string | null }[]>("/album/grants")
      .then((list) => alive && setShares(list.filter((g) => g.id === userId).map(({ albumId, expiresAt }) => ({ albumId, expiresAt }))))
      .catch(() => alive && setShares([]));
    return () => {
      alive = false;
    };
  }, [hasAlbum, userId]);

  return (
    <div className="album-menu" role="group" aria-label="Compartir álbumes privados">
      <div className="album-menu__head">
        <button type="button" className="iconbtn" aria-label="Volver a las opciones" onClick={onBack}><BackIcon /></button>
        <p className="small"><LockIcon /> Álbum privado</p>
      </div>
      {!hasAlbum || !me ? (
        <p className="muted small">
          Todavía no tenés fotos en tu álbum privado. <Link to="/yo/editar">Sumá alguna desde tu perfil</Link>.
        </p>
      ) : shares === undefined ? (
        <p className="muted small">Cargando…</p>
      ) : (
        <ShareAlbums userId={userId} name={name} me={me} shares={shares} onChange={setShares} inline />
      )}
    </div>
  );
}
