// Pedir que se revise una suspensión, desde la app y en privado. La persona suspendida puede usar estas rutas
// (ver requireUser en lib.ts) y nada más de la app. El equipo las responde desde el panel (routes/admin.ts).
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { newId, requireUser, type AppEnv } from "../lib.js";
import { limit } from "../ratelimit.js";
import { notifyStaff } from "../staff.js";

const { appeal } = schema;

export const appealRoutes = new Hono<AppEnv>();

/** Lo que ve la persona: sin quién suspendió ni quién revisó. */
const view = (a: typeof appeal.$inferSelect) => ({
  status: a.status as "open" | "upheld" | "lifted",
  body: a.body,
  extra: a.extra,
  response: a.response,
  createdAt: a.createdAt.toISOString(),
  reviewedAt: a.reviewedAt?.toISOString() ?? null,
});

/** El pedido de la suspensión actual o, si ya no hay suspensión, el último que tuvo una respuesta. */
appealRoutes.get("/appeal", requireUser, async (c) => {
  const p = c.get("profile");
  if (!p?.suspendedAt) return c.json(null);
  const [a] = await db.select().from(appeal).where(and(eq(appeal.userId, p.userId), eq(appeal.suspendedAt, p.suspendedAt)));
  return c.json(a ? view(a) : null);
});

const text = (min: number, max: number) => z.string().trim().min(min, `Contanos un poco más (al menos ${min} letras)`).max(max);

/** Un pedido por suspensión. */
appealRoutes.post("/appeal", requireUser, async (c) => {
  const p = c.get("profile");
  if (!p?.suspendedAt) throw new HTTPException(400, { message: "Tu cuenta no está suspendida" });
  await limit(p.userId, "appeal");
  const { body } = z.object({ body: text(20, 2000) }).parse(await c.req.json());
  const [a] = await db.insert(appeal).values({
    id: newId(),
    userId: p.userId,
    suspendedAt: p.suspendedAt,
    suspendReason: p.suspendReason,
    suspendedBy: p.suspendedBy,
    body,
  }).onConflictDoNothing().returning();
  if (!a) throw new HTTPException(409, { message: "Ya mandaste un pedido por esta suspensión" });
  void notifyStaff("appeals", { title: "Pedido de revisión", body: "Hay un pedido nuevo para revisar.", url: "/admin", tag: "apelacion" });
  return c.json(view(a));
});

/** Sumar algo más, una sola vez, mientras no se haya respondido. */
appealRoutes.post("/appeal/extra", requireUser, async (c) => {
  const p = c.get("profile");
  if (!p?.suspendedAt) throw new HTTPException(400, { message: "Tu cuenta no está suspendida" });
  await limit(p.userId, "appeal");
  const { extra } = z.object({ extra: text(5, 1000) }).parse(await c.req.json());
  const [a] = await db.update(appeal).set({ extra, extraAt: new Date() })
    .where(and(eq(appeal.userId, p.userId), eq(appeal.suspendedAt, p.suspendedAt), eq(appeal.status, "open"), sql`${appeal.extra} is null`))
    .returning();
  if (!a) throw new HTTPException(409, { message: "Ya no se puede sumar nada a este pedido" });
  return c.json(view(a));
});
