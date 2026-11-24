import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import sharp from "sharp";
import { z } from "zod";
import { parseWatermarkKey, verifyAlbumImage } from "../albumWatermark.js";
import { db, schema } from "../db/index.js";
import type { AppEnv } from "../lib.js";
import { logAction, requireAccess } from "../staff.js";
import { MAX_UPLOAD_BYTES, readImage, readReportCapture } from "../storage.js";

const { report, photo, album, profile, user } = schema;
const secret = parseWatermarkKey(process.env.ALBUM_WATERMARK_KEY);
export const reportPhotoRoutes = new Hono<AppEnv>();
reportPhotoRoutes.use("*", requireAccess("reports"), requireAccess("photoVerification"), async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

export function canVerifyReportPhoto(r: typeof report.$inferSelect, actorId: string) {
  return Boolean(secret && r.reporterId && r.targetUserId && !r.groupId && r.status !== "dismissed" &&
    r.reason !== "menor de edad" && r.reporterId !== actorId && r.targetUserId !== actorId);
}

async function verifiableReport(reportId: string, actorId: string) {
  const [r] = await db.select().from(report).where(eq(report.id, reportId));
  if (!r || !canVerifyReportPhoto(r, actorId) || !r.reporterId || !r.targetUserId) {
    throw new HTTPException(404, { message: "La verificación no está disponible para este reporte" });
  }
  return { ...r, reporterId: r.reporterId, targetUserId: r.targetUserId };
}

async function referencePhotos(r: Awaited<ReturnType<typeof verifiableReport>>, photoId?: string) {
  return db.select({
    id: photo.id, key: photo.key, userId: photo.userId, position: photo.position,
    album: album.name, name: profile.displayName,
  }).from(photo)
    .innerJoin(album, and(eq(photo.albumId, album.id), eq(photo.userId, album.userId)))
    .leftJoin(profile, eq(profile.userId, photo.userId))
    .where(and(
      inArray(photo.userId, [r.reporterId, r.targetUserId]), eq(photo.kind, "photo"), eq(photo.isPrivate, true),
      photoId === undefined ? undefined : eq(photo.id, photoId),
    ))
    .orderBy(asc(photo.userId), asc(album.position), asc(photo.position));
}

reportPhotoRoutes.get("/", async (c) => {
  const id = c.req.param("id")!;
  const actor = c.get("user").id;
  const r = await verifiableReport(id, actor);
  const photos = await referencePhotos(r);
  await logAction(actor, "Consultó las fotos para verificar un reporte", id);
  return c.json({
    hasCapture: Boolean(r.captureKey),
    photos: photos.map(({ id, position, album, name, key }) => ({
      id, position, album, name: name ?? "Cuenta sin perfil", attached: r.evidenceKeys.includes(key),
    })),
  });
});

async function attachedCapture(key: string | null) {
  const bytes = key && await readReportCapture(key);
  if (!bytes) throw new HTTPException(404, { message: "La captura adjunta ya no está disponible" });
  return bytes;
}

reportPhotoRoutes.get("/capture", async (c) => {
  const id = c.req.param("id")!;
  const actor = c.get("user").id;
  const r = await verifiableReport(id, actor);
  const bytes = await attachedCapture(r.captureKey);
  await logAction(actor, "Vio la captura adjunta a un reporte", id);
  return c.body(new Uint8Array(bytes), 200, { "Content-Type": "image/webp" });
});

const variant = z.enum(["photo", "thumb"]);

async function readReference(r: Awaited<ReturnType<typeof verifiableReport>>, photoId: string, thumb: boolean) {
  const [selected] = await referencePhotos(r, photoId);
  const original = selected && await readImage(selected.key, thumb);
  if (!original) throw new HTTPException(404, { message: "La foto original ya no está disponible" });
  return { selected, original };
}

reportPhotoRoutes.get("/:photoId/:variant", async (c) => {
  const id = c.req.param("id")!;
  const actor = c.get("user").id;
  const parsed = variant.safeParse(c.req.param("variant"));
  if (!parsed.success) return c.notFound();
  const r = await verifiableReport(id, actor);
  const { selected, original } = await readReference(r, c.req.param("photoId"), parsed.data === "thumb");
  await logAction(actor, "Vio una foto original para verificar un reporte", id, selected.id);
  return c.body(new Uint8Array(original), 200, { "Content-Type": "image/webp" });
});

const crop = z.object({
  left: z.number().int().min(0).max(40_000_000), top: z.number().int().min(0).max(40_000_000),
  width: z.number().int().min(1).max(40_000_000), height: z.number().int().min(1).max(40_000_000),
});
const requestFields = z.object({
  photoId: z.string().min(1).max(200), viewerId: z.string().trim().min(1).max(200),
  variant, originalCrop: crop.optional(), captureCrop: crop.optional(),
});

reportPhotoRoutes.post("/", async (c) => {
  if (!secret) return c.notFound();
  const id = c.req.param("id")!;
  const actor = c.get("user").id;
  const r = await verifiableReport(id, actor);
  let file: File | undefined;
  let data: unknown;
  if (/^multipart\/form-data(?:;|$)/i.test(c.req.header("content-type") ?? "")) {
    const body = await c.req.formData().catch(() => null);
    const candidate = body?.get("file");
    if (!(candidate instanceof File) || !candidate.size) throw new HTTPException(400, { message: "Adjuntá una captura" });
    if (candidate.size > MAX_UPLOAD_BYTES) throw new HTTPException(413, { message: "La captura supera los 12 MB" });
    file = candidate;
    const fields = body?.get("fields");
    try {
      if (typeof fields === "string" && fields.length <= 2048) data = JSON.parse(fields);
    } catch {
      throw new HTTPException(400, { message: "Revisá los datos de la verificación" });
    }
  } else {
    data = await c.req.json().catch(() => null);
  }
  const parsed = requestFields.safeParse(data);
  if (!parsed.success) throw new HTTPException(400, { message: "Revisá los datos de la verificación" });
  const { photoId, viewerId, originalCrop, captureCrop } = parsed.data;
  const thumb = parsed.data.variant === "thumb";
  const { selected, original } = await readReference(r, photoId, thumb);
  if (viewerId === selected.userId) throw new HTTPException(400, { message: "Elegí una cuenta distinta de la que subió la foto" });

  let copy = file ? Buffer.from(await file.arrayBuffer()) : await attachedCapture(r.captureKey);
  let result: Awaited<ReturnType<typeof verifyAlbumImage>> | undefined;
  try {
    const image = sharp(copy, { limitInputPixels: 40_000_000 });
    const { format, autoOrient: { width, height } } = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(format) || !width || !height) {
      throw new Error("Formato de captura inválido");
    }
    const area = captureCrop ?? { left: 0, top: 0, width, height };
    if (area.left + area.width > width || area.top + area.height > height) {
      throw new Error("El recorte excede la captura");
    }
    if (area.width >= 16 && area.height >= 16) {
      if (captureCrop) copy = await image.autoOrient().extract(captureCrop).png().toBuffer();
      result = await verifyAlbumImage(original, copy, { secret, fileKey: selected.key, viewerId, thumb }, originalCrop);
    }
  } catch {
    throw new HTTPException(400, { message: "No pudimos analizar la captura. Revisá el formato y los recortes" });
  }

  const status = !result || result.insufficient ? "insufficient" : result.match ? "match" : "no_match";
  const [recipient] = status === "match" ? await db.select({ name: profile.displayName }).from(user)
    .leftJoin(profile, eq(profile.userId, user.id)).where(eq(user.id, viewerId)) : [];
  await logAction(actor, "Verificó una foto de un reporte", id, `${photoId} · ${status === "match" ? "coincidencia" : status === "insufficient" ? "imagen insuficiente" : "sin coincidencia"}`);
  return c.json({
    status, uploader: selected.name ?? "Cuenta sin perfil",
    recipient: status === "match" ? { id: viewerId, name: recipient?.name ?? "Cuenta sin perfil" } : null,
  });
});
