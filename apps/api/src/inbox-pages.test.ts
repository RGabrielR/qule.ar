import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

/**
 * Chats viejos: la bandeja viene de a INBOX_LIMIT y se puede seguir con `before`/`beforeId`, sin repetir ni saltear
 * chats (aunque varios tengan la misma fecha); los bloqueos y los chats vacíos no cuentan para llenar la página.
 * En un chat, los mensajes anteriores se piden con `before`/`beforeId` y tampoco se pierden empates.
 */
test("chats y mensajes viejos se cargan por páginas", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "qule-bandeja-"));
  process.env.DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_URL;
  const { db, schema, runMigrations, closeDb } = await import("./db/index.js");
  t.after(async () => { await closeDb(); await rm(dir, { recursive: true, force: true }); });
  await runMigrations();
  const { INBOX_LIMIT } = await import("@mortero/shared/realtime");
  const { auth } = await import("./auth.js");
  const { socialRoutes } = await import("./routes/social.js");
  const credentials = { email: "ana@example.test", password: "clave-para-pruebas" };
  const { user } = await auth.api.signUpEmail({ body: { ...credentials, name: "Ana" } });
  const login = await auth.api.signInEmail({ body: credentials, asResponse: true });
  const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const me = user.id;
  await db.insert(schema.profile).values({ userId: me, displayName: "Ana", birthdate: "1990-01-01" });

  // 130 chats con mensajes. Los de a pares comparten fecha, para probar el desempate por id.
  const total = 130;
  const base = Date.UTC(2026, 0, 1);
  const people = Array.from({ length: total + 2 }, (_, i) => `p${String(i).padStart(3, "0")}`);
  await db.insert(schema.user).values(people.map((id) => ({ id, email: `${id}@example.test`, name: id })));
  await db.insert(schema.profile).values(people.map((id) => ({ userId: id, displayName: id, birthdate: "1990-01-01" })));
  const pair = (other: string) => (me < other ? { userA: me, userB: other } : { userA: other, userB: me });
  const chats = people.slice(0, total).map((other, i) => ({
    id: `c${String(i).padStart(3, "0")}`, ...pair(other), lastMessageAt: new Date(base + Math.floor(i / 2) * 60_000),
  }));
  // Uno bloqueado y uno vacío (abierto, sin mensajes): no se muestran
  const blocked = { id: "bloqueado", ...pair(people[total]), lastMessageAt: new Date(base + 999 * 60_000) };
  const empty = { id: "vacio", ...pair(people[total + 1]), lastMessageAt: new Date(base + 998 * 60_000) };
  await db.insert(schema.conversation).values([...chats, blocked, empty]);
  await db.insert(schema.directMessage).values([...chats, blocked].map((c) => ({
    id: `m-${c.id}`, conversationId: c.id, senderId: c.userA === me ? c.userB : c.userA, body: "hola", createdAt: c.lastMessageAt,
  })));
  await db.insert(schema.block).values({ blockerId: me, blockedId: people[total] });

  type Summary = { id: string; lastMessageAt: string };
  const inbox = async (query = "") => {
    const res = await socialRoutes.request(`/conversations${query}`, { headers: { cookie } });
    assert.equal(res.status, 200);
    return await res.json() as Summary[];
  };
  const first = await inbox();
  assert.equal(first.length, INBOX_LIMIT, "la primera página viene completa aunque haya un bloqueo y un chat vacío");
  assert.ok(!first.some((c) => c.id === blocked.id || c.id === empty.id));
  const last = first.at(-1)!;
  const second = await inbox(`?${new URLSearchParams({ before: last.lastMessageAt, beforeId: last.id })}`);
  assert.equal(second.length, total - INBOX_LIMIT, "la segunda trae el resto");
  const seen = [...first, ...second].map((c) => c.id);
  assert.equal(new Set(seen).size, total, "sin repetidos");
  assert.deepEqual([...seen].sort(), chats.map((c) => c.id).sort(), "sin salteados");
  const end = second.at(-1)!;
  assert.deepEqual(await inbox(`?${new URLSearchParams({ before: end.lastMessageAt, beforeId: end.id })}`), []);
  const bad = await socialRoutes.request("/conversations?before=ayer&beforeId=x", { headers: { cookie } });
  assert.equal(bad.status, 400);

  // Mensajes de un chat: 70, de a pares con la misma hora
  const chat = chats[0];
  const other = chat.userA === me ? chat.userB : chat.userA;
  await db.insert(schema.directMessage).values(Array.from({ length: 70 }, (_, i) => ({
    id: `dm-${String(i).padStart(3, "0")}`, conversationId: chat.id, senderId: i % 2 ? me : other, body: `mensaje ${i}`,
    createdAt: new Date(base - (70 - Math.floor(i / 2)) * 60_000),
  })));
  type Page = { messages: { id: string; createdAt: string }[]; hasMore: boolean };
  const messages = async (query = "") => {
    const res = await socialRoutes.request(`/conversations/${chat.id}/messages${query}`, { headers: { cookie } });
    assert.equal(res.status, 200);
    return await res.json() as Page;
  };
  const recent = await messages();
  assert.equal(recent.messages.length, 50);
  assert.ok(recent.hasMore);
  const oldest = recent.messages[0];
  const older = await messages(`?${new URLSearchParams({ before: oldest.createdAt, beforeId: oldest.id })}`);
  assert.equal(older.hasMore, false);
  const all = [...older.messages, ...recent.messages].map((m) => m.id);
  assert.equal(new Set(all).size, 71, "los 70 más el primero, sin repetidos ni salteados");
});
