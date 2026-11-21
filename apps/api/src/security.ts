import { createHash } from "node:crypto";
import { secureHeaders } from "hono/secure-headers";

/**
 * Encabezados de seguridad para todas las respuestas (API y web).
 *
 * - CSP: la página solo carga código y estilos propios (y las fuentes de Google). Si alguien logra meter
 *   HTML en un mensaje o un perfil, el navegador igual no ejecuta scripts que no sean nuestros.
 *   El único script en línea es el del tema en index.html: se permite por su hash, calculado al arrancar.
 * - Nadie puede meter la app dentro de un iframe (clickjacking).
 * - En producción (https), HSTS: el navegador no vuelve a entrar nunca por http.
 * - Permisos del navegador: solo la ubicación (para "Cerca"), y solo para la propia app.
 */
export function securityHeaders(appUrl: string, indexHtml: string | null) {
  const url = new URL(appUrl);
  const https = url.protocol === "https:";
  // El chat en vivo usa WebSocket en el mismo dominio
  const ws = `${https ? "wss" : "ws"}://${url.host}`;

  const inlineScripts = indexHtml
    ? [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
        (m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`,
      )
    : [];

  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ...inlineScripts],
      // 'unsafe-inline' en estilos: React usa style={…} para tamaños calculados (no ejecuta código)
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      // blob: para la vista previa de fotos y videos antes de subirlos
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'", ws],
      workerSrc: ["'self'", "blob:"], // El conversor HEIC corre en un worker creado desde el navegador.
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(https ? { upgradeInsecureRequests: [] } : {}),
    },
    xFrameOptions: "DENY",
    // Las direcciones internas (/perfil/…, /mensajes/…) no se le pasan a otros sitios
    referrerPolicy: "same-origin",
    strictTransportSecurity: https ? "max-age=31536000; includeSubDomains" : false,
    permissionsPolicy: {
      geolocation: ["self"],
      camera: [],
      microphone: [],
      payment: [],
      usb: [],
    },
  });
}
