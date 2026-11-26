import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db/index.js";
import { authorsFor } from "./lib.js";

const { block, profile } = schema;

export const BLOCKS_PAGE = 30;

export const blocksQuerySchema = z.object({
  q: z.string().max(60).optional().transform((s) => s?.trim() ?? ""),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
  limit: z.coerce.number().int().min(0).max(BLOCKS_PAGE).default(BLOCKS_PAGE),
});

/** Minúsculas y sin tildes, igual en la base y en lo que se busca: "Rocío" se encuentra con "rocio". */
const FROM = "áàäâéèëêíìïîóòöôúùüûñç";
const TO = "aaaaeeeeiiiioooouuuunc";
const plain = (s: string) => s.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)
  .replace(new RegExp(`[${FROM}]`, "g"), (ch) => TO[FROM.indexOf(ch)]);

/**
 * Personas que `meId` bloqueó, de la más reciente a la más vieja, de a una página. `q` busca por nombre.
 * `total` cuenta todas las que coinciden, para mostrar cuántas hay sin traer la lista entera.
 */
export async function blockedPage(meId: string, { q, offset, limit }: z.infer<typeof blocksQuerySchema>) {
  const conds = [eq(block.blockerId, meId)];
  if (q) conds.push(sql`translate(lower(${profile.displayName}), ${FROM}, ${TO}) like ${`%${plain(q)}%`}`);
  const where = and(...conds);
  const [rows, [{ total }]] = await Promise.all([
    limit
      ? db.select({ id: block.blockedId }).from(block)
          // Sin perfil es una cuenta borrada: aparece sin búsqueda y no coincide con ningún nombre
          .leftJoin(profile, eq(profile.userId, block.blockedId))
          .where(where).orderBy(desc(block.createdAt), desc(block.blockedId)).limit(limit).offset(offset)
      : [],
    db.select({ total: sql<number>`count(*)::int` }).from(block).leftJoin(profile, eq(profile.userId, block.blockedId)).where(where),
  ]);
  const authors = await authorsFor(rows.map((r) => r.id));
  return {
    people: rows.map((r) => authors.get(r.id) ?? { id: r.id, name: "Cuenta borrada", age: 0, photo: null }),
    total,
    hasMore: offset + rows.length < total,
  };
}
