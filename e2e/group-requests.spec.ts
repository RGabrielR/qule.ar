import { expect, test } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 } });

test("solicitudes vuelve a la pantalla de origen y abre desde un aviso", async ({ page, browser, baseURL }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { value: "Android", configurable: true });
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => query === "(display-mode: standalone)"
      ? { ...matchMedia(query), matches: true }
      : matchMedia(query);
    class TestCloseWatcher extends EventTarget {
      private close = () => this.dispatchEvent(new Event("close"));
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
  const owner = await createAccount(baseURL!, "Ana Grupos");
  const applicant = await createAccount(baseURL!, "Sol Solicitudes");
  const headers = { Origin: baseURL! };
  await signIn(page, owner);
  const name = "Caminatas de fin de semana por la ciudad";
  const response = await page.request.post("/api/groups", { data: { name }, headers });
  await expect(response).toBeOK();
  const { id } = await response.json();
  const chat = `/grupos/${id}`;
  const info = `${chat}/info`;
  const requests = `${chat}/solicitudes`;

  const applicantPage = await browser.newPage({ baseURL });
  try {
    await signIn(applicantPage, applicant);
    await expect(await applicantPage.request.post(`/api/groups/${id}/requests`, {
      data: { message: "Quiero sumarme" }, headers,
    })).toBeOK();
    await applicantPage.goto(requests);
    await expect(applicantPage).toHaveURL(new URL(chat, baseURL!).href);
    await expect(applicantPage.getByRole("heading", { name: "Solicitudes", exact: true })).toHaveCount(0);

    await page.goto(info);
    const detailsMenu = page.getByRole("button", { name: /^Opciones del grupo/ });
    await detailsMenu.click();
    const detailsLink = page.getByRole("link", { name: "Solicitudes 1" });
    await detailsLink.click();
    const heading = page.getByRole("heading", { name: "Solicitudes", exact: true });
    await expect(heading).toBeVisible();
    await expect(page.getByText(applicant.name)).toBeVisible();
    await page.getByRole("button", { name: "Volver", exact: true }).click();
    await expect(page).toHaveURL(new URL(info, baseURL!).href);
    await detailsMenu.click();
    await expect(detailsLink).toBeVisible();

    await page.getByRole("button", { name: "Volver", exact: true }).click();
    await expect(page).toHaveURL(new URL(chat, baseURL!).href);
    await page.getByRole("button", { name: /^Opciones del grupo/ }).click();
    await page.getByRole("link", { name: "Solicitudes 1" }).click();
    await expect(heading).toBeVisible();
    await page.getByRole("button", { name: "Volver", exact: true }).click();
    await expect(page).toHaveURL(new URL(chat, baseURL!).href);

    await page.goto(`${requests}?aviso=1`);
    await expect(heading).toBeVisible();
    await page.getByRole("button", { name: "Volver", exact: true }).click();
    await expect(page).toHaveURL(new URL(`${chat}?aviso=1`, baseURL!).href);
    await expect(page.getByRole("button", { name: "Volver a Grupos" })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("test:system-back")));
    await expect(page).toHaveURL(new URL("/grupos", baseURL!).href);

    await page.goto(`${requests}?aviso=1`);
    await expect(heading).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("test:system-back")));
    await expect(page).toHaveURL(new URL(`${chat}?aviso=1`, baseURL!).href);
    await page.getByRole("button", { name: "Volver a Grupos" }).click();
    await expect(page).toHaveURL(new URL("/grupos", baseURL!).href);

    await page.goto(`${info}#solicitudes`);
    await expect(page).toHaveURL(new URL(requests, baseURL!).href);
    await expect(heading).toBeVisible();
    await page.getByRole("button", { name: "Volver", exact: true }).click();
    await expect(page).toHaveURL(new URL(chat, baseURL!).href);
  } finally {
    await applicantPage.close();
  }
});

test("el puntito de solicitudes vuelve al cerrar el menú mientras haya pendientes", async ({ page, browser, baseURL }) => {
  const owner = await createAccount(baseURL!, "Ana Menú");
  const applicant = await createAccount(baseURL!, "Sol Menú");
  const headers = { Origin: baseURL! };
  await signIn(page, owner);
  const created = await page.request.post("/api/groups", { data: { name: "Grupo del indicador" }, headers });
  await expect(created).toBeOK();
  const { id } = await created.json();
  const groupPath = `/api/groups/${id}`;
  const chat = `/grupos/${id}`;

  await page.goto(chat);
  const options = page.getByRole("button", { name: /^Opciones del grupo/ });
  const dot = options.locator(".group-actions__dot");
  const requests = page.getByRole("link", { name: /^Solicitudes/ });
  await expect(options).toBeVisible();
  await expect(dot).toHaveCount(0);
  await options.click();
  await expect(requests).toHaveText("Solicitudes");
  await page.keyboard.press("Escape");
  await expect(options).toBeFocused();

  const applicantPage = await browser.newPage({ baseURL });
  try {
    await signIn(applicantPage, applicant);
    const applied = await applicantPage.request.post(`${groupPath}/requests`, { data: {}, headers });
    await expect(applied).toBeOK();
    const { id: requestId } = await applied.json();

    await expect(dot).toBeVisible();
    await expect(requests).toHaveCount(0);
    await options.click();
    await expect(dot).toHaveCount(0);
    await expect(requests).toHaveCount(1);
    await expect(requests).toHaveText(/Solicitudes\s*1/);
    await page.mouse.click(20, 400);
    await expect(dot).toBeVisible();
    await options.click();
    await expect(dot).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dot).toBeVisible();
    await expect(options).toBeFocused();

    await expect(await page.request.post(`${groupPath}/requests/${requestId}/accept`, { headers })).toBeOK();
    await expect(dot).toHaveCount(0);
    await options.click();
    await expect(requests).toHaveText("Solicitudes");
  } finally {
    await applicantPage.close();
  }
});

test("silenciar y reactivar guarda el estado y un error conserva la opción anterior", async ({ page, baseURL }) => {
  const owner = await createAccount(baseURL!, "Ana Avisos");
  const headers = { Origin: baseURL! };
  await signIn(page, owner);
  const created = await page.request.post("/api/groups", { data: { name: "Grupo de avisos" }, headers });
  await expect(created).toBeOK();
  const { id } = await created.json();
  const chat = `/grupos/${id}`;
  const endpoint = `**/api/groups/${id}/notifications`;

  await page.goto(chat);
  const options = page.getByRole("button", { name: /^Opciones del grupo/ });
  const mute = page.getByRole("button", { name: "Silenciar notificaciones" });
  const unmute = page.getByRole("button", { name: "Reactivar notificaciones" });
  await options.click();
  await mute.click();
  await expect(unmute).toBeVisible();
  await page.reload();
  await options.click();
  await expect(unmute).toBeVisible();

  await page.route(endpoint, (route) => route.fulfill({ status: 500, json: {} }));
  await unmute.click();
  await expect(page.getByText("No se pudieron cambiar los avisos. Probá de nuevo.")).toBeVisible();
  await expect(unmute).toBeVisible();
  await page.unroute(endpoint);

  await unmute.click();
  await expect(mute).toBeVisible();
  await page.reload();
  await options.click();
  await expect(mute).toBeVisible();
});

test("el acceso a solicitudes se habilita al pasar de miembro a moderador", async ({ page, browser, baseURL }) => {
  const owner = await createAccount(baseURL!, "Ana Permisos");
  const member = await createAccount(baseURL!, "Sol Permisos");
  const headers = { Origin: baseURL! };
  await signIn(page, owner);
  const created = await page.request.post("/api/groups", { data: { name: "Grupo de permisos" }, headers });
  await expect(created).toBeOK();
  const { id } = await created.json();
  const chat = `/grupos/${id}`;
  const groupPath = `/api/groups/${id}`;

  const memberPage = await browser.newPage({ baseURL });
  try {
    await signIn(memberPage, member);
    const session = await memberPage.request.get("/api/auth/get-session");
    await expect(session).toBeOK();
    const { user } = await session.json();
    const applied = await memberPage.request.post(`${groupPath}/requests`, { data: {}, headers });
    await expect(applied).toBeOK();
    const { id: requestId } = await applied.json();
    await expect(await page.request.post(`${groupPath}/requests/${requestId}/accept`, { headers })).toBeOK();

    const requests = memberPage.getByRole("link", { name: "Solicitudes", exact: true });
    const options = memberPage.getByRole("button", { name: /^Opciones del grupo/ });
    await memberPage.goto(`${chat}/info`);
    await expect(memberPage.getByRole("heading", { name: "Grupo de permisos" })).toBeVisible();
    await options.click();
    await expect(requests).toHaveCount(0);
    await memberPage.goto(`${chat}/solicitudes`);
    await expect(memberPage).toHaveURL(new URL(chat, baseURL!).href);
    await options.click();
    await expect(memberPage.getByRole("link", { name: "Ver detalles" })).toBeVisible();
    await expect(requests).toHaveCount(0);

    await expect(await page.request.patch(`${groupPath}/members/${user.id}`, {
      data: { role: "moderator" }, headers,
    })).toBeOK();
    await expect(requests).toBeVisible();
    await requests.click();
    await expect(memberPage.getByText("No hay solicitudes pendientes.")).toBeVisible();
    await memberPage.getByRole("button", { name: "Volver", exact: true }).click();
    await expect(memberPage).toHaveURL(new URL(chat, baseURL!).href);
    await memberPage.goto(`${chat}/info`);
    await options.click();
    await expect(requests).toBeVisible();
    await expect(memberPage.getByRole("link", { name: "Editar grupo" })).toHaveCount(0);
    await memberPage.getByRole("link", { name: "Invitaciones", exact: true }).click();
    await expect(memberPage.getByRole("heading", { name: "Invitaciones", exact: true })).toBeVisible();
    await expect(memberPage.getByRole("button", { name: "Invitar gente" })).toBeVisible();
  } finally {
    await memberPage.close();
  }
});
