import { expect, test } from "@playwright/test";
import { createAccount, openProfile, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 } });

test("los enlaces permitidos en grupos se abren fuera del chat al tocarlos", async ({ page, context, baseURL }) => {
  const sender = await createAccount(baseURL!, "Ana Enlaces");
  await signIn(page, sender);
  const headers = { Origin: baseURL! };
  const created = await page.request.post("/api/groups", {
    data: { name: "Grupo de enlaces" }, headers,
  });
  await expect(created).toBeOK();
  const { id } = await created.json();
  const group = await page.request.get(`/api/groups/${id}`);
  await expect(group).toBeOK();
  const { rules } = await group.json();
  await expect(await page.request.patch(`/api/groups/${id}`, {
    data: { rules: { ...rules, newAccountHours: 0 } }, headers,
  })).toBeOK();

  const destination = "https://example.test/guia_(grupo)";
  const body = `Mirá (${destination}), o www.example.test/otra.\nEl texto sigue: javascript:alert(1).`;
  let requests = 0;
  await context.route("https://example.test/**", async (route) => {
    requests++;
    await route.fulfill({ contentType: "text/html; charset=utf-8", body: "<h1>Página externa</h1>" });
  });

  await expect(await page.request.post(`/api/groups/${id}/messages`, { data: { body }, headers })).toBeOK();
  const path = `/grupos/${id}`;
  await page.goto(path);
  const message = page.getByRole("log").getByText("El texto sigue:", { exact: false });
  const external = message.getByRole("link", { name: destination, exact: true });
  const www = message.getByRole("link", { name: "www.example.test/otra", exact: true });
  await expect(message).toHaveCount(1);
  expect(await message.textContent()).toBe(body);
  await expect(message.getByRole("link")).toHaveCount(2);
  await expect(external).toHaveAttribute("href", destination);
  await expect(external).toHaveAttribute("target", "_blank");
  await expect(external).toHaveAttribute("rel", "noopener noreferrer");
  await expect(www).toHaveAttribute("href", "https://www.example.test/otra");
  expect(requests).toBe(0);

  const popupPromise = page.waitForEvent("popup");
  await external.click();
  const popup = await popupPromise;
  await expect(popup.getByRole("heading", { name: "Página externa" })).toBeVisible();
  await expect(page).toHaveURL(new URL(path, baseURL!).href);
  expect(requests).toBe(1);
  await popup.close();
});

test("los enlaces privados de una cuenta nueva se muestran como texto al llegar y en el historial", async ({ page, browser, baseURL }) => {
  const sender = await createAccount(baseURL!, "Ana Privados");
  const recipient = await createAccount(baseURL!, "Sol Privados");
  await signIn(page, sender);
  await openProfile(page, recipient);
  await page.getByRole("button", { name: "Mandar mensaje" }).click();
  await expect(page).toHaveURL(/\/mensajes\/[^/]+$/);
  const path = new URL(page.url()).pathname;
  const recipientContext = await browser.newContext({ baseURL, viewport: page.viewportSize() });
  try {
    const recipientPage = await recipientContext.newPage();
    await recipientPage.addInitScript(() => localStorage.setItem("mortero:tema", "penumbra"));
    await signIn(recipientPage, recipient);
    await recipientPage.goto(path);
    await expect(recipientPage.locator("html")).toHaveAttribute("data-theme", "penumbra");
    await expect(recipientPage.getByRole("link", { name: new RegExp(sender.name) })).toBeVisible();
    await expect(recipientPage.getByRole("log")).toBeVisible();

    const body = "Mirá https://example.test/guia o www.example.test/otra.";
    await page.getByRole("textbox", { name: "Mensaje", exact: true }).fill(body);
    await page.getByRole("button", { name: "Mandar", exact: true }).click();
    for (const chat of [page, recipientPage]) {
      const message = chat.getByRole("log").getByText(body, { exact: true });
      await expect(message).toBeVisible();
      await expect(message.getByRole("link")).toHaveCount(0);
    }

    await recipientPage.reload();
    const stored = recipientPage.getByRole("log").getByText(body, { exact: true });
    await expect(stored).toBeVisible();
    await expect(stored.getByRole("link")).toHaveCount(0);
  } finally {
    await recipientContext.close();
  }
});
