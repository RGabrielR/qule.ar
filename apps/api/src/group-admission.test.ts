import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

test("las decisiones de ingreso son atómicas", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "qule-ingreso-"));
  process.env.DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_URL;
  const { db, schema, runMigrations, closeDb } = await import("./db/index.js");
  t.after(async () => { await closeDb(); await rm(dir, { recursive: true, force: true }); });
  await runMigrations();
  const { auth } = await import("./auth.js");
  const { groupRoutes } = await import("./routes/groups.js");
  const app = new Hono().route("/", groupRoutes);
  app.onError((err, c) => c.text(err.message, err instanceof HTTPException ? err.status : 500));

  async function account(name: string) {
    const credentials = { email: `${name}@example.com`, password: "clave-para-pruebas" };
    const { user } = await auth.api.signUpEmail({ body: { ...credentials, name } });
    await db.insert(schema.profile).values({ userId: user.id, displayName: name, birthdate: "1990-01-01" });
    const login = await auth.api.signInEmail({ body: credentials, asResponse: true });
    const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    return { id: user.id, post: async (url: string) => app.request(url, { method: "POST", headers: { cookie } }) };
  }

  const owner = await account("owner");
  const applicant = await account("applicant");
  const guest = await account("guest");
  const groupId = "grupo-prueba";
  await db.insert(schema.group).values({ id: groupId, name: "Grupo de prueba" });
  await db.insert(schema.groupMember).values({ groupId, userId: owner.id, role: "owner" });
  await db.insert(schema.groupJoinRequest).values({ id: "solicitud", groupId, userId: applicant.id });

  const requestStatus = async () => {
    const [row] = await db.select().from(schema.groupJoinRequest).where(eq(schema.groupJoinRequest.id, "solicitud"));
    return row.status;
  };
  const inviteStatus = async (id: string) => {
    const [row] = await db.select().from(schema.groupInvite).where(eq(schema.groupInvite.id, id));
    return row.status;
  };
  const hasMember = async (userId: string) => {
    const [row] = await db.select().from(schema.groupMember)
      .where(and(eq(schema.groupMember.groupId, groupId), eq(schema.groupMember.userId, userId)));
    return Boolean(row);
  };

  await t.test("si falla la membresía, la solicitud queda pendiente y se puede reintentar", async () => {
    await db.insert(schema.groupInvite).values({ id: "invitacion-previa", groupId, userId: applicant.id, invitedBy: owner.id });
    await db.execute(sql`ALTER TABLE group_member ADD CONSTRAINT test_reject_new_member CHECK (role <> 'member')`);
    const url = `/groups/${groupId}/requests/solicitud/accept`;
    try {
      assert.equal((await owner.post(url)).status, 500);
      assert.equal(await requestStatus(), "pending");
      assert.equal(await inviteStatus("invitacion-previa"), "pending");
      assert.equal(await hasMember(applicant.id), false);
    } finally {
      await db.execute(sql`ALTER TABLE group_member DROP CONSTRAINT test_reject_new_member`);
    }
    assert.equal((await owner.post(url)).status, 200);
    assert.equal(await requestStatus(), "accepted");
    assert.equal(await inviteStatus("invitacion-previa"), "accepted");
    assert.equal(await hasMember(applicant.id), true);
  });

  await t.test("un fallo al avisar a moderación conserva la respuesta de éxito", async (t) => {
    await db.insert(schema.groupJoinRequest).values({ id: "solicitud-avisos", groupId, userId: guest.id });
    const select = db.select.bind(db);
    const failure = new Error("Falló la consulta de moderación");
    const log = t.mock.method(console, "error", () => {});
    const mock = t.mock.method(db, "select", (fields?: Parameters<typeof db.select>[0]) => {
      if (fields?.userId === schema.groupMember.userId) throw failure;
      return fields ? select(fields) : select();
    });
    try {
      const response = await owner.post(`/groups/${groupId}/requests/solicitud-avisos/accept`);
      assert.equal(response.status, 200);
      assert.equal(await hasMember(guest.id), true);
      assert.deepEqual(log.mock.calls[0]?.arguments, ["Aviso de ingreso a moderación", { groupId, error: failure }]);
    } finally {
      mock.mock.restore();
      log.mock.restore();
      await db.delete(schema.groupMember).where(eq(schema.groupMember.userId, guest.id));
    }
  });

  await t.test("aceptar y rechazar en paralelo produce una sola decisión", async () => {
    await db.insert(schema.groupInvite).values({ id: "invitacion", groupId, userId: guest.id, invitedBy: owner.id });
    const [accept, decline] = await Promise.all([
      guest.post("/invites/invitacion/accept"),
      guest.post("/invites/invitacion/decline"),
    ]);
    assert.deepEqual([accept.status, decline.status].sort(), [200, 409]);
    assert.equal(await inviteStatus("invitacion"), accept.ok ? "accepted" : "declined");
    assert.equal(await hasMember(guest.id), accept.ok);
  });
});
