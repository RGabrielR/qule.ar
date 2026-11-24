import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

/**
 * Aceptar o rechazar solicitudes en lote (POST /groups/:id/requests/bulk): solo dueño y moderadores,
 * ignora lo que no es de este grupo o ya se resolvió, respeta el tope y los filtros de la lista.
 */
test("solicitudes en lote", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "qule-lote-"));
  process.env.DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_URL;
  const { db, schema, runMigrations, closeDb } = await import("./db/index.js");
  t.after(async () => { await closeDb(); await rm(dir, { recursive: true, force: true }); });
  await runMigrations();
  const { auth } = await import("./auth.js");
  const { groupRoutes } = await import("./routes/groups.js");
  const { BULK_MAX } = await import("./joinRequests.js");
  const app = new Hono().route("/", groupRoutes);
  app.onError((err, c) => c.text(err.message, err instanceof HTTPException ? err.status : 500));

  async function account(name: string) {
    const credentials = { email: `${name}@example.com`, password: "clave-para-pruebas" };
    const { user } = await auth.api.signUpEmail({ body: { ...credentials, name } });
    await db.insert(schema.profile).values({ userId: user.id, displayName: name, birthdate: "1990-01-01" });
    const login = await auth.api.signInEmail({ body: credentials, asResponse: true });
    const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    return {
      id: user.id,
      bulk: (groupId: string, body: unknown) =>
        app.request(`/groups/${groupId}/requests/bulk`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }),
    };
  }

  const owner = await account("duenio");
  const mod = await account("moderador");
  const member = await account("miembro");
  const G = "grupo";
  await db.insert(schema.group).values([{ id: G, name: "Grupo" }, { id: "otro", name: "Otro" }]);
  await db.insert(schema.groupMember).values([
    { groupId: G, userId: owner.id, role: "owner" },
    { groupId: G, userId: mod.id, role: "moderator" },
    { groupId: G, userId: member.id, role: "member" },
  ]);

  // 260 personas que piden entrar; las pares tienen foto pública
  const N = 260;
  const ids = Array.from({ length: N }, (_, i) => `p${String(i).padStart(3, "0")}`);
  await db.insert(schema.user).values(ids.map((id) => ({ id, name: id, email: `${id}@example.test` })));
  await db.insert(schema.profile).values(ids.map((id) => ({ userId: id, displayName: id, birthdate: "1990-01-01" })));
  await db.insert(schema.photo).values(ids.filter((_, i) => i % 2 === 0).map((id) => ({ id: `f-${id}`, userId: id, key: `${id}.webp` })));
  const base = Date.now();
  await db.insert(schema.groupJoinRequest).values(ids.map((id, i) => ({ id: `s-${id}`, groupId: G, userId: id, createdAt: new Date(base - i * 1000) })));
  // Ruido: una de otro grupo y una ya rechazada
  await db.insert(schema.groupJoinRequest).values([
    { id: "s-otro", groupId: "otro", userId: "p001" },
    { id: "s-vieja", groupId: G, userId: "p002", status: "rejected" },
  ]);
  // p004 también tenía una invitación pendiente: al aceptarla se cierra
  await db.insert(schema.groupInvite).values({ id: "inv-p004", groupId: G, userId: "p004", invitedBy: owner.id });

  const status = async (id: string) => (await db.select().from(schema.groupJoinRequest).where(eq(schema.groupJoinRequest.id, id)))[0]?.status;
  const members = async (userIds: string[]) =>
    (await db.select().from(schema.groupMember).where(and(eq(schema.groupMember.groupId, G), inArray(schema.groupMember.userId, userIds)))).length;

  await t.test("un miembro común no puede", async () => {
    assert.equal((await member.bulk(G, { action: "accept", ids: ["s-p000"] })).status, 403);
    assert.equal(await status("s-p000"), "pending");
  });

  await t.test("pedidos inválidos", async () => {
    assert.equal((await owner.bulk(G, { action: "accept" })).status, 400);
    assert.equal((await owner.bulk(G, { action: "accept", ids: ["s-p000"], filtros: {} })).status, 400);
    assert.equal((await owner.bulk(G, { action: "borrar", ids: ["s-p000"] })).status, 400);
    const tooMany = Array.from({ length: BULK_MAX + 1 }, (_, i) => `x${i}`);
    assert.equal((await owner.bulk(G, { action: "accept", ids: tooMany })).status, 400);
    assert.equal(await status("s-p000"), "pending");
  });

  await t.test("por ids: ignora las de otro grupo y las ya resueltas", async () => {
    const res = await owner.bulk(G, { action: "accept", ids: ["s-p000", "s-p004", "s-otro", "s-vieja", "no-existe"] });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { resolved: 2, remaining: 0 });
    assert.equal(await status("s-p000"), "accepted");
    assert.equal(await status("s-p004"), "accepted");
    assert.equal(await status("s-otro"), "pending");
    assert.equal(await status("s-vieja"), "rejected");
    assert.equal(await members(["p000", "p004", "p001"]), 2);
    const [inv] = await db.select().from(schema.groupInvite).where(eq(schema.groupInvite.id, "inv-p004"));
    assert.equal(inv.status, "accepted");
    // Repetir el mismo pedido no hace nada
    assert.deepEqual(await (await owner.bulk(G, { action: "accept", ids: ["s-p000"] })).json(), { resolved: 0, remaining: 0 });
  });

  await t.test("por filtros: de a BULK_MAX, de la más nueva a la más vieja, y dice cuántas quedan", async () => {
    // Sin foto: las impares, 130 en total
    const first = await mod.bulk(G, { action: "reject", filtros: { foto: "sin" } });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { resolved: 130, remaining: 0 });
    const odd = ids.filter((_, i) => i % 2 === 1);
    const rows = await db.select().from(schema.groupJoinRequest).where(inArray(schema.groupJoinRequest.userId, odd));
    assert.ok(rows.filter((r) => r.groupId === G).every((r) => r.status === "rejected"));
    assert.equal(await status("s-otro"), "pending"); // p001 en otro grupo, intacta
    const [r] = rows.filter((x) => x.id === "s-p001");
    assert.equal(r.resolvedBy, mod.id);

    // Con foto quedan 128 (130 menos p000 y p004). Todas, sin filtros: 128, en un pedido
    const all = await owner.bulk(G, { action: "accept", filtros: {} });
    assert.deepEqual(await all.json(), { resolved: 128, remaining: 0 });
    assert.equal(await members(ids.filter((_, i) => i % 2 === 0)), 130);
  });

  await t.test("más de BULK_MAX: corta en el tope y avisa el resto", async () => {
    const more = Array.from({ length: BULK_MAX + 30 }, (_, i) => `q${String(i).padStart(3, "0")}`);
    await db.insert(schema.user).values(more.map((id) => ({ id, name: id, email: `${id}@example.test` })));
    await db.insert(schema.profile).values(more.map((id) => ({ userId: id, displayName: id, birthdate: "1990-01-01" })));
    await db.insert(schema.groupJoinRequest).values(more.map((id, i) => ({ id: `s-${id}`, groupId: G, userId: id, createdAt: new Date(base + 60_000 - i * 1000) })));
    const first = await owner.bulk(G, { action: "reject", filtros: {} });
    assert.deepEqual(await first.json(), { resolved: BULK_MAX, remaining: 30 });
    // Las más nuevas se resolvieron primero
    assert.equal(await status("s-q000"), "rejected");
    assert.equal(await status(`s-q${String(BULK_MAX + 29).padStart(3, "0")}`), "pending");
    const second = await owner.bulk(G, { action: "reject", filtros: {} });
    assert.deepEqual(await second.json(), { resolved: 30, remaining: 0 });
  });
});
