import { expect, test } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 }, serviceWorkers: "block" });

for (const theme of ["oscuro", "penumbra"] as const) {
  test(`crea y edita etiquetas de grupos y las combina con la búsqueda (${theme})`, async ({ page, baseURL }) => {
    const owner = await createAccount(baseURL!, "Dueño de grupos");
    await page.addInitScript((mode) => {
      localStorage.setItem("mortero:tema", mode);
      localStorage.setItem("mortero:avisos-oculto", String(Date.now()));
    }, theme);
    await signIn(page, owner);
    const prefix = `Etiquetas ${theme}`;
    const tagged = `${prefix} encuentro`;
    const other = `${prefix} charla`;
    const headers = { Origin: baseURL! };
    await expect(await page.request.post("/api/groups", { headers, data: { name: other, tags: ["#charlar"] } })).toBeOK();
    expect((await page.request.post("/api/groups", { headers, data: { name: "Etiqueta externa", tags: ["#inventada"] } })).status()).toBe(400);

    await page.goto("/grupos");
    expect(await page.locator("html").getAttribute("data-theme")).toBe(theme === "penumbra" ? theme : null);
    await page.getByRole("button", { name: "Crear", exact: true }).click();
    const create = page.getByRole("dialog", { name: "Crear un grupo" });
    await create.getByRole("textbox", { name: "Nombre" }).fill(tagged);
    await create.getByText("Etiquetas del grupo", { exact: true }).click();
    await create.getByRole("button", { name: "#amistad", exact: true }).click();
    await create.getByRole("button", { name: "#atletico", exact: true }).click();
    await create.getByRole("button", { name: "Crear grupo", exact: true }).click();
    await expect(page).toHaveURL(/\/grupos\/[^/?]+$/);
    const groupPath = new URL(page.url()).pathname;
    await page.goto(`${groupPath}/editar`);
    await page.getByText("Etiquetas del grupo", { exact: true }).click();
    await expect(page.getByRole("button", { name: "#atletico", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "#atletico", exact: true }).click();
    await page.getByRole("button", { name: "#charlar", exact: true }).click();
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByRole("button", { name: "Guardado", exact: true })).toBeVisible();

    await page.goto("/grupos?ver=todos");
    const search = page.getByRole("searchbox", { name: "Buscar grupos" });
    await search.fill(prefix);
    const filter = page.getByRole("button", { name: /^Filtrar por etiquetas/ });
    await expect(filter).toBeVisible();
    expect((await filter.boundingBox())!.x).toBeGreaterThan((await search.boundingBox())!.x);
    await expect(page.getByRole("link", { name: new RegExp(other) })).toBeVisible();
    await filter.click();
    const sheet = page.getByRole("dialog", { name: "Filtrar por etiquetas" });
    for (const tag of ["#tiene-lugar", "#edad", "#altura", "#peso", "#en-linea", "#favoritos", "#con-foto"]) {
      await expect(sheet.getByRole("button", { name: tag, exact: true })).toHaveCount(1);
    }
    await sheet.getByRole("button", { name: "#charlar", exact: true }).click();
    await sheet.getByRole("button", { name: "#amistad", exact: true }).click();
    await sheet.getByRole("button", { name: "Aplicar", exact: true }).click();
    await expect(filter).toHaveAccessibleName("Filtrar por etiquetas · 2");
    const taggedLink = page.getByRole("link", { name: new RegExp(tagged) });
    await expect(taggedLink).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(other) })).toHaveCount(0);

    await taggedLink.click();
    await expect(page.getByRole("heading", { name: "Sobre el grupo" })).toBeVisible();
    await expect(page.getByText("#amistad #charlar", { exact: true })).toBeVisible();
    await page.goBack();
    await expect(search).toHaveValue(prefix);
    await expect(filter).toHaveAccessibleName("Filtrar por etiquetas · 2");
  });
}
