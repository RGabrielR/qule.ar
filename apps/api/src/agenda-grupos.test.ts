import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "./lib.js";

test("agenda de grupos", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "qule-agenda-grupos-"));
  const origin = "http://localhost:3001";
  process.env.DATABASE_URL = "";
  process.env.DATA_DIR = dataDir;
  process.env.NODE_ENV = "test";
  process.env.APP_URL = origin;
  process.env.SMTP_URL = "";
  process.env.BETTER_AUTH_SECRET = "clave-local-de-prueba-actividad-qule";
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
  const { groupRoutes } = await import("./routes/groups.js");
  const app = new Hono<AppEnv>();
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.route("/api", groupRoutes);

  function request(route: string, cookie?: string, method = "GET", json?: unknown) {
    const headers = new Headers({ origin });
    if (cookie) headers.set("cookie", cookie);
    if (json !== undefined) headers.set("content-type", "application/json");
    return app.request(new URL(`/api${route}`, origin), { method, headers, body: JSON.stringify(json) });
  }

  async function account(name: string) {
    const response = await request("/auth/sign-up/email", undefined, "POST", {
      name, email: `${name.toLowerCase()}@example.test`, password: "una frase sintética para esta prueba",
    });
    assert.equal(response.status, 200);
    const { user } = await response.json() as { user: { id: string } };
    const cookie = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    assert.ok(cookie);
    await db.insert(schema.profile).values({ userId: user.id, displayName: name, birthdate: "1990-01-01" });
    return { id: user.id, cookie };
  }

  const owner = await account("Ana");
  const member = await account("Luz");
  const other = await account("Sol");
  const created = await request("/groups", owner.cookie, "POST", { name: "Mesa de juegos" });
  assert.equal(created.status, 200);
  const { id: groupId } = await created.json() as { id: string };
  await db.insert(schema.groupMember).values({ groupId, userId: member.id });
  const eventsPath = `/groups/${groupId}/events`;
  const input = { title: "Partida del sábado", startsAt: new Date(Date.now() + 86_400_000).toISOString(), capacity: 1 };
  assert.equal((await request(eventsPath, other.cookie)).status, 403);
  assert.equal((await request(eventsPath, member.cookie, "POST", input)).status, 403);

  const publication = await request(eventsPath, owner.cookie, "POST", input);
  assert.equal(publication.status, 201);
  const { id } = await publication.json() as { id: string };
  const attendance = `${eventsPath}/${id}/attendance`;
  const responses = await Promise.all([owner, member].map((person) => request(attendance, person.cookie, "PUT")));
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const [winner] = [owner, member].filter((_, i) => responses[i].status === 200);
  assert.equal((await request(attendance, winner.cookie, "PUT")).status, 200);
  const list = await request(eventsPath, winner.cookie);
  const [event] = await list.json() as { attending: boolean; attendees: number }[];
  assert.equal(event.attending, true);
  assert.equal(event.attendees, 1);
  assert.equal((await request(attendance, winner.cookie, "DELETE")).status, 200);
  assert.equal((await request(attendance, member.cookie, "PUT")).status, 200);

  await db.delete(schema.groupMember).where(eq(schema.groupMember.userId, member.id));
  assert.equal((await db.select().from(schema.groupEventAttendance)).length, 0);
  assert.equal((await request(`${eventsPath}/${id}`, owner.cookie, "DELETE")).status, 200);
  assert.equal((await request(attendance, owner.cookie, "PUT")).status, 409);
});
