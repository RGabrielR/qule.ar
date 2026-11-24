import { expect, test } from "@playwright/test";
import { createAccount } from "./fixtures";

test.use({ hasTouch: true, serviceWorkers: "block" });

test("los usuarios de X e Instagram se validan, se publican y se pueden quitar", async ({ page, baseURL }) => {
  const account = await createAccount(baseURL!, "Perfil X");
  await page.setViewportSize({ width: 375, height: 812 });
  const session = await page.request.post("/api/auth/sign-in/email", {
    headers: { Origin: baseURL! }, data: { email: account.email, password: account.password },
  });
  await expect(session).toBeOK();
  await page.goto("/yo/editar");
  const field = page.getByRole("textbox", { name: "Usuario de X" });
  await field.pressSequentially("ana maria");
  await expect(field).toHaveValue("ana maria");
  await field.evaluate((input) => {
    const editor = input.closest<HTMLElement>(".profile-editor")!;
    editor.scrollTop += input.getBoundingClientRect().bottom - 650;
  });
  await page.setViewportSize({ width: 375, height: 490 });
  await expect(field).toBeInViewport({ ratio: 1 });
  // Con el teclado abierto se esconde la barra de abajo (#193): el campo tiene que quedar entero dentro del editor
  await expect.poll(() => field.evaluate((el) =>
    el.getBoundingClientRect().bottom - el.closest(".profile-editor")!.getBoundingClientRect().bottom,
  )).toBeLessThanOrEqual(0.5);
  await expect(page.locator(".tabbar")).toBeHidden();
  const editor = page.locator(".profile-editor");
  const scroll = await editor.evaluate((el) => el.scrollTop);
  await page.getByRole("textbox", { name: "Sobre mí" }).focus();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await editor.evaluate((el) => el.scrollTop)).toBe(scroll);
  await page.setViewportSize({ width: 375, height: 812 });
  await field.blur();
  expect(await field.evaluate((input: HTMLInputElement) => input.validity.patternMismatch)).toBe(true);
  for (const xUsername of ["a".repeat(16), "https://x.com/a", "otro/test", "<b>", "x\ny"]) {
    const response = await page.request.put("/api/me/profile", {
      headers: { Origin: baseURL! }, data: { displayName: account.name, xUsername },
    });
    expect(response.status()).toBe(400);
  }
  const instagram = page.getByRole("textbox", { name: "Usuario de Instagram" });
  await instagram.fill("dos..puntos");
  expect(await instagram.evaluate((input: HTMLInputElement) => input.validity.patternMismatch)).toBe(true);
  await field.fill("");
  await page.getByRole("button", { name: "Guardar cambios" }).tap();
  await expect(instagram).toBeFocused();
  await expect(page.locator("#instagramUsername-error")).toBeVisible();
  await instagram.fill("@mi.cuenta");
  await expect(instagram).toHaveValue("mi.cuenta");
  for (const instagramUsername of ["a".repeat(31), "https://otra.web", "@cuenta", "dos..puntos", ".inicio", "fin.", "<b>"]) {
    const response = await page.request.put("/api/me/profile", {
      headers: { Origin: baseURL! }, data: { displayName: account.name, instagramUsername },
    });
    expect(response.status()).toBe(400);
  }
  const instagramUsername = "gyjp_" + "w".repeat(21) + ".a_1";
  await instagram.fill("@" + instagramUsername);
  await expect(instagram).toHaveValue(instagramUsername);
  const instagramLink = page.getByRole("link", { name: `Abrir @${instagramUsername} en Instagram` });
  const handle = "Pipy_g";
  await field.fill("  " + handle + "  ");
  await instagram.focus();
  await page.setViewportSize({ width: 375, height: 490 });
  const save = page.getByRole("button", { name: "Guardar cambios" });
  const saved = page.waitForResponse((response) =>
    response.url().endsWith("/api/me/profile") && response.request().method() === "PUT");
  await save.tap();
  expect((await saved).ok()).toBe(true);
  await expect(page).toHaveURL(/\/yo$/);
  await page.setViewportSize({ width: 375, height: 812 });
  const link = page.getByRole("link", { name: `Abrir @${handle} en X` });
  await expect(link).toHaveText(handle);
  await expect(instagramLink).toHaveText(instagramUsername);
  await expect(link).toHaveAttribute("href", `https://x.com/${handle}`);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(instagramLink).toHaveAttribute("href", `https://www.instagram.com/${instagramUsername}/`);
  await expect(instagramLink).toHaveAttribute("target", "_blank");
  expect((await link.boundingBox())!.y).toBe((await instagramLink.boundingBox())!.y);
  const { user } = await (await page.request.get("/api/me")).json();
  await page.evaluate(() => localStorage.setItem("mortero:tema", "penumbra"));
  await page.goto(`/perfil/${user.id}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "penumbra");
  await link.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await expect(link).toBeInViewport({ ratio: 1 });
  await instagramLink.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await expect(instagramLink).toBeInViewport({ ratio: 1 });
  const xBox = await link.boundingBox();
  const instagramBox = await instagramLink.boundingBox();
  expect(xBox!.y).toBe(instagramBox!.y);
  const label = instagramLink.locator(".profile__handle");
  await expect(label).toHaveCSS("text-overflow", "ellipsis");
  expect(await label.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await instagramLink.evaluate((el) => el.getBoundingClientRect().width > el.parentElement!.clientWidth / 2)).toBe(true);
  for (const button of [link, instagramLink]) {
    const alignment = await button.evaluate((el) => {
      const bounds = el.getBoundingClientRect();
      const icon = el.querySelector("svg")!.getBoundingClientRect();
      const text = el.querySelector(".profile__handle")!.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el.querySelector(".profile__handle")!);
      const glyphs = range.getBoundingClientRect();
      return {
        topSpace: glyphs.top - text.top,
        bottomSpace: text.bottom - glyphs.bottom,
        horizontal: Math.abs((icon.left - bounds.left) - (bounds.right - text.right)),
        vertical: Math.abs((icon.y + icon.height / 2) - (text.y + text.height / 2)),
      };
    });
    expect(alignment.topSpace).toBeGreaterThanOrEqual(0);
    expect(alignment.bottomSpace).toBeGreaterThanOrEqual(0);
    expect(alignment.horizontal).toBeLessThanOrEqual(1);
    expect(alignment.vertical).toBeLessThanOrEqual(1);
  }
  await page.goto("/yo/editar");
  await expect(instagram).toHaveValue(instagramUsername);
  await instagram.fill("luz");
  await save.tap();
  const shortInstagram = page.getByRole("link", { name: "Abrir @luz en Instagram" });
  await expect(shortInstagram).toBeVisible();
  for (const button of [link, shortInstagram]) {
    expect(await button.evaluate((el) => el.clientWidth < el.parentElement!.clientWidth / 2)).toBe(true);
  }
  await page.goto("/yo/editar");
  await instagram.fill("");
  await expect(field).toHaveValue(handle);
  await field.fill("");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page).toHaveURL(/\/yo$/);
  await page.reload();
  await expect(page.getByRole("link", { name: "Editar perfil" })).toBeVisible();
  await expect(link).toHaveCount(0);
  await expect(shortInstagram).toHaveCount(0);
});
