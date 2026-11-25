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
  const viewChat = page.getByRole("link", { name: "Ver chat del grupo" });
  const requests = page.getByRole("link", { name: "Solicitudes 128" });
  await expect(viewChat).toBeInViewport();
  await expect(requests).toBeInViewport();
  const viewBox = (await viewChat.boundingBox())!;
  const requestsBox = (await requests.boundingBox())!;
  expect(requestsBox.x + requestsBox.width).toBeLessThanOrEqual(viewBox.x);
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
    await expect(requests).toBeVisible();
    await expect(viewChat).toHaveCount(0);
    await page.getByRole("button", { name: "Volver", exact: true }).click();
    await expect(detailsLink).toBeVisible();
    const box = (await target.boundingBox())!;
    const x = target === header ? 2 : box.width / 2;
    const y = target === header ? 2 : box.height / 2;
    await page.mouse.click(box.x + x, box.y + y);
  }

  await expect(page).toHaveURL(new URL(details, baseURL!).href);
  await page.getByRole("button", { name: "Volver", exact: true }).click();
  await page.getByRole("button", { name: "Volver a Grupos" }).click();
  await expect(page).toHaveURL(new URL("/grupos", baseURL!).href);
});
