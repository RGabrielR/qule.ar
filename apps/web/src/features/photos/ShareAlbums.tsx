import { useState } from "react";
import { api, type Me, type PublicProfile } from "../../api";
import { albumCount, untilLabel } from "../../components/AlbumViewer";
import { LockIcon } from "../../components/Icons";

export const SHARE_OPTIONS: { hours: number | null; label: string }[] = [
  { hours: 1, label: "1 hora" },
  { hours: 24, label: "24 horas" },
  { hours: 168, label: "7 días" },
  { hours: null, label: "Sin límite" },
];

type Share = PublicProfile["myShares"][number];

/**
 * Compartirle a alguien mis álbumes privados desde su perfil, cada uno por separado y con su plazo.
 * Solo aparecen los álbumes que tienen algo adentro.
 * inline: la lista se ve de entrada, sin el botón que la abre (en el menú de fotos del chat).
 */
export function ShareAlbums({ userId, name, me, shares, onChange, inline = false }: {
  userId: string;
  name: string;
  me: Me;
  shares: Share[];
  onChange: (shares: Share[]) => void;
  inline?: boolean;
}) {
  const [toggled, setOpen] = useState(false);
  const open = inline || toggled;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const albums = me.albums.flatMap((a) => {
    const items = me.photos.filter((p) => p.isPrivate && p.albumId === a.id);
    return items.length ? [{ ...a, count: items.length, videos: items.filter((p) => p.kind === "video").length }] : [];
  });
  if (!albums.length) return null;
  const shared = albums.filter((a) => shares.some((s) => s.albumId === a.id));

  async function run(action: () => Promise<Share[]>) {
    setBusy(true);
    setError("");
    try {
      onChange(await action());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const share = (albumId: string, hours: number | null) => run(async () => {
    const r = await api<{ expiresAt: string | null }>(`/album/albums/${albumId}/grants/${userId}`, { method: "PUT", json: { hours } });
    return [...shares.filter((s) => s.albumId !== albumId), { albumId, expiresAt: r.expiresAt }];
  });
  const unshare = (albumId: string) => run(async () => {
    await api(`/album/albums/${albumId}/grants/${userId}`, { method: "DELETE" });
    return shares.filter((s) => s.albumId !== albumId);
  });

  return (
    <div className="share-album">
      {shared.length > 0 && !inline && (
        <p className="small">
          <LockIcon /> {shared.length === 1 ? `Le compartiste «${shared[0].name}»` : `Le compartiste ${shared.length} álbumes`}
        </p>
      )}
      {!inline && (
        <button className="btn btn--ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          <LockIcon /> {shared.length ? "Cambiar qué álbumes ve" : albums.length === 1 ? "Compartirle mi álbum privado" : "Compartirle un álbum privado"}
        </button>
      )}
      {open && (
        <ul className="share-album__list" aria-label={`Tus álbumes para ${name}`}>
          {albums.map((a) => {
            const s = shares.find((x) => x.albumId === a.id);
            return (
              <li key={a.id} className="share-album__options">
                <div className="share-album__head">
                  <strong>{a.name}</strong>
                  <span className="muted small">{albumCount(a.count, a.videos)}</span>
                </div>
                <p className="muted small">{s ? `Lo ve ${untilLabel(s.expiresAt)}.` : "No lo ve. ¿Por cuánto tiempo se lo compartís?"}</p>
                <div className="chips" role="group" aria-label={`Por cuánto tiempo ve ${a.name}`}>
                  {SHARE_OPTIONS.map((o) => (
                    <button key={o.label} className="chip" disabled={busy} onClick={() => share(a.id, o.hours)}>{o.label}</button>
                  ))}
                </div>
                {s && <button className="linkbtn linkbtn--danger share-album__stop" disabled={busy} onClick={() => unshare(a.id)}>Dejar de compartir</button>}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
