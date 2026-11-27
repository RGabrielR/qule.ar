import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { authorsFor, imageUrl, type AppEnv } from "../lib.js";
import { logAction, requireAccess } from "../staff.js";

const { photo } = schema;

/**
 * Moderación de la marca de fotos explícitas (ver src/explicit/). Solo corrige al modelo: la marca tapa la foto a
 * quien eligió no ver fotos explícitas y nada más. No es un reporte, no suma en el historial de nadie y no lleva a
 * ninguna medida. Se monta en /admin/explicit, detrás del permiso de reportes.
 */
export const explicitAdminRoutes = new Hono<AppEnv>();
explicitAdminRoutes.use("*", requireAccess("reports"));

const PAGE = 50;

/**
 * `status=requested`: fotos que quien las subió pidió revisar (las más viejas primero).
 * `status=marked`: las últimas que marcó el modelo y nadie revisó, para corregir sin esperar un pedido.
 */
explicitAdminRoutes.get("/", async (c) => {
  const status = c.req.query("status") === "marked" ? "marked" : "requested";
  const base = { id: photo.id, key: photo.key, userId: photo.userId, score: photo.explicitScore, checkedAt: photo.explicitCheckedAt, requestedAt: photo.explicitReviewRequestedAt };
  const rows = status === "requested"
    ? await db.select(base).from(photo)
        .where(and(isNotNull(photo.explicitReviewRequestedAt), eq(photo.isPrivate, false)))
        .orderBy(asc(photo.explicitReviewRequestedAt)).limit(PAGE)
    : await db.select(base).from(photo)
        .where(and(eq(photo.explicit, true), isNull(photo.explicitReviewedAt), eq(photo.isPrivate, false)))
        .orderBy(desc(photo.explicitCheckedAt)).limit(PAGE);
  const people = await authorsFor(rows.map((r) => r.userId));
  c.header("Cache-Control", "no-store");
  return c.json(rows.map((r) => ({
    id: r.id,
    url: imageUrl(r.key),
    person: people.get(r.userId) ?? null,
    score: r.score,
    checkedAt: r.checkedAt?.toISOString() ?? null,
    requestedAt: r.requestedAt?.toISOString() ?? null,
  })));
});

/** Decidir: `explicit: false` la destapa ("esto no es explícito"); `true` la deja tapada. El modelo no la vuelve a tocar. */
explicitAdminRoutes.post("/:id", async (c) => {
  const parsed = z.object({ explicit: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HTTPException(400, { message: "Falta si es explícita o no" });
  const admin = c.get("user");
  const [row] = await db.update(photo)
    .set({ explicit: parsed.data.explicit, explicitReviewedAt: new Date(), explicitReviewedBy: admin.id, explicitReviewRequestedAt: null })
    .where(eq(photo.id, c.req.param("id")))
    .returning({ id: photo.id });
  if (!row) throw new HTTPException(404, { message: "Esa foto ya no está" });
  // Va al registro con la foto como destino (no la cuenta): corregir la marca no es una medida sobre nadie
  await logAction(admin.id, parsed.data.explicit ? "Foto explícita: confirmó la marca" : "Foto explícita: sacó la marca", row.id);
  return c.json({ ok: true });
});
