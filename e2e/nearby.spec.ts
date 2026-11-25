import { expect, test } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

test("Atrás cierra los filtros de Gente antes de volver a la sección anterior", async ({ page, baseURL }) => {
  await signIn(page, await createAccount(baseURL!, "Andrea Filtros"));
  const tabs = page.getByRole("navigation", { name: "Secciones" });
  await tabs.getByRole("link", { name: "Yo", exact: true }).tap();
  await tabs.getByRole("link", { name: "Gente", exact: true }).tap();

  const filters = page.getByRole("button", { name: /^Filtros/ });
  const sheet = page.getByRole("dialog", { name: "Filtros" });
  const withPhoto = sheet.getByRole("checkbox", { name: "Solo con foto" });

  await filters.tap();
  await withPhoto.check();
  await page.goBack();
  await expect(page).toHaveURL(/\/cerca$/);
  await expect(sheet).toBeHidden();
  await expect(filters).toBeFocused();

  await filters.tap();
  await expect(withPhoto).not.toBeChecked();
  await sheet.getByRole("button", { name: "Cancelar" }).tap();
  await expect(sheet).toBeHidden();

  await filters.tap();
  await withPhoto.check();
  await sheet.getByRole("button", { name: "Aplicar" }).tap();
  await expect(sheet).toBeHidden();
  await expect(filters).toHaveText("Filtros · 1");

  await page.goBack();
  await expect(page).toHaveURL(/\/yo$/);
});

for (const [width, columns] of [[375, 3], [650, 4]]) {
  test(`Ver más completa las filas de ${columns} y muestra los perfiles que quedan al final`, async ({ page, baseURL }) => {
    const account = await createAccount(baseURL!, "Andrea Grilla");
    await page.setViewportSize({ width, height: 812 });
    await page.addInitScript(() => localStorage.setItem("mortero:avisos-oculto", String(Date.now())));
    const people = Array.from({ length: 125 }, (_, i) => ({
      id: `demo-${i}`, name: `Perfil ${i + 1}`, age: 30, photo: null,
      online: false, recent: false, favorite: false, distance: null,
    }));
    // Simula un perfil de la primera tanda que se movió después de cargarla.
    const reordered = [...people.slice(0, 60), people[59], ...people.slice(60)];
    const requests: { offset: number; limit: number }[] = [];
    await page.route(/\/api\/nearby\?/, async (route) => {
      const query = new URL(route.request().url()).searchParams;
      const offset = Number(query.get("offset"));
      const limit = Number(query.get("limit"));
      requests.push({ offset, limit });
      const end = offset + limit;
      await route.fulfill({ json: {
        hasLocation: false,
        people: reordered.slice(offset, end),
        nextOffset: end < reordered.length ? end : null,
      } });
    });
    await signIn(page, account);
    const grid = page.locator(".nearby-page .grid");
    const profiles = grid.getByRole("link");
    const more = page.getByRole("button", { name: "Ver más" });
    await expect(profiles).toHaveCount(60);
    expect(await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(columns);
    await more.tap();
    await expect(profiles).toHaveCount(120);
    await expect(profiles.nth(119)).toHaveAccessibleName("Perfil 120, 30");
    expect(requests).toContainEqual({ offset: 120, limit: 1 });
    await more.tap();
    await expect(profiles).toHaveCount(125);
    await expect(more).toBeHidden();
    await expect(profiles.nth(124)).toHaveAccessibleName("Perfil 125, 30");
  });
}
