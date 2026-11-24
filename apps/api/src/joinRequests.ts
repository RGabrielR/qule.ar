import { and, desc, eq, gt, lt, lte, not, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db/index.js";
import { authorsFor } from "./lib.js";

const { groupJoinRequest, photo, profile, user } = schema;

/** Solicitudes por página en la lista de un grupo. */
export const REQUESTS_PAGE = 30;
/** Días en los que una cuenta cuenta como "nueva" para el filtro de solicitudes. */
export const NEW_ACCOUNT_DAYS = 7;

/**
 * Cursor de la lista de solicitudes: fecha exacta (texto de Postgres, con microsegundos
 * y zona horaria, para no perder precisión al pasarlo por JS) + id para desempatar.
 */
export type RequestCursor = { t: string; id: string };

export function encodeCursor(c: RequestCursor): string {
  return Buffer.from(JSON.stringify([c.t, c.id])).toString("base64url");
}

export function decodeCursor(raw: string | undefined): RequestCursor | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(v) || typeof v[0] !== "string" || typeof v[1] !== "string") return null;
    // Solo aceptamos algo con forma de fecha, para que el ::timestamptz nunca falle
    if (Number.isNaN(Date.parse(v[0].replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")))) return null;
    return { t: v[0], id: v[1] };
  } catch {
    return null;
  }
}

const age = z.coerce.number().int().min(18).max(99);

/** Filtros de la lista de solicitudes (lo que llega por query string). */
export const requestFilters = z.object({
  cursor: z.string().max(200).optional(),
  /** con: tiene al menos una foto pública; sin: ninguna */
  foto: z.enum(["con", "sin"]).optional(),
  /** Cuenta creada hace menos de NEW_ACCOUNT_DAYS días */
  nueva: z.literal("1").optional(),
  edadMin: age.optional(),
  edadMax: age.optional(),
});
export type RequestFilters = z.infer<typeof requestFilters>;

/** Solicitudes que se resuelven como mucho en un pedido de lote. */
export const BULK_MAX = 200;

/**
 * Aceptar o rechazar en lote: o estas solicitudes (`ids`), o las que coinciden con estos filtros
 * (`filtros`, de la más nueva a la más vieja, hasta BULK_MAX por pedido).
 */
export const bulkInput = z.object({
  action: z.enum(["accept", "reject"]),
  ids: z.array(z.string().min(1).max(64)).min(1).max(BULK_MAX).optional(),
  filtros: requestFilters.omit({ cursor: true }).optional(),
}).refine((b) => (b.ids ? 1 : 0) + (b.filtros ? 1 : 0) === 1, { message: "Elegí solicitudes o filtros" });

/**
 * Fechas de nacimiento que corresponden a un rango de edad, hoy.
 * Tener `min` años o más ⇔ nació el (hoy - min años) o antes.
 * Tener `max` años o menos ⇔ nació después de (hoy - (max + 1) años).
 */
export function birthdateRange(min: number | undefined, max: number | undefined, now = new Date()) {
  const shift = (years: number) => {
    const d = new Date(Date.UTC(now.getFullYear() - years, now.getMonth(), now.getDate()));
    return d.toISOString().slice(0, 10);
  };
  return {
    bornOnOrBefore: min != null ? shift(min) : null,
    bornAfter: max != null ? shift(max + 1) : null,
  };
}

/**
 * Condiciones de "pendientes de este grupo que coinciden con los filtros". Usan `user` y `profile`,
 * así que la consulta tiene que unir esas tablas. La lista y el lote usan las mismas.
 */
export function pendingConds(groupId: string, f: Omit<RequestFilters, "cursor">, now = new Date()): SQL[] {
  const conds: SQL[] = [eq(groupJoinRequest.groupId, groupId), eq(groupJoinRequest.status, "pending")];
  const hasPublicPhoto = sql`exists (select 1 from ${photo} where ${photo.userId} = ${groupJoinRequest.userId} and ${photo.isPrivate} = false)`;
  if (f.foto === "con") conds.push(hasPublicPhoto);
  if (f.foto === "sin") conds.push(not(hasPublicPhoto));
  if (f.nueva) conds.push(gt(user.createdAt, new Date(now.getTime() - NEW_ACCOUNT_DAYS * 86_400_000)));
  const { bornOnOrBefore, bornAfter } = birthdateRange(f.edadMin, f.edadMax, now);
  if (bornOnOrBefore) conds.push(lte(profile.birthdate, bornOnOrBefore));
  if (bornAfter) conds.push(gt(profile.birthdate, bornAfter));
  return conds;
}

/**
 * Una página de solicitudes pendientes de un grupo, de la más nueva a la más vieja.
 * `total` (cuántas hay con estos filtros) viene solo en la primera página.
 * Devuelve null si el cursor no es válido.
 */
export async function requestPage(groupId: string, f: RequestFilters, now = new Date()) {
  const cursor = decodeCursor(f.cursor);
  if (f.cursor && !cursor) return null;

  const newSince = new Date(now.getTime() - NEW_ACCOUNT_DAYS * 86_400_000);
  const conds = pendingConds(groupId, f, now);

  const pageConds = cursor
    ? [...conds, or(
        lt(groupJoinRequest.createdAt, sql`${cursor.t}::timestamptz`),
        and(eq(groupJoinRequest.createdAt, sql`${cursor.t}::timestamptz`), lt(groupJoinRequest.id, cursor.id)),
      )!]
    : conds;

  const [rows, total] = await Promise.all([
    db
      .select({
        id: groupJoinRequest.id,
        userId: groupJoinRequest.userId,
        message: groupJoinRequest.message,
        createdAt: groupJoinRequest.createdAt,
        // Texto exacto de Postgres (con microsegundos) para armar el cursor
        at: sql<string>`${groupJoinRequest.createdAt}::text`,
        accountCreatedAt: user.createdAt,
      })
      .from(groupJoinRequest)
      .innerJoin(user, eq(user.id, groupJoinRequest.userId))
      .leftJoin(profile, eq(profile.userId, groupJoinRequest.userId))
      .where(and(...pageConds))
      .orderBy(desc(groupJoinRequest.createdAt), desc(groupJoinRequest.id))
      .limit(REQUESTS_PAGE + 1),
    cursor
      ? Promise.resolve(null)
      : db
          .select({ n: sql<number>`count(*)::int` })
          .from(groupJoinRequest)
          .innerJoin(user, eq(user.id, groupJoinRequest.userId))
          .leftJoin(profile, eq(profile.userId, groupJoinRequest.userId))
          .where(and(...conds))
          .then(([r]) => r?.n ?? 0),
  ]);

  const page = rows.slice(0, REQUESTS_PAGE);
  const last = page.at(-1);
  const authors = await authorsFor(page.map((r) => r.userId));
  return {
    items: page.map((r) => ({
      id: r.id,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
      newAccount: r.accountCreatedAt > newSince,
      user: authors.get(r.userId) ?? { id: r.userId, name: "Cuenta borrada", age: 0, photo: null },
    })),
    nextCursor: rows.length > REQUESTS_PAGE && last ? encodeCursor({ t: last.at, id: last.id }) : null,
    total,
  };
}
