import { expect, test } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 } });

test("Mis grupos conserva el orden personal al recargar y permite restablecerlo", async ({ page, baseURL }) => {
  const owner = await createAccount(baseURL!, "Lea Orden");
  await signIn(page, owner);
  const headers = { Origin: baseURL! };
  for (const name of ["Alfa Orden", "Zulu Orden"]) {
    await expect(await page.request.post("/api/groups", { data: { name }, headers })).toBeOK();
  }
  await page.goto("/grupos");
  const groups = page.locator(".glist a.gcard");
  await expect(groups.nth(1)).toContainText("Alfa Orden");
  await page.getByRole("button", { name: "Reordenar mis grupos" }).click();
  await page.getByRole("button", { name: "Subir Zulu Orden" }).click();
  await expect(groups.nth(1)).toContainText("Zulu Orden");
  await page.getByRole("button", { name: "Listo", exact: true }).click();
  await page.reload();
  await expect(groups.nth(1)).toContainText("Zulu Orden");
  await page.getByRole("button", { name: "Reordenar mis grupos" }).click();
  await page.getByRole("button", { name: "Restablecer orden" }).click();
  await expect(groups.nth(1)).toContainText("Alfa Orden");
});
