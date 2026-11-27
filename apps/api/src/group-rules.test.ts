import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

test("los ajustes antispam del grupo dicen qué número está fuera de rango", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "qule-reglas-"));
  process.env.DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_URL;
  const { db, schema, runMigrations, closeDb } = await import("./db/index.js");
  t.after(async () => { await closeDb(); await rm(dir, { recursive: true, force: true }); });
  await runMigrations();
  const { auth } = await import("./auth.js");
  const { groupRoutes } = await import("./routes/groups.js");
  const app = new Hono().route("/", groupRoutes);

  const credentials = { email: "duena@example.com", password: "clave-para-pruebas" };
  const { user } = await auth.api.signUpEmail({ body: { ...credentials, name: "Dueña" } });
  await db.insert(schema.profile).values({ userId: user.id, displayName: "Dueña", birthdate: "1990-01-01" });
  const login = await auth.api.signInEmail({ body: credentials, asResponse: true });
  const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  await db.insert(schema.group).values({ id: "grupo", name: "Grupo" });
  await db.insert(schema.groupMember).values({ groupId: "grupo", userId: user.id, role: "owner" });

  const rules = { intervalSeconds: 60, burst: 3, rotationWindow: 20, rotationMax: 10, newAccountHours: 24, maxQueued: 3 };
  const patch = (body: unknown) => app.request("/groups/grupo", {
    method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body),
  });

  const tooBig = await patch({ rules: { ...rules, burst: 60 } });
  assert.equal(tooBig.status, 400);
  assert.equal(await tooBig.text(), "Ráfaga: entre 1 y 10");

  const ok = await patch({ rules: { ...rules, intervalSeconds: 5, burst: 5 } });
  assert.equal(ok.status, 200);
  const [g] = await db.select().from(schema.group).where(eq(schema.group.id, "grupo"));
  assert.equal(g.spamRules.intervalSeconds, 5);
  assert.equal(g.spamRules.burst, 5);
});
