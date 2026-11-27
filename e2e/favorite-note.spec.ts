import { expect, test } from "@playwright/test";
import { createAccount, openProfile, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 } });

test("nota privada en un favorito: se agrega desde el perfil, solo la ve quien la escribe y se va con el favorito", async ({ page, browser, baseURL }) => {
  const me = await createAccount(baseURL!, "Anota");
  const other = await createAccount(baseURL!, "Anotada");
  await signIn(page, me);
  await openProfile(page, other);
  const otherId = new URL(page.url()).pathname.split("/").pop()!;
  const headers = { Origin: baseURL! };

  // Sin favorito no hay nota
  await expect(page.getByRole("button", { name: /Agregar una nota/ })).toHaveCount(0);
  expect((await page.request.put(`/api/favorites/${otherId}/note`, { headers, data: { note: "x" } })).status()).toBe(404);

  await page.getByRole("button", { name: "Agregar a favoritos" }).click();
  await page.getByRole("button", { name: /Agregar una nota/ }).click();
  await page.getByRole("textbox", { name: "Tu nota" }).fill("La conocí en la feria del libro");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("La conocí en la feria del libro")).toBeVisible();

  // Larga de más, no se guarda
  expect((await page.request.put(`/api/favorites/${otherId}/note`, { headers, data: { note: "a".repeat(301) } })).status()).toBe(400);

  // Al volver a entrar sigue ahí; la otra persona no la ve
  await page.reload();
  await expect(page.getByText("La conocí en la feria del libro")).toBeVisible();
  const otherPage = await browser.newPage({ baseURL });
  try {
    await signIn(otherPage, other);
    const myId = (await (await page.request.get("/api/me")).json()).user.id as string;
    const seen = await (await otherPage.request.get(`/api/users/${myId}`)).json() as { favoriteNote: string | null };
    expect(seen.favoriteNote).toBeNull();
  } finally {
    await otherPage.close();
  }

  // Sacarla de favoritos borra la nota
  await page.getByRole("button", { name: "Sacar de favoritos" }).click();
  await expect(page.getByText("La conocí en la feria del libro")).toHaveCount(0);
  await expect.poll(async () => ((await (await page.request.get(`/api/users/${otherId}`)).json()) as { favoriteNote: string | null }).favoriteNote).toBeNull();
});
