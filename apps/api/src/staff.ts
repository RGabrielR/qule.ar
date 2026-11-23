// Quién puede hacer qué en el panel de moderación.
//
// - Administración general: las cuentas de ADMIN_USER_IDS (o ADMIN_EMAILS, solo con el mail verificado), en la
//   configuración del servidor. Pueden todo: además de lo de abajo, dar de baja grupos, ver el registro y
//   dar y sacar permisos.
// - Permisos chicos, que la administración general da desde el panel, de a uno:
//   · reports: revisar reportes, descartarlos y borrar el mensaje reportado.
//   · sanctions: suspender y reactivar cuentas.
//   · appeals: revisar pedidos de revisión de suspensiones (mantener o levantar la medida).
// Nadie con permisos chicos ve mails, IPs ni datos de salud, ni puede tocar grupos o permisos.
import { eq, inArray, sql } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { db, schema } from "./db/index.js";
import { env } from "./env.js";
import type { AppEnv } from "./lib.js";
import { pushTo } from "./push.js";

export const STAFF_PERMISSIONS = ["reports", "sanctions", "appeals"] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];
export type Access = StaffPermission | "owner";

const { staffPermission, user, modAction } = schema;

type U = { id: string; email: string; emailVerified: boolean };

/** Administración general (desde la configuración del servidor, no desde la base). */
export const isOwner = (u: U) =>
  env.ADMIN_USER_IDS.includes(u.id) || (u.emailVerified && env.ADMIN_EMAILS.includes(u.email.toLowerCase()));

/** Todo lo que puede esta cuenta. Vacío: no entra al panel. */
export async function accessFor(u: U): Promise<Access[]> {
  if (isOwner(u)) return ["owner", ...STAFF_PERMISSIONS];
  const rows = await db.select({ p: staffPermission.permission }).from(staffPermission).where(eq(staffPermission.userId, u.id));
  return STAFF_PERMISSIONS.filter((p) => rows.some((r) => r.p === p));
}

export const can = async (u: U, a: Access) => (await accessFor(u)).includes(a);

/** Las cuentas con administración general (las de la configuración del servidor, con el mail verificado). */
export async function ownerIds(): Promise<string[]> {
  const ids = new Set(env.ADMIN_USER_IDS);
  if (env.ADMIN_EMAILS.length) {
    const rows = await db.select({ id: user.id, verified: user.emailVerified }).from(user)
      .where(inArray(sql`lower(${user.email})`, env.ADMIN_EMAILS));
    for (const r of rows) if (r.verified) ids.add(r.id);
  }
  return [...ids];
}

/** Quiénes tienen un permiso (incluye la administración general). Para avisar de reportes urgentes. */
export async function staffIdsWith(p: StaffPermission): Promise<string[]> {
  const ids = new Set(await ownerIds());
  const granted = await db.select({ id: staffPermission.userId }).from(staffPermission).where(eq(staffPermission.permission, p));
  for (const g of granted) ids.add(g.id);
  return [...ids];
}

/** Exige alguno de estos permisos (se aplica en el servidor, no solo escondiendo botones). */
export const requireAccess = (...need: Access[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const have = await accessFor(c.get("user"));
    if (!need.some((a) => have.includes(a))) throw new HTTPException(403, { message: "No tenés permiso para esto" });
    await next();
  });

/** Deja constancia de una acción de moderación. */
export async function logAction(actorId: string, action: string, targetId: string | null, details?: string | null) {
  await db.insert(modAction).values({ id: crypto.randomUUID(), actorId, action, targetId, details: details ?? null });
}

export async function grant(userId: string, perms: StaffPermission[], by: string) {
  await db.delete(staffPermission).where(eq(staffPermission.userId, userId));
  if (perms.length) await db.insert(staffPermission).values(perms.map((p) => ({ userId, permission: p, grantedBy: by })));
}


/**
 * Aviso discreto (push) a quienes tienen un permiso. No dice quién ni por qué.
 * Cada persona del equipo lo puede apagar (aviso "moderacion"); lo pendiente se sigue viendo en el panel.
 * ownersAlways: a la administración general le llega igual aunque lo haya apagado (menores de edad).
 */
export async function notifyStaff(
  p: StaffPermission,
  msg: { title: string; body: string; url: string; tag: string },
  { ownersAlways = false }: { ownersAlways?: boolean } = {},
) {
  const owners = ownersAlways ? new Set(await ownerIds()) : new Set<string>();
  for (const id of await staffIdsWith(p)) {
    pushTo(id, owners.has(id) ? msg : { ...msg, kind: "moderacion" }).catch(() => {});
  }
}
