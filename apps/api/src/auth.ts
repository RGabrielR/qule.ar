import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { verifySolution } from "./botCheck.js";
import { forgetUnlisted } from "./verification.js";
import { db, schema } from "./db/index.js";
import { env } from "./env.js";
import { resetMail, sendMail, verifyMail } from "./mail.js";
import { clustered, hit } from "./shared.js";

export const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export const auth = betterAuth({
  // La web y el API se sirven desde el mismo origen (en desarrollo, vía el proxy de Vite)
  baseURL: env.APP_URL,
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL],
  // IP real de quien usa la app, para el límite de intentos y la sesión. Sale de un encabezado que el proxy de
  // adelante pisa siempre (CLIENT_IP_HEADER, ver docs/DEPLOY.md). Por defecto Better Auth usaba X-Forwarded-For,
  // que puede mandar cualquiera: con eso el límite de intentos se salteaba.
  advanced: { ipAddress: { ipAddressHeaders: [env.CLIENT_IP_HEADER] } },
  // Límite de intentos (activo en producción). Better Auth trae 3 cada 10 s en login, unos 1000 por hora:
  // muy poco para frenar a quien prueba contraseñas.
  rateLimit: {
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 5 * 60, max: 10 },
      "/sign-up/email": { window: 60 * 60, max: 5 },
      "/request-password-reset": { window: 60 * 60, max: 3 },
      "/reset-password": { window: 60 * 60, max: 10 },
      "/send-verification-email": { window: 60 * 60, max: 5 },
    },
    // Con varios procesos del API, los intentos se cuentan en todos juntos (ver shared.ts). Si no, cada proceso
    // llevaría su propia cuenta y alcanzaría con repartir los intentos para multiplicar el límite.
    ...(clustered
      ? { customStorage: { consume: async (key: string, rule: { window: number; max: number }) => {
          const allowed = await hit(`auth:${key}`, rule.max, rule.window * 1000);
          return { allowed, retryAfter: allowed ? null : rule.window };
        } } }
      : {}),
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    resetPasswordTokenExpiresIn: 60 * 60,
    // Al cambiar la contraseña se cierran las demás sesiones abiertas
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      // Tope por dirección y general en mail.ts. Better Auth responde lo mismo exista o no la cuenta.
      void sendMail(resetMail(user.email, url), "reset");
    },
  },
  // Al crear una cuenta con mail se manda un link para confirmarlo. Se puede entrar y armar el perfil igual, pero
  // hasta confirmarlo no se aparece en Gente (ver routes/nearby.ts). Las cuentas de Google ya vienen verificadas.
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 24 * 60 * 60,
    // Al confirmar, que aparezca en Gente sin esperar a que venza la lista en memoria (ver verification.ts)
    afterEmailVerification: async () => forgetUnlisted(),
    sendVerificationEmail: async ({ user, url }) => {
      // Tope por dirección y general en mail.ts
      void sendMail(verifyMail(user.email, url), "verify");
    },
  },
  hooks: {
    // Chequeo anti-bots antes de crear una cuenta con mail (ver botCheck.ts)
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email" || env.SIGNUP_POW_BITS <= 0) return;
      // Campo trampa: invisible para las personas, los bots que completan todo lo llenan
      if (ctx.headers?.get("x-qule-trampa")) throw new APIError("BAD_REQUEST", { code: "BOT_CHECK", message: "No se pudo crear la cuenta." });
      const result = await verifySolution(ctx.headers?.get("x-qule-desafio"));
      if (result !== "ok") {
        throw new APIError("BAD_REQUEST", {
          code: result === "expired" || result === "used" ? "BOT_CHECK_EXPIRED" : "BOT_CHECK",
          message: "No pudimos confirmar que sos una persona. Probá de nuevo.",
        });
      }
    }),
  },
  socialProviders: googleEnabled
    ? { google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! } }
    : {},
});

export type AuthUser = typeof auth.$Infer.Session.user;
