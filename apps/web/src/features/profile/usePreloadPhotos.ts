import { useEffect } from "react";

/**
 * Baja por detrás las fotos de un perfil que no se están mirando, de a una y empezando por la siguiente: al pasar de
 * foto ya está en caché y se ve en el acto, sin esqueleto. Arranca cuando ya se ve la primera (`ready`), para no
 * competir con ella. Con el ahorro de datos del celu prendido, no baja nada.
 */
export function usePreloadPhotos(photos: string[] | undefined, current: number, ready: boolean) {
  useEffect(() => {
    if (!ready || !photos || photos.length < 2) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;
    // La siguiente primero, después las demás en orden (y la anterior al final)
    const order = photos.map((_, i) => photos[(current + 1 + i) % photos.length]);
    let cancelled = false;
    void (async () => {
      for (const url of order) {
        if (cancelled) return;
        const img = new Image();
        img.decoding = "async";
        img.src = url;
        await img.decode().catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Solo al abrir el perfil (o si cambian sus fotos): pasar de foto no vuelve a empezar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, ready]);
}
