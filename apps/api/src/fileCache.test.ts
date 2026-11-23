import assert from "node:assert/strict";
import { test } from "node:test";
import { forgetFile, isKnownPublic, rememberPublic, sessionCookie } from "./fileCache.js";

test("encuentra la cookie de sesión, con o sin prefijo seguro", () => {
  assert.equal(sessionCookie("a=1; better-auth.session_token=abc.def; b=2"), "abc.def");
  assert.equal(sessionCookie("__Secure-better-auth.session_token=xyz"), "xyz");
  assert.equal(sessionCookie("otra=1"), null);
  assert.equal(sessionCookie(undefined), null);
});

test("las fotos públicas se recuerdan un minuto y se olvidan al dejar de serlo", () => {
  const t0 = 1_000_000;
  assert.equal(isKnownPublic("k1", t0), false);
  rememberPublic("k1", t0);
  assert.equal(isKnownPublic("k1", t0 + 59_000), true);
  assert.equal(isKnownPublic("k1", t0 + 61_000), false, "pasado el minuto se vuelve a chequear");
  rememberPublic("k2", t0);
  forgetFile("k2"); // con un solo proceso, el aviso llega al toque
  assert.equal(isKnownPublic("k2", t0 + 1), false, "al borrarla o pasarla a privada se olvida");
});
