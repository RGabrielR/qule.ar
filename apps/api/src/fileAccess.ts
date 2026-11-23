import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { auth, type AuthUser } from "./auth.js";
import { db, schema } from "./db/index.js";
import type { AppEnv } from "./lib.js";
import { remember, sessionCookie } from "./fileCache.js";

/**
 * Atajos para /api/files, el pedido más repetido de la app: una grilla de Gente son 60 fotos.
 * Antes, cada foto buscaba la sesión, el perfil y de qué era el archivo: entre 4 y 6 consultas a la base.
 *
 * - La sesión se recuerda un minuto por cookie. Cerrar sesión o una suspensión tardan como mucho eso en
 *   cortar el acceso a las fotos; el resto de la API sigue chequeando en cada pedido.
 * - Las fotos públicas (de perfil o de un grupo activo) se recuerdan un minuto. Al borrarlas, pasarlas al
 *   álbum privado o dar de baja el grupo se olvidan al toque en todos los procesos (forgetFile).
 * - Las privadas, las de mensajes y los videos se chequean siempre, como antes.
 */

const SESSION_MS = 60_000;

type CachedSession = { user: AuthUser; suspended: boolean; until: number };
const sessions = new Map<string, CachedSession>();

/** Como requireUser, pero recordando la sesión un minuto. Solo deja `user`: /files no usa el perfil. */
export const requireUserForFiles = createMiddleware<AppEnv>(async (c, next) => {
  const token = sessionCookie(c.req.header("cookie"));
  const now = Date.now();
  let s = token ? sessions.get(token) : undefined;
  if (!s || s.until < now) {
    const found = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!found) {
      if (token) sessions.delete(token);
      throw new HTTPException(401, { message: "Tenés que iniciar sesión" });
    }
    const [p] = await db.select({ suspendedAt: schema.profile.suspendedAt }).from(schema.profile)
      .where(eq(schema.profile.userId, found.user.id));
    s = { user: found.user, suspended: Boolean(p?.suspendedAt), until: now + SESSION_MS };
    if (token) remember(sessions, token, s);
  }
  if (s.suspended) throw new HTTPException(403, { message: "Tu cuenta está suspendida" });
  c.set("user", s.user);
  await next();
});

export { forgetFile, isKnownPublic, rememberPublic } from "./fileCache.js";
