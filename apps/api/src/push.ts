import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { generateVAPIDKeys, sendNotification, setVapidDetails } from "web-push";
import { db, schema } from "./db/index.js";
import { env } from "./env.js";

const { profile, pushSubscription } = schema;

/**
 * Tipos de aviso que cada persona puede apagar desde Yo → Configuración → Notificaciones.
 * "moderacion" (reportes urgentes y pedidos de revisión) solo se muestra a quien es del equipo.
 * La notificación de prueba no tiene tipo: llega siempre.
 */
export const NOTIFY_KINDS = ["mensajes", "toques", "respuestas", "grupos", "solicitudes", "moderacion"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

/** Si la persona quiere este tipo de aviso. Lo que no eligió cuenta como "sí". */
export async function wantsNotice(userId: string, kind: NotifyKind): Promise<boolean> {
  const [p] = await db.select({ prefs: profile.notifyPrefs }).from(profile).where(eq(profile.userId, userId));
  return p?.prefs?.[kind] !== false;
}

/**
 * Claves VAPID: en producción vienen por variables de entorno.
 * En desarrollo, si faltan, se generan una vez y se guardan en data/vapid.json.
 */
function loadKeys(): { publicKey: string; privateKey: string } {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  }
  if (process.env.NODE_ENV === "production") {
    console.warn("Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY: las notificaciones push quedan apagadas.");
    return { publicKey: "", privateKey: "" };
  }
  const file = path.join(env.DATA_DIR, "vapid.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const keys = generateVAPIDKeys();
  writeFileSync(file, JSON.stringify(keys));
  return keys;
}

const keys = loadKeys();
export const vapidPublicKey = keys.publicKey;
export const pushEnabled = Boolean(keys.publicKey && keys.privateKey);

if (pushEnabled) {
  const subject = env.APP_URL.startsWith("https://") ? env.APP_URL : "mailto:noreply@qule.invalid";
  setVapidDetails(subject, keys.publicKey, keys.privateKey);
}

// always: mostrarla aunque la persona tenga la app abierta en esa pantalla (para la notificación de prueba)
// kind: qué tipo de aviso es; si la persona lo apagó, no se manda. Sin kind se manda siempre.
export type PushPayload = { title: string; body: string; url: string; tag?: string; always?: boolean; kind?: NotifyKind };

/**
 * Manda una notificación a todos los dispositivos de alguien.
 * Los textos son discretos a propósito: aparecen en la pantalla bloqueada.
 */
export async function pushTo(userId: string, { kind, ...payload }: PushPayload): Promise<number> {
  if (!pushEnabled) return 0;
  if (kind && !(await wantsNotice(userId, kind))) return 0;
  const subs = await db.select().from(pushSubscription).where(eq(pushSubscription.userId, userId));
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 24 },
        );
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // La suscripción ya no existe (desinstalaron la app, revocaron el permiso, etc.)
        if (status === 404 || status === 410) {
          await db.delete(pushSubscription).where(eq(pushSubscription.id, s.id)).catch(() => {});
        }
      }
    }),
  );
  return sent;
}
