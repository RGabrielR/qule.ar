import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { nextSlot } from "../antispam.js";
import { db, schema } from "../db/index.js";
import { DEFAULT_SPAM_RULES } from "../db/schema.js";
import { ageFrom, authorsFor, blockedWith, newId, requireProfile, requireUser, thumbUrl, type AppEnv } from "../lib.js";
import { distanceLabel, visibleKm } from "../geo.js";
import { autoHiddenGroups, autoHiddenUsers, forbiddenGroupText, groupIsEvidence, reportMinorGroupAttempt } from "../moderation.js";
import { emitToGroup, emitToUser, isOnline, serializeGroupMessages, syncGroupRoom } from "../realtime.js";
import { pushTo } from "../push.js";
import { notifyGroupMessage } from "../groupNotify.js";
import { APP_NAME } from "../brand.js";

const { group, groupMember, groupMessage, groupJoinRequest, groupInvite } = schema;

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

async function memberCounts(ids: string[]) {
  const map = new Map<string, number>();
  if (!ids.length) return map;
  const rows = await db
    .select({ groupId: groupMember.groupId, n: sql<number>`count(*)::int` })
    .from(groupMember)
    .where(inArray(groupMember.groupId, ids))
    .groupBy(groupMember.groupId);
  for (const r of rows) map.set(r.groupId, r.n);
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
  const map = new Map<string, { pending: boolean; cooldownUntil: string | null }>();
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
    const cur = map.get(r.groupId) ?? { pending: false, cooldownUntil: null };
    if (r.status === "pending") cur.pending = true;
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

const rulesInput = z.object({
  intervalSeconds: z.number().int().min(5).max(3600),
  burst: z.number().int().min(1).max(10),
  rotationWindow: z.number().int().min(5).max(100),
  rotationMax: z.number().int().min(1).max(50),
  newAccountHours: z.number().int().min(0).max(24 * 30),
  maxQueued: z.number().int().min(1).max(10),
});

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new HTTPException(400, { message: r.error.issues[0].message });
  return r.data;
}

// ---------- Nombres que no se permiten ----------

/**
 * Corta con 400 si el nombre o la descripción apunta a menores, venta, masajes o servicios sexuales, o drogas.
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
  await db.update(group).set({ removedAt: new Date(), removedReason: reason }).where(eq(group.id, groupId));
}

/** El dueño cierra el grupo: si es prueba de un reporte, se da de baja (no se pierde); si no, se borra. */
async function closeGroup(groupId: string, reason: string) {
  if (await groupIsEvidence(groupId)) return removeGroup(groupId, reason);
  await kickAll(groupId);
  await db.delete(group).where(eq(group.id, groupId));
}

// ---------- Listados ----------

/** Mis grupos (el general primero), con solicitudes pendientes si modero. */
groupRoutes.get("/groups", async (c) => {
  const u = c.get("user");
  const rows = await db
    .select({ id: group.id, name: group.name, description: group.description, isGeneral: group.isGeneral, role: groupMember.role })
    .from(groupMember)
    .innerJoin(group, eq(group.id, groupMember.groupId))
    .where(and(eq(groupMember.userId, u.id), isNull(group.removedAt)))
    .orderBy(desc(group.isGeneral), asc(group.name));
  const ids = rows.map((r) => r.id);
  const counts = await memberCounts(ids);
  const pending = await pendingCounts(rows.filter((r) => canModerate(r.role)).map((r) => r.id));
  return c.json(rows.map((r) => ({ ...r, memberCount: counts.get(r.id) ?? 0, pendingCount: pending.get(r.id) ?? 0 })));
});

/** Todos los grupos, para explorar y pedir ingreso. */
groupRoutes.get("/groups/all", async (c) => {
  const u = c.get("user");
  const q = (c.req.query("q") ?? "").trim().slice(0, 40);
  const conds = [eq(group.isGeneral, false), isNull(group.removedAt)];
  if (q) conds.push(or(ilike(group.name, `%${q}%`), ilike(group.description, `%${q}%`))!);
  const hiddenGroups = await autoHiddenGroups();
  const rows = (await db.select().from(group).where(and(...conds)).orderBy(desc(group.createdAt)).limit(200))
    .filter((g) => !hiddenGroups.has(g.id)); // ocultos por precaución: varios reportes urgentes sin revisar
  const ids = rows.map((r) => r.id);
  const counts = await memberCounts(ids);
  const mine = ids.length
    ? await db.select().from(groupMember).where(and(eq(groupMember.userId, u.id), inArray(groupMember.groupId, ids)))
    : [];
  const roles = new Map(mine.map((m) => [m.groupId, m.role]));
  const states = await requestStateFor(u.id, ids);
  const list = rows.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    memberCount: counts.get(g.id) ?? 0,
    role: roles.get(g.id) ?? null,
    pending: states.get(g.id)?.pending ?? false,
    cooldownUntil: states.get(g.id)?.cooldownUntil ?? null,
  }));
  // Los más concurridos primero
  list.sort((a, b) => b.memberCount - a.memberCount);
  return c.json(list);
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
    isGeneral: g.isGeneral,
    rules: g.spamRules,
    role: member?.role ?? null,
    memberCount: counts.get(g.id) ?? 0,
    pending: state?.pending ?? false,
    cooldownUntil: state?.cooldownUntil ?? null,
    pendingCount: pending,
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
    await joinGroup(g, u.id, null);
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
    pushTo(m, { title: APP_NAME, body: "Tenés una solicitud nueva en un grupo", url: `/grupos/${g.id}/info`, tag: `req-${g.id}` }).catch(() => {});
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

/** Solicitudes pendientes (dueño y moderadores). */
groupRoutes.get("/groups/:id/requests", async (c) => {
  const u = c.get("user");
  const { group: g } = await requireMod(c.req.param("id"), u.id);
  const rows = await db
    .select()
    .from(groupJoinRequest)
    .where(and(eq(groupJoinRequest.groupId, g.id), eq(groupJoinRequest.status, "pending")))
    .orderBy(asc(groupJoinRequest.createdAt));
  const authors = await authorsFor(rows.map((r) => r.userId));
  return c.json(rows.map((r) => ({
    id: r.id,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
    user: authors.get(r.userId) ?? { id: r.userId, name: "Cuenta borrada", age: 0, photo: null },
  })));
});

groupRoutes.post("/groups/:id/requests/:rid/:decision{accept|reject}", async (c) => {
  const u = c.get("user");
  const { group: g } = await requireMod(c.req.param("id"), u.id);
  const accept = c.req.param("decision") === "accept";
  const [req] = await db
    .update(groupJoinRequest)
    .set({ status: accept ? "accepted" : "rejected", resolvedBy: u.id, resolvedAt: new Date() })
    .where(and(
      eq(groupJoinRequest.id, c.req.param("rid")),
      eq(groupJoinRequest.groupId, g.id),
      eq(groupJoinRequest.status, "pending"),
    ))
    .returning();
  if (!req) throw new HTTPException(409, { message: "Esa solicitud ya fue resuelta" });
  if (accept) {
    await joinGroup(g, req.userId, u.id); // también cierra una invitación que tuviera pendiente
    emitToUser(req.userId, "group:accepted", { groupId: g.id, name: g.name });
    pushTo(req.userId, { title: APP_NAME, body: "Te aceptaron en un grupo", url: `/grupos/${g.id}`, tag: `acc-${g.id}` }).catch(() => {});
  } else {
    emitToUser(req.userId, "group:rejected", { groupId: g.id, name: g.name });
    await notifyMods(g.id, "group:request", { groupId: g.id });
  }
  return c.json({ ok: true });
});

// ---------- Invitaciones ----------
// Dueño y moderadores invitan; la persona invitada elige si entra. Nadie queda adentro sin aceptar.

/** Invitaciones pendientes que puede tener un grupo a la vez (frena las invitaciones masivas). */
const MAX_PENDING_INVITES = 50;

/** Suma a alguien al grupo y cierra lo que tenía pendiente (su solicitud o su invitación). */
async function joinGroup(g: typeof group.$inferSelect, userId: string, by: string | null) {
  const now = new Date();
  await db.insert(groupMember).values({ groupId: g.id, userId }).onConflictDoNothing();
  await db
    .update(groupJoinRequest)
    .set({ status: "accepted", resolvedBy: by, resolvedAt: now })
    .where(and(eq(groupJoinRequest.groupId, g.id), eq(groupJoinRequest.userId, userId), eq(groupJoinRequest.status, "pending")));
  await db
    .update(groupInvite)
    .set({ status: "accepted", resolvedAt: now })
    .where(and(eq(groupInvite.groupId, g.id), eq(groupInvite.userId, userId), eq(groupInvite.status, "pending")));
  syncGroupRoom(userId, g.id, true);
  await notifyMods(g.id, "group:request", { groupId: g.id });
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
    .select({ id: group.id, name: group.name })
    .from(groupMember)
    .innerJoin(group, eq(group.id, groupMember.groupId))
    .where(and(eq(groupMember.userId, u.id), inArray(groupMember.role, ["owner", "moderator"]), eq(group.isGeneral, false), isNull(group.removedAt)))
    .orderBy(asc(group.name));
  if (target === u.id || (await blockedWith(u.id)).has(target)) return c.json([]);
  const states = await inviteStateFor(target, rows.map((r) => r.id));
  return c.json(rows.map((r) => ({ ...r, state: states.get(r.id) ?? null })));
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
    await joinGroup(g, target, u.id);
    emitToUser(target, "group:accepted", { groupId: g.id, name: g.name });
    pushTo(target, { title: APP_NAME, body: "Te aceptaron en un grupo", url: `/grupos/${g.id}`, tag: `acc-${g.id}` }).catch(() => {});
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
  pushTo(target, { title: APP_NAME, body: "Te invitaron a un grupo", url: "/grupos", tag: `inv-${g.id}` }).catch(() => {});
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

  const conds = [sql`${schema.profile.userId} <> ${u.id}`, isNull(schema.profile.suspendedAt)];
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
      return { p, km, age: ageFrom(p.birthdate), online: !p.incognito && isOnline(p.userId) };
    })
    .filter(({ km, age, online }) =>
      (f.maxKm == null || (km != null && km <= f.maxKm)) &&
      (f.ageMin == null || age >= f.ageMin) &&
      (f.ageMax == null || age <= f.ageMax) &&
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
    .select({ id: groupInvite.id, invitedBy: groupInvite.invitedBy, createdAt: groupInvite.createdAt, groupId: group.id, name: group.name, description: group.description })
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
    group: { id: r.groupId, name: r.name, description: r.description, memberCount: counts.get(r.groupId) ?? 0 },
    invitedBy: (r.invitedBy && authors.get(r.invitedBy)) || null,
  })));
});

groupRoutes.post("/invites/:iid/:decision{accept|decline}", requireUser, requireProfile, async (c) => {
  const u = c.get("user");
  const accept = c.req.param("decision") === "accept";
  const [inv] = await db
    .select()
    .from(groupInvite)
    .where(and(eq(groupInvite.id, c.req.param("iid")), eq(groupInvite.userId, u.id), eq(groupInvite.status, "pending")));
  if (!inv) throw new HTTPException(409, { message: "Esa invitación ya no está disponible" });
  const [g] = await db.select().from(group).where(eq(group.id, inv.groupId));
  if (!g || g.removedAt) throw new HTTPException(404, { message: "Ese grupo ya no existe" });
  if (accept) {
    await joinGroup(g, u.id, inv.invitedBy);
  } else {
    await db.update(groupInvite).set({ status: "declined", resolvedAt: new Date() }).where(eq(groupInvite.id, inv.id));
    await notifyMods(g.id, "group:request", { groupId: g.id });
  }
  emitToUser(u.id, "group:invite", { groupId: g.id }); // para que se actualice el contador en sus otras pestañas
  if (accept) return c.json({ groupId: g.id });
  return c.json({ ok: true });
});

// ---------- Miembros ----------

groupRoutes.get("/groups/:id/members", async (c) => {
  const u = c.get("user");
  const { group: g, member } = await membership(c.req.param("id"), u.id);
  if (!member) throw new HTTPException(403, { message: "No sos parte de este grupo" });
  const rows = await db
    .select()
    .from(groupMember)
    .where(eq(groupMember.groupId, g.id))
    .orderBy(sql`case ${groupMember.role} when 'owner' then 0 when 'moderator' then 1 else 2 end`, asc(groupMember.joinedAt))
    .limit(500);
  const blocked = await blockedWith(u.id);
  const visible = rows.filter((r) => !blocked.has(r.userId));
  const authors = await authorsFor(visible.map((r) => r.userId));
  return c.json(visible.flatMap((r) => {
    const a = authors.get(r.userId);
    return a ? [{ ...a, role: r.role as Role, joinedAt: r.joinedAt.toISOString() }] : [];
  }));
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
  const blocked = [...(await blockedWith(u.id))];
  const conds = [eq(groupMessage.groupId, groupId), eq(groupMessage.status, "published")];
  if (before) conds.push(lt(groupMessage.scheduledAt, new Date(before)));
  if (blocked.length) conds.push(notInArray(groupMessage.userId, blocked));

  const published = await db
    .select()
    .from(groupMessage)
    .where(and(...conds))
    .orderBy(desc(groupMessage.scheduledAt))
    .limit(50);
  const queued = before
    ? []
    : await db
        .select()
        .from(groupMessage)
        .where(and(eq(groupMessage.groupId, groupId), eq(groupMessage.userId, u.id), eq(groupMessage.status, "queued")))
        .orderBy(asc(groupMessage.scheduledAt));

  return c.json({
    messages: await serializeGroupMessages(published.reverse()),
    queued: await serializeGroupMessages(queued),
    hasMore: published.length === 50,
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
  // Respuesta a otro mensaje: tiene que ser del mismo grupo y estar publicado
  let replyToId: string | null = null;
  if (typeof raw?.replyToId === "string" && raw.replyToId) {
    const [orig] = await db.select({ id: groupMessage.id }).from(groupMessage)
      .where(and(eq(groupMessage.id, raw.replyToId), eq(groupMessage.groupId, groupId), eq(groupMessage.status, "published")));
    if (!orig) throw new HTTPException(400, { message: "Ese mensaje ya no está" });
    replyToId = orig.id;
  }

  // Cuentas nuevas no pueden mandar links en grupos
  const isNew = Date.now() - new Date(u.createdAt).getTime() < g.spamRules.newAccountHours * 3_600_000;
  if (isNew && /(https?:\/\/|www\.|\.[a-z]{2,}\/)/i.test(body)) {
    throw new HTTPException(400, { message: `Las cuentas nuevas no pueden mandar links en grupos durante las primeras ${g.spamRules.newAccountHours} h` });
  }

  const slot = await nextSlot({ groupId, userId: u.id, userCreatedAt: new Date(u.createdAt), rules: g.spamRules });
  if (!slot.ok) throw new HTTPException(429, { message: slot.error });

  const now = new Date();
  const publishNow = slot.at.getTime() <= now.getTime();
  const [row] = await db
    .insert(groupMessage)
    .values({
      id: newId(),
      groupId,
      userId: u.id,
      body,
      replyToId,
      status: publishNow ? "published" : "queued",
      scheduledAt: publishNow ? now : slot.at,
    })
    .returning();
  const [msg] = await serializeGroupMessages([row]);
  if (publishNow) {
    await emitToGroup(groupId, u.id, "group:message", msg);
    notifyGroupMessage(row).catch((e) => console.error("notifyGroupMessage", e));
  }
  else emitToUser(u.id, "group:queued", msg);
  return c.json({ message: msg, reasons: slot.reasons, intervalSeconds: slot.intervalSeconds });
});

/** Editar un mensaje propio mientras está en cola. */
groupRoutes.patch("/groups/:id/messages/:mid", async (c) => {
  const u = c.get("user");
  const { body } = parse(bodySchema, await c.req.json());
  const [row] = await db
    .update(groupMessage)
    .set({ body })
    .where(and(
      eq(groupMessage.id, c.req.param("mid")),
      eq(groupMessage.userId, u.id),
      eq(groupMessage.status, "queued"),
    ))
    .returning();
  if (!row) throw new HTTPException(409, { message: "Ese mensaje ya salió" });
  const [msg] = await serializeGroupMessages([row]);
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
  if (row.status === "queued" && mine) {
    // Borrado de verdad: no queda el texto (si alguien lo había reportado, la copia está en el reporte)
    await db.update(groupMessage).set({ status: "cancelled", body: "" }).where(eq(groupMessage.id, row.id));
    emitToUser(u.id, "group:cancelled", { id: row.id, groupId: row.groupId });
  } else if (row.status === "published") {
    await db.update(groupMessage).set({ status: "deleted", body: "" }).where(eq(groupMessage.id, row.id));
    await db.delete(schema.reaction).where(eq(schema.reaction.messageId, row.id));
    await emitToGroup(row.groupId, row.userId, "group:deleted", { id: row.id, groupId: row.groupId });
  }
  return c.json({ ok: true });
});
