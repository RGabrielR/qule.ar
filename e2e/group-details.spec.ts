import { expect, test } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 } });

test("los detalles conservan el origen al abrirse desde Grupos o desde el chat", async ({ page, baseURL }) => {
  const owner = await createAccount(baseURL!, "Ana Grupos");
  await signIn(page, owner);
  const name = "Caminatas de fin de semana por la ciudad";
  const created = await page.request.post("/api/groups", {
    data: { name }, headers: { Origin: baseURL! },
  });
  await expect(created).toBeOK();
  const { id } = await created.json();
  const chat = `/grupos/${id}`;
  const details = `${chat}/info`;
  await page.route(`**/api/groups/${id}`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), pendingCount: 128 } });
  });

  await page.goto("/grupos");
  await page.getByRole("tab", { name: "Todos los grupos" }).click();
  await page.getByRole("link", { name, exact: true }).and(page.locator(`a[href="${details}"]`)).click();
  await expect(page).toHaveURL(new URL(details, baseURL!).href);
  const menu = page.getByRole("button", { name: /^Opciones del grupo/ });
  const viewChat = page.getByRole("link", { name: "Ver chat del grupo" });
  const requests = page.getByRole("link", { name: "Solicitudes 128" });
  await expect(menu).toBeInViewport();
  await expect(menu).toHaveAccessibleName(/hay solicitudes pendientes/);
  await expect(viewChat).toHaveCount(0);
  await menu.click();
  await expect(viewChat).toBeInViewport();
  await expect(requests).toBeInViewport();
  const viewBox = (await viewChat.boundingBox())!;
  const requestsBox = (await requests.boundingBox())!;
  expect(requestsBox.y + requestsBox.height).toBeLessThanOrEqual(viewBox.y);
  expect(viewBox.x + viewBox.width).toBeLessThanOrEqual(375);
  await viewChat.click();
  await expect(page).toHaveURL(new URL(chat, baseURL!).href);
  await expect(page.getByRole("log", { name: "Mensajes del grupo" })).toBeVisible();

  await page.goto("/grupos");
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(new URL(chat, baseURL!).href);
  await page.getByRole("button", { name: /^Opciones del grupo/ }).click();
  await page.getByRole("link", { name: "Ver detalles", exact: true }).click();
  await expect(page).toHaveURL(new URL(details, baseURL!).href);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await menu.click();
  await expect(viewChat).toHaveCount(0);
  await expect(requests).toBeVisible();

  await page.getByRole("button", { name: "Volver", exact: true }).click();
  await expect(page).toHaveURL(new URL(chat, baseURL!).href);
  const header = page.locator("header").filter({ has: page.getByRole("button", { name: "Volver a Grupos" }) });
  const detailsLink = header.getByRole("link", { name, exact: true });
  await detailsLink.focus();
  await detailsLink.press("Enter");

  for (const target of [header.locator(".gcard__icon"), header.locator(".topbar__sub"), header]) {
    await expect(page).toHaveURL(new URL(details, baseURL!).href);
    await menu.click();
    await expect(requests).toBeVisible();
    await expect(viewChat).toHaveCount(0);
    await page.getByRole("button", { name: "Volver", exact: true }).click();
    await expect(detailsLink).toBeVisible();
    // El chat entra deslizando: se mide cuando terminó de moverse
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
    const box = (await target.boundingBox())!;
    const x = target === header ? 2 : box.width / 2;
    const y = target === header ? 2 : box.height / 2;
    await page.mouse.click(box.x + x, box.y + y);
  }

  await expect(page).toHaveURL(new URL(details, baseURL!).href);
  await menu.click();
  await expect(requests).toBeVisible();
  await expect(viewChat).toHaveCount(0);
  await page.getByRole("button", { name: "Volver", exact: true }).click();
  await page.getByRole("button", { name: "Volver a Grupos" }).click();
  await expect(page).toHaveURL(new URL("/grupos", baseURL!).href);
});

test("la edición del grupo tiene su propia pantalla y es exclusiva del dueño", async ({ page, browser, baseURL }) => {
  const owner = await createAccount(baseURL!, "Ana Edición");
  const member = await createAccount(baseURL!, "Sol Edición");
  const headers = { Origin: baseURL! };
  await signIn(page, owner);
  const created = await page.request.post("/api/groups", {
    data: { name: "Caminatas de finde", description: "Nos juntamos los sábados." }, headers,
  });
  await expect(created).toBeOK();
  const { id } = await created.json();
  const groupPath = `/api/groups/${id}`;
  const details = `/grupos/${id}/info`;
  const edit = `/grupos/${id}/editar`;

  await page.goto(details);
  const editLink = page.getByRole("link", { name: "Editar grupo" });
  await expect(editLink).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Miembros/ })).toBeInViewport();
  await expect(page.getByRole("textbox", { name: "Descripción" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Poner foto" })).toHaveCount(0);

  await page.getByRole("button", { name: /^Opciones del grupo/ }).click();
  await editLink.click();
  await expect(page).toHaveURL(new URL(edit, baseURL!).href);
  await expect(page.getByRole("heading", { name: "Editar grupo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Poner foto" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Miembros/ })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Nombre" }).fill("Caminatas y mates");
  await page.getByRole("textbox", { name: "Descripción" }).fill("Nos juntamos los domingos.");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("button", { name: "Guardado" })).toBeVisible();
  await page.getByRole("button", { name: "Volver", exact: true }).click();
  await expect(page).toHaveURL(new URL(details, baseURL!).href);
  await expect(page.getByRole("heading", { name: "Caminatas y mates" })).toBeVisible();
  await expect(page.getByText("Nos juntamos los domingos.")).toBeVisible();

  const memberPage = await browser.newPage({ baseURL });
  try {
    await signIn(memberPage, member);
    const applied = await memberPage.request.post(`${groupPath}/requests`, { data: {}, headers });
    await expect(applied).toBeOK();
    const { id: requestId } = await applied.json();
    await expect(await page.request.post(`${groupPath}/requests/${requestId}/accept`, { headers })).toBeOK();
    await memberPage.goto(edit);
    await expect(memberPage).toHaveURL(new URL(details, baseURL!).href);
    await expect(memberPage.getByRole("heading", { name: "Caminatas y mates" })).toBeVisible();
    await memberPage.getByRole("button", { name: /^Opciones del grupo/ }).click();
    await expect(memberPage.getByRole("link", { name: "Editar grupo" })).toHaveCount(0);
    await expect(memberPage.getByRole("link", { name: "Invitaciones", exact: true })).toHaveCount(0);
    await memberPage.goto(`/grupos/${id}/invitaciones`);
    await expect(memberPage).toHaveURL(new URL(details, baseURL!).href);
  } finally {
    await memberPage.close();
  }
});

test("las invitaciones se envían y cancelan desde su pantalla", async ({ page, baseURL }) => {
  const owner = await createAccount(baseURL!, "Ana Invitaciones");
  const guest = await createAccount(baseURL!, "Sol Invitaciones");
  await signIn(page, owner);
  const created = await page.request.post("/api/groups", {
    data: { name: "Grupo para invitar" }, headers: { Origin: baseURL! },
  });
  await expect(created).toBeOK();
  const { id } = await created.json();
  const details = `/grupos/${id}/info`;

  await page.goto(details);
  await expect(page.getByRole("heading", { name: "Grupo para invitar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Invitar gente" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Opciones del grupo/ }).click();
  await page.getByRole("link", { name: "Invitaciones", exact: true }).click();
  await expect(page).toHaveURL(new URL(`/grupos/${id}/invitaciones`, baseURL!).href);
  await expect(page.getByRole("heading", { name: "Invitaciones", exact: true })).toBeVisible();
  const empty = page.getByText("No hay invitaciones pendientes.");
  await expect(empty).toBeVisible();
  await page.locator("header").getByRole("button", { name: "Invitar gente" }).click();
  const picker = page.getByRole("dialog");
  await picker.getByRole("searchbox", { name: "Buscar gente" }).fill(guest.name);
  await picker.getByRole("listitem").filter({ hasText: guest.name }).getByRole("button", { name: "Invitar", exact: true }).click();
  await expect(picker.getByText("Invitación enviada")).toBeVisible();
  await picker.getByRole("button", { name: "Listo", exact: true }).click();
  // La hoja baja antes de cerrarse: hasta entonces, su fila de la persona sigue en pantalla
  await expect(picker).toHaveCount(0);

  const row = page.getByRole("listitem").filter({ hasText: guest.name });
  await expect(row).toContainText("sin responder");
  await row.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(empty).toBeVisible();
  await page.getByRole("button", { name: "Volver", exact: true }).click();
  await expect(page).toHaveURL(new URL(details, baseURL!).href);
});

test("al abrir Invitaciones directo, Atrás pasa por Detalles y vuelve al chat", async ({ page, browser, baseURL }) => {
  const owner = await createAccount(baseURL!, "Ana Entrada directa");
  await signIn(page, owner);
  const name = "Grupo para volver atrás";
  const created = await page.request.post("/api/groups", { data: { name }, headers: { Origin: baseURL! } });
  await expect(created).toBeOK();
  const { id } = await created.json();
  const chat = new URL(`/grupos/${id}`, baseURL!).href;
  const details = `${chat}/info`;
  const invites = `${chat}/invitaciones`;
  const storageState = await page.context().storageState();

  const direct = await browser.newPage({ storageState });
  try {
    await direct.goto(invites);
    await expect(direct.getByRole("button", { name: "Invitar gente" })).toBeVisible();
    await direct.getByRole("button", { name: "Volver", exact: true }).click();
    await expect(direct).toHaveURL(details);
    await expect(direct.getByRole("heading", { name })).toBeVisible();
    await direct.goBack();
    await expect(direct).toHaveURL(chat);
    await expect(direct.getByRole("log", { name: "Mensajes del grupo" })).toBeVisible();
  } finally {
    await direct.close();
  }

  const installed = await browser.newPage({ storageState, userAgent: "Android" });
  try {
    await installed.addInitScript(() => {
      const matchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) => query === "(display-mode: standalone)"
        ? { ...matchMedia(query), matches: true }
        : matchMedia(query);
      class TestCloseWatcher extends EventTarget {
        private close = () => {
          this.destroy();
          this.dispatchEvent(new Event("close"));
        };
        constructor() {
          super();
          window.addEventListener("test:system-back", this.close);
        }
        destroy() {
          window.removeEventListener("test:system-back", this.close);
        }
      }
      Object.defineProperty(window, "CloseWatcher", { value: TestCloseWatcher, configurable: true });
    });
    await installed.goto(invites);
    await expect(installed.getByRole("button", { name: "Invitar gente" })).toBeVisible();
    await installed.evaluate(() => window.dispatchEvent(new Event("test:system-back")));
    await expect(installed).toHaveURL(details);
    await expect(installed.getByRole("heading", { name })).toBeVisible();
    await installed.evaluate(() => window.dispatchEvent(new Event("test:system-back")));
    await expect(installed).toHaveURL(chat);
    await expect(installed.getByRole("log", { name: "Mensajes del grupo" })).toBeVisible();
  } finally {
    await installed.close();
  }
});
