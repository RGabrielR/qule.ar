import { expect, test } from "@playwright/test";
import { createAccount, openProfile, signIn } from "./fixtures";

test("mantener apretado un chat permite silenciar, eliminar, reportar y bloquear", async ({ page, browser, baseURL }) => {
  const receiver = await createAccount(baseURL!, "Alex Acciones");
  const sender = await createAccount(baseURL!, "Juli Acciones");
  const viewport = { width: 375, height: 720 };
  await page.setViewportSize(viewport);
  const mobile = await browser.newContext({ baseURL, viewport, isMobile: true, hasTouch: true });
  const headers = { Origin: baseURL! };
  try {
    const inbox = await mobile.newPage();
    await inbox.addInitScript(() => localStorage.setItem("mortero:tema", "penumbra"));
    await signIn(inbox, receiver);
    await inbox.getByRole("link", { name: "Mensajes", exact: true }).click();
    await signIn(page, sender);
    await openProfile(page, receiver);
    await page.getByRole("button", { name: "Mandar mensaje" }).click();
    await expect(page).toHaveURL(/\/mensajes\/[^/]+$/);
    const chatUrl = new URL(page.url()).pathname;
    const apiPath = chatUrl.replace("/mensajes/", "/api/conversations/");
    const send = (body: string) => page.request.post(`${apiPath}/messages`, { headers, data: { body } });
    const oldMessage = await send("Mensaje anterior");
    await expect(oldMessage).toBeOK();
    const { id: oldId } = await oldMessage.json();

    // La foto abre el perfil; el resto de la fila es el enlace al chat, con sus acciones
    const item = inbox.locator("a.inbox__item").filter({ hasText: sender.name });
    await expect(item).toBeVisible();
    await expect(inbox.getByRole("list").getByRole("button", { name: /Opciones del chat/ })).toHaveCount(0);
    await expect(inbox.locator("html")).toHaveAttribute("data-theme", "penumbra");
    const rect = (await item.boundingBox())!;
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const touch = await mobile.newCDPSession(inbox);
    const menu = inbox.getByRole("menu", { name: "Opciones del chat" });
    async function holdChat() {
      await item.scrollIntoViewIfNeeded();
      const box = (await item.boundingBox())!;
      const touchPoint = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint] });
      await inbox.clock.runFor(550);
      await expect(menu).toBeVisible();
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect(menu).toBeVisible();
    }

    await inbox.clock.install();
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await inbox.clock.runFor(550);
    await expect(menu).toHaveCount(0);

    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await inbox.clock.runFor(550);
    await expect(menu.getByRole("menuitem")).toHaveText(["Silenciar", "Vaciar chat", "Bloquear", "Reportar"]);
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(inbox).toHaveURL(/\/mensajes$/);
    await menu.getByRole("menuitem", { name: "Silenciar" }).tap();
    await expect(item.getByRole("img", { name: "Chat silenciado" })).toBeVisible();
    await expect(item.locator(".badge--inline")).toHaveText("1");
    expect(await (await page.request.get(`${apiPath}/summary`)).json()).toMatchObject({ muted: false });

    await page.goto("/mensajes");
    const senderItem = page.locator("a.inbox__item").filter({ hasText: receiver.name });
    const senderMenu = page.getByRole("menu", { name: "Opciones del chat" });
    await senderItem.click({ button: "right" });
    await expect(senderMenu).toHaveCount(0);
    await senderItem.press("Shift+F10");
    await expect(senderMenu.getByRole("menuitem")).toHaveText(["Silenciar", "Vaciar chat", "Bloquear", "Reportar"]);
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "penumbra");
    await page.keyboard.press("Escape");
    await expect(senderItem).toBeFocused();

    await inbox.reload();
    await expect(item.getByRole("img", { name: "Chat silenciado" })).toBeVisible();
    await item.press("Shift+F10");
    await expect(menu.getByRole("menuitem", { name: "Activar avisos" })).toBeFocused();
    await inbox.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(item).toBeFocused();

    await holdChat();
    await menu.getByRole("menuitem", { name: "Vaciar chat" }).tap();
    const remove = inbox.getByRole("dialog", { name: "¿Vaciar este chat?" });
    await remove.getByRole("button", { name: "Cancelar" }).tap();
    await expect(item).toBeVisible();
    await holdChat();
    await menu.getByRole("menuitem", { name: "Vaciar chat" }).tap();
    await remove.getByRole("button", { name: "Vaciar chat" }).tap();
    await expect(item).toHaveCount(0);
    expect(await (await mobile.request.get(`${apiPath}/messages`)).json()).toMatchObject({ messages: [] });
    const read = await mobile.request.post(`${apiPath}/read`, { headers, data: { messageIds: [oldId] } });
    expect(await read.json()).toMatchObject({ changed: false });
    expect(await (await page.request.get(`${apiPath}/messages`)).json()).toMatchObject({
      messages: [{ id: oldId, readAt: null }],
    });

    await expect(await send("Mensaje después de eliminar")).toBeOK();
    await expect(item).toContainText("Mensaje después de eliminar");
    await expect(item.locator(".badge--inline")).toHaveText("1");
    await expect(item.getByRole("img", { name: "Chat silenciado" })).toBeVisible();
    await item.tap();
    await expect(inbox).toHaveURL(new RegExp(chatUrl + "$"));
    await expect(inbox.getByText("Mensaje después de eliminar", { exact: true })).toBeVisible();
    await expect(inbox.getByText("Mensaje anterior", { exact: true })).toHaveCount(0);

    const headerMenu = inbox.getByRole("button", { name: "Opciones del chat" });
    await headerMenu.tap();
    await expect(menu.getByRole("menuitem")).toHaveText(["Activar avisos", "Vaciar chat", "Bloquear", "Reportar"]);
    await menu.getByRole("menuitem", { name: "Vaciar chat" }).tap();
    await remove.getByRole("button", { name: "Cancelar" }).tap();
    await expect(headerMenu).toBeFocused();
    await headerMenu.tap();
    await menu.getByRole("menuitem", { name: "Activar avisos" }).tap();
    await headerMenu.tap();
    await expect(menu.getByRole("menuitem", { name: "Silenciar", exact: true })).toBeVisible();
    await inbox.keyboard.press("Escape");
    await expect(headerMenu).toBeFocused();
    expect(await (await mobile.request.get(`${apiPath}/summary`)).json()).toMatchObject({ muted: false });
    await headerMenu.tap();
    await menu.getByRole("menuitem", { name: "Reportar" }).tap();
    const report = inbox.getByRole("dialog", { name: `Reportar a ${sender.name}` });
    await report.getByRole("button", { name: "spam", exact: true }).tap();
    await report.getByRole("button", { name: "Reportar", exact: true }).tap();
    await expect(inbox.getByRole("heading", { name: "Gracias por avisar" })).toBeVisible();
    await inbox.getByRole("button", { name: "Listo" }).tap();

    await headerMenu.tap();
    await menu.getByRole("menuitem", { name: "Bloquear" }).tap();
    const block = inbox.getByRole("dialog", { name: `¿Bloquear a ${sender.name}?` });
    await block.getByRole("button", { name: "Bloquear" }).tap();
    await expect(inbox).toHaveURL(/\/mensajes$/);
    await expect(item).toHaveCount(0);
    expect((await send("Mensaje bloqueado")).status()).toBe(404);
  } finally {
    await mobile.close();
  }
});
