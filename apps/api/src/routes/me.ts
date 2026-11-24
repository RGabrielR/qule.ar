import { and, asc, eq, or } from "drizzle-orm";
import { mailEnabled } from "../mail.js";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { ageFrom, mediaOut, newId, requireProfile, requireUser, type AppEnv } from "../lib.js";
import { syncGroupRoom } from "../realtime.js";
import { deleteImage, MAX_UPLOAD_BYTES, MAX_VIDEO_BYTES, readImage, saveImage, saveVideo, videoEnabled, videoFile, type VideoSource } from "../storage.js";
import { googleEnabled } from "../auth.js";
import { hasAlbumAccess } from "./premium.js";
import { defaultAlbum, MAX_ALBUM_ITEMS, myAlbums, renumberPhotos } from "../albums.js";

import { accessFor } from "../staff.js";
import { APP_NAME } from "../brand.js";
import { expiringIsOver } from "../expiring.js";
import { checkMinorSignals, deleteImageUnlessEvidence, isEvidence } from "../moderation.js";
import { limit } from "../ratelimit.js";
import { TERMS_VERSION } from "../legal.js";
import { NOTIFY_KINDS } from "../push.js";
import { HAS_PLACE } from "../db/schema.js";
import { forgetFile, isKnownPublic, rememberPublic, requireUserForFiles } from "../fileAccess.js";

const { profile, photo, user, group, groupMember, directMessage, conversation } = schema;
const MAX_PHOTOS = 6;
/** El tope de archivos privados es por persona, sumando todos sus álbumes. */
const albumFullMessage = `Entre todos tus álbumes podés tener hasta ${MAX_ALBUM_ITEMS} fotos y videos`;

const shortText = z.string().trim().max(60);
const profileInput = z.object({
  displayName: z.string().trim().min(1, "Poné un nombre").max(40),
  birthdate: z.iso.date().optional(),
  about: z.string().trim().max(500).nullish(),
  heightCm: z.number().int().min(120).max(230).nullish(),
  weightKg: z.number().int().min(35).max(250).nullish(),
  bodyType: shortText.nullish(),
  position: shortText.nullish(),
  tribes: z.array(shortText).max(10).default([]),
  lookingFor: z.array(shortText).max(10).default([]),
  relationship: shortText.nullish(),
  pronouns: shortText.nullish(),
  // Tengo lugar / No tengo lugar; null lo borra (sin decir)
  hasPlace: z.enum(HAS_PLACE, { message: "Elegí si tenés lugar o no" }).nullish(),
  hivStatus: shortText.nullish(),
  lastTested: z.iso.date().nullish(),
  // Solo cuenta en el alta del perfil
  acceptTerms: z.boolean().optional(),
});

export const meRoutes = new Hono<AppEnv>();

// Config pública: qué métodos de login hay
// passwordReset: sin mails configurados no ofrecemos recuperar la contraseña (en desarrollo sí: el mail sale por consola)
meRoutes.get("/config", (c) => c.json({ google: googleEnabled, passwordReset: mailEnabled || process.env.NODE_ENV !== "production" }));

// Archivos: solo para gente con sesión, así no se pueden scrapear las fotos desde afuera
meRoutes.get("/files/:key", requireUserForFiles, async (c) => {
  const key = c.req.param("key");
  const thumb = c.req.query("s") === "thumb";
  // Foto pública ya chequeada hace un rato: directo al archivo, sin preguntarle a la base (ver fileAccess.ts)
  if (isKnownPublic(key)) return sendImage(c, key, thumb, false);
  const viewer = c.get("user").id;
  // Foto o video de álbum privado (o la miniatura de un video): solo dueño o gente con acceso vigente
  const [ph] = await db.select().from(photo).where(or(eq(photo.key, key), eq(photo.posterKey, key)));
  // Cada álbum se comparte por separado: con acceso a uno no se ven los archivos de otro
  if (ph?.isPrivate && !(await hasAlbumAccess(ph.userId, viewer, ph.albumId))) return c.notFound();
  const video = await videoFile(key);
  if (video) {
    if (!ph) return c.notFound();
    return serveVideo(c.req.header("range"), video);
  }
  // Foto de mensaje privado: solo las dos personas de la charla; si es temporal, solo quien la recibe tras abrirla
  const [dm] = await db.select().from(directMessage).where(eq(directMessage.photoKey, key));
  // Foto de un grupo: la ve cualquiera con sesión, igual que el nombre del grupo al explorar
  // (la de un grupo dado de baja solo la ve moderación)
  const [grp] = ph || dm ? [] : await db.select({ removedAt: group.removedAt }).from(group).where(eq(group.photoKey, key)).limit(1);
  // Moderación: quien revisa reportes o suspende puede ver la foto de un grupo dado de baja y las pruebas guardadas
  const mod = async () => (await accessFor(c.get("user"))).some((a) => a === "reports" || a === "sanctions");
  const gr = grp && (!grp.removedAt || (await mod()));
  // Archivo que ya no usa ningún mensaje, perfil ni grupo (desenviado, borrado): solo existe como prueba de un reporte,
  // y solo moderación lo puede pedir
  if (!ph && !dm && !gr && !((await isEvidence(key)) && (await mod()))) return c.notFound();
  if (dm) {
    const [conv] = await db.select().from(conversation).where(eq(conversation.id, dm.conversationId));
    const inConv = conv && (conv.userA === viewer || conv.userB === viewer);
    if (!inConv) return c.notFound();
    // Ya vista: después de unos segundos no se sirve más, aunque el archivo todavía no se haya borrado
    if (dm.expiring && (dm.senderId === viewer || !dm.openedAt || expiringIsOver(dm.openedAt))) return c.notFound();
  }
  // Las privadas no se cachean, así revocar el acceso tiene efecto
  const noStore = Boolean(ph?.isPrivate || dm?.expiring);
  // Foto de perfil pública o de un grupo activo: la puede ver cualquiera con sesión, se recuerda un minuto
  if ((ph && !ph.isPrivate) || (grp && !grp.removedAt)) rememberPublic(key);
  return sendImage(c, key, thumb, noStore);
});

async function sendImage(c: Context<AppEnv>, key: string, thumb: boolean, noStore: boolean) {
  const buf = await readImage(key, thumb);
  if (!buf) return c.notFound();
  return c.body(new Uint8Array(buf), 200, {
    "Content-Type": "image/webp",
    "Cache-Control": noStore ? "no-store" : "private, max-age=31536000, immutable",
  });
}

/** Sirve un video por partes (Range): Safari no reproduce videos sin esto, y así se puede adelantar. */
async function serveVideo(range: string | undefined, v: VideoSource) {
  const headers: Record<string, string> = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
  let start = 0;
  let end = v.size - 1;
  let status = 200;
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m) {
    if (m[1]) {
      start = Number(m[1]);
      if (m[2]) end = Math.min(Number(m[2]), v.size - 1);
    } else if (m[2]) {
      start = Math.max(0, v.size - Number(m[2]));
    }
    if (start > end || start >= v.size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${v.size}` } });
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${v.size}`;
  }
  headers["Content-Length"] = String(end - start + 1);
  const body = await v.open(start, end);
  return new Response(body, { status, headers });
}

meRoutes.get("/me", requireUser, async (c) => {
  const u = c.get("user");
  const p = c.get("profile");
  const photos = await db.select().from(photo).where(eq(photo.userId, u.id)).orderBy(asc(photo.position));
  const albums = await myAlbums(u.id);
  const access = await accessFor(u);
  return c.json({
    // isAdmin: entra al panel de moderación. access: qué puede hacer ahí (ver staff.ts)
    user: { id: u.id, email: u.email, name: u.name, isAdmin: access.length > 0, access },
    profile: p
      ? (() => {
          const { cellLat, cellLng, ...rest } = p;
          // A la propia persona solo le decimos si tiene ubicación, no la celda
          return { ...rest, age: ageFrom(p.birthdate), hasLocation: cellLat != null && cellLng != null };
        })()
      : null,
    photos: photos.map((x) => ({ id: x.id, position: x.position, isPrivate: x.isPrivate, albumId: x.albumId, ...mediaOut(x) })),
    // Álbumes privados, en orden (el primero es el álbum por defecto)
    albums: albums.map((a) => ({ id: a.id, name: a.name })),
  });
});

meRoutes.put("/me/profile", requireUser, async (c) => {
  const u = c.get("user");
  const existing = c.get("profile");
  const parsed = profileInput.safeParse(await c.req.json());
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.issues[0].message });
  const data = parsed.data;

  if (!existing) {
    // Alta del perfil: acá se verifica la edad y se registra la aceptación de los términos
    if (!data.birthdate) throw new HTTPException(400, { message: "Falta la fecha de nacimiento" });
    if (ageFrom(data.birthdate) < 18) throw new HTTPException(403, { message: `${APP_NAME} es solo para mayores de 18` });
    if (data.acceptTerms !== true) throw new HTTPException(400, { message: "Para entrar tenés que aceptar los términos y la política de privacidad" });
    const { acceptTerms: _accepted, ...fields } = data;
    await db.insert(profile).values({
      ...fields,
      birthdate: data.birthdate,
      userId: u.id,
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: new Date(),
    });
    checkMinorSignals({ userId: u.id, name: fields.displayName }, { "el nombre": fields.displayName, "la descripción": fields.about })
      .catch((e) => console.error("checkMinorSignals", e));
    // Todo el mundo entra al chat general
    const [general] = await db.select().from(group).where(eq(group.isGeneral, true));
    if (general) {
      await db.insert(groupMember).values({ groupId: general.id, userId: u.id }).onConflictDoNothing();
      syncGroupRoom(u.id, general.id, true);
    }
  } else {
    // La fecha de nacimiento no se puede cambiar después del alta
    const { birthdate: _ignored, acceptTerms: _a, ...rest } = data;
    await db.update(profile).set({ ...rest, updatedAt: new Date() }).where(eq(profile.userId, u.id));
    checkMinorSignals({ userId: u.id, name: rest.displayName }, { "el nombre": rest.displayName, "la descripción": rest.about })
      .catch((e) => console.error("checkMinorSignals", e));
  }
  return c.json({ ok: true });
});

/** Aceptar la versión vigente de los términos (para cuentas creadas antes, o cuando cambian). */
meRoutes.put("/me/terms", requireUser, requireProfile, async (c) => {
  const u = c.get("user");
  const parsed = z.object({ version: z.string() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HTTPException(400, { message: "Falta la versión de los términos" });
  const { version } = parsed.data;
  // Solo se puede aceptar la versión vigente: si la web quedó vieja, que recargue y lea la nueva
  if (version !== TERMS_VERSION) throw new HTTPException(409, { message: "Los términos cambiaron. Recargá la página para leer la versión nueva." });
  await db.update(profile).set({ termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() }).where(eq(profile.userId, u.id));
  return c.json({ termsVersion: TERMS_VERSION });
});

/** Qué avisos quiere recibir. Se manda solo lo que cambia; lo demás queda como estaba. */
const notifyInput = z.object(Object.fromEntries(NOTIFY_KINDS.map((k) => [k, z.boolean().optional()]))).strict();
meRoutes.put("/me/notificaciones", requireUser, requireProfile, async (c) => {
  const u = c.get("user");
  const parsed = notifyInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HTTPException(400, { message: "Esos avisos no existen" });
  const prefs = { ...c.get("profile")!.notifyPrefs, ...parsed.data };
  await db.update(profile).set({ notifyPrefs: prefs }).where(eq(profile.userId, u.id));
  return c.json({ notifyPrefs: prefs });
});

/**
 * Subir una foto (al perfil o a un álbum privado) o un video (solo a un álbum). Se sube de a un archivo; la web manda varios seguidos.
 * `album` elige el álbum privado; con `private=1` y sin `album`, va al álbum por defecto.
 */
meRoutes.post("/me/photos", requireUser, requireProfile, async (c) => {
  const u = c.get("user");
  await limit(u.id, "upload");
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) throw new HTTPException(400, { message: "Falta el archivo" });
  const albumField = typeof body.album === "string" && body.album ? body.album : null;
  const isPrivate = body.private === "1" || albumField !== null;
  const isVideo = file.type.startsWith("video/");
  if (isVideo && !isPrivate) throw new HTTPException(400, { message: "Los videos solo van en el álbum privado" });
  if (isVideo && !videoEnabled) throw new HTTPException(400, { message: "Por ahora no se pueden subir videos" });
  if (file.size > (isVideo ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES)) {
    throw new HTTPException(413, { message: isVideo ? "El video pesa demasiado (máx. 80 MB)" : "La foto pesa demasiado (máx. 12 MB)" });
  }
  const mine = await db.select({ isPrivate: photo.isPrivate }).from(photo).where(eq(photo.userId, u.id));
  const same = mine.filter((x) => x.isPrivate === isPrivate).length;
  if (isPrivate && same >= MAX_ALBUM_ITEMS) throw new HTTPException(400, { message: albumFullMessage });
  if (!isPrivate && same >= MAX_PHOTOS) throw new HTTPException(400, { message: `Podés tener hasta ${MAX_PHOTOS} fotos en tu perfil` });
  const albumId = isPrivate ? (albumField ? (await ownAlbumOr404(u.id, albumField)).id : (await defaultAlbum(u.id)).id) : null;

  let saved: { key: string; posterKey: string | null; seconds: number | null };
  try {
    saved = isVideo ? await saveVideo(await file.arrayBuffer()) : { key: await saveImage(await file.arrayBuffer()), posterKey: null, seconds: null };
  } catch {
    throw new HTTPException(400, { message: isVideo ? "No pudimos procesar ese video" : "No pudimos leer esa imagen" });
  }
  const id = newId();
  const kind = isVideo ? "video" : "photo";
  const position = mine.length;
  await db.insert(photo).values({ id, userId: u.id, position, isPrivate, albumId, kind, ...saved });
  return c.json({ id, position, isPrivate, albumId, ...mediaOut({ kind, ...saved }) });
});

/** Uno de mis álbumes, o 404 (para no confirmar que existe un álbum ajeno). */
async function ownAlbumOr404(userId: string, albumId: string) {
  const [a] = await db.select().from(schema.album).where(and(eq(schema.album.id, albumId), eq(schema.album.userId, userId)));
  if (!a) throw new HTTPException(404, { message: "Ese álbum no existe" });
  return a;
}

/**
 * Pasar una foto a un álbum privado, moverla entre álbumes o sacarla al perfil.
 * `albumId` elige el álbum; `isPrivate: true` sin álbum la manda al álbum por defecto; `isPrivate: false` la hace pública.
 */
meRoutes.patch("/me/photos/:id", requireUser, async (c) => {
  const u = c.get("user");
  const parsed = z.object({ isPrivate: z.boolean().optional(), albumId: z.string().min(1).optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || (parsed.data.isPrivate === undefined && parsed.data.albumId === undefined)) {
    throw new HTTPException(400, { message: "Falta a dónde mover el archivo" });
  }
  if (parsed.data.isPrivate === false && parsed.data.albumId !== undefined) throw new HTTPException(400, { message: "Una foto pública no va en un álbum" });
  const isPrivate = parsed.data.albumId !== undefined || parsed.data.isPrivate === true;
  const [current] = await db.select().from(photo).where(and(eq(photo.id, c.req.param("id")), eq(photo.userId, u.id)));
  if (!current) return c.notFound();
  if (isPrivate && !current.isPrivate) {
    const priv = await db.select({ id: photo.id }).from(photo).where(and(eq(photo.userId, u.id), eq(photo.isPrivate, true)));
    if (priv.length >= MAX_ALBUM_ITEMS) throw new HTTPException(400, { message: albumFullMessage });
  }
  const albumId = !isPrivate ? null
    : parsed.data.albumId ? (await ownAlbumOr404(u.id, parsed.data.albumId)).id
    : current.albumId ?? (await defaultAlbum(u.id)).id;
  if (!isPrivate && current.kind === "video") throw new HTTPException(400, { message: "Los videos solo van en el álbum privado" });
  if (!isPrivate && current.isPrivate) {
    const pub = await db.select({ id: photo.id }).from(photo).where(and(eq(photo.userId, u.id), eq(photo.isPrivate, false)));
    if (pub.length >= MAX_PHOTOS) throw new HTTPException(400, { message: `Ya tenés ${MAX_PHOTOS} fotos en tu perfil` });
  }
  const [row] = await db
    .update(photo)
    .set({ isPrivate, albumId })
    .where(and(eq(photo.id, c.req.param("id")), eq(photo.userId, u.id)))
    .returning();
  if (!row) return c.notFound();
  if (isPrivate) {
    forgetFile(row.key);
    forgetFile(row.posterKey);
  }
  return c.json({ ok: true });
});

meRoutes.delete("/me/photos/:id", requireUser, async (c) => {
  const u = c.get("user");
  const [row] = await db
    .delete(photo)
    .where(and(eq(photo.id, c.req.param("id")), eq(photo.userId, u.id)))
    .returning();
  if (!row) return c.notFound();
  await deleteImageUnlessEvidence(row.key);
  if (row.posterKey) await deleteImageUnlessEvidence(row.posterKey);
  // Reordenar las que quedan
  await renumberPhotos(u.id);
  return c.json({ ok: true });
});

meRoutes.put("/me/photos/order", requireUser, async (c) => {
  const u = c.get("user");
  const ids = z.array(z.string()).parse(await c.req.json());
  const mine = await db.select().from(photo).where(eq(photo.userId, u.id));
  const valid = new Set(mine.map((p) => p.id));
  if (ids.length !== mine.length || !ids.every((id) => valid.has(id))) {
    throw new HTTPException(400, { message: "Orden inválido" });
  }
  for (const [i, id] of ids.entries()) await db.update(photo).set({ position: i }).where(eq(photo.id, id));
  return c.json({ ok: true });
});

/** Borra la cuenta y todo lo asociado. No se puede deshacer. */
meRoutes.delete("/me", requireUser, async (c) => {
  const u = c.get("user");
  const photos = await db.select().from(photo).where(eq(photo.userId, u.id));
  const dmPhotos = await db.select().from(directMessage).where(eq(directMessage.senderId, u.id));
  await db.delete(user).where(eq(user.id, u.id)); // en cascada: perfil, fotos, mensajes, sesiones, etc.
  for (const p of photos) {
    await deleteImageUnlessEvidence(p.key);
    if (p.posterKey) await deleteImageUnlessEvidence(p.posterKey);
  }
  // Lo que sea prueba de un reporte queda guardado para moderación (Ley 25.326, art. 16 inc. 5)
  for (const m of dmPhotos) if (m.photoKey) await deleteImageUnlessEvidence(m.photoKey);
  return c.json({ ok: true });
});
