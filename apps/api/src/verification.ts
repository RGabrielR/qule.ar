import { and, eq, gte } from "drizzle-orm";
import { db, schema } from "./db/index.js";
import { env } from "./env.js";

/**
 * ¿El perfil aparece en Gente? Las cuentas nuevas, recién cuando confirman el mail (las de Google ya vienen
 * confirmadas). Las creadas antes de EMAIL_VERIFY_SINCE siguen apareciendo aunque no lo hayan confirmado.
 */
export const isListed = (u: { emailVerified: boolean; createdAt: Date }) =>
  u.emailVerified || u.createdAt < env.EMAIL_VERIFY_SINCE;

/**
 * Cuentas que todavía no aparecen en Gente: nuevas y sin el mail confirmado. Son pocas (las de las últimas horas),
 * así que la grilla las saca en memoria, como a las ocultas por reportes, en vez de cruzar cada consulta con la
 * tabla entera de cuentas: eso le sumaba un 40 % a la consulta más usada de la app.
 *
 * Se recuerda 30 segundos por proceso. Al confirmar el mail se olvida al toque en este proceso (ver auth.ts); en los
 * demás, la persona aparece en Gente como mucho 30 segundos después.
 */
const TTL_MS = 30_000;
let cached: { ids: Set<string>; until: number } | null = null;
let pending: Promise<Set<string>> | null = null;

export async function unlistedUsers(now = Date.now()): Promise<Set<string>> {
  if (cached && cached.until > now) return cached.ids;
  pending ??= db.select({ id: schema.user.id }).from(schema.user)
    .where(and(eq(schema.user.emailVerified, false), gte(schema.user.createdAt, env.EMAIL_VERIFY_SINCE)))
    .then((rows) => {
      const ids = new Set(rows.map((r) => r.id));
      cached = { ids, until: Date.now() + TTL_MS };
      return ids;
    })
    .finally(() => { pending = null; });
  return pending;
}

/** Olvida la lista (por ejemplo, porque alguien acaba de confirmar su mail). */
export function forgetUnlisted() {
  cached = null;
}
