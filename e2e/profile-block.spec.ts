import { expect, test } from "@playwright/test";
import { createAccount, openProfile, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 } });

test("bloquear desde el perfil pide confirmación en la hoja de abajo, como en Mensajes", async ({ page, baseURL }) => {
  const me = await createAccount(baseURL!, "Bloquea Perfil");
  const other = await createAccount(baseURL!, "Bloqueada Perfil");
  await signIn(page, me);
  await openProfile(page, other);

  await page.getByRole("button", { name: "Bloquear", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: `¿Bloquear a ${other.name}?` });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Cancelar" }).click();
  await expect(sheet).toHaveCount(0);

  await page.getByRole("button", { name: "Bloquear", exact: true }).click();
  await sheet.getByRole("button", { name: "Bloquear" }).click();
  await expect(page).not.toHaveURL(/\/perfil\//);
  const blocked = await (await page.request.get("/api/blocks/page?q=&offset=0")).json() as { people: { name: string }[] };
  expect(blocked.people.map((p) => p.name)).toContain(other.name);
});
