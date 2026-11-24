import { expect, test } from "@playwright/test";
import { createAccount, openProfile, signIn } from "./fixtures";

function gate() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { wait, release };
}

test("entrega un mensaje a otra sesión y lo conserva al reabrir el chat", async ({ page, browser, baseURL }) => {
  const sender = await createAccount(baseURL!, "Camila Mensajes");
  const recipient = await createAccount(baseURL!, "Daniela Mensajes");
  const recipientContext = await browser.newContext({ baseURL });
  try {
    const recipientPage = await recipientContext.newPage();
    const secondMessageReceived = gate();
    recipientPage.on("websocket", (socket) => {
      socket.on("framereceived", ({ payload }) => {
        if (payload.toString().includes("Segundo mensaje durante el resumen")) secondMessageReceived.release();
      });
    });
    await signIn(recipientPage, recipient);
    const inbox = recipientPage.getByRole("link", { name: "Mensajes", exact: true });
    await inbox.click();
    const conversation = recipientPage.getByRole("link", { name: new RegExp(sender.name) });
    await expect(recipientPage.getByText("Sin mensajes por ahora", { exact: true })).toBeVisible();

    await signIn(page, sender);
    await openProfile(page, recipient);
    await page.getByRole("button", { name: "Mandar mensaje" }).click();
    const composer = page.getByRole("textbox", { name: "Mensaje", exact: true });
    await composer.waitFor();
    const conversationPath = new URL(page.url()).pathname.replace("/mensajes/", "/api/conversations/");
    const firstSummaryCaptured = gate();
    const allowFirstSummary = gate();
    const nextSummary = gate();
    const allowNextSummary = gate();
    let summaryRequests = 0;
    await recipientPage.route("**/summary", async (route) => {
      summaryRequests++;
      if (summaryRequests !== 1) {
        nextSummary.release();
        await allowNextSummary.wait;
        await route.continue();
        return;
      }
      const snapshot = await route.fetch();
      const summary = await snapshot.json();
      firstSummaryCaptured.release();
      await allowFirstSummary.wait;
      await route.fulfill({ response: snapshot, json: summary });
    });
    const message = "Hola, este mensaje se tiene que guardar.";
    await composer.fill(message);
    await page.getByRole("button", { name: "Mandar", exact: true }).click();

    try {
      await firstSummaryCaptured.wait;
      await expect(await page.request.post(`${conversationPath}/messages`, {
        data: { body: "Segundo mensaje durante el resumen" }, headers: { Origin: baseURL! },
      })).toBeOK();
      await secondMessageReceived.wait;
    } finally {
      allowFirstSummary.release();
    }
    await nextSummary.wait;
    try {
      await expect(conversation).toHaveCount(0);
    } finally {
      allowNextSummary.release();
    }
    await expect(conversation.getByText("Segundo mensaje durante el resumen", { exact: true })).toBeVisible();
    await expect(conversation.locator(".badge--inline")).toHaveText("2");
    expect(summaryRequests).toBe(2);
    await recipientPage.unroute("**/summary");
    const otherTab = await recipientContext.newPage();
    await otherTab.goto("/mensajes");
    const otherChat = otherTab.getByRole("link", { name: new RegExp(sender.name) });
    await expect(otherChat.locator(".badge--inline")).toHaveText("2");
    const summaryCounts = [0, 0];
    const tabs = [recipientPage, otherTab];
    for (const [index, tab] of tabs.entries()) {
      tab.on("request", (request) => {
        if (request.url().endsWith(`${conversationPath}/summary`)) summaryCounts[index]++;
      });
    }
    const localRead = recipientPage.waitForEvent("console", { predicate: (message) => message.text() === "mortero:read" });
    await recipientPage.evaluate(() => window.addEventListener("mortero:read", (event) => console.log(event.type), { once: true }));
    const initialRead = recipientPage.waitForResponse((response) => response.url().endsWith("/read")
      && response.request().method() === "POST");
    const initialSummary = recipientPage.waitForResponse((response) => response.url().endsWith("/summary"));
    await conversation.click();
    await expect(recipientPage.getByText(message, { exact: true })).toBeVisible();
    expect((await initialRead).ok()).toBe(true);
    await localRead;
    expect((await initialSummary).ok()).toBe(true);

    await expect(otherChat.locator(".badge--inline")).toHaveCount(0);
    await Promise.all(tabs.map((tab) => tab.waitForLoadState("networkidle")));
    expect(summaryCounts).toEqual([1, 1]);
    await otherChat.click();
    await expect(otherTab.getByText(message, { exact: true })).toBeVisible();
    const simultaneousReads = tabs.map((tab) => tab.waitForResponse((response) =>
      response.url().endsWith(`${conversationPath}/read`) && response.request().method() === "POST"));
    const summaries = tabs.map((tab) => tab.waitForResponse((response) =>
      response.url().endsWith(`${conversationPath}/summary`)));
    await expect(await page.request.post(`${conversationPath}/messages`, {
      data: { body: "Leído en dos pestañas abiertas" }, headers: { Origin: baseURL! },
    })).toBeOK();
    const confirmations = await Promise.all(simultaneousReads.map(async (response) => (await response).json()));
    expect(confirmations.map(({ changed }) => changed).sort()).toEqual([false, true]);
    for (const summary of await Promise.all(summaries)) expect(await summary.json()).toMatchObject({ unread: 0 });
    await Promise.all(tabs.map((tab) => tab.waitForLoadState("networkidle")));
    expect(summaryCounts).toEqual([2, 2]);
    await otherTab.close();

    const inboxRequests: string[] = [];
    const readRequests: string[] = [];
    recipientPage.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path === "/api/conversations") inboxRequests.push(path);
      if (path === `${conversationPath}/read`) readRequests.push(path);
    });

    // Pausá el reloj del receptor para que las tres entregas entren en la misma ventana.
    await recipientPage.clock.install();
    await recipientPage.clock.pauseAt(new Date(Date.now() + 1000));
    const burst = ["Uno en vivo", "Dos en vivo", "Tres en vivo"];
    let lastId = "";
    for (const body of burst) {
      const response = await page.request.post(`${conversationPath}/messages`, {
        data: { body },
        headers: { Origin: baseURL! },
      });
      await expect(response).toBeOK();
      lastId = (await response.json()).id;
      await expect(recipientPage.getByText(body, { exact: true })).toBeVisible();
    }
    const burstSummary = recipientPage.waitForResponse((response) => response.url().endsWith("/summary"));
    await recipientPage.clock.runFor(300);
    const summary = await burstSummary;
    expect(summary.ok()).toBe(true);
    expect(await summary.json()).toMatchObject({ last: { body: burst[2] }, unread: 0 });
    expect(readRequests).toHaveLength(1);
    expect(inboxRequests).toHaveLength(0);
    await recipientPage.clock.resume();

    await recipientPage.goBack();
    await expect(conversation.getByText(burst[2], { exact: true })).toBeVisible();
    await expect(conversation.locator(".badge--inline")).toHaveCount(0);
    const deleted = await page.request.delete(`${conversationPath}/messages/${lastId}`, {
      headers: { Origin: baseURL! },
    });
    await expect(deleted).toBeOK();
    await expect(conversation.getByText(burst[1], { exact: true })).toBeVisible();
    expect(inboxRequests).toHaveLength(0);
    await recipientPage.reload();
    await conversation.click();
    await expect(recipientPage.getByText(message, { exact: true })).toBeVisible();

    const readStarted = gate();
    const allowRead = gate();
    const readPath = `**${conversationPath}/read`;
    const attemptedReadBodies: string[] = [];
    await recipientPage.route(readPath, async (route) => {
      attemptedReadBodies.push(route.request().postData() ?? "");
      if (attemptedReadBodies.length <= 2) {
        await route.abort();
        return;
      }
      if (attemptedReadBodies.length === 3) {
        readStarted.release();
        await allowRead.wait;
        await route.abort();
        return;
      }
      await route.continue();
    });
    const seen = await page.request.post(`${conversationPath}/messages`, {
      data: { body: "Recibido con el chat abierto" }, headers: { Origin: baseURL! },
    });
    await expect(seen).toBeOK();
    const seenId = (await seen.json()).id;
    await expect(recipientPage.getByText("Recibido con el chat abierto")).toBeVisible();
    await readStarted.wait;
    await recipientPage.goBack();

    const unseen = await page.request.post(`${conversationPath}/messages`, {
      data: { body: "Recibido después de salir" }, headers: { Origin: baseURL! },
    });
    await expect(unseen).toBeOK();
    const unseenId = (await unseen.json()).id;
    await expect(conversation.getByText("Recibido después de salir")).toBeVisible();
    const readSummary = recipientPage.waitForResponse((response) => response.url().endsWith("/summary"));
    allowRead.release();
    expect(await (await readSummary).json()).toMatchObject({ last: { id: unseenId }, unread: 1 });
    await recipientPage.unroute(readPath);

    const history = await page.request.get(`${conversationPath}/messages`);
    await expect(history).toBeOK();
    expect((await history.json()).messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: seenId, readAt: expect.any(String) }),
      expect.objectContaining({ id: unseenId, readAt: null }),
    ]));
    expect(attemptedReadBodies).toEqual([
      JSON.stringify({ messageIds: [seenId] }),
      JSON.stringify({ messageIds: [seenId] }),
      JSON.stringify({ messageIds: [seenId] }),
      JSON.stringify({ messageIds: [seenId] }),
    ]);
    await expect(page.getByText("Visto", { exact: true })).toHaveCount(0);

    // Agotá también los intentos con el chat abierto y recuperá la conexión antes de salir.
    let failedReads = 0;
    await recipientPage.route(readPath, async (route) => {
      failedReads++;
      await route.fulfill({ status: 503, json: {} });
    });
    const settled = recipientPage.waitForEvent("requestfinished", {
      predicate: (request) => failedReads === 3 && request.url().endsWith("/read"),
    });
    await conversation.click();
    await settled;
    expect(failedReads).toBe(3);
    await recipientPage.unroute(readPath);
    const recovered = recipientPage.waitForResponse((response) => response.url().endsWith("/read"));
    await recipientPage.goBack();
    expect((await recovered).ok()).toBe(true);
    await expect(conversation.locator(".badge--inline")).toHaveCount(0);

    const legacyMessage = await page.request.post(`${conversationPath}/messages`, {
      data: { body: "Para la pestaña anterior" }, headers: { Origin: baseURL! },
    });
    await expect(legacyMessage).toBeOK();
    const legacyId = (await legacyMessage.json()).id;
    await expect(conversation.locator(".badge--inline")).toHaveText("1");
    const legacySummary = recipientPage.waitForResponse((response) => response.url().endsWith("/summary"));
    await expect(await recipientPage.request.post(`${conversationPath}/read`, {
      headers: { Origin: baseURL! },
    })).toBeOK();
    expect(await (await legacySummary).json()).toMatchObject({ last: { body: "Para la pestaña anterior" }, unread: 0 });

    const summaryFailed = recipientPage.waitForEvent("requestfailed", {
      predicate: (request) => request.url().endsWith("/summary"),
    });
    const allowFullReload = gate();
    await recipientPage.route("**/api/conversations", async (route) => {
      await allowFullReload.wait;
      await route.continue();
    });
    await recipientPage.route("**/summary", (route) => route.abort());
    await expect(await page.request.delete(`${conversationPath}/messages/${legacyId}`, {
      headers: { Origin: baseURL! },
    })).toBeOK();
    await summaryFailed;
    try {
      await expect(conversation.getByText("Para la pestaña anterior")).toHaveCount(0);
    } finally {
      allowFullReload.release();
    }
    await expect(conversation.getByText("Recibido después de salir")).toBeVisible();
  } finally {
    await recipientContext.close();
  }
});

test("publica la primera bandeja y reconcilia los mensajes recibidos durante la carga", async ({ page, baseURL }) => {
  const sender = await createAccount(baseURL!, "Ana Bandeja");
  const recipient = await createAccount(baseURL!, "Sol Bandeja");
  await signIn(page, sender);
  await openProfile(page, recipient);
  await page.getByRole("button", { name: "Mandar mensaje" }).click();
  await page.getByRole("textbox", { name: "Mensaje", exact: true }).waitFor();
  const path = new URL(page.url()).pathname.replace("/mensajes/", "/api/conversations/");
  const send = (body: string) => page.request.post(`${path}/messages`, { data: { body }, headers: { Origin: baseURL! } });
  await expect(await send("Vista previa inicial")).toBeOK();

  const snapshot = gate();
  const showSnapshot = gate();
  const reconcile = gate();
  const connected = gate();
  const delivered = gate();
  page.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => {
    if (payload.toString().startsWith("40")) connected.release();
    if (payload.toString().includes("Durante la carga 2")) delivered.release();
  }));
  let loads = 0;
  await page.route("**/api/conversations", async (route) => {
    loads++;
    const response = await route.fetch();
    snapshot.release();
    await (loads === 1 ? showSnapshot : reconcile).wait;
    await route.fulfill({ response });
  });
  await page.route("**/summary", async (route) => {
    await reconcile.wait;
    await route.continue();
  });
  try {
    await page.goto("/mensajes");
    await Promise.all([snapshot.wait, connected.wait]);
    await expect(await send("Durante la carga 1")).toBeOK();
    await expect(await send("Durante la carga 2")).toBeOK();
    await delivered.wait;
    showSnapshot.release();
    await expect(page.getByText("Vos: Vista previa inicial", { exact: true })).toBeVisible();
  } finally {
    showSnapshot.release();
    reconcile.release();
  }
  await expect(page.getByText("Vos: Durante la carga 2", { exact: true })).toBeVisible();
  expect(loads).toBe(1);
});

test("conserva una lectura que llega antes del mensaje y solo avisa cambios reales de bloqueo", async ({ page, browser, baseURL }) => {
  const sender = await createAccount(baseURL!, "Luz Confirmación");
  const recipient = await createAccount(baseURL!, "Mar Confirmación");
  const recipientContext = await browser.newContext({ baseURL });
  const delayed = gate();
  const read = gate();
  let deliverMessage: (() => void) | undefined;
  let accessEvents = 0;
  let receipt: { messageIds: string[]; through?: { id: string; createdAt: string } } | undefined;
  await page.routeWebSocket("**/socket.io/**", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((frame) => {
      if (typeof frame === "string" && frame.includes('"dm:message"') && frame.includes("Mensaje demorado")) {
        deliverMessage = () => socket.send(frame);
        delayed.release();
        return;
      }
      socket.send(frame);
      if (typeof frame === "string" && frame.startsWith('42["dm:read",')) {
        [, receipt] = JSON.parse(frame.slice(2));
        read.release();
      }
      if (typeof frame === "string" && frame.includes('"dm:access"')) accessEvents++;
    });
  });
  try {
    await signIn(page, sender);
    await openProfile(page, recipient);
    await page.getByRole("button", { name: "Mandar mensaje" }).click();
    await page.getByRole("textbox", { name: "Mensaje", exact: true }).waitFor();
    const path = new URL(page.url()).pathname.replace("/mensajes/", "/api/conversations/");
    const headers = { Origin: baseURL! };
    await signIn(await recipientContext.newPage(), recipient);
    const { other } = await (await page.request.get(path)).json();
    for (let i = 0; i < 2; i++) await expect(await page.request.post("/api/blocks", { headers, data: { userId: other.id } })).toBeOK();
    for (let i = 0; i < 2; i++) await expect(await page.request.delete(`/api/blocks/${other.id}`, { headers })).toBeOK();

    const earlier = await page.request.post(`${path}/messages`, { data: { body: "Mensaje anterior" }, headers });
    await expect(earlier).toBeOK();
    const previous = await earlier.json();
    const sent = await page.request.post(`${path}/messages`, { data: { body: "Mensaje demorado" }, headers });
    await expect(sent).toBeOK();
    await delayed.wait;
    expect(accessEvents).toBe(2);
    const { id } = await sent.json();
    await expect(await recipientContext.request.post(`${path}/read`, { headers, data: { beforeId: id, messageIds: [id] } })).toBeOK();
    await read.wait;
    expect(receipt).toMatchObject({ messageIds: [id], through: { id: previous.id, createdAt: previous.createdAt } });
    deliverMessage!();
    await expect(page.getByText("Mensaje demorado", { exact: true })).toBeVisible();
    await expect(page.getByText("Visto", { exact: true })).toBeVisible();
  } finally {
    await recipientContext.close();
  }
});
