import { createHash } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db, schema } from "./db/index.js";
import { env } from "./env.js";
import { APP_NAME, APP_SLOGAN, fonts, mail as c, radii } from "./brand.js";

// Mails por SMTP: sirve cualquier proveedor (Amazon SES, Resend, Brevo…).
// Sin SMTP_URL no se manda nada; en desarrollo el mail se muestra en la consola para poder probar.
//
// La app manda muy pocos mails, y solo cuando hacen falta: recuperar la contraseña y avisos sobre tu cuenta
// (suspensión y respuesta a un pedido de revisión). Nada de bienvenida, publicidad ni novedades.
export const mailEnabled = Boolean(env.SMTP_URL);
const transport = env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : null;
const dev = process.env.NODE_ENV !== "production";

/** reset: recuperar la contraseña (lo puede pedir cualquiera, tiene tope por dirección). account: avisos de moderación. */
export type MailKind = "reset" | "account";
type Mail = { to: string; subject: string; text: string; html: string };

/** Recuperar la contraseña, por dirección: 3 por día y uno por minuto. Alcanza para quien lo pide dos veces. */
export const RESET_PER_ADDRESS_DAY = 3;
export const RESET_MIN_GAP_MS = 60_000;
const DAY_MS = 86_400_000;

const { mailLog } = schema;
const hashTo = (to: string) => createHash("sha256").update(to.trim().toLowerCase()).digest("hex");
let lastPurge = 0;

/**
 * ¿Se puede mandar? Cuenta en la base (no en memoria): así vale igual para los varios procesos del API y
 * aunque se reinicie. Si se pasa el tope general del día, no sale ningún mail más hasta que baje: un ataque
 * nunca se convierte en una factura grande.
 */
/** Número fijo para el candado de la base que ordena los mails (pg_advisory_xact_lock). */
const MAIL_LOCK = 73_110_901;

export async function allowMail(to: string, kind: MailKind, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - DAY_MS);
  const toHash = hashTo(to);
  // Contar y anotar con un candado de la base: así, con varios procesos a la vez, el tope no se pasa.
  const ok = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${MAIL_LOCK})`);
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(mailLog).where(gt(mailLog.createdAt, since));
    if (total >= env.MAIL_DAILY_CAP) {
      console.warn(`Tope diario de mails alcanzado (${env.MAIL_DAILY_CAP}): no se manda`);
      return false;
    }
    if (kind === "reset") {
      const mine = await tx.select({ at: mailLog.createdAt }).from(mailLog)
        .where(and(eq(mailLog.toHash, toHash), eq(mailLog.kind, "reset"), gt(mailLog.createdAt, since)));
      if (mine.length >= RESET_PER_ADDRESS_DAY) return false;
      if (mine.some((m) => Math.abs(now.getTime() - m.at.getTime()) < RESET_MIN_GAP_MS)) return false;
    }
    await tx.insert(mailLog).values({ id: crypto.randomUUID(), toHash, kind, createdAt: now });
    return true;
  });
  if (ok && now.getTime() - lastPurge > 3_600_000) {
    lastPurge = now.getTime();
    await db.delete(mailLog).where(lt(mailLog.createdAt, new Date(now.getTime() - 2 * DAY_MS)));
  }
  return ok;
}

export async function sendMail(mail: Mail, kind: MailKind) {
  try {
    if (!(await allowMail(mail.to, kind))) return;
  } catch (err) {
    console.error("No se pudo revisar el tope de mails:", err);
    return;
  }
  if (!transport) {
    if (dev) console.log(`\n✉️  Mail para ${mail.to}: ${mail.subject}\n${mail.text}\n`);
    else console.warn("Mail sin enviar: falta SMTP_URL");
    return;
  }
  try {
    await transport.sendMail({ from: env.MAIL_FROM, ...mail });
  } catch (err) {
    // Que un mail falle no tiene que romper el registro ni el login
    console.error("No se pudo mandar el mail:", err);
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * Plantilla de los mails. Armada con tablas y estilos en línea, que es lo único que respetan todos los
 * clientes (Gmail, Outlook, Apple Mail). Los colores salen de la marca (packages/brand).
 *
 * El logo se carga desde la web (APP_URL/icon-192.png): Gmail y Apple Mail lo muestran solos. Si el cliente
 * bloquea imágenes, queda el nombre escrito al lado, así que el mail se entiende igual.
 */
const FONT = `${fonts.text.family},system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

type Layout = {
  title: string;
  /** Texto corto que se ve en la bandeja de entrada al lado del asunto. */
  preview: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  /** Por qué le llega este mail. */
  reason: string;
};

export function layout({ title, preview, paragraphs, button, reason }: Layout) {
  const site = env.APP_URL.replace(/\/$/, "");
  const logo = `${site}/icon-192.png`;
  const p = paragraphs
    .map((t) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:${c.text}">${esc(t)}</p>`)
    .join("");
  const b = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 22px"><tr>
<td align="center" bgcolor="${c.accent}" style="border-radius:${radii.pill}">
<a href="${esc(button.url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:700;color:${c.accentInk};text-decoration:none;border-radius:${radii.pill}">${esc(button.label)}</a>
</td></tr></table>
<p style="margin:0;font-size:13px;line-height:1.5;color:${c.muted}">Si el botón no anda, copiá este link en el navegador:<br>
<a href="${esc(button.url)}" target="_blank" style="color:${c.link};word-break:break-all">${esc(button.url)}</a></p>`
    : "";
  // Relleno invisible después de la vista previa, para que la bandeja no muestre el resto del texto del mail
  const spacer = "&#x34F;&zwnj;&nbsp;".repeat(30);
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${c.bg};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preview)}${spacer}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.bg}" style="background:${c.bg}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;font-family:${FONT}">
<tr><td style="padding:0 4px 18px">
<a href="${esc(site)}" target="_blank" style="text-decoration:none"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding-right:12px"><img src="${esc(logo)}" width="44" height="44" alt="" style="display:block;border:0;border-radius:12px"></td>
<td style="font-family:${FONT};font-size:24px;font-weight:800;letter-spacing:-0.03em;color:${c.title}">${esc(APP_NAME)}</td>
</tr></table></a></td></tr>
<tr><td bgcolor="${c.card}" style="background:${c.card};border-radius:20px;padding:32px 28px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:800;color:${c.title}">${esc(title)}</h1>
${p}${b}
</td></tr>
<tr><td style="padding:20px 8px 0;font-size:12px;line-height:1.6;color:${c.muted}">
${esc(reason)}<br>
${esc(APP_SLOGAN)} App comunitaria, gratuita y de código abierto. <a href="${esc(site)}" target="_blank" style="color:${c.muted}">${esc(site.replace(/^https?:\/\//, ""))}</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

const ACCOUNT_REASON = `Te llega porque es un aviso importante sobre tu cuenta de ${APP_NAME}.`;

export function resetMail(to: string, url: string): Mail {
  return {
    to,
    subject: "Cambiá tu contraseña",
    text: `Pediste cambiar tu contraseña de ${APP_NAME}. Entrá a este link para elegir una nueva (vence en 1 hora):\n\n${url}\n\nSi no fuiste vos, ignorá este mail: tu contraseña sigue igual.`,
    html: layout({
      title: "Cambiá tu contraseña",
      preview: "Elegí una contraseña nueva. El link vence en 1 hora.",
      paragraphs: [
        "Pediste cambiar tu contraseña. Tocá el botón para elegir una nueva. El link vence en 1 hora.",
        "Si no fuiste vos, ignorá este mail: tu contraseña sigue igual.",
      ],
      button: { label: "Elegir contraseña nueva", url },
      reason: "Te llega porque alguien pidió cambiar la contraseña de esta dirección.",
    }),
  };
}

/**
 * Aviso de suspensión. Discreto: no dice el motivo ni nada del perfil (el mail lo ve el proveedor); el motivo
 * se lee en la app, donde también se pide la revisión.
 */
export function suspendedMail(to: string): Mail {
  return {
    to,
    subject: `Tu cuenta de ${APP_NAME} está suspendida`,
    text: `Tu cuenta de ${APP_NAME} fue suspendida. Entrá con tu cuenta para ver el motivo.\n\nSi creés que es un error, desde ahí mismo podés pedir que la revisemos. Es privado.\n\n${env.APP_URL}`,
    html: layout({
      title: "Tu cuenta está suspendida",
      preview: "Entrá con tu cuenta para ver el motivo.",
      paragraphs: [
        "Entrá con tu cuenta para ver el motivo.",
        "Si creés que es un error, desde ahí mismo podés pedir que la revisemos. Es privado.",
      ],
      button: { label: `Entrar a ${APP_NAME}`, url: env.APP_URL },
      reason: ACCOUNT_REASON,
    }),
  };
}

/**
 * Ya se revisó el pedido. Si se levantó la suspensión, lo dice (la cuenta ya anda y la pantalla de suspensión
 * no se ve más). Si se mantuvo, no dice nada más: la respuesta se lee en la app.
 */
export function appealReviewedMail(to: string, lifted: boolean): Mail {
  if (lifted) {
    return {
      to,
      subject: `Tu cuenta de ${APP_NAME} vuelve a funcionar`,
      text: `Revisamos tu pedido y levantamos la suspensión. Ya podés entrar como siempre. Perdón por las molestias.\n\n${env.APP_URL}`,
      html: layout({
        title: "Tu cuenta vuelve a funcionar",
        preview: "Levantamos la suspensión: ya podés entrar como siempre.",
        paragraphs: ["Revisamos tu pedido y levantamos la suspensión. Ya podés entrar como siempre. Perdón por las molestias."],
        button: { label: `Entrar a ${APP_NAME}`, url: env.APP_URL },
        reason: ACCOUNT_REASON,
      }),
    };
  }
  return {
    to,
    subject: "Revisamos tu pedido",
    text: `Ya revisamos tu pedido de revisión en ${APP_NAME}. Entrá con tu cuenta para leer la respuesta.\n\n${env.APP_URL}`,
    html: layout({
      title: "Revisamos tu pedido",
      preview: "Entrá con tu cuenta para leer la respuesta.",
      paragraphs: ["Entrá con tu cuenta para leer la respuesta."],
      button: { label: `Entrar a ${APP_NAME}`, url: env.APP_URL },
      reason: ACCOUNT_REASON,
    }),
  };
}
