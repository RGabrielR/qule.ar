import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { handleOAuthUserInfo } from "better-auth/oauth2";

// Quien se registró con mail y contraseña y después entra con Google usando el mismo mail: Better Auth no une las
// cuentas hasta que el mail esté confirmado (accountLinking.requireLocalEmailVerified). Así nadie se queda con la
// cuenta de otra persona registrando antes su mail. La web explica qué hacer (pages/Login.tsx, account_not_linked).
test("Google se une a una cuenta con contraseña solo cuando el mail está confirmado", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "qule-google-"));
  const origin = "http://localhost:3001";
  Object.assign(process.env, {
    DATABASE_URL: "", DATA_DIR: dataDir, NODE_ENV: "test", APP_URL: origin, SMTP_URL: "",
    VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", BETTER_AUTH_SECRET: "clave-local-de-pruebas-de-google-qule",
    SIGNUP_POW_BITS: "0", GOOGLE_CLIENT_ID: "id-de-prueba", GOOGLE_CLIENT_SECRET: "secreto-de-prueba",
  });
  let close: (() => Promise<void>) | undefined;
  t.after(async () => {
    try {
      await close?.();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
  // Sin SMTP, el mail de confirmación sale por la consola
  t.mock.method(console, "log", () => {});
  const { db, closeDb, runMigrations, schema } = await import("./db/index.js");
  close = closeDb;
  await runMigrations();
  const { auth } = await import("./auth.js");

  const email = "ana@example.test";
  const signup = await auth.handler(new Request(new URL("/api/auth/sign-up/email", origin), {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ name: "Ana", email, password: "una frase sintética de prueba" }),
  }));
  assert.equal(signup.status, 200);
  const [ana] = await db.select().from(schema.user).where(eq(schema.user.email, email));
  assert.equal(ana.emailVerified, false);

  // Lo que hace el callback de Google con el perfil que devuelve Google (mail ya verificado por Google)
  const ctx = { context: await auth.$context } as unknown as Parameters<typeof handleOAuthUserInfo>[0];
  const fromGoogle = () => handleOAuthUserInfo(ctx, {
    userInfo: { id: "google-ana", email, name: "Ana G", emailVerified: true },
    account: { providerId: "google", accountId: "google-ana" },
    callbackURL: "/",
  });
  const googleAccounts = () => db.select().from(schema.account)
    .where(and(eq(schema.account.providerId, "google"), eq(schema.account.accountId, "google-ana")));

  // Mail sin confirmar: no se une ni se crea otra cuenta. El callback lo convierte en ?error=account_not_linked
  const rejected = await fromGoogle();
  assert.equal(rejected.error, "account not linked");
  assert.equal(rejected.data, null);
  assert.equal((await googleAccounts()).length, 0);
  assert.equal((await db.select().from(schema.user)).length, 1);

  // Con el mail confirmado (el link que llega al crear la cuenta o el de Yo), Google entra a la misma cuenta
  await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, ana.id));
  const linked = await fromGoogle();
  assert.equal(linked.error, null);
  assert.equal(linked.data?.user.id, ana.id);
  const [account] = await googleAccounts();
  assert.equal(account?.userId, ana.id);
  assert.equal((await db.select().from(schema.user)).length, 1);
});
