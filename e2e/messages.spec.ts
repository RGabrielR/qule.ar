import { expect, test } from "@playwright/test";
import { createAccount, openProfile, signIn } from "./fixtures";

test("entrega un mensaje a otra sesión y lo conserva al reabrir el chat", async ({ page, browser, baseURL }) => {
  const sender = await createAccount(baseURL!, "Camila Mensajes");
  const recipient = await createAccount(baseURL!, "Daniela Mensajes");
  const recipientContext = await browser.newContext({ baseURL });
  try {
    const recipientPage = await recipientContext.newPage();
    await signIn(recipientPage, recipient);
    const inbox = recipientPage.getByRole("link", { name: "Mensajes", exact: true });
    await inbox.click();
    const conversation = recipientPage.getByRole("link", { name: new RegExp(sender.name) });
    await expect(recipientPage.getByText("Sin mensajes por ahora", { exact: true })).toBeVisible();

    await signIn(page, sender);
    await openProfile(page, recipient);
    await page.getByRole("button", { name: "Mandar mensaje" }).click();
    const message = "Hola, este mensaje se tiene que guardar.";
    await page.getByRole("textbox", { name: "Mensaje", exact: true }).fill(message);
    await page.getByRole("button", { name: "Mandar", exact: true }).click();

    await expect(conversation.getByText(message, { exact: true })).toBeVisible();
    await conversation.click();
    await expect(recipientPage.getByText(message, { exact: true })).toBeVisible();
    await recipientPage.goBack();
    await recipientPage.reload();
    await conversation.click();
    await expect(recipientPage.getByText(message, { exact: true })).toBeVisible();
  } finally {
    await recipientContext.close();
  }
});
