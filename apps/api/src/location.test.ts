import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import { snapToCell } from "./geo.js";
import type { AppEnv } from "./lib.js";

test("la celda enviada por el navegador se conserva al redondearla en el servidor", () => {
  for (const [lat, lng] of [[-34.6037, -58.3816], [19.4326, -99.1332], [90, 180], [-90, -180], [0, -179.999999]]) {
    const cell = snapToCell(lat, lng);
    assert.ok(cell.lat >= -90 && cell.lat <= 90 && cell.lng >= -180 && cell.lng <= 180);
    assert.deepEqual(snapToCell(cell.lat, cell.lng), cell);
  }
  assert.deepEqual(snapToCell(0, 180), snapToCell(0, -180));
});

test("borrar una zona impide que una ubicación automática vuelva a guardarla", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "qule-location-"));
  const origin = "http://localhost:3001";
  process.env.DATABASE_URL = "";
  process.env.DATA_DIR = dataDir;
  process.env.NODE_ENV = "test";
  process.env.APP_URL = origin;
  process.env.SMTP_URL = "";
  process.env.BETTER_AUTH_SECRET = "clave-local-de-pruebas-de-ubicacion";
  let close: (() => Promise<void>) | undefined;
  t.after(async () => {
    try {
      await close?.();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
  t.mock.method(console, "log", () => {});
  const { db, closeDb, runMigrations, schema } = await import("./db/index.js");
  close = closeDb;
  await runMigrations();
  const { auth } = await import("./auth.js");
  const { nearbyRoutes } = await import("./routes/nearby.js");
  const app = new Hono<AppEnv>();
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.route("/api", nearbyRoutes);
  const signup = await app.request(origin + "/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ name: "Ana", email: "ana@example.test", password: "una clave de prueba de ubicación" }),
  });
  assert.equal(signup.status, 200);
  const { user } = await signup.json() as { user: { id: string } };
  const cookie = signup.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  assert.ok(cookie);
  await db.insert(schema.profile).values({ userId: user.id, displayName: "Ana", birthdate: "1990-01-01" });

  const send = async (auto: boolean) => {
    const res = await app.request(origin + "/api/me/location", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie, origin },
      body: JSON.stringify({ lat: 19.4326, lng: -99.1332, auto }),
    });
    assert.equal(res.status, 200);
  };
  const nearby = async () => {
    const res = await app.request(origin + "/api/nearby", { headers: { cookie } });
    assert.equal(res.status, 200);
    return res.json() as Promise<{ hasLocation: boolean; locationUpdatedAt: string | null }>;
  };
  await send(false);
  const saved = await nearby();
  assert.equal(saved.hasLocation, true);
  assert.ok(saved.locationUpdatedAt);
  assert.equal("cellLat" in saved, false);
  const erased = await app.request(origin + "/api/me/location", { method: "DELETE", headers: { cookie, origin } });
  assert.equal(erased.status, 200);
  await send(true);
  const after = await nearby();
  assert.equal(after.hasLocation, false);
  assert.equal(after.locationUpdatedAt, null);
  await send(false);
  assert.equal((await nearby()).hasLocation, true);
});
