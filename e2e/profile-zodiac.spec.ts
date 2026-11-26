import { expect, test, type Page } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 } });

async function changeSign(page: Page, previous: string, next: string) {
  await page.getByRole("link", { name: "Editar perfil", exact: true }).click();
  const select = page.getByRole("combobox", { name: "Signo", exact: true });
  await expect(select).toHaveValue(previous);
  await select.selectOption(next);
  await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(page).toHaveURL(/\/yo$/);
}

test("permite elegir, cambiar y borrar el signo y filtrar perfiles en Gente", async ({ page, browser, baseURL }) => {
  const owner = await createAccount(baseURL!, "Ana Signo");
  const viewer = await createAccount(baseURL!, "Sol Signo");
  const unassigned = await createAccount(baseURL!, "Luz Sin Signo");
  await signIn(page, owner);
  await page.getByRole("link", { name: "Yo", exact: true }).click();
  await changeSign(page, "", "Géminis");
  await expect(page.getByText("Géminis", { exact: true })).toBeVisible();

  const viewerContext = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 } });
  try {
    const grid = await viewerContext.newPage();
    await grid.addInitScript(() => localStorage.setItem("mortero:tema", "penumbra"));
    await signIn(grid, viewer);
    await grid.goto("/gente");
    await expect(grid.locator("html")).toHaveAttribute("data-theme", "penumbra");
    const listedOwner = grid.getByRole("link", { name: new RegExp(`^${owner.name}(?:,|$)`) });
    const listedUnassigned = grid.getByRole("link", { name: new RegExp(`^${unassigned.name}(?:,|$)`) });
    await expect(listedUnassigned).toBeVisible();

    await grid.getByRole("button", { name: "Filtros", exact: true }).click();
    const filter = grid.getByRole("dialog", { name: "Filtros" });
    await filter.getByRole("button", { name: "Géminis", exact: true }).click();
    await filter.getByRole("button", { name: "Aplicar", exact: true }).click();
    await expect(listedOwner).toBeVisible();
    await expect(listedUnassigned).toHaveCount(0);
    await listedOwner.click();
    await expect(grid.getByText("Géminis", { exact: true })).toBeVisible();

    await changeSign(page, "Géminis", "Piscis");
    await expect(page.getByText("Piscis", { exact: true })).toBeVisible();
    await grid.goto("/gente");
    await expect(grid.getByRole("button", { name: "Filtros · 1", exact: true })).toBeVisible();
    await expect(listedOwner).toHaveCount(0);

    await grid.getByRole("button", { name: "Filtros · 1", exact: true }).click();
    await filter.getByRole("button", { name: "Piscis", exact: true }).click();
    await filter.getByRole("button", { name: "Aplicar", exact: true }).click();
    await expect(listedOwner).toBeVisible();

    await changeSign(page, "Piscis", "");
    await expect(page.getByText("Signo", { exact: true })).toHaveCount(0);
    await grid.reload();
    await grid.getByRole("button", { name: "Filtros · 1", exact: true }).click();
    await filter.getByRole("button", { name: "Limpiar", exact: true }).click();
    await filter.getByRole("button", { name: "Aplicar", exact: true }).click();
    await expect(listedOwner).toBeVisible();
    await expect(listedUnassigned).toBeVisible();
    await listedOwner.click();
    await expect(grid.getByRole("heading", { name: owner.name, exact: true })).toBeVisible();
    await expect(grid.getByText("Signo", { exact: true })).toHaveCount(0);
  } finally {
    await viewerContext.close();
  }
});
