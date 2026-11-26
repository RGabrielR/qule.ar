import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./lib.js";

/**
 * Encuestas en grupos (discusión 184): una pregunta con 2 a 5 opciones, un voto por miembro que se puede cambiar,
 * solo totales (nunca quién votó qué) y las mismas reglas que el resto del chat: reportes, borrado por
 * moderación y limpieza al suspender.
 */
test("encuestas en grupos: votos, privacidad y moderación", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "qule-encuestas-"));
  process.env.DATABASE_URL = "";
  process.env.DATA_DIR = dir;
  process.env.DATA_KEY ??= randomBytes(32).toString("base64");
  process.env.SMTP_URL = "";
  const { db, schema, runMigrations, closeDb } = await import("./db/index.js");
  t.after(async () => { await closeDb(); await rm(dir, { recursive: true, force: true }); });
  await runMigrations();
  const { eq } = await import("drizzle-orm");
  const { auth } = await import("./auth.js");
  const { groupRoutes } = await import("./routes/groups.js");
  const { socialRoutes } = await import("./routes/social.js");
  const { purgeSuspendedContent } = await import("./suspension.js");
  const { pollRanking } = await import("./polls.js");
  const app = new Hono<AppEnv>().route("/", groupRoutes).route("/", socialRoutes);
  app.onError((err, c) => c.text(err.message, err instanceof HTTPException ? err.status : 500));

  async function account(name: string) {
    const credentials = { email: `${name}@example.com`, password: "clave-para-pruebas" };
    const { user } = await auth.api.signUpEmail({ body: { ...credentials, name } });
    await db.insert(schema.profile).values({ userId: user.id, displayName: name, birthdate: "1990-01-01" });
    const login = await auth.api.signInEmail({ body: credentials, asResponse: true });
    const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const call = (method: string, url: string, body?: unknown) => app.request(url, {
      method, headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { id: user.id, call };
  }

  const ana = await account("ana");
  const beto = await account("beto");
  const caro = await account("caro");
  const dani = await account("dani"); // no es del grupo
  const groupId = "grupo-encuestas";
  // Sin esperas entre mensajes, salvo para caro (cuenta nueva con cola) más abajo
  await db.insert(schema.group).values({
    id: groupId, name: "Juntadas",
    spamRules: { intervalSeconds: 1, burst: 50, rotationWindow: 20, rotationMax: 50, newAccountHours: 0, maxQueued: 3 },
  });
  await db.insert(schema.groupMember).values([
    { groupId, userId: ana.id, role: "owner" },
    { groupId, userId: beto.id },
    { groupId, userId: caro.id },
  ]);

  const createPoll = async (who: typeof ana, body: string, options: unknown) =>
    who.call("POST", `/groups/${groupId}/messages`, { body, poll: { options } });
  const vote = (who: typeof ana, mid: string, option: number | null) =>
    who.call("PUT", `/groups/${groupId}/polls/${mid}/vote`, { option });
  const history = async (who: typeof ana) =>
    (await (await who.call("GET", `/groups/${groupId}/messages`)).json()) as {
      messages: { id: string; body: string | null; poll: { options: string[]; counts: number[]; total: number; myVote: number | null } | null }[];
    };

  let pollId = "";

  await t.test("se crea con una pregunta y entre 2 y 5 opciones distintas", async () => {
    assert.equal((await createPoll(ana, "¿Cuándo?", ["Viernes"])).status, 400);
    assert.equal((await createPoll(ana, "¿Cuándo?", ["1", "2", "3", "4", "5", "6"])).status, 400);
    assert.equal((await createPoll(ana, "¿Cuándo?", ["Viernes", "viernes "])).status, 400);
    assert.equal((await createPoll(ana, "¿Cuándo?", ["Viernes", " "])).status, 400);
    assert.equal((await createPoll(ana, "x".repeat(201), ["Viernes", "Sábado"])).status, 400);

    const res = await createPoll(ana, "¿Cuándo hacemos la próxima juntada?", ["Viernes 20 h", "Sábado 18 h", "Domingo al mediodía"]);
    assert.equal(res.status, 200);
    const { message } = await res.json();
    assert.equal(message.status, "published");
    assert.deepEqual(message.poll.options, ["Viernes 20 h", "Sábado 18 h", "Domingo al mediodía"]);
    assert.deepEqual(message.poll.counts, [0, 0, 0]);
    pollId = message.id;
  });

  await t.test("un voto por miembro, que se puede cambiar o sacar", async () => {
    assert.equal((await vote(beto, pollId, 0)).status, 200);
    const changed = await vote(beto, pollId, 1);
    assert.deepEqual(await changed.json(), { counts: [0, 1, 0], total: 1, myVote: 1 });
    assert.equal((await vote(caro, pollId, 1)).status, 200);
    assert.equal((await vote(ana, pollId, 2)).status, 200);
    assert.equal((await vote(ana, pollId, null)).status, 200);

    const poll = (await history(beto)).messages.find((m) => m.id === pollId)!.poll!;
    assert.deepEqual(poll, { options: ["Viernes 20 h", "Sábado 18 h", "Domingo al mediodía"], counts: [0, 2, 0], total: 2, myVote: 1 });
    assert.equal((await history(ana)).messages.find((m) => m.id === pollId)!.poll!.myVote, null);
    assert.deepEqual((await pollRanking(pollId))?.map((r) => r.option), ["Sábado 18 h", "Viernes 20 h", "Domingo al mediodía"]);
  });

  await t.test("nunca se muestra quién votó qué", async () => {
    const raw = JSON.stringify(await history(ana));
    assert.ok(!raw.includes(caro.id), "el historial no tiene ids de quienes votaron");
    const voteRaw = await (await vote(caro, pollId, 1)).text();
    assert.ok(!voteRaw.includes(caro.id) && !voteRaw.includes(beto.id));
  });

  await t.test("solo votan miembros, en opciones que existen", async () => {
    assert.equal((await vote(dani, pollId, 0)).status, 403);
    assert.equal((await vote(beto, pollId, 3)).status, 400);
    assert.equal((await vote(beto, pollId, -1)).status, 400);
    const { message } = await (await beto.call("POST", `/groups/${groupId}/messages`, { body: "Un mensaje común" })).json();
    assert.equal(message.poll, null);
    assert.equal((await vote(beto, message.id, 0)).status, 404);
  });

  await t.test("el reporte guarda la pregunta y las opciones", async () => {
    const res = await beto.call("POST", "/reports", { userId: ana.id, reason: "spam", messageId: pollId, messageKind: "group" });
    assert.equal(res.status, 200);
    const [r] = await db.select().from(schema.report).where(eq(schema.report.messageId, pollId));
    assert.equal(r.messageBody, "Encuesta: ¿Cuándo hacemos la próxima juntada?\n- Viernes 20 h\n- Sábado 18 h\n- Domingo al mediodía");
  });

  await t.test("moderación la borra con sus votos", async () => {
    const { message } = await (await createPoll(beto, "¿Pizza o empanadas?", ["Pizza", "Empanadas"])).json();
    await vote(caro, message.id, 0);
    assert.equal((await ana.call("DELETE", `/groups/${groupId}/messages/${message.id}`)).status, 200);
    assert.equal((await db.select().from(schema.groupPoll).where(eq(schema.groupPoll.messageId, message.id))).length, 0);
    assert.equal((await db.select().from(schema.groupPollVote).where(eq(schema.groupPollVote.messageId, message.id))).length, 0);
    assert.equal((await vote(caro, message.id, 1)).status, 404);
  });

  await t.test("en cola no se vota y al suspender se borran sus encuestas", async () => {
    await db.update(schema.group).set({
      spamRules: { intervalSeconds: 600, burst: 1, rotationWindow: 20, rotationMax: 50, newAccountHours: 0, maxQueued: 3 },
    }).where(eq(schema.group.id, groupId));
    const first = await (await createPoll(caro, "¿Vamos al río?", ["Sí", "No"])).json();
    const second = await (await createPoll(caro, "¿Llevamos mate?", ["Sí", "Obvio"])).json();
    assert.equal(second.message.status, "queued");
    assert.deepEqual(second.message.poll.options, ["Sí", "Obvio"]);
    assert.equal((await vote(beto, second.message.id, 0)).status, 404);
    await vote(beto, first.message.id, 0);

    await purgeSuspendedContent(caro.id);
    for (const id of [first.message.id, second.message.id]) {
      assert.equal((await db.select().from(schema.groupPoll).where(eq(schema.groupPoll.messageId, id))).length, 0);
    }
    assert.ok(!(await history(beto)).messages.some((m) => m.id === first.message.id));
    // El voto de caro en la encuesta de ana no es contenido suyo: queda en los totales
    assert.equal((await history(beto)).messages.find((m) => m.id === pollId)!.poll!.total, 2);
  });
});
