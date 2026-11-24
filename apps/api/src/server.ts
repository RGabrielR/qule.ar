import cluster from "node:cluster";
import { existsSync, readFileSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { auth } from "./auth.js";
import { closeDb, db, runMigrations, schema } from "./db/index.js";
import { encryptLegacyHealth } from "./db/health.js";
import { checkDataKey } from "./crypt.js";
import { env } from "./env.js";
import { APP_NAME } from "./brand.js";
import type { AppEnv } from "./lib.js";
import { attachRealtime } from "./realtime.js";
import { groupRoutes } from "./routes/groups.js";
import { meRoutes } from "./routes/me.js";
import { socialRoutes } from "./routes/social.js";
import { nearbyRoutes } from "./routes/nearby.js";
import { premiumRoutes } from "./routes/premium.js";
import { adminRoutes } from "./routes/admin.js";
import { toqueRoutes } from "./routes/toques.js";
import { appealRoutes } from "./routes/appeals.js";
import { securityHeaders } from "./security.js";
import { limitApiBody } from "./requestBody.js";
import { sweepExpiredPhotos } from "./expiring.js";
import { purgeRemovedGroups, scanExistingGroups } from "./moderation.js";
import { signalReady } from "./shared.js";

checkDataKey();

// Con varios procesos (ver cluster.ts), lo que no se puede repetir lo hace solo el líder: migrar la base,
// las tareas cada tanto y publicar los mensajes en cola. Con un solo proceso, este es el líder.
const leader = !cluster.isWorker || process.env.LEADER === "1";

if (leader) {
  await runMigrations();
  const encryptedProfiles = await encryptLegacyHealth(db);
  if (encryptedProfiles) console.log(`Datos de salud cifrados: ${encryptedProfiles} perfiles`);

  // Fotos temporales ya vistas: se borran al arrancar (por si el API se reinició justo después de abrir una) y cada minuto
  await sweepExpiredPhotos().catch((e) => console.error("sweepExpiredPhotos", e));
  setInterval(() => sweepExpiredPhotos().catch((e) => console.error("sweepExpiredPhotos", e)), 60_000).unref();

  // Grupos dados de baja hace más de 90 días: se borran del todo (sus reportes conservan la copia)
  await purgeRemovedGroups().catch((e) => console.error("purgeRemovedGroups", e));
  // Grupos que ya existían con nombres que ahora no se permiten: van a moderación (no se repite si ya se revisó)
  await scanExistingGroups().catch((e) => console.error("scanExistingGroups", e));
  setInterval(() => purgeRemovedGroups().catch((e) => console.error("purgeRemovedGroups", e)), 6 * 3_600_000).unref();

  // El chat general existe siempre
  const [general] = await db.select().from(schema.group).where(eq(schema.group.isGeneral, true));
  if (!general) {
    await db.insert(schema.group).values({
      id: "general",
      name: "General",
      description: "El chat de toda la app. Modo lento activado: un mensaje por minuto, ráfagas de dos.",
      isGeneral: true,
    });
  }
}

const app = new Hono<AppEnv>();

// Encabezados de seguridad en todas las respuestas (ver security.ts). La CSP necesita el index.html compilado
// para permitir, por su hash, el único script en línea (el del tema).
const indexPath = path.join(env.WEB_DIST, "index.html");
// Los íconos de la app (icon-192.png…) se pueden mostrar desde otros sitios: el logo de los mails sale de acá
// y los clientes de mail web lo cargan desde su propio dominio. Son imágenes públicas, no exponen nada.
// Va antes de securityHeaders para correr después que él y ganarle al "same-origin" que pone por defecto.
app.use("/icon-*", async (c, next) => {
  await next();
  if (/^\/icon-[\w-]+\.png$/.test(c.req.path)) c.res.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
});
app.use("*", securityHeaders(env.APP_URL, existsSync(indexPath) ? readFileSync(indexPath, "utf8") : null));

// Si entran por otra dirección (www, el túnel provisorio viejo), los mandamos al dominio principal.
// Solo en producción (APP_URL con https) y nunca para localhost, así no molesta en desarrollo ni en los chequeos del server.
const canonical = new URL(env.APP_URL);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
if (canonical.protocol === "https:") {
  app.use("*", async (c, next) => {
    const host = (c.req.header("host") ?? "").replace(/:\d+$/, "").toLowerCase();
    if (!host || host === canonical.hostname || LOCAL_HOSTS.has(host)) return next();
    const { pathname, search } = new URL(c.req.url);
    // 301 para GET; 308 para el resto, así un POST sigue siendo POST
    const status = c.req.method === "GET" || c.req.method === "HEAD" ? 301 : 308;
    return c.redirect(`${canonical.origin}${pathname}${search}`, status);
  });
}

app.use("/api/*", limitApiBody);
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
app.route("/api", meRoutes);
app.route("/api", groupRoutes);
app.route("/api", socialRoutes);
app.route("/api", nearbyRoutes);
app.route("/api", premiumRoutes);
app.route("/api", adminRoutes);
app.route("/api", toqueRoutes);
app.route("/api", appealRoutes);
app.all("/api/*", (c) => c.json({ error: "No existe" }, 404));

// En producción el API también sirve la web compilada (un solo proceso, un solo puerto)
if (existsSync(env.WEB_DIST)) {
  const index = readFileSync(path.join(env.WEB_DIST, "index.html"), "utf8");
  app.use("/*", serveStatic({
    root: path.relative(process.cwd(), env.WEB_DIST),
    onFound: (p, c) => {
      // Los assets con hash se cachean para siempre; el resto, no
      c.header("Cache-Control", p.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
    },
  }));
  // Rutas de la app (SPA): todo lo demás devuelve index.html
  app.get("*", (c) => c.html(index, 200, { "Cache-Control": "no-cache" }));
}

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  if (err && typeof err === "object" && "issues" in err) return c.json({ error: "Datos inválidos" }, 400);
  console.error(err);
  return c.json({ error: "Algo salió mal" }, 500);
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  const who = cluster.isWorker ? ` (proceso ${cluster.worker?.id}${leader ? ", líder" : ""})` : "";
  console.log(`${APP_NAME} API escuchando en http://localhost:${info.port}${who}`);
  signalReady();
});
attachRealtime(server as HttpServer, { publishQueued: leader });

// Apagado ordenado: dejar de recibir pedidos y cerrar la base antes de salir.
// - Producción: docker stop manda SIGTERM, y así se cierran bien las conexiones a Postgres.
// - Desarrollo: Ctrl+C (SIGINT), o el pedido "shutdown" que manda scripts/dev.mjs antes de reiniciar.
//   Sin esto, la base local (PGlite) a veces queda dañada y no vuelve a abrir. En Windows las señales
//   matan el proceso sin dejarlo limpiar, por eso el reinicio se pide por IPC.
let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.log(`${signal}: cerrando…`);
  const force = setTimeout(() => process.exit(1), 5_000);
  force.unref();
  (server as HttpServer).close();
  await closeDb().catch((e) => console.error("closeDb", e));
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void shutdown(signal));
process.on("message", (msg) => {
  if (msg === "shutdown") void shutdown("reinicio");
});
