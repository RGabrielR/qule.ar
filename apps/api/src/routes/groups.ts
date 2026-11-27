import { activeSuspension, isSuspended } from "../suspensionStatus.js";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { nextSlot } from "../antispam.js";
import { db, schema } from "../db/index.js";
import { DEFAULT_SPAM_RULES } from "../db/schema.js";
import { ageFrom, authorsFor, blockedWith, messageKey, newId, requireProfile, requireUser, thumbUrl, type AppEnv } from "../lib.js";
import { distanceLabel, visibleKm } from "../geo.js";
import { autoHiddenGroups, autoHiddenUsers, deleteImageUnlessEvidence, forbiddenGroupText, groupIsEvidence, reportMinorGroupAttempt } from "../moderation.js";
import { BULK_MAX, bulkInput, pendingConds, requestFilters, requestPage } from "../joinRequests.js";
import { limit } from "../ratelimit.js";
import { deleteImage, MAX_UPLOAD_BYTES, readImage, saveImage } from "../storage.js";
import { emitPublishedMessage, emitToGroup, emitToGroupRoom, emitToUser, isOnline, serializeGroupMessages, syncGroupRoom } from "../realtime.js";
import { broadcast, onBroadcast } from "../shared.js";
import { pushTo } from "../push.js";
import { notifyGroupMessage } from "../groupNotify.js";
import { canOpenGroupPhoto, groupPhotoPilot } from "../groupPhotos.js";
import { forgetFile } from "../fileCache.js";
import { dropPolls, POLL_QUESTION_MAX, pollOptionsInput, pollTotals } from "../polls.js";

const { group, groupMember, groupMessage, groupJoinRequest, groupInvite, groupPoll, groupPollVote, profile, user } = schema;

/** Días que tiene que esperar alguien rechazado o expulsado para volver a pedir ingreso. */
const REAPPLY_DAYS = 7;
/** Grupos que puede tener una misma persona como dueña (frena la creación masiva de grupos spam). */
const MAX_OWNED = 10;

type Role = "owner" | "moderator" | "member";
const canModerate = (role: string | null | undefined) => role === "owner" || role === "moderator";

export const groupRoutes = new Hono<AppEnv>();
groupRoutes.use("/groups/*", requireUser, requireProfile);
groupRoutes.use("/groups", requireUser, requireProfile);

// ---------- Helpers ----------

async function membership(groupId: string, userId: string) {
  const [g] = await db.select().from(group).where(eq(group.id, groupId));
  // Dado de baja: no existe para nadie de la app (queda guardado solo como prueba para moderación)
  if (!g || g.removedAt) throw new HTTPException(404, { message: "Ese grupo no existe" });
  const [m] = await db
    .select()
    .from(groupMember)
    .where(and(eq(groupMember.groupId, groupId), eq(groupMember.userId, userId)));
  return { group: g, member: m ?? null };
}

async function requireMod(groupId: string, userId: string) {
  const r = await membership(groupId, userId);
  if (!canModerate(r.member?.role)) throw new HTTPException(403, { message: "Solo dueño o moderadores" });
  return r as typeof r & { member: NonNullable<typeof r.member> };
}

/**
 * Cuántos miembros tiene cada grupo. Se guarda un minuto en memoria: el grupo general tiene miles de miembros
 * y contarlos en cada pedido de la lista de grupos era de lo más pesado para la base. Al entrar o salir alguien
 * se olvida el número de ese grupo en todos los procesos del API (forgetMemberCount), así que quien entra ve el
 * número nuevo enseguida.
 */
const COUNT_TTL_MS = 60_000;
const countCache = new Map<string, { n: number; at: number }>();
const forgetMemberCount = (groupId: string) => broadcast("forgetMemberCount", groupId);
onBroadcast("forgetMemberCount", (id) => countCache.delete(String(id)));

async function memberCounts(ids: string[]) {
  const map = new Map<string, number>();
  const now = Date.now();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const hit = countCache.get(id);
    if (hit && now - hit.at < COUNT_TTL_MS) map.set(id, hit.n);
    else missing.push(id);
  }
  if (!missing.length) return map;
  const rows = await db
    .select({ groupId: groupMember.groupId, n: sql<number>`count(*)::int` })
    .from(groupMember)
    .where(inArray(groupMember.groupId, missing))
    .groupBy(groupMember.groupId);
  const counted = new Map(rows.map((r) => [r.groupId, r.n]));
  for (const id of missing) {
    const n = counted.get(id) ?? 0;
    map.set(id, n);
    countCache.set(id, { n, at: now });
  }
  // Que no crezca sin límite con grupos borrados
  if (countCache.size > 5000) for (const [id, v] of countCache) if (now - v.at >= COUNT_TTL_MS) countCache.delete(id);
  return map;
}

async function pendingCounts(ids: string[]) {
  const map = new Map<string, number>();
  if (!ids.length) return map;
  const rows = await db
    .select({ groupId: groupJoinRequest.groupId, n: sql<number>`count(*)::int` })
    .from(groupJoinRequest)
    .where(and(inArray(groupJoinRequest.groupId, ids), eq(groupJoinRequest.status, "pending")))
    .groupBy(groupJoinRequest.groupId);
  for (const r of rows) map.set(r.groupId, r.n);
  return map;
}

/** Estado de una persona respecto de varios grupos: solicitud pendiente o período de espera. */
async function requestStateFor(userId: string, ids: string[]) {
  const map = new Map<string, { pending: boolean; pendingMessage: string | null; cooldownUntil: string | null }>();
  if (!ids.length) return map;
  const since = new Date(Date.now() - REAPPLY_DAYS * 86_400_000);
  const rows = await db
    .select()
    .from(groupJoinRequest)
    .where(and(
      eq(groupJoinRequest.userId, userId),
      inArray(groupJoinRequest.groupId, ids),
      or(
        eq(groupJoinRequest.status, "pending"),
        and(inArray(groupJoinRequest.status, ["rejected", "removed"]), gt(groupJoinRequest.resolvedAt, since)),
      ),
    ));
  for (const r of rows) {
    const cur = map.get(r.groupId) ?? { pending: false, pendingMessage: null, cooldownUntil: null };
    if (r.status === "pending") {
      cur.pending = true;
      cur.pendingMessage = r.message;
    }
    else if (r.resolvedAt) {
      const until = new Date(r.resolvedAt.getTime() + REAPPLY_DAYS * 86_400_000).toISOString();
      if (!cur.cooldownUntil || until > cur.cooldownUntil) cur.cooldownUntil = until;
    }
    map.set(r.groupId, cur);
  }
  return map;
}

/** Avisa a dueño y moderadores (por ejemplo, que hay una solicitud nueva). */
async function notifyMods(groupId: string, event: string, payload: unknown) {
  const mods = await db
    .select({ userId: groupMember.userId })
    .from(groupMember)
    .where(and(eq(groupMember.groupId, groupId), inArray(groupMember.role, ["owner", "moderator"])));
  for (const m of mods) emitToUser(m.userId, event, payload);
  return mods.map((m) => m.userId);
}

const groupInput = z.object({
  name: z.string().trim().min(3, "El nombre tiene que tener al menos 3 letras").max(40, "Máximo 40 caracteres"),
  description: z.string().trim().max(300, "Máximo 300 caracteres").nullish(),
});

/** Un número entero entre min y max, con un error que dice qué campo está mal. */
const ruleNumber = (label: string, min: number, max: number) =>
  z.number({ error: `${label}: tiene que ser un número` }).int(`${label}: tiene que ser un número entero`)
    .min(min, `${label}: entre ${min} y ${max}`).max(max, `${label}: entre ${min} y ${max}`);

const rulesInput = z.object({
  intervalSeconds: ruleNumber("Segundos por mensaje", 5, 3600),
  burst: ruleNumber("Ráfaga", 1, 10),
  rotationWindow: ruleNumber("Rotación: mirar los últimos", 5, 100),
  rotationMax: ruleNumber("Rotación: máximo tuyos", 1, 50),
  newAccountHours: ruleNumber("Horas de cuenta nueva", 0, 24 * 30),
  maxQueued: ruleNumber("Máximo en cola", 1, 10),
});

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new HTTPException(400, { message: r.error.issues[0].message });
  return r.data;
}

// ---------- Nombres que no se permiten ----------

/**
 * Corta con 400 si el nombre o la descripción apunta a menores, venta, masajes o servicios sexuales.
 * Si es por menores, además le avisa a moderación quién lo intentó.
 */
async function rejectForbidden(u: { id: string; name: string }, name: string, description: string | null | undefined) {
  const bad = forbiddenGroupText(name, description);
  if (!bad) return;
  if (bad.kind === "menores") {
    await reportMinorGroupAttempt(u, bad.hit, [name, description].filter(Boolean).join("\n"))
      .catch((e) => console.error("reportMinorGroupAttempt", e));
  }
  throw new HTTPException(400, { message: bad.message });
}

// ---------- Cerrar y dar de baja ----------

/** Saca a todo el mundo de la sala en vivo del grupo y les avisa que ya no está. */
async function kickAll(groupId: string) {
  const members = await db.select({ userId: groupMember.userId }).from(groupMember).where(eq(groupMember.groupId, groupId));
  for (const m of members) {
    syncGroupRoom(m.userId, groupId, false);
    emitToUser(m.userId, "group:gone", { groupId });
  }
}

/** Da de baja un grupo: desaparece para todo el mundo y queda guardado 90 días como prueba (ver moderation.ts). */
export async function removeGroup(groupId: string, reason: string) {
  await kickAll(groupId);
  const [g] = await db.update(group).set({ removedAt: new Date(), removedReason: reason }).where(eq(group.id, groupId))
    .returning({ photoKey: group.photoKey });
  // Su foto pasa a verla solo moderación
  forgetFile(g?.photoKey);
}

/** El dueño cierra el grupo: si es prueba de un reporte, se da de baja (no se pierde); si no, se borra. */
async function closeGroup(groupId: string, reason: string) {
  if (await groupIsEvidence(groupId)) return removeGroup(groupId, reason);
  await kickAll(groupId);
  const files = await db.transaction(async (tx) => {
    await tx.select({ id: group.id }).from(group).where(eq(group.id, groupId)).for("update");
    const files = await tx.select({ key: groupMessage.photoKey }).from(groupMessage).where(eq(groupMessage.groupId, groupId));
    await tx.delete(group).where(eq(group.id, groupId));
    return files;
  });
  for (const { key } of files) if (key) await deleteImageUnlessEvidence(key);
}

// ---------- Listados ----------

/** Mis grupos (el general primero), con solicitudes pendientes si modero. */
groupRoutes.get("/groups", async (c) => {
  const u = c.get("user");
  const rows = await db
    .select({ id: group.id, name: group.name, description: group.description, isGeneral: group.isGeneral, photoKey: group.photoKey, role: groupMember.role })
    .from(groupMember)
    .innerJoin(group, eq(group.id, groupMember.groupId))
    .where(and(eq(groupMember.userId, u.id), isNull(group.removedAt)))
    .orderBy(desc(group.isGeneral), asc(group.name));
  const ids = rows.map((r) => r.id);
  const counts = await memberCounts(ids);
  const pending = await pendingCounts(rows.filter((r) => canModerate(r.role)).map((r) => r.id));
  return c.json(rows.map(({ photoKey, ...r }) => ({ ...r, photo: thumbUrl(photoKey), memberCount: counts.get(r.id) ?? 0, pendingCount: pending.get(r.id) ?? 0 })));
});

/** Grupos por página en Explorar. */
export const EXPLORE_PAGE = 60;

/**
 * Todos los grupos, para explorar y pedir ingreso: los que tienen más gente primero, de a páginas.
 * Antes se traían los 200 más nuevos y recién ahí se ordenaban por miembros: cuando hubo más de 200 grupos,
 * los más viejos (que son los más grandes) dejaron de aparecer.
 * `offset` pide la página siguiente; `limit` (hasta 300) sirve para recargar de una vez lo que ya se ve.
 */
groupRoutes.get("/groups/all", async (c) => {
  const u = c.get("user");
  const q = (c.req.query("q") ?? "").trim().slice(0, 40);
  const offset = Math.max(0, Math.min(10_000, Number(c.req.query("offset")) || 0));
  const pageSize = Math.max(1, Math.min(300, Number(c.req.query("limit")) || EXPLORE_PAGE));
  const conds = [eq(group.isGeneral, false), isNull(group.removedAt)];
  if (q) conds.push(or(ilike(group.name, `%${q}%`), ilike(group.description, `%${q}%`))!);
  // Cuenta con el índice de la clave de group_member (group_id, user_id)
  const members = sql<number>`(select count(*)::int from ${groupMember} where ${groupMember.groupId} = ${group.id})`;
  const page = await db.select({ g: group, n: members }).from(group).where(and(...conds))
    .orderBy(desc(members), desc(group.createdAt), asc(group.id))
    .limit(pageSize + 1)
    .offset(offset);
  const more = page.length > pageSize;
  const hiddenGroups = await autoHiddenGroups();
  const visible = page.slice(0, pageSize).filter((r) => !hiddenGroups.has(r.g.id)); // ocultos por precaución: varios reportes urgentes sin revisar
  const rows = visible.map((r) => r.g);
  const counts = new Map(visible.map((r) => [r.g.id, r.n]));
  const ids = rows.map((r) => r.id);
  const mine = ids.length
    ? await db.select().from(groupMember).where(and(eq(groupMember.userId, u.id), inArray(groupMember.groupId, ids)))
    : [];
  const roles = new Map(mine.map((m) => [m.groupId, m.role]));
  const states = await requestStateFor(u.id, ids);
  const list = rows.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    photo: thumbUrl(g.photoKey),
    memberCount: counts.get(g.id) ?? 0,
    role: roles.get(g.id) ?? null,
    pending: states.get(g.id)?.pending ?? false,
    cooldownUntil: states.get(g.id)?.cooldownUntil ?? null,
  }));
  return c.json({ groups: list, nextOffset: more ? offset + pageSize : null });
});

// ---------- Crear, editar, borrar ----------

groupRoutes.post("/groups", async (c) => {
  const u = c.get("user");
  const data = parse(groupInput, await c.req.json());
  await rejectForbidden(u, data.name, data.description);
  const [{ owned }] = await db
    .select({ owned: sql<number>`count(*)::int` })
    .from(groupMember)
    .where(and(eq(groupMember.userId, u.id), eq(groupMember.role, "owner")));
  if (owned >= MAX_OWNED) throw new HTTPException(400, { message: `Podés ser dueño de hasta ${MAX_OWNED} grupos` });
  const id = newId();
  await db.insert(group).values({ id, name: data.name, description: data.description ?? null, ownerId: u.id });
  await db.insert(groupMember).values({ groupId: id, userId: u.id, role: "owner" });
  forgetMemberCount(id);
  syncGroupRoom(u.id, id, true);
  return c.json({ id });
});

groupRoutes.get("/groups/:id", async (c) => {
  const u = c.get("user");
  const { group: g, member } = await membership(c.req.param("id"), u.id);
  const counts = await memberCounts([g.id]);
  const state = (await requestStateFor(u.id, [g.id])).get(g.id);
  const pending = canModerate(member?.role) ? (await pendingCounts([g.id])).get(g.id) ?? 0 : 0;
  return c.json({
    id: g.id,
    name: g.name,
    description: g.description,
    photo: thumbUrl(g.photoKey),
    isGeneral: g.isGeneral,
    rules: g.spamRules,
    role: member?.role ?? null,
    memberCount: counts.get(g.id) ?? 0,
    pending: state?.pending ?? false,
    pendingMessage: state?.pendingMessage ?? null,
    cooldownUntil: state?.cooldownUntil ?? null,
    pendingCount: pending,
    photoPilot: Boolean(member && groupPhotoPilot(g)),
    photoUploadsPaused: g.photoUploadsPaused,
    muted: member?.muted ?? false,
  });
});

// Silenciar o activar los avisos de un grupo (solo para vos)
groupRoutes.put("/groups/:id/notifications", async (c) => {
  const u = c.get("user");
  const { group: g, member } = await membership(c.req.param("id"), u.id);
  if (!member) throw new HTTPException(403, { message: "No sos parte de este grupo" });
  const { muted } = parse(z.object({ muted: z.boolean() }), await c.req.json());
  await db.update(groupMember).set({ muted }).where(and(eq(groupMember.groupId, g.id), eq(groupMember.userId, u.id)));
  return c.json({ muted });
});

/** Editar nombre, descripción y reglas antispam (solo el dueño; el general solo se puede ajustar en código). */
groupRoutes.patch("/groups/:id", async (c) => {
  const u = c.get("user");
  const { group: g, member } = await membership(c.req.param("id"), u.id);
  if (member?.role !== "owner") throw new HTTPException(403, { message: "Solo el dueño puede editar el grupo" });
  const body = await c.req.json();
  const data = parse(groupInput.partial().extend({ rules: rulesInput.optional() }), body);
  await rejectForbidden(u, data.name ?? g.name, data.description !== undefined ? data.description : g.description);
  await db
    .update(group)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description ?? null }),
      ...(data.rules && { spamRules: { ...DEFAULT_SPAM_RULES, ...data.rules } }),
    })
    .where(eq(group.id, g.id));
  return c.json({ ok: true });
});

/** Poner o cambiar la foto del grupo (solo el dueño; el general muestra el logo de la app). */
groupRoutes.post("/groups/:id/photo", async (c) => {
  const u = c.get("user");
  const { group: g, member } = await membership(c.req.param("id"), u.id);
  if (g.isGeneral) throw new HTTPException(400, { message: "El chat general usa el logo de la app" });
  if (member?.role !== "owner") throw new HTTPException(403, { message: "Solo el dueño puede cambiar la foto del grupo" });
  await limit(u.id, "upload");
  const file = (await c.req.parseBody()).file;
  if (!(file instanceof File)) throw new HTTPException(400, { message: "Falta la foto" });
  if (file.type.startsWith("video/")) throw new HTTPException(400, { message: "La foto del grupo no puede ser un video" });
  if (file.size > MAX_UPLOAD_BYTES) throw new HTTPException(413, { message: "La foto pesa demasiado (máx. 12 MB)" });
  let key: string;
  try {
    key = await saveImage(await file.arrayBuffer());
  } catch {
    throw new HTTPException(400, { message: "No pudimos leer esa imagen" });
  }
  await db.update(group).set({ photoKey: key }).where(eq(group.id, g.id));
  if (g.photoKey) await deleteImageUnlessEvidence(g.photoKey);
  return c.json({ photo: thumbUrl(key) });
});

/** Sacar la foto del grupo (vuelve a mostrar la inicial). */
groupRoutes.delete("/groups/:id/photo", async (c) => {
  const u = c.get("user");
  const { group: g, member } = await membership(c.req.param("id"), u.id);
  if (member?.role !== "owner") throw new HTTPException(403, { message: "Solo el dueño puede cambiar la foto del grupo" });
  if (g.photoKey) {
    await db.update(group).set({ photoKey: null }).where(eq(group.id, g.id));
    await deleteImageUnlessEvidence(g.photoKey);
  }
  return c.json({ photo: null });
});

groupRoutes.delete("/groups/:id", async (c) => {
  const u = c.get("user");
  const { group: g, member } = await membership(c.req.param("id"), u.id);
  if (g.isGeneral) throw new HTTPException(400, { message: "El chat general no se puede borrar" });
  if (member?.role !== "owner") throw new HTTPException(403, { message: "Solo el dueño puede borrar el grupo" });
  await closeGroup(g.id, "Borrado por su dueño");
  return c.json({ ok: true });
});

// ---------- Solicitudes de ingreso ----------

groupRoutes.post("/groups/:id/requests", async (c) => {
  const u = c.get("user");
  const { group: g, member } = await membership(c.req.param("id"), u.id);
  if (g.isGeneral) throw new HTTPException(400, { message: "Al general ya pertenecés" });
  if ((await autoHiddenGroups()).has(g.id)) throw new HTTPException(403, { message: "Este grupo está en revisión. Probá más adelante." });
  if (member) throw new HTTPException(400, { message: "Ya sos parte de este grupo" });
  // Si ya te habían invitado, pedir entrar es aceptar la invitación
  if ((await inviteStateFor(u.id, [g.id])).get(g.id) === "invited") {
    await acceptPendingAdmission(g.id, u.id, { kind: "invite" });
    return c.json({ joined: true });
  }
  const state = (await requestStateFor(u.id, [g.id])).get(g.id);
  if (state?.pending) throw new HTTPException(409, { message: "Ya mandaste una solicitud" });
  if (state?.cooldownUntil) {
    const d = new Date(state.cooldownUntil).toLocaleDateString("es-AR", { day: "numeric", month: "long" });
    throw new HTTPException(429, { message: `Podés volver a pedir ingreso a partir del ${d}` });
  }
  const { message } = parse(z.object({ message: z.string().trim().max(300).optional() }), await c.req.json().catch(() => ({})));
  const id = newId();
  await db.insert(groupJoinRequest).values({ id, groupId: g.id, userId: u.id, message: message || null });
  const mods = await notifyMods(g.id, "group:request", { groupId: g.id });
  for (const m of mods) {
    pushTo(m, { title: "Nueva solicitud de ingreso", body: "Abrí el grupo para revisarla.", url: `/grupos/${g.id}/solicitudes`, tag: `req-${g.id}`, kind: "solicitudes" }).catch(() => {});
  }
  return c.json({ id });
});

/** Cancelar mi solicitud pendiente. */
groupRoutes.delete("/groups/:id/requests/mine", async (c) => {
  const u = c.get("user");
  await db
    .update(groupJoinRequest)
    .set({ status: "cancelled", resolvedAt: new Date() })
    .where(and(
      eq(groupJoinRequest.groupId, c.req.param("id")),
      eq(groupJoinRequest.userId, u.id),
      eq(groupJoinRequest.status, "pending"),
    ));
  await notifyMods(c.req.param("id"), "group:request", { groupId: c.req.param("id") });
  return c.json({ ok: true });
});

/**
 * Solicitudes pendientes (dueño y moderadores), de la más nueva a la más vieja,
 * de a REQUESTS_PAGE por página. Filtros opcionales: con/sin foto pública,
 * cuenta nueva y rango de edad. `total` viene solo en la primera página.
 */
groupRoutes.get("/groups/:id/requests", async (c) => {
  const u = c.get("user");
  const { group: g } = await requireMod(c.req.param("id"), u.id);
  const parsed = requestFilters.safeParse(c.req.query());
  if (!parsed.success) throw new HTTPException(400, { message: "Filtro inválido" });
  const page = await requestPage(g.id, parsed.data);
  if (!page) throw new HTTPException(400, { message: "Página inválida" });
  return c.json(page);
});

/**
 * Aceptar o rechazar muchas solicitudes de una (dueño y moderadores), para grupos con cientos pendientes.
 * Con `ids`, solo las de este grupo que sigan pendientes (las demás se ignoran). Con `filtros`, las más
 * nuevas que coinciden, hasta BULK_MAX; `remaining` dice cuántas quedan para el próximo pedido.
 * Mismos efectos que de a una: membresía, invitaciones cerradas, avisos y período de espera al rechazar.
 */
groupRoutes.post("/groups/:id/requests/bulk", async (c) => {
  const u = c.get("user");
  const { group: g } = await requireMod(c.req.param("id"), u.id);
  const body = parse(bulkInput, await c.req.json().catch(() => null));
  await limit(u.id, "bulkRequests");
  const accept = body.action === "accept";
  const now = new Date();
  const conds = body.ids
    ? [eq(groupJoinRequest.groupId, g.id), eq(groupJoinRequest.status, "pending"), inArray(groupJoinRequest.id, body.ids)]
    : pendingConds(g.id, body.filtros!, now);

  const userIds = await db.transaction(async (tx) => {
    await lockActiveGroup(tx, g.id);
    await lockModerator(tx, g.id, u.id);
    const picked = await tx
      .select({ id: groupJoinRequest.id })
      .from(groupJoinRequest)
      .innerJoin(user, eq(user.id, groupJoinRequest.userId))
      .leftJoin(profile, eq(profile.userId, groupJoinRequest.userId))
      .where(and(...conds))
      .orderBy(desc(groupJoinRequest.createdAt), desc(groupJoinRequest.id))
      .limit(BULK_MAX)
      .for("update", { of: groupJoinRequest });
    if (!picked.length) return [];
    const resolved = await tx
      .update(groupJoinRequest)
      .set({ status: accept ? "accepted" : "rejected", resolvedBy: u.id, resolvedAt: now })
      .where(and(inArray(groupJoinRequest.id, picked.map((r) => r.id)), eq(groupJoinRequest.status, "pending")))
      .returning({ userId: groupJoinRequest.userId });
    const ids = [...new Set(resolved.map((r) => r.userId))];
    if (accept && ids.length) {
      await tx.insert(groupMember).values(ids.map((userId) => ({ groupId: g.id, userId }))).onConflictDoNothing();
      await tx
        .update(groupInvite)
        .set({ status: "accepted", resolvedAt: now })
        .where(and(eq(groupInvite.groupId, g.id), inArray(groupInvite.userId, ids), eq(groupInvite.status, "pending")));
    }
    return ids;
  });

  if (userIds.length) {
    if (accept) {
      forgetMemberCount(g.id);
      for (const id of userIds) {
        syncGroupRoom(id, g.id, true);
        notifyRequestAccepted(g, id);
      }
    } else {
      for (const id of userIds) emitToUser(id, "group:rejected", { groupId: g.id, name: g.name });
    }
    await notifyAdmissionMods(g.id);
  }
  let remaining = 0;
  if (body.filtros) {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(groupJoinRequest)
      .innerJoin(user, eq(user.id, groupJoinRequest.userId))
      .leftJoin(profile, eq(profile.userId, groupJoinRequest.userId))
      .where(and(...pendingConds(g.id, body.filtros, now)));
    remaining = r?.n ?? 0;
  }
  return c.json({ resolved: userIds.length, remaining });
});

groupRoutes.post("/groups/:id/requests/:rid/:decision{accept|reject}", async (c) => {
  const u = c.get("user");
  const { group: g } = await requireMod(c.req.param("id"), u.id);
  const accept = c.req.param("decision") === "accept";
  const applicantId = await db.transaction(async (tx) => {
    await lockActiveGroup(tx, g.id);
    await lockModerator(tx, g.id, u.id);
    const now = new Date();
    const [resolved] = await tx
      .update(groupJoinRequest)
      .set({ status: accept ? "accepted" : "rejected", resolvedBy: u.id, resolvedAt: now })
      .where(and(
        eq(groupJoinRequest.id, c.req.param("rid")),
        eq(groupJoinRequest.groupId, g.id),
        eq(groupJoinRequest.status, "pending"),
      ))
      .returning({ userId: groupJoinRequest.userId });
    if (!resolved) throw new HTTPException(409, { message: "Esa solicitud ya fue resuelta" });
    if (accept) await addMember(tx, g.id, resolved.userId, u.id, now);
    return resolved.userId;
  });
  if (accept) {
    await notifyGroupJoin(g.id, applicantId);
    notifyRequestAccepted(g, applicantId);
  } else {
    emitToUser(applicantId, "group:rejected", { groupId: g.id, name: g.name });
    await notifyAdmissionMods(g.id);
  }
  return c.json({ ok: true });
});

// ---------- Invitaciones ----------
// Dueño y moderadores invitan; la persona invitada elige si entra. Nadie queda adentro sin aceptar.

/** Invitaciones pendientes que puede tener un grupo a la vez (frena las invitaciones masivas). */
const MAX_PENDING_INVITES = 50;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Bloquea primero el grupo: aceptar una solicitud y aceptar una invitación pueden modificar las mismas filas en distinto orden. */
async function lockActiveGroup(tx: Transaction, groupId: string) {
  const [active] = await tx.select({ id: group.id }).from(group)
    .where(and(eq(group.id, groupId), isNull(group.removedAt))).for("no key update");
  if (!active) throw new HTTPException(404, { message: "Ese grupo ya no existe" });
}

/** Evita que cambie el rol mientras el moderador resuelve el ingreso. */
async function lockModerator(tx: Transaction, groupId: string, userId: string) {
  const [member] = await tx.select({ role: groupMember.role }).from(groupMember)
    .where(and(eq(groupMember.groupId, groupId), eq(groupMember.userId, userId))).for("share");
  if (!canModerate(member?.role)) throw new HTTPException(403, { message: "Solo dueño o moderadores" });
}

/** Suma a alguien al grupo y cierra lo que tenía pendiente dentro de la misma transacción. */
async function addMember(tx: Transaction, groupId: string, userId: string, by: string | null, now: Date) {
  await tx.insert(groupMember).values({ groupId, userId }).onConflictDoNothing();
  await tx
    .update(groupJoinRequest)
    .set({ status: "accepted", resolvedBy: by, resolvedAt: now })
    .where(and(eq(groupJoinRequest.groupId, groupId), eq(groupJoinRequest.userId, userId), eq(groupJoinRequest.status, "pending")));
  await tx
    .update(groupInvite)
    .set({ status: "accepted", resolvedAt: now })
    .where(and(eq(groupInvite.groupId, groupId), eq(groupInvite.userId, userId), eq(groupInvite.status, "pending")));
}

async function notifyGroupJoin(groupId: string, userId: string) {
  forgetMemberCount(groupId);
  syncGroupRoom(userId, groupId, true);
  await notifyAdmissionMods(groupId);
}

function notifyAdmissionMods(groupId: string) {
  return notifyMods(groupId, "group:request", { groupId })
    .catch((error) => console.error("Aviso de ingreso a moderación", { groupId, error }));
}

function notifyRequestAccepted(g: { id: string; name: string }, userId: string) {
  emitToUser(userId, "group:accepted", { groupId: g.id, name: g.name });
  pushTo(userId, { title: "Te aceptaron en un grupo", body: "Ya podés entrar al chat.", url: `/grupos/${g.id}`, tag: `acc-${g.id}`, kind: "solicitudes" }).catch(() => {});
}

type PendingAdmission = { kind: "invite" } | { kind: "request"; moderatorId: string };

/** Al coincidir una solicitud y una invitación, confirma que la anterior siga pendiente. */
async function acceptPendingAdmission(groupId: string, userId: string, pending: PendingAdmission) {
  await db.transaction(async (tx) => {
    await lockActiveGroup(tx, groupId);
    const moderatorId = pending.kind === "request" ? pending.moderatorId : null;
    if (moderatorId !== null) await lockModerator(tx, groupId, moderatorId);
    const source = pending.kind === "invite" ? groupInvite : groupJoinRequest;
    const [row] = await tx.select({ id: source.id }).from(source)
      .where(and(eq(source.groupId, groupId), eq(source.userId, userId), eq(source.status, "pending")))
      .limit(1).for("update");
    if (!row) throw new HTTPException(409, { message: "El ingreso ya se resolvió. Actualizá el grupo." });
    await addMember(tx, groupId, userId, moderatorId, new Date());
  });
  await notifyGroupJoin(groupId, userId);
}

/** Qué pasa entre una persona y un grupo: si ya está, si tiene invitación o solicitud pendiente. */
async function inviteStateFor(userId: string, ids: string[]) {
  const map = new Map<string, "member" | "invited" | "requested" | "declined">();
  if (!ids.length) return map;
  const since = new Date(Date.now() - REAPPLY_DAYS * 86_400_000);
  const [members, invites, requests] = await Promise.all([
    db.select({ groupId: groupMember.groupId }).from(groupMember)
      .where(and(eq(groupMember.userId, userId), inArray(groupMember.groupId, ids))),
    db.select({ groupId: groupInvite.groupId, status: groupInvite.status }).from(groupInvite)
      .where(and(
        eq(groupInvite.userId, userId),
        inArray(groupInvite.groupId, ids),
        or(eq(groupInvite.status, "pending"), and(eq(groupInvite.status, "declined"), gt(groupInvite.resolvedAt, since))),
      )),
    db.select({ groupId: groupJoinRequest.groupId }).from(groupJoinRequest)
      .where(and(eq(groupJoinRequest.userId, userId), inArray(groupJoinRequest.groupId, ids), eq(groupJoinRequest.status, "pending"))),
  ]);
  for (const r of invites) if (!map.has(r.groupId) || r.status === "pending") map.set(r.groupId, r.status === "pending" ? "invited" : "declined");
  for (const r of requests) map.set(r.groupId, "requested");
  for (const r of members) map.set(r.groupId, "member");
  return map;
}

/** Lo mismo que inviteStateFor, pero para varias personas en un solo grupo. */
async function peopleStateIn(groupId: string, userIds: string[]) {
  const map = new Map<string, "member" | "invited" | "requested" | "declined">();
  if (!userIds.length) return map;
  const since = new Date(Date.now() - REAPPLY_DAYS * 86_400_000);
  const [members, invites, requests] = await Promise.all([
    db.select({ userId: groupMember.userId }).from(groupMember)
      .where(and(eq(groupMember.groupId, groupId), inArray(groupMember.userId, userIds))),
    db.select({ userId: groupInvite.userId, status: groupInvite.status }).from(groupInvite)
      .where(and(
        eq(groupInvite.groupId, groupId),
        inArray(groupInvite.userId, userIds),
        or(eq(groupInvite.status, "pending"), and(eq(groupInvite.status, "declined"), gt(groupInvite.resolvedAt, since))),
      )),
    db.select({ userId: groupJoinRequest.userId }).from(groupJoinRequest)
      .where(and(eq(groupJoinRequest.groupId, groupId), inArray(groupJoinRequest.userId, userIds), eq(groupJoinRequest.status, "pending"))),
  ]);
  for (const r of invites) if (!map.has(r.userId) || r.status === "pending") map.set(r.userId, r.status === "pending" ? "invited" : "declined");
  for (const r of requests) map.set(r.userId, "requested");
  for (const r of members) map.set(r.userId, "member");
  return map;
}

/** Los grupos que modero, con el estado de una persona en cada uno (para invitarla desde su perfil). */
groupRoutes.get("/groups/invitable/:uid", async (c) => {
  const u = c.get("user");
  const target = c.req.param("uid");
  const rows = await db
    .select({ id: group.id, name: group.name, photoKey: group.photoKey })
    .from(groupMember)
    .innerJoin(group, eq(group.id, groupMember.groupId))
    .where(and(eq(groupMember.userId, u.id), inArray(groupMember.role, ["owner", "moderator"]), eq(group.isGeneral, false), isNull(group.removedAt)))
    .orderBy(asc(group.name));
  if (target === u.id || (await blockedWith(u.id)).has(target)) return c.json([]);
  const states = await inviteStateFor(target, rows.map((r) => r.id));
  return c.json(rows.map(({ photoKey, ...r }) => ({ ...r, photo: thumbUrl(photoKey), state: states.get(r.id) ?? null })));
});

groupRoutes.post("/groups/:id/invites", async (c) => {
  const u = c.get("user");
  const { group: g } = await requireMod(c.req.param("id"), u.id);
  if (g.isGeneral) throw new HTTPException(400, { message: "Al general ya pertenece todo el mundo" });
  if ((await autoHiddenGroups()).has(g.id)) throw new HTTPException(403, { message: "Este grupo está en revisión. Por ahora no se puede invitar." });
  const { userId: target } = parse(z.object({ userId: z.string().min(1) }), await c.req.json().catch(() => ({})));
  if (target === u.id) throw new HTTPException(400, { message: "Ya sos parte de este grupo" });
  const [p] = await db.select({ userId: schema.profile.userId }).from(schema.profile).where(eq(schema.profile.userId, target));
  if (!p || (await blockedWith(u.id)).has(target)) throw new HTTPException(404, { message: "No encontramos a esa persona" });

  const state = (await inviteStateFor(target, [g.id])).get(g.id);
  if (state === "member") throw new HTTPException(409, { message: "Ya es parte del grupo" });
  if (state === "invited") throw new HTTPException(409, { message: "Ya tiene una invitación pendiente" });
  if (state === "declined") throw new HTTPException(429, { message: "Rechazó una invitación hace poco. Esperá unos días para volver a invitarle" });
  if (state === "requested") {
    // Ya había pedido entrar: invitarle es lo mismo que aceptarle
    await acceptPendingAdmission(g.id, target, { kind: "request", moderatorId: u.id });
    notifyRequestAccepted(g, target);
    return c.json({ joined: true });
  }

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(groupInvite)
    .where(and(eq(groupInvite.groupId, g.id), eq(groupInvite.status, "pending")));
  if (n >= MAX_PENDING_INVITES) {
    throw new HTTPException(429, { message: `El grupo ya tiene ${MAX_PENDING_INVITES} invitaciones sin responder. Esperá a que contesten o cancelá alguna` });
  }
  const id = newId();
  await db.insert(groupInvite).values({ id, groupId: g.id, userId: target, invitedBy: u.id });
  emitToUser(target, "group:invite", { groupId: g.id, name: g.name });
  pushTo(target, { title: "Te invitaron a un grupo", body: "Abrí Grupos para ver la invitación.", url: "/grupos", tag: `inv-${g.id}`, kind: "solicitudes" }).catch(() => {});
  await notifyMods(g.id, "group:request", { groupId: g.id });
  return c.json({ id });
});

const candidatesQuery = z.object({
  q: z.string().trim().max(40).optional(),
  // Hasta cuántos km (sin valor: sin límite)
  maxKm: z.coerce.number().positive().max(20000).optional(),
  ageMin: z.coerce.number().int().min(18).max(99).optional(),
  ageMax: z.coerce.number().int().min(18).max(99).optional(),
  online: z.enum(["1"]).optional(),
  withPhoto: z.enum(["1"]).optional(),
  // Solo gente con la que ya chateaste / solo tus favoritos
  chatted: z.enum(["1"]).optional(),
  favorites: z.enum(["1"]).optional(),
  // Por defecto no se muestra a quien ya está en el grupo
  showMembers: z.enum(["1"]).optional(),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
});
const CANDIDATES_PAGE = 60;

/**
 * Gente para invitar a un grupo (dueño y moderadores): la lista larga, como la grilla de Gente,
 * de la más cercana a la más lejana. Se puede buscar por nombre y filtrar por distancia, edad, en línea,
 * con foto, "ya chateamos" y favoritos. Quien está en incógnito solo aparece si la buscás por nombre.
 */
groupRoutes.get("/groups/:id/invite-candidates", async (c) => {
  const u = c.get("user");
  const me = c.get("profile")!;
  const { group: g } = await requireMod(c.req.param("id"), u.id);
  const f = candidatesQuery.parse(c.req.query());
  const q = f.q ?? "";

  const conds = [sql`${schema.profile.userId} <> ${u.id}`, sql`not ${activeSuspension()}`];
  if (q) conds.push(ilike(schema.profile.displayName, `%${q.replace(/[%_\\]/g, "\\$&")}%`));
  else conds.push(eq(schema.profile.incognito, false));
  const rows = await db.select().from(schema.profile).where(and(...conds)).orderBy(desc(schema.profile.lastSeenAt)).limit(3000);

  const blocked = await blockedWith(u.id);
  const hidden = await autoHiddenUsers();
  let chatted: Set<string> | null = null;
  if (f.chatted) {
    const convs = await db.select({ a: schema.conversation.userA, b: schema.conversation.userB }).from(schema.conversation)
      .where(or(eq(schema.conversation.userA, u.id), eq(schema.conversation.userB, u.id)));
    chatted = new Set(convs.map((r) => (r.a === u.id ? r.b : r.a)));
  }
  let favorites: Set<string> | null = null;
  if (f.favorites) {
    const favs = await db.select({ id: schema.favorite.favoriteId }).from(schema.favorite).where(eq(schema.favorite.userId, u.id));
    favorites = new Set(favs.map((r) => r.id));
  }

  const meHasLoc = me.cellLat != null && me.cellLng != null;
  let list = rows
    .filter((p) => !blocked.has(p.userId) && !hidden.has(p.userId) && (!chatted || chatted.has(p.userId)) && (!favorites || favorites.has(p.userId)))
    .map((p) => {
      // null si alguien escondió la distancia: tampoco se usa para ordenar ni para el filtro de km
      const km = visibleKm(me, p);
      return { p, km, age: p.showAge ? ageFrom(p.birthdate) : null, online: !p.incognito && isOnline(p.userId) };
    })
    .filter(({ km, age, online }) =>
      (f.maxKm == null || (km != null && km <= f.maxKm)) &&
      (f.ageMin == null || (age != null && age >= f.ageMin)) &&
      (f.ageMax == null || (age != null && age <= f.ageMax)) &&
      (!f.online || online));

  // Estado en el grupo (miembro, invitado, pidió entrar…): por defecto se esconde a quien ya está
  const states = await peopleStateIn(g.id, list.map((x) => x.p.userId));
  if (!f.showMembers) list = list.filter((x) => states.get(x.p.userId) !== "member");

  // Foto principal pública
  const ids = list.map((x) => x.p.userId);
  const photos = ids.length
    ? await db.select().from(schema.photo).where(and(inArray(schema.photo.userId, ids), eq(schema.photo.isPrivate, false))).orderBy(asc(schema.photo.position))
    : [];
  const first = new Map<string, string>();
  for (const ph of photos) if (!first.has(ph.userId)) first.set(ph.userId, ph.key);
  if (f.withPhoto) list = list.filter((x) => first.has(x.p.userId));

  const far = Number.POSITIVE_INFINITY;
  list.sort((a, b) => (a.km ?? far) - (b.km ?? far) || Number(b.online) - Number(a.online) || b.p.lastSeenAt.getTime() - a.p.lastSeenAt.getTime());
  const page = list.slice(f.offset, f.offset + CANDIDATES_PAGE);

  return c.json({
    hasLocation: meHasLoc,
    total: list.length,
    hasMore: list.length > f.offset + CANDIDATES_PAGE,
    people: page.map(({ p, km, age, online }) => ({
      id: p.userId,
      name: p.displayName,
      age,
      photo: thumbUrl(first.get(p.userId)),
      online,
      distance: km != null ? distanceLabel(km) : null,
      state: states.get(p.userId) ?? null,
    })),
  });
});

/** Invitaciones sin responder de un grupo (dueño y moderadores). */
groupRoutes.get("/groups/:id/invites", async (c) => {
  const u = c.get("user");
  const { group: g } = await requireMod(c.req.param("id"), u.id);
  const rows = await db
    .select()
    .from(groupInvite)
    .where(and(eq(groupInvite.groupId, g.id), eq(groupInvite.status, "pending")))
    .orderBy(desc(groupInvite.createdAt));
  const authors = await authorsFor(rows.map((r) => r.userId));
  return c.json(rows.flatMap((r) => {
    const a = authors.get(r.userId);
    return a ? [{ id: r.id, createdAt: r.createdAt.toISOString(), user: a }] : [];
  }));
});

groupRoutes.delete("/groups/:id/invites/:iid", async (c) => {
  const u = c.get("user");
  const { group: g } = await requireMod(c.req.param("id"), u.id);
  const [row] = await db
    .update(groupInvite)
    .set({ status: "cancelled", resolvedAt: new Date() })
    .where(and(eq(groupInvite.id, c.req.param("iid")), eq(groupInvite.groupId, g.id), eq(groupInvite.status, "pending")))
    .returning();
  if (row) emitToUser(row.userId, "group:invite", { groupId: g.id });
  await notifyMods(g.id, "group:request", { groupId: g.id });
  return c.json({ ok: true });
});

/** Mis invitaciones sin responder. */
groupRoutes.get("/invites", requireUser, requireProfile, async (c) => {
  const u = c.get("user");
  const rows = await db
    .select({ id: groupInvite.id, invitedBy: groupInvite.invitedBy, createdAt: groupInvite.createdAt, groupId: group.id, name: group.name, description: group.description, photoKey: group.photoKey })
    .from(groupInvite)
    .innerJoin(group, eq(group.id, groupInvite.groupId))
    .where(and(eq(groupInvite.userId, u.id), eq(groupInvite.status, "pending"), isNull(group.removedAt)))
    .orderBy(desc(groupInvite.createdAt));
  const blocked = await blockedWith(u.id);
  const visible = rows.filter((r) => !r.invitedBy || !blocked.has(r.invitedBy));
  const counts = await memberCounts(visible.map((r) => r.groupId));
  const authors = await authorsFor(visible.flatMap((r) => (r.invitedBy ? [r.invitedBy] : [])));
  return c.json(visible.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    group: { id: r.groupId, name: r.name, description: r.description, photo: thumbUrl(r.photoKey), memberCount: counts.get(r.groupId) ?? 0 },
    invitedBy: (r.invitedBy && authors.get(r.invitedBy)) || null,
  })));
});

groupRoutes.post("/invites/:iid/:decision{accept|decline}", requireUser, requireProfile, async (c) => {
  const u = c.get("user");
  const accept = c.req.param("decision") === "accept";
  const groupId = await db.transaction(async (tx) => {
    const pendingInvite = and(
      eq(groupInvite.id, c.req.param("iid")),
      eq(groupInvite.userId, u.id),
      eq(groupInvite.status, "pending"),
    );
    const [inv] = await tx.select({ groupId: groupInvite.groupId }).from(groupInvite).where(pendingInvite);
    if (!inv) throw new HTTPException(409, { message: "Esa invitación ya no está disponible" });
    await lockActiveGroup(tx, inv.groupId);
    const now = new Date();
    const [resolved] = await tx.update(groupInvite)
      .set({ status: accept ? "accepted" : "declined", resolvedAt: now })
      .where(pendingInvite)
      .returning({ invitedBy: groupInvite.invitedBy });
    if (!resolved) throw new HTTPException(409, { message: "Esa invitación ya no está disponible" });
    if (accept) await addMember(tx, inv.groupId, u.id, resolved.invitedBy, now);
    return inv.groupId;
  });
  if (accept) await notifyGroupJoin(groupId, u.id);
  else await notifyAdmissionMods(groupId);
  emitToUser(u.id, "group:invite", { groupId }); // para que se actualice el contador en sus otras pestañas
  if (accept) return c.json({ groupId });
  return c.json({ ok: true });
});

// ---------- Miembros ----------

/** De a 25, como la grilla de Gente: la información del grupo no trae cientos de integrantes de una. */
const MEMBER_PAGE = 25;

groupRoutes.get("/groups/:id/members", async (c) => {
  const u = c.get("user");
  const { group: g, member } = await membership(c.req.param("id"), u.id);
  if (!member) throw new HTTPException(403, { message: "No sos parte de este grupo" });
  const offset = parse(z.coerce.number().int().min(0), c.req.query("offset") ?? 0);
  const rows = await db
    .select()
    .from(groupMember)
    .where(eq(groupMember.groupId, g.id))
    .orderBy(
      sql`case ${groupMember.role} when 'owner' then 0 when 'moderator' then 1 else 2 end`,
      asc(groupMember.joinedAt),
      asc(groupMember.userId),
    )
    .limit(MEMBER_PAGE + 1)
    .offset(offset);
  const hasMore = rows.length > MEMBER_PAGE;
  const blocked = await blockedWith(u.id);
  const visible = rows.slice(0, MEMBER_PAGE).filter((r) => !blocked.has(r.userId));
  const authors = await authorsFor(visible.map((r) => r.userId));
  return c.json({
    members: visible.flatMap((r) => {
      const a = authors.get(r.userId);
      return a ? [{ ...a, role: r.role as Role, joinedAt: r.joinedAt.toISOString() }] : [];
    }),
    nextOffset: hasMore ? offset + MEMBER_PAGE : null,
  });
});

/** Nombrar o sacar moderadores (solo el dueño). */
groupRoutes.patch("/groups/:id/members/:uid", async (c) => {
  const u = c.get("user");
  const { group: g, member } = await membership(c.req.param("id"), u.id);
  if (member?.role !== "owner") throw new HTTPException(403, { message: "Solo el dueño puede cambiar roles" });
  const { role } = parse(z.object({ role: z.enum(["moderator", "member"]) }), await c.req.json());
  const target = c.req.param("uid");
  if (target === u.id) throw new HTTPException(400, { message: "No podés cambiar tu propio rol" });
  const [row] = await db
    .update(groupMember)
    .set({ role })
    .where(and(eq(groupMember.groupId, g.id), eq(groupMember.userId, target)))
    .returning();
  if (!row) throw new HTTPException(404, { message: "Esa persona no está en el grupo" });
  emitToUser(target, "group:role", { groupId: g.id, role });
  return c.json({ ok: true });
});

/** Expulsar. Moderadores pueden expulsar miembros; el dueño, a cualquiera. */
groupRoutes.delete("/groups/:id/members/:uid", async (c) => {
  const u = c.get("user");
  const { group: g, member } = await requireMod(c.req.param("id"), u.id);
  if (g.isGeneral) throw new HTTPException(400, { message: "Del general no se puede expulsar: reportá o bloqueá" });
  const target = c.req.param("uid");
  if (target === u.id) throw new HTTPException(400, { message: "Para irte, usá «Salir del grupo»" });
  const [t] = await db
    .select()
    .from(groupMember)
    .where(and(eq(groupMember.groupId, g.id), eq(groupMember.userId, target)));
  if (!t) throw new HTTPException(404, { message: "Esa persona no está en el grupo" });
  if (member.role === "moderator" && t.role !== "member") {
    throw new HTTPException(403, { message: "Solo el dueño puede expulsar a otro moderador" });
  }
  await db.delete(groupMember).where(and(eq(groupMember.groupId, g.id), eq(groupMember.userId, target)));
  forgetMemberCount(g.id);
  // Queda registrado para el período de espera antes de volver a pedir ingreso
  await db.insert(groupJoinRequest).values({
    id: newId(), groupId: g.id, userId: target, status: "removed", resolvedBy: u.id, resolvedAt: new Date(),
  });
  syncGroupRoom(target, g.id, false);
  emitToUser(target, "group:removed", { groupId: g.id, name: g.name });
  return c.json({ ok: true });
});

/** Salir de un grupo. Si se va el dueño, la posta pasa a un moderador o al miembro más antiguo. */
groupRoutes.post("/groups/:id/leave", async (c) => {
  const u = c.get("user");
  const { group: g, member } = await membership(c.req.param("id"), u.id);
  if (g.isGeneral) throw new HTTPException(400, { message: "Del chat general no se puede salir" });
  if (!member) return c.json({ ok: true });
  await db.delete(groupMember).where(and(eq(groupMember.groupId, g.id), eq(groupMember.userId, u.id)));
  forgetMemberCount(g.id);
  syncGroupRoom(u.id, g.id, false);

  if (member.role === "owner") {
    const [heir] = await db
      .select()
      .from(groupMember)
      .where(eq(groupMember.groupId, g.id))
      .orderBy(sql`case ${groupMember.role} when 'moderator' then 0 else 1 end`, asc(groupMember.joinedAt))
      .limit(1);
    if (heir) {
      await db.update(groupMember).set({ role: "owner" })
        .where(and(eq(groupMember.groupId, g.id), eq(groupMember.userId, heir.userId)));
      await db.update(group).set({ ownerId: heir.userId }).where(eq(group.id, g.id));
      emitToUser(heir.userId, "group:role", { groupId: g.id, role: "owner" });
    } else {
      await closeGroup(g.id, "Se fue la última persona"); // nadie más: el grupo se cierra
    }
  }
  return c.json({ ok: true });
});

// ---------- Mensajes ----------

/** Historial publicado (sin gente con bloqueo) + mis mensajes en cola. */
groupRoutes.get("/groups/:id/messages", async (c) => {
  const u = c.get("user");
  const groupId = c.req.param("id");
  const { member } = await membership(groupId, u.id);
  if (!member) throw new HTTPException(403, { message: "No sos parte de este grupo" });

  const before = c.req.query("before");
  const after = c.req.query("after");
  const around = c.req.query("around");
  const cursorId = c.req.query("cursorId");
  const blocked = [...(await blockedWith(u.id))];
  const conds = [eq(groupMessage.groupId, groupId), eq(groupMessage.status, "published")];
  if (blocked.length) conds.push(notInArray(groupMessage.userId, blocked));

  // El ID desempata cuando dos publicaciones comparten el mismo milisegundo.
  const position = sql`(${groupMessage.scheduledAt}, ${groupMessage.id})`;
  const cursor = (date: Date, id: string) => sql`(${date.toISOString()}::timestamptz, ${id}::text)`;
  if (around) {
    const [target] = await db.select().from(groupMessage).where(and(...conds, eq(groupMessage.id, around)));
    if (!target) throw new HTTPException(404, { message: "El mensaje citado ya no está disponible." });
    const pivot = cursor(target.scheduledAt, target.id);
    const [older, newer] = await Promise.all([
      db.select().from(groupMessage).where(and(...conds, sql`${position} < ${pivot}`))
        .orderBy(desc(groupMessage.scheduledAt), desc(groupMessage.id)).limit(25),
      db.select().from(groupMessage).where(and(...conds, sql`${position} > ${pivot}`))
        .orderBy(asc(groupMessage.scheduledAt), asc(groupMessage.id)).limit(26),
    ]);
    return c.json({
      messages: await serializeGroupMessages([...older.slice(0, 24).reverse(), target, ...newer.slice(0, 25)], u.id),
      hasMore: older.length > 24, hasNewer: newer.length > 25,
    });
  }

  const boundary = before ?? after;
  if (boundary !== undefined) {
    const date = new Date(boundary);
    if (!Number.isFinite(date.getTime()) || (before && after) || (after && !cursorId)) {
      throw new HTTPException(400, { message: "Página inválida" });
    }
    if (cursorId) {
      const pivot = cursor(date, cursorId);
      conds.push(after ? sql`${position} > ${pivot}` : sql`${position} < ${pivot}`);
    } else {
      // Las versiones anteriores solo envían la fecha.
      conds.push(lt(groupMessage.scheduledAt, date));
    }
  }
  const order = after ? asc : desc;
  const rows = await db.select().from(groupMessage).where(and(...conds))
    .orderBy(order(groupMessage.scheduledAt), order(groupMessage.id)).limit(51);
  const published = rows.slice(0, 50);
  const hasMore = rows.length > 50;
  if (after) return c.json({ messages: await serializeGroupMessages(published, u.id), hasMore, hasNewer: hasMore });

  const queued = before
    ? []
    : await db
        .select()
        .from(groupMessage)
        .where(and(eq(groupMessage.groupId, groupId), eq(groupMessage.userId, u.id), eq(groupMessage.status, "queued")))
        .orderBy(asc(groupMessage.scheduledAt));

  return c.json({
    messages: await serializeGroupMessages(published.reverse(), u.id),
    queued: await serializeGroupMessages(queued, u.id),
    hasMore,
  });
});

const bodySchema = z.object({ body: z.string().trim().min(1, "Mensaje vacío").max(1000, "Máximo 1000 caracteres") });

groupRoutes.post("/groups/:id/messages", async (c) => {
  const u = c.get("user");
  const groupId = c.req.param("id");
  const { group: g, member } = await membership(groupId, u.id);
  if (!member) throw new HTTPException(403, { message: "No sos parte de este grupo" });
  const raw = await c.req.json();
  const { body } = parse(bodySchema, raw);
  // Encuesta: el texto es la pregunta y van entre 2 y 5 opciones (ver polls.ts)
  const options = raw?.poll === undefined ? null : parse(z.object({ options: pollOptionsInput }), raw.poll).options;
  if (options && body.length > POLL_QUESTION_MAX) {
    throw new HTTPException(400, { message: `La pregunta puede tener hasta ${POLL_QUESTION_MAX} caracteres` });
  }
  const idempotencyKey = messageKey(c.req.header("Idempotency-Key"));
  const { row, slot } = await db.transaction(async (tx) => {
    await tx.select({ id: group.id }).from(group).where(eq(group.id, groupId)).for("update");
    if (idempotencyKey) {
      const [existing] = await tx.select().from(groupMessage).where(and(eq(groupMessage.userId, u.id), eq(groupMessage.idempotencyKey, idempotencyKey)));
      if (existing && existing.groupId !== groupId) throw new HTTPException(409);
      if (existing) return { row: existing, slot: null };
    }
    // Respuesta a otro mensaje: tiene que ser del mismo grupo y estar publicado
    let replyToId: string | null = null;
    if (typeof raw?.replyToId === "string" && raw.replyToId) {
      const [orig] = await tx.select({ id: groupMessage.id }).from(groupMessage)
        .where(and(eq(groupMessage.id, raw.replyToId), eq(groupMessage.groupId, groupId), eq(groupMessage.status, "published")));
      if (!orig) throw new HTTPException(400, { message: "Ese mensaje ya no está" });
      replyToId = orig.id;
    }

    // Cuentas nuevas no pueden mandar links en grupos
    const isNew = Date.now() - new Date(u.createdAt).getTime() < g.spamRules.newAccountHours * 3_600_000;
    if (isNew && /(https?:\/\/|www\.|\.[a-z]{2,}\/)/i.test([body, ...(options ?? [])].join("\n"))) {
      throw new HTTPException(400, { message: `Las cuentas nuevas no pueden mandar links en grupos durante las primeras ${g.spamRules.newAccountHours} h` });
    }

    const slot = await nextSlot({ groupId, userId: u.id, userCreatedAt: new Date(u.createdAt), rules: g.spamRules }, tx);
    if (!slot.ok) throw new HTTPException(429, { message: slot.error });

    const now = new Date();
    const publishNow = slot.at.getTime() <= now.getTime();
    const [row] = await tx
      .insert(groupMessage)
      .values({
        id: newId(),
        idempotencyKey,
        groupId,
        userId: u.id,
        body,
        replyToId,
        status: publishNow ? "published" : "queued",
        scheduledAt: publishNow ? now : slot.at,
      })
      .onConflictDoNothing({ target: [groupMessage.userId, groupMessage.idempotencyKey] }).returning();
    if (!row) throw new HTTPException(409);
    if (options) await tx.insert(groupPoll).values({ messageId: row.id, options });
    return { row, slot };
  });
  const [msg] = await serializeGroupMessages([row], u.id);
  if (!slot) return c.json({ message: msg, reasons: [], intervalSeconds: g.spamRules.intervalSeconds });
  if (row.status === "published") {
    await emitPublishedMessage(msg, row.idempotencyKey);
    notifyGroupMessage(row).catch((e) => console.error("notifyGroupMessage", e));
  }
  else emitToUser(u.id, "group:queued", msg);
  return c.json({ message: msg, reasons: slot.reasons, intervalSeconds: slot.intervalSeconds });
});

groupRoutes.put("/groups/:id/photo-pilot", async (c) => {
  const { group: g } = await requireMod(c.req.param("id"), c.get("user").id);
  if (!groupPhotoPilot(g)) return c.notFound();
  const { paused } = parse(z.object({ paused: z.boolean() }), await c.req.json());
  await db.update(group).set({ photoUploadsPaused: paused }).where(eq(group.id, g.id));
  emitToGroupRoom(g.id, "group:photo-pilot", { groupId: g.id, paused });
  return c.json({ paused });
});

groupRoutes.post("/groups/:id/messages/photo", async (c) => {
  const u = c.get("user");
  const { group: g, member } = await membership(c.req.param("id"), u.id);
  if (!member || !groupPhotoPilot(g)) return c.notFound();
  if (g.photoUploadsPaused) throw new HTTPException(409, { message: "Las fotos de este grupo están en pausa" });
  // Igual que con los links, las cuentas nuevas no mandan fotos. En el piloto el mínimo es el valor por defecto,
  // aunque el grupo lo haya bajado: una cuenta creada para subir algo y desaparecer es el caso más riesgoso.
  const newAccountHours = Math.max(g.spamRules.newAccountHours, DEFAULT_SPAM_RULES.newAccountHours);
  if (Date.now() - new Date(u.createdAt).getTime() < newAccountHours * 3_600_000) {
    throw new HTTPException(403, { message: `Las cuentas nuevas no pueden mandar fotos en grupos durante las primeras ${newAccountHours} h` });
  }
  await limit(u.id, "upload");
  const file = (await c.req.parseBody()).file;
  if (!(file instanceof File) || file.type.startsWith("video/")) {
    throw new HTTPException(400, { message: "Elegí una foto" });
  }
  if (file.size > MAX_UPLOAD_BYTES) throw new HTTPException(413, { message: "La foto pesa demasiado" });
  // Primero un control sin bloqueo, para no procesar la imagen si ya se sabe que no entra en la cola
  const early = await nextSlot({ groupId: g.id, userId: u.id, userCreatedAt: new Date(u.createdAt), rules: g.spamRules });
  if (!early.ok) throw new HTTPException(429, { message: early.error });
  let photoKey: string;
  try {
    photoKey = await saveImage(await file.arrayBuffer());
  } catch {
    throw new HTTPException(400, { message: "No pudimos leer esa imagen" });
  }
  const row = await db.transaction(async (tx) => {
    // Mismo bloqueo que los mensajes de texto: así una ráfaga de fotos no pasa el tope de la cola
    const [current] = await tx.select().from(group).where(eq(group.id, g.id)).for("update");
    const [currentMember] = await tx.select().from(groupMember)
      .where(and(eq(groupMember.groupId, g.id), eq(groupMember.userId, u.id))).for("share");
    const [sender] = await tx.select({ suspendedAt: profile.suspendedAt, suspendedUntil: profile.suspendedUntil }).from(profile).where(eq(profile.userId, u.id)).for("share");
    if (!current || current.removedAt || current.photoUploadsPaused || !currentMember || !sender || isSuspended(sender)) {
      throw new HTTPException(409, { message: "Por ahora no podés mandar fotos en este grupo" });
    }
    const slot = await nextSlot({ groupId: g.id, userId: u.id, userCreatedAt: new Date(u.createdAt), rules: current.spamRules }, tx);
    if (!slot.ok) throw new HTTPException(429, { message: slot.error });
    const now = new Date();
    const publishNow = slot.at.getTime() <= now.getTime();
    const [message] = await tx.insert(groupMessage).values({
      id: newId(), groupId: g.id, userId: u.id, body: "", photoKey,
      status: publishNow ? "published" : "queued", scheduledAt: publishNow ? now : slot.at,
    }).returning();
    return message;
  }).catch(async (error) => {
    await deleteImage(photoKey);
    throw error;
  });
  const [message] = await serializeGroupMessages([row]);
  if (row.status === "published") await emitToGroup(g.id, u.id, "group:message", message);
  else emitToUser(u.id, "group:queued", message);
  return c.json({ message });
});

groupRoutes.get("/groups/:id/messages/:mid/photo", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const groupId = c.req.param("id");
  if (!groupPhotoPilot({ id: groupId, isGeneral: false })) return c.notFound();
  const messageId = c.req.param("mid");
  const viewer = c.get("user").id;
  const key = await canOpenGroupPhoto(groupId, messageId, viewer);
  if (!key) return c.notFound();
  const image = await readImage(key);
  // El estado puede cambiar mientras se obtiene el archivo del almacenamiento.
  if (!image || await canOpenGroupPhoto(groupId, messageId, viewer) !== key) return c.notFound();
  return c.body(new Uint8Array(image), 200, { "Content-Type": "image/webp" });
});

/** Editar un mensaje propio mientras está en cola. */
groupRoutes.patch("/groups/:id/messages/:mid", async (c) => {
  const u = c.get("user");
  const { body } = parse(bodySchema, await c.req.json());
  const [poll] = await db.select({ id: groupPoll.messageId }).from(groupPoll).where(eq(groupPoll.messageId, c.req.param("mid")));
  if (poll && body.length > POLL_QUESTION_MAX) {
    throw new HTTPException(400, { message: `La pregunta puede tener hasta ${POLL_QUESTION_MAX} caracteres` });
  }
  const [row] = await db
    .update(groupMessage)
    .set({ body })
    .where(and(
      eq(groupMessage.id, c.req.param("mid")),
      eq(groupMessage.groupId, c.req.param("id")),
      isNull(groupMessage.photoKey),
      eq(groupMessage.userId, u.id),
      eq(groupMessage.status, "queued"),
    ))
    .returning();
  if (!row) throw new HTTPException(409, { message: "Ese mensaje ya salió" });
  const [msg] = await serializeGroupMessages([row], u.id);
  emitToUser(u.id, "group:queued", msg);
  return c.json({ message: msg });
});

/** Cancelar (si está en cola) o borrar (si ya salió). Dueño y moderadores pueden borrar mensajes de otros. */
groupRoutes.delete("/groups/:id/messages/:mid", async (c) => {
  const u = c.get("user");
  const groupId = c.req.param("id");
  const [row] = await db
    .select()
    .from(groupMessage)
    .where(and(eq(groupMessage.id, c.req.param("mid")), eq(groupMessage.groupId, groupId)));
  if (!row) return c.notFound();
  const mine = row.userId === u.id;
  if (!mine) {
    const { member } = await membership(groupId, u.id);
    if (!canModerate(member?.role) || row.status !== "published") {
      throw new HTTPException(403, { message: "No podés borrar ese mensaje" });
    }
  }
  const cancelOnly = c.req.query("onlyQueued") === "1";
  if (cancelOnly && !mine) throw new HTTPException(403);
  if (cancelOnly && row.status === "published") throw new HTTPException(409, { message: "El mensaje ya se publicó." });
  if (row.status === "queued" && mine) {
    // Borrado de verdad: no queda el texto (si alguien lo había reportado, la copia está en el reporte)
    const [cancelled] = await db.update(groupMessage).set({ status: "cancelled", body: "", photoKey: null })
      .where(and(eq(groupMessage.id, row.id), eq(groupMessage.status, "queued")))
      .returning({ id: groupMessage.id });
    if (!cancelled) {
      const [current] = await db.select({ status: groupMessage.status }).from(groupMessage).where(eq(groupMessage.id, row.id));
      if (current?.status === "published") throw new HTTPException(409, { message: "El mensaje ya se publicó." });
      return c.json({ ok: true });
    }
    if (row.photoKey) await deleteImageUnlessEvidence(row.photoKey);
    await dropPolls([row.id]);
    emitToUser(u.id, "group:cancelled", { id: row.id, groupId: row.groupId });
  } else if (row.status === "published") {
    await db.update(groupMessage).set({ status: "deleted", body: "", photoKey: null }).where(eq(groupMessage.id, row.id));
    if (row.photoKey) await deleteImageUnlessEvidence(row.photoKey);
    await db.delete(schema.reaction).where(eq(schema.reaction.messageId, row.id));
    await dropPolls([row.id]);
    await emitToGroup(row.groupId, row.userId, "group:deleted", { id: row.id, groupId: row.groupId });
  }
  return c.json({ ok: true });
});

// ---------- Encuestas ----------

/**
 * Votar en una encuesta, cambiar el voto o sacarlo (option = null). Un voto por miembro.
 * Al grupo le llegan en vivo solo los totales: nunca quién votó qué.
 */
groupRoutes.put("/groups/:id/polls/:mid/vote", async (c) => {
  const u = c.get("user");
  const groupId = c.req.param("id");
  const messageId = c.req.param("mid");
  const { member } = await membership(groupId, u.id);
  if (!member) throw new HTTPException(403, { message: "No sos parte de este grupo" });
  const { option } = parse(z.object({ option: z.number().int().min(0).nullable() }), await c.req.json().catch(() => ({})));
  const [row] = await db.select({ userId: groupMessage.userId, options: groupPoll.options }).from(groupMessage)
    .innerJoin(groupPoll, eq(groupPoll.messageId, groupMessage.id))
    .where(and(eq(groupMessage.id, messageId), eq(groupMessage.groupId, groupId), eq(groupMessage.status, "published")));
  if (!row) throw new HTTPException(404, { message: "Esa encuesta ya no está" });
  // Quien tiene un bloqueo con quien la creó no la ve, así que tampoco puede votar
  if ((await blockedWith(u.id)).has(row.userId)) throw new HTTPException(404, { message: "Esa encuesta ya no está" });
  if (option !== null && option >= row.options.length) throw new HTTPException(400, { message: "Esa opción no existe" });
  await limit(u.id, "pollVote");

  const mine = and(eq(groupPollVote.messageId, messageId), eq(groupPollVote.userId, u.id));
  if (option === null) await db.delete(groupPollVote).where(mine);
  else {
    await db.insert(groupPollVote).values({ messageId, userId: u.id, option })
      .onConflictDoUpdate({ target: [groupPollVote.messageId, groupPollVote.userId], set: { option, createdAt: new Date() } });
  }
  const totals = await pollTotals(messageId);
  if (!totals) throw new HTTPException(404, { message: "Esa encuesta ya no está" });
  // A quienes ven la encuesta (sin bloqueo con quien la creó), como el mensaje
  await emitToGroup(groupId, row.userId, "group:poll", { groupId, messageId, ...totals });
  return c.json({ ...totals, myVote: option });
});
