import { useState, type ReactNode } from "react";

type Props = { photo?: string; preview?: string; alt: string; fallback: ReactNode };

export function ProfileCoverImage({ photo, preview, alt, fallback }: Props) {
  const [previewReady, setPreviewReady] = useState(false);
  const [photoState, setPhotoState] = useState<"loading" | "ready" | "failed">("loading");
  const showPhoto = photoState === "ready";
  const showPreview = previewReady && !showPhoto;

  return (
    <div className="profile__cover-media">
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
