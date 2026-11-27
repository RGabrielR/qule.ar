import { useEffect, useEffectEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { markBack } from "./features/navigation/pageTransition";

type CloseWatcherConstructor = new () => EventTarget & { destroy(): void };

export function useInstalledAndroidBack(enabled: boolean, onBack: () => void) {
  const { key } = useLocation();
  const handleBack = useEffectEvent(onBack);

  useEffect(() => {
    const { CloseWatcher } = window as Window & { CloseWatcher?: CloseWatcherConstructor };
    const installedOnAndroid = /Android/i.test(navigator.userAgent) && window.matchMedia("(display-mode: standalone)").matches;
    if (!enabled || !CloseWatcher || !installedOnAndroid) return;
    const watcher = new CloseWatcher();
    watcher.addEventListener("close", () => handleBack());
    return () => watcher.destroy();
  }, [enabled, key]);
}

export function useSectionBack(parent: string) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const fromNotification = (pathname === "/toques" || /^\/mensajes\/[^/]+$/.test(pathname) || /^\/grupos\/[^/]+(?:\/solicitudes)?$/.test(pathname)) &&
    new URLSearchParams(search).get("aviso") === "1";

  // Una notificación puede abrir la app sin una pantalla anterior en el historial.
  useInstalledAndroidBack(fromNotification, () => navigate(parent, { replace: true }));

  // Si se llegó desde otra pantalla de la app, Volver vuelve a esa misma vista (con su búsqueda y su scroll).
  // Si no hay pantalla anterior (se abrió desde una notificación o un link), va a la sección.
  // Volver con el botón de la app anima la pantalla anterior desde la izquierda (ver pageTransition.ts).
  return () => {
    markBack();
    if (window.history.state?.idx > 0 && !fromNotification) navigate(-1);
    else navigate(parent, { replace: fromNotification });
  };
}
