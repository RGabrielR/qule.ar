import { expect, test } from "@playwright/test";
import { createAccount, openProfile, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 } });

test("la pulsación larga abre las reacciones sin interferir con toques breves", async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "vibrate", {
      value: (duration: number) => {
        document.documentElement.dataset.testVibration = String(duration);
        return true;
      },
      configurable: true,
    });
  });
  const owner = await createAccount(baseURL!, "Ana Pulsa");
  const recipient = await createAccount(baseURL!, "Sol Pulsa");
  await signIn(page, owner);
  await openProfile(page, recipient);
  await page.getByRole("button", { name: "Mandar mensaje" }).click();
  await expect(page).toHaveURL(/\/mensajes\/[^/]+$/);
  const privateChat = page.url();
  const created = await page.request.post("/api/groups", {
    data: { name: "Grupo de reacciones" }, headers: { Origin: baseURL! },
  });
  await expect(created).toBeOK();
  const { id } = await created.json();

  await page.clock.install();
  const touch = await page.context().newCDPSession(page);
  for (const path of [privateChat, `/grupos/${id}`]) {
    await page.goto(path);
    const composer = page.locator(".composer").getByRole("textbox");
    await composer.fill("Mensaje para probar la pulsación");
    await page.getByRole("button", { name: "Mandar", exact: true }).click();
    const message = page.locator(".message-gesture").filter({ hasText: "Mensaje para probar la pulsación" });
    const menu = message.getByRole("menu");
    const picker = menu.getByRole("group", { name: "Reaccionar" });
    await expect(message).toBeVisible();
    await expect(message.getByRole("button", { name: /opciones del mensaje/i })).toHaveCount(0);

    const body = message.getByText("Mensaje para probar la pulsación", { exact: true });
    await expect(body).toHaveCSS("user-select", "none");
    await expect(message.locator("time")).toHaveCSS("user-select", "none");
    await body.click();
    await page.clock.runFor(550);
    await expect(menu).toHaveCount(0);
    const box = (await body.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 20, y);
    await page.clock.runFor(550);
    await page.mouse.up();
    await expect(menu).toHaveCount(0);

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.clock.runFor(550);
    await expect(picker).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-test-vibration", "15");
    await expect(picker.getByRole("button").first().locator("img")).toHaveCSS("user-select", "none");
    await expect(menu.getByRole("menuitem").first()).toHaveCSS("user-select", "none");
    await page.mouse.up();
    await expect(picker).toBeVisible();
    await picker.getByRole("button").first().click();
    await expect(menu).toHaveCount(0);
    await expect(message.locator(".reaction-chip")).toBeVisible();

    await message.focus();
    await page.keyboard.press("Shift+F10");
    await expect(picker).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(message).toBeFocused();
    const touchBox = (await body.boundingBox())!;
    const touchPoint = { x: touchBox.x + touchBox.width / 2, y: touchBox.y + touchBox.height / 2 };
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await page.clock.runFor(550);
    await expect(menu).toHaveCount(0);

    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint] });
    await page.clock.runFor(550);
    await expect(picker).toBeVisible();
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(picker).toBeVisible();
  }
  await touch.detach();
});
