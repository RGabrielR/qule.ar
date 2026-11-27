import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("avisos de grupo: solo a quien tiene suscripción, no silenció y no tiene bloqueos", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "qule-avisos-grupo-"));
  process.env.DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_URL;
  const { db, schema, runMigrations, closeDb } = await import("./db/index.js");
  t.after(async () => { await closeDb(); await rm(dir, { recursive: true, force: true }); });
  await runMigrations();
  const { groupPushRecipients } = await import("./groupNotify.js");

  const names = ["autor", "suscripta", "sinSuscripcion", "silenciada", "respondida", "bloqueada", "bloqueadora", "deOtroGrupo"];
  await db.insert(schema.user).values(names.map((id) => ({ id, name: id, email: `${id}@example.com` })));
  await db.insert(schema.group).values([{ id: "g", name: "Grupo" }, { id: "otro", name: "Otro" }]);
  await db.insert(schema.groupMember).values(names.filter((id) => id !== "deOtroGrupo").map((userId) => ({
    groupId: "g", userId, role: "member", muted: userId === "silenciada" || userId === "respondida",
  })));
  await db.insert(schema.groupMember).values({ groupId: "otro", userId: "deOtroGrupo", role: "member" });
  await db.insert(schema.pushSubscription).values(names.filter((id) => id !== "sinSuscripcion").map((userId) => ({
    id: userId, userId, endpoint: `https://push.example/${userId}`, p256dh: "p", auth: "a",
  })));
  await db.insert(schema.block).values([
    { blockerId: "autor", blockedId: "bloqueada" },
    { blockerId: "bloqueadora", blockedId: "autor" },
  ]);

  const ids = async (repliedTo: string | null) =>
    (await groupPushRecipients({ groupId: "g", userId: "autor" }, repliedTo)).map((r) => r.userId).sort();

  assert.deepEqual(await ids(null), ["suscripta"]);
  // A quien le respondieron le llega aunque haya silenciado el grupo
  assert.deepEqual(await ids("respondida"), ["respondida", "suscripta"]);
  // Pero no si hay un bloqueo
  assert.deepEqual(await ids("bloqueada"), ["suscripta"]);
});
