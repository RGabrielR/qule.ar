import { expect, test } from "@playwright/test";
import { createAccount, openProfile, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 } });

test("marcar un favorito desde su perfil pone la estrellita en Mensajes sin volver a pedir la bandeja", async ({ page, browser, baseURL }) => {
  const me = await createAccount(baseURL!, "Fede Favoritos");
  const other = await createAccount(baseURL!, "Nico Estrella");
  await signIn(page, me);
  const myId = (await (await page.request.get("/api/me")).json()).user.id as string;

  const otherPage = await browser.newPage({ baseURL });
  try {
    await signIn(otherPage, other);
    const headers = { Origin: baseURL! };
    const chat = await otherPage.request.post("/api/conversations", { headers, data: { userId: myId } });
    await expect(chat).toBeOK();
    const { id } = await chat.json();
    await expect(await otherPage.request.post(`/api/conversations/${id}/messages`, { headers, data: { body: "Hola" } })).toBeOK();
  } finally {
    await otherPage.close();
  }

  const tabs = page.getByRole("navigation", { name: "Secciones" });
  const plain = page.getByRole("link", { name: `Ver perfil de ${other.name}`, exact: true });
  const starred = page.getByRole("link", { name: `Ver perfil de ${other.name}, en favoritos`, exact: true });
  await tabs.getByRole("link", { name: /^Mensajes/ }).click();
  await expect(plain).toBeVisible();

  // Desde el perfil (al que se llega desde Gente): la bandeja ya cargada se actualiza sola
  const inboxLoads: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/conversations") inboxLoads.push(request.url());
  });
  await openProfile(page, other);
  await page.getByRole("button", { name: "Agregar a favoritos" }).click();
  await expect(page.getByRole("button", { name: "Sacar de favoritos" })).toBeVisible();
  await tabs.getByRole("link", { name: /^Mensajes/ }).click();
  await expect(starred).toBeVisible();

  // Desde Favoritos, que abre el mismo perfil: al sacarlo, la estrellita se va
  await tabs.getByRole("link", { name: "Yo", exact: true }).click();
  await page.getByRole("link", { name: "Favoritos", exact: true }).click();
  await page.getByRole("link", { name: other.name, exact: true }).click();
  await page.getByRole("button", { name: "Sacar de favoritos" }).click();
  await expect(page.getByRole("button", { name: "Agregar a favoritos" })).toBeVisible();
  await tabs.getByRole("link", { name: /^Mensajes/ }).click();
  await expect(plain).toBeVisible();
  expect(inboxLoads).toEqual([]);
});
