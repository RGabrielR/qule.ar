import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

type CloseWatcherConstructor = new () => EventTarget & { destroy(): void };

export function useSectionBack(parent: string) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const fromNotification = (pathname === "/toques" || /^\/mensajes\/[^/]+$/.test(pathname)) &&
    new URLSearchParams(search).get("aviso") === "1";

  useEffect(() => {
    const { CloseWatcher } = window as Window & { CloseWatcher?: CloseWatcherConstructor };
    const installedOnAndroid = /Android/i.test(navigator.userAgent) && window.matchMedia("(display-mode: standalone)").matches;
    if (!fromNotification || !CloseWatcher || !installedOnAndroid) return;

    // Una notificación puede abrir la app sin una pantalla anterior en el historial.
    const watcher = new CloseWatcher();
    watcher.addEventListener("close", () => navigate(parent, { replace: true }));
    return () => watcher.destroy();
  }, [fromNotification, pathname, navigate, parent]);

  return () => navigate(parent, { replace: fromNotification });
}
