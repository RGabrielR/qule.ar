import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hono } from "hono";
import sharp from "sharp";
import { bestExplicit, NUDENET_LABELS } from "./explicit/nudenet.js";

/** Salida de mentira del modelo: [1, 4 + clases, cajas], con los puntajes que se pasan por caja. */
function fakeOutput(boxes: Record<string, number>[]) {
  const classes = NUDENET_LABELS.length;
  const data = new Float32Array((4 + classes) * boxes.length);
  boxes.forEach((scores, i) => {
    for (const [label, score] of Object.entries(scores)) {
      data[(4 + NUDENET_LABELS.indexOf(label as (typeof NUDENET_LABELS)[number])) * boxes.length + i] = score;
    }
  });
  return { data, dims: [1, 4 + classes, boxes.length] };
}

test("solo cuentan genitales o culo al descubierto, y solo si es lo más probable de cada caja", () => {
  const none = fakeOutput([{ MALE_BREAST_EXPOSED: 0.95 }, { BELLY_EXPOSED: 0.9 }, { BUTTOCKS_COVERED: 0.9 }, { FACE_MALE: 0.8 }]);
  assert.deepEqual(bestExplicit(none.data, none.dims), { score: 0, label: null });

  // En la primera caja gana la cara: el culo en segundo lugar no cuenta (igual que NudeNet)
  const some = fakeOutput([{ FACE_MALE: 0.9, BUTTOCKS_EXPOSED: 0.6 }, { MALE_GENITALIA_EXPOSED: 0.7 }, { BUTTOCKS_EXPOSED: 0.4 }]);
  assert.deepEqual(bestExplicit(some.data, some.dims), { score: some.data[(4 + 14) * 3 + 1], label: "MALE_GENITALIA_EXPOSED" });
});

test("la marca de foto explícita solo tapa la foto a quien eligió no verlas", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "qule-explicitas-"));
  process.env.DATA_DIR = dir;
  process.env.ADMIN_EMAILS = "equipo@example.test";
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_URL;
  const { db, schema, runMigrations, closeDb } = await import("./db/index.js");
  t.after(async () => { await closeDb(); await rm(dir, { recursive: true, force: true }); });
  await runMigrations();
  const { auth } = await import("./auth.js");
  const { meRoutes } = await import("./routes/me.js");
  const { socialRoutes } = await import("./routes/social.js");
  const { nearbyRoutes } = await import("./routes/nearby.js");
  const { adminRoutes } = await import("./routes/admin.js");
  const { grant } = await import("./staff.js");
  const { checkNext, pendingCount, runQueue, sleep } = await import("./explicit/queue.js");

  // Las esperas no dejan escuchas colgadas en el signal: la cola corre todo el día con el mismo
  const longRun = new AbortController();
  for (let i = 0; i < 20; i++) await sleep(1, longRun.signal);
  assert.equal(getEventListeners(longRun.signal, "abort").length, 0);
  const cut = sleep(60_000, longRun.signal);
  longRun.abort();
  await cut;
  assert.equal(getEventListeners(longRun.signal, "abort").length, 0);
  const { testDetector } = await import("./explicit/index.js");
  const { eq } = await import("drizzle-orm");
  const app = new Hono().basePath("/api").route("/", meRoutes).route("/", socialRoutes).route("/", nearbyRoutes).route("/", adminRoutes);

  async function account(name: string) {
    const credentials = { email: `${name}@example.test`, password: "clave-para-pruebas" };
    const { user } = await auth.api.signUpEmail({ body: { ...credentials, name } });
    await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, user.id));
    const login = await auth.api.signInEmail({ body: credentials, asResponse: true });
    const cookie = login.headers.getSetCookie().map((s) => s.split(";")[0]).join("; ");
    const res = await app.request("/api/me/profile", {
      method: "PUT", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ displayName: name, birthdate: "1990-01-01", acceptTerms: true }),
    });
    assert.equal(res.status, 200);
    return { id: user.id, cookie };
  }
  const json = (cookie: string, path: string, init: { method?: string; body?: unknown } = {}) => app.request(`/api${path}`, {
    method: init.method ?? "GET",
    headers: { cookie, ...(init.body !== undefined && { "content-type": "application/json" }) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  async function upload(cookie: string, color: string, isPrivate = false) {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: color } }).png().toBuffer();
    const body = new FormData();
    body.set("file", new File([new Uint8Array(png)], "foto.png", { type: "image/png" }));
    if (isPrivate) body.set("private", "1");
    const res = await app.request("/api/me/photos", { method: "POST", headers: { cookie }, body });
    assert.equal(res.status, 200);
    return (await res.json()).id as string;
  }

  const [autor, tapa, mira, mod, equipo] = [
    await account("autor"), await account("tapa"), await account("mira"), await account("modera"), await account("equipo"),
  ];
  await grant(mod.id, ["reports"], equipo.id);

  // Las cuentas nuevas arrancan con la opción prendida
  const [nueva] = await db.select({ hide: schema.profile.hideExplicit }).from(schema.profile).where(eq(schema.profile.userId, tapa.id));
  assert.equal(nueva.hide, true);
  assert.equal((await json(mira.cookie, "/me/privacy", { method: "PUT", body: { hideExplicit: false } })).status, 200);

  // El modelo de mentira marca las fotos rojas. La privada no se revisa.
  const roja = await upload(autor.cookie, "red");
  const naranja = await upload(autor.cookie, "orange");
  const privada = await upload(autor.cookie, "red", true);
  while (await checkNext(testDetector)) { /* revisa todo lo pendiente */ }
  const rows = new Map((await db.select().from(schema.photo).where(eq(schema.photo.userId, autor.id))).map((p) => [p.id, p]));
  assert.equal(rows.get(roja)!.explicit, true);
  assert.equal(rows.get(naranja)!.explicit, false);
  assert.ok(rows.get(naranja)!.explicitCheckedAt);
  assert.equal(rows.get(privada)!.explicitCheckedAt, null);

  // Grilla: misma gente y mismo orden con la opción prendida o apagada; solo cambia si se ve borrosa
  type Grid = { people: { id: string; blur: boolean }[] };
  const gridTapa = (await (await json(tapa.cookie, "/nearby")).json()) as Grid;
  const gridMira = (await (await json(mira.cookie, "/nearby")).json()) as Grid;
  const others = (g: Grid) => g.people.map((p) => p.id).filter((id) => id !== tapa.id && id !== mira.id);
  assert.deepEqual(others(gridTapa), others(gridMira));
  assert.equal(gridTapa.people.find((p) => p.id === autor.id)?.blur, true);
  assert.equal(gridMira.people.find((p) => p.id === autor.id)?.blur, false);

  // Perfil: borrosa solo la roja, solo para quien eligió taparlas, nunca para quien la subió
  const blurOf = async (cookie: string) => ((await (await json(cookie, `/users/${autor.id}`)).json()) as { photosBlur: boolean[] }).photosBlur;
  assert.deepEqual(await blurOf(tapa.cookie), [true, false]);
  assert.deepEqual(await blurOf(mira.cookie), [false, false]);
  assert.deepEqual(await blurOf(autor.cookie), [false, false]);

  // Quien la subió ve que está tapada y puede pedir que la revisen
  type MyPhoto = { id: string; explicit: boolean; explicitReview: string | null };
  const mine = async () => ((await (await json(autor.cookie, "/me")).json()) as { photos: MyPhoto[] }).photos;
  assert.deepEqual((await mine()).map((p) => [p.id, p.explicit, p.explicitReview]), [[roja, true, null], [naranja, false, null], [privada, false, null]]);
  assert.equal((await json(autor.cookie, `/me/photos/${naranja}/explicit-review`, { method: "POST" })).status, 400);
  assert.equal((await json(tapa.cookie, `/me/photos/${roja}/explicit-review`, { method: "POST" })).status, 404);
  assert.equal((await json(autor.cookie, `/me/photos/${roja}/explicit-review`, { method: "POST" })).status, 200);
  assert.equal((await mine()).find((p) => p.id === roja)?.explicitReview, "requested");

  // Moderación ve el pedido y corrige: "no es explícita". Quien no modera, no.
  assert.equal((await json(tapa.cookie, "/admin/explicit")).status, 403);
  const requested = (await (await json(mod.cookie, "/admin/explicit?status=requested")).json()) as { id: string; person: { id: string } }[];
  assert.deepEqual(requested.map((r) => [r.id, r.person.id]), [[roja, autor.id]]);
  const marked = (await (await json(mod.cookie, "/admin/explicit?status=marked")).json()) as { id: string }[];
  assert.deepEqual(marked.map((r) => r.id), [roja]);
  assert.equal((await json(mod.cookie, `/admin/explicit/${roja}`, { method: "POST", body: { explicit: false } })).status, 200);
  assert.deepEqual(await blurOf(tapa.cookie), [false, false]);
  assert.equal((await mine()).find((p) => p.id === roja)?.explicitReview, "reviewed");
  assert.deepEqual(await (await json(mod.cookie, "/admin/explicit?status=requested")).json(), []);
  // El registro apunta a la foto, no a la cuenta: no suma en el historial de nadie
  const log = await db.select().from(schema.modAction).where(eq(schema.modAction.targetId, roja));
  assert.equal(log.length, 1);
  assert.equal((await db.select().from(schema.modAction).where(eq(schema.modAction.targetId, autor.id))).length, 0);
  // Ningún reporte por la marca
  assert.equal((await db.select().from(schema.report)).length, 0);

  // La decisión de moderación no la pisa el modelo
  await db.update(schema.photo).set({ explicitCheckedAt: null }).where(eq(schema.photo.id, roja));
  assert.equal(await checkNext(testDetector), false);
  assert.equal((await db.select().from(schema.photo).where(eq(schema.photo.id, roja)))[0].explicit, false);

  // Límite de trabajo: con 240 por minuto, una foto cada 250 ms como mucho
  for (let i = 0; i < 3; i++) await upload(tapa.cookie, "blue");
  assert.equal(await pendingCount(), 3);
  const stop = new AbortController();
  const running = runQueue({ detect: testDetector, perMinute: 240, signal: stop.signal });
  while (await pendingCount()) await new Promise((r) => setTimeout(r, 50));
  stop.abort();
  await running;
  const times = (await db.select({ at: schema.photo.explicitCheckedAt }).from(schema.photo).where(eq(schema.photo.userId, tapa.id)))
    .map((r) => r.at!.getTime()).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 200, `revisó dos fotos con ${times[i] - times[i - 1]} ms de diferencia`);
});
