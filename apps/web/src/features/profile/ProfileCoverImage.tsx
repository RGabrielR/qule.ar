import { useState, type ReactNode } from "react";

/** blur: la foto va borrosa (foto explícita, si eligió taparlas; ver features/explicit). */
type Props = { photo?: string; preview?: string; alt: string; fallback: ReactNode; blur?: boolean };

export function ProfileCoverImage({ photo, preview, alt, fallback, blur = false }: Props) {
  const [previewReady, setPreviewReady] = useState(false);
  const [photoState, setPhotoState] = useState<"loading" | "ready" | "failed">("loading");
  const showPhoto = photoState === "ready";
  const showPreview = previewReady && !showPhoto;

  return (
    <div className={blur ? "profile__cover-media profile__cover-media--blur" : "profile__cover-media"}>
      {!showPreview && !showPhoto && (photoState === "failed"
        ? fallback
        : <div className="profile__skeleton" aria-hidden="true" />)}
      {preview && !showPhoto && (
        <img src={preview} alt={alt} hidden={!showPreview} onLoad={() => setPreviewReady(true)} />
      )}
      {photo && (
        <img
          src={photo}
          alt={alt}
          hidden={!showPhoto}
          onLoad={(event) => {
            void event.currentTarget.decode().then(() => setPhotoState("ready"), () => setPhotoState("failed"));
          }}
          onError={() => setPhotoState("failed")}
        />
      )}
    </div>
  );
}
