import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const env = {
  PORT: Number(process.env.PORT ?? 3001),
  // URL pública de la web (en desarrollo, Vite en el 5173 hace de proxy al API)
  APP_URL: process.env.APP_URL ?? "http://localhost:5173",
  DATABASE_URL: process.env.DATABASE_URL,
  DATA_DIR: process.env.DATA_DIR ?? path.join(root, "data"),
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "solo-para-desarrollo-cambiar-en-produccion",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
  // Mails (recuperar contraseña y avisos de moderación). Ej. con Amazon SES:
  // smtps://USUARIO_SMTP:CLAVE_SMTP@email-smtp.eu-west-1.amazonaws.com:465
  SMTP_URL: process.env.SMTP_URL,
  // Tope de mails en 24 horas, entre todos. Si se llega, no sale ninguno más hasta que baje (ver mail.ts).
  MAIL_DAILY_CAP: Number(process.env.MAIL_DAILY_CAP ?? 2000),
  MAIL_FROM: process.env.MAIL_FROM ?? "qule.ar <hola@qule.local>",
  // Emails con acceso al panel de moderación, separados por coma
  ADMIN_EMAILS: (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  // IDs de cuenta con acceso a moderación. Sirve para quien entra con mail y contraseña: hoy esos mails no se
  // verifican, así que ADMIN_EMAILS solo cuenta para cuentas con el mail verificado (por ejemplo, las de Google).
  ADMIN_USER_IDS: (process.env.ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  // Carpeta con la web compilada (en producción el API la sirve)
  WEB_DIST: process.env.WEB_DIST ?? path.join(root, "apps/web/dist"),
  // Clave que cifra los datos de salud en la base (32 bytes en base64). Obligatoria en producción; en desarrollo
  // se crea sola en DATA_DIR. Si se pierde, esos datos no se recuperan: guardala también fuera del servidor.
  DATA_KEY: process.env.DATA_KEY,
  // Encabezado del que sale la IP real de cada persona (límite de intentos y sesiones). Tiene que ser uno que el
  // proxy de adelante pise siempre: cf-connecting-ip con el túnel de Cloudflare, x-real-ip con el nginx de deploy/.
  CLIENT_IP_HEADER: (process.env.CLIENT_IP_HEADER ?? "cf-connecting-ip").toLowerCase(),
  // Dónde se guardan fotos y videos: "disk" (por defecto, en DATA_DIR/uploads) o "s3" (Cloudflare R2 u otro
  // compatible con S3). Con s3 hacen falta los cinco S3_*. Ver docs/DEPLOY.md, "Fotos en R2".
  STORAGE: process.env.STORAGE === "s3" ? "s3" : "disk",
  S3_ENDPOINT: process.env.S3_ENDPOINT, // R2: https://<cuenta>.r2.cloudflarestorage.com
  S3_BUCKET: process.env.S3_BUCKET,
  S3_REGION: process.env.S3_REGION ?? "auto", // R2 usa "auto"
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
};

if (process.env.NODE_ENV === "production" && !process.env.BETTER_AUTH_SECRET) {
  throw new Error("Falta BETTER_AUTH_SECRET");
}
