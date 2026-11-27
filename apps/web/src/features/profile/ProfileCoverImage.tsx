import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** blur: la foto va borrosa (foto explícita, si eligió taparlas; ver features/explicit). */
type Props = { photo?: string; preview?: string; alt: string; fallback: ReactNode; blur?: boolean; onReady?: () => void };

/** Guarda, la primera vez que se monta la imagen, si ya estaba cargada (venía de caché). */
const rememberCached = (cached: { current: boolean | undefined }) => (img: HTMLImageElement | null) => {
  if (img && cached.current === undefined) cached.current = img.complete;
};

/** onReady: avisa cuando la foto ya se ve (o no se pudo cargar), para empezar a bajar las demás. */
export function ProfileCoverImage({ photo, preview, alt, fallback, blur = false, onReady }: Props) {
  const [previewReady, setPreviewReady] = useState(false);
  const [photoState, setPhotoState] = useState<"loading" | "ready" | "failed">("loading");
  const showPhoto = photoState === "ready";
  const showPreview = previewReady && !showPhoto;
  // Lo que reemplaza al esqueleto entra con un fundido, salvo que viniera de caché. La foto grande que
  // reemplaza a la vista previa no: es la misma imagen, solo se ve más nítida.
  const previewCached = useRef<boolean>(undefined);
  const photoCached = useRef<boolean>(undefined);
  const photoFade = useRef<boolean>(undefined);
  if (showPhoto && photoFade.current === undefined) photoFade.current = !photoCached.current && !previewReady;
  // Si la foto ya estaba bajada (ver usePreloadPhotos), se muestra antes de pintar: sin un cuadro de esqueleto
  const photoRef = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const img = photoRef.current;
    if (img?.complete && img.naturalWidth) setPhotoState("ready");
  }, []);
  useEffect(() => {
    if (photoState !== "loading") onReady?.();
    // Solo cuando cambia el estado de la foto
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoState]);

  return (
    <div className={blur ? "profile__cover-media profile__cover-media--blur" : "profile__cover-media"}>
      {!showPreview && !showPhoto && (photoState === "failed"
        ? fallback
        : <div className="profile__skeleton" aria-hidden="true" />)}
      {preview && !showPhoto && (
        <img
          src={preview} alt={alt} hidden={!showPreview} onLoad={() => setPreviewReady(true)}
          ref={rememberCached(previewCached)} className={previewCached.current ? undefined : "profile__cover-fade"}
        />
      )}
      {photo && (
        <img
          src={photo}
          alt={alt}
          hidden={!showPhoto}
          ref={(img) => {
            photoRef.current = img;
            rememberCached(photoCached)(img);
          }}
          className={photoFade.current ?? !photoCached.current ? "profile__cover-fade" : undefined}
          onLoad={(event) => {
            void event.currentTarget.decode().then(() => setPhotoState("ready"), () => setPhotoState("failed"));
          }}
          onError={() => setPhotoState("failed")}
        />
      )}
    </div>
  );
}
