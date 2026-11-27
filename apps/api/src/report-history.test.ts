import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import type { AppEnv } from "./lib.js";

test("el historial pagina por tema y reserva los reportes enviados para administración general", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "qule-historial-"));
  const origin = "http://localhost:3001";
  Object.assign(process.env, {
    DATA_DIR: dataDir, DATABASE_URL: "", NODE_ENV: "test", APP_URL: origin,
    ADMIN_USER_IDS: "", ADMIN_EMAILS: "", SMTP_URL: "", SIGNUP_POW_BITS: "0",
    BETTER_AUTH_SECRET: "clave-local-de-pruebas-de-historial-qule",
  });
  const { db, closeDb, runMigrations, schema } = await import("./db/index.js");
  t.after(async () => {
    try { await closeDb(); } finally { await rm(dataDir, { recursive: true, force: true }); }
  });
  t.mock.method(console, "log", () => {});
  await runMigrations();
  const { env } = await import("./env.js");
  const { auth } = await import("./auth.js");
  const { adminRoutes } = await import("./routes/admin.js");
  const app = new Hono<AppEnv>();
  app.post("/api/auth/*", (c) => auth.handler(c.req.raw));
  app.route("/api", adminRoutes);

  async function account(name: string) {
    const response = await app.request(origin + "/api/auth/sign-up/email", {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ name, email: `${name}@example.test`, password: "contraseña local de pruebas" }),
    });
    assert.equal(response.status, 200);
    const { user } = await response.json() as { user: { id: string } };
    const cookie = response.headers.getSetCookie().map((line) => line.split(";", 1)[0]).join("; ");
    return { id: user.id, cookie };
  }

  const owner = await account("owner");
  const moderator = await account("moderador");
  const target = await account("persona");
  env.ADMIN_USER_IDS.push(owner.id);
  await db.insert(schema.staffPermission).values({ userId: moderator.id, permission: "reports" });
  const report = (id: string, reporterId: string, targetUserId: string) => ({
    id, reporterId, targetUserId, reason: "spam", details: "Comentario", createdAt: new Date("2026-01-01"),
  });
  await db.insert(schema.report).values([
    ...Array.from({ length: 22 }, (_, i) => ({
      ...report(`recibido-${String(i).padStart(2, "0")}`, moderator.id, target.id),
      status: i % 2 ? "open" : "dismissed",
    })),
    { ...report("enviado", target.id, moderator.id), targetName: "Otra cuenta" },
  ]);
  const history = (cookie: string, query: string) =>
    app.request(origin + "/api/admin/reports/recibido-21/history?" + query, { headers: { origin, cookie } });
  const received = await history(moderator.cookie, "direction=received");
  assert.equal(received.status, 200);
  assert.equal(received.headers.get("cache-control"), "no-store");
  const first = await received.json() as { items: Record<string, string>[]; next: string };
  assert.equal(first.items.length, 20);
  assert.deepEqual([...new Set(first.items.map((item) => item.status))], ["open", "dismissed"]);
  assert.ok(first.items.every((item) => !("reporterId" in item) && item.targetName === null));
  const next = await history(moderator.cookie, "direction=received&before=" + first.next);
  assert.equal(next.status, 200);
  const second = await next.json() as { items: { id: string }[]; next: string | null };
  assert.deepEqual(second.items.map((item) => item.id), ["recibido-01", "recibido-00"]);
  assert.equal(second.next, null);
  assert.equal((await history(moderator.cookie, "direction=sent")).status, 403);
  assert.equal((await history(target.cookie, "direction=received")).status, 403);
  const sent = await history(owner.cookie, "direction=sent");
  assert.equal(sent.status, 200);
  assert.deepEqual((await sent.json() as { items: { id: string; targetName: string }[] }).items
    .map(({ id, targetName }) => [id, targetName]), [["enviado", "Otra cuenta"]]);
});
