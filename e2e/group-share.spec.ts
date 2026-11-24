import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

async function createGroup(page: Page, origin: string, name: string) {
  const owner = await createAccount(origin, "Dueño del grupo");
  await signIn(page, owner);
  const response = await page.request.post("/api/groups", { headers: { Origin: origin }, data: { name } });
  await expect(response).toBeOK();
  const { id } = await response.json();
  const path = `/grupos/${id}`;
  await page.goto(path);
  await page.getByRole("button", { name: "Opciones del grupo", exact: true }).tap();
  await page.getByRole("button", { name: "Compartir grupo", exact: true }).tap();
  return { id, url: new URL(path, origin).href };
}

test("comparte el grupo con el sistema y recupera el destino al iniciar sesión", async ({ page, browser, baseURL }) => {
  const origin = baseURL!;
  const account = await createAccount(origin, "Sol Grupo Compartido");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      value: async (data: ShareData) => {
        sessionStorage.setItem("test:share", JSON.stringify({ ...data, active: navigator.userActivation.isActive }));
      },
    });
  });
  const name = "Caminatas para compartir";
  const { id, url } = await createGroup(page, origin, name);
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("test:share") ?? "null")))
    .toEqual({ title: name, url, active: true });

  const recipient = await browser.newPage({ baseURL, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  try {
    await recipient.goto(url);
    await expect(recipient).toHaveURL(new URL(`/entrar?grupo=${id}`, origin).href);
    await recipient.reload();
    await recipient.getByRole("textbox", { name: "Email", exact: true }).fill(account.email);
    await recipient.getByLabel("Contraseña", { exact: true }).fill(account.password);
    await recipient.getByRole("button", { name: "Entrar", exact: true }).tap();
    await expect(recipient).toHaveURL(url);
    await expect(recipient.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(recipient.getByRole("log", { name: "Mensajes del grupo" })).toHaveCount(0);
    await recipient.getByRole("button", { name: "Pedir ingreso", exact: true }).tap();
    await recipient.getByRole("button", { name: "Mandar solicitud", exact: true }).tap();
    await expect(recipient.getByText("Solicitud enviada", { exact: true })).toBeVisible();
  } finally {
    await recipient.close();
  }
});

test("copia el enlace cuando hace falta y vuelve al grupo después de completar el registro", async ({ page, browser, baseURL }) => {
  const origin = baseURL!;
  await page.addInitScript(() => {
    localStorage.setItem("mortero:tema", "penumbra");
    Object.defineProperty(navigator, "share", { value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (url: string) => sessionStorage.setItem("test:clipboard", url) },
    });
  });
  const name = "Grupo compartido por enlace";
  const { id, url } = await createGroup(page, origin, name);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "penumbra");
  await expect(page.getByRole("status").getByText("Enlace copiado.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("test:clipboard"))).toBe(url);

  const recipient = await browser.newPage({ baseURL, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  try {
    await recipient.goto(url);
    await recipient.getByRole("tab", { name: "Crear cuenta", exact: true }).tap();
    await recipient.getByRole("textbox", { name: "Nombre", exact: true }).fill("Luz Enlace");
    await recipient.getByRole("textbox", { name: "Email", exact: true }).fill(`${randomUUID()}@example.test`);
    await recipient.getByLabel("Contraseña", { exact: true }).fill(randomUUID());
    await recipient.getByRole("button", { name: "Crear cuenta", exact: true }).tap();
    await expect(recipient).toHaveURL(new URL(`/bienvenida?grupo=${id}`, origin).href);
    await recipient.reload();
    await recipient.getByLabel(/Fecha de nacimiento/).fill("1990-01-01");
    await recipient.getByRole("checkbox", { name: /Confirmo que tengo 18/ }).check();
    await recipient.getByRole("button", { name: "Leer los Términos y condiciones" }).tap();
    await recipient.getByRole("checkbox", { name: /Leí los Términos/ }).check();
    await recipient.getByRole("button", { name: "Entrar a qule.ar", exact: true }).tap();
    await expect(recipient).toHaveURL(url);
    await expect(recipient.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(recipient.getByRole("button", { name: "Pedir ingreso", exact: true })).toBeVisible();
  } finally {
    await recipient.close();
  }
});
