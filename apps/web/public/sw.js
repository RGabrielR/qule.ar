// Service worker de qule.ar: hace la app instalable y recibe notificaciones push.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = { title: "qule.ar", body: "Tenés novedades", url: "/" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* payload vacío o inválido: usamos el texto genérico */
  }
  event.waitUntil(
    (async () => {
      // Solo se omite si la persona está mirando justo esa pantalla, en la ventana que tiene el foco.
      // Antes alcanzaba con que la app estuviera "visible": en la compu una pestaña abierta atrás de otra
      // ventana cuenta como visible, así que los avisos no aparecían nunca.
      const path = new URL(data.url || "/", self.location.origin).pathname;
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const looking = wins.some((w) => w.focused && w.visibilityState === "visible" && new URL(w.url).pathname === path);
      if (looking && !data.always) return;
      await self.registration.showNotification(data.title, {
        body: data.body,
        icon: "/icon-192.png",
        // Silueta blanca con fondo transparente: con un PNG a color, Android muestra un cuadrado blanco
        badge: "/badge-96.png",
        tag: data.tag,
        renotify: Boolean(data.tag),
        data: { url: data.url },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || "/", self.location.origin);
  const target = destination.origin === self.location.origin ? destination : new URL("/", self.location.origin);
  if (target.pathname === "/toques" || /^\/mensajes\/[^/]+$/.test(target.pathname)) {
    target.searchParams.set("aviso", "1");
  }
  const url = target.href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin) {
          await w.focus();
          return w.navigate(url);
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
