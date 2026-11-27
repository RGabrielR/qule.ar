import { expect, request, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { createAccount, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });

type Account = Awaited<ReturnType<typeof createAccount>>;

async function addPhoto(baseURL: string, account: Account) {
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  try {
    await expect(await api.post("/api/auth/sign-in/email", { data: { email: account.email, password: account.password } })).toBeOK();
    const buffer = await sharp({ create: { width: 600, height: 750, channels: 3, background: "teal" } }).png().toBuffer();
    await expect(await api.post("/api/me/photos", { multipart: { file: { name: "foto.png", mimeType: "image/png", buffer } } })).toBeOK();
  } finally {
    await api.dispose();
  }
}

const tile = (page: Page, account: Account) => page.getByRole("link", { name: new RegExp(`^${account.name}(?:,|$)`) });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth);

for (const theme of ["oscuro", "penumbra"]) {
  test(`Gente tiene Todos, Nuevos y Toques; Nuevos muestra solo cuentas nuevas con foto (${theme}, 375 px)`, async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    const viewer = await createAccount(baseURL!, "Mira Pestañas");
    const withPhoto = await createAccount(baseURL!, "Nueva Con Foto");
    const noPhoto = await createAccount(baseURL!, "Nueva Sin Foto");
    await addPhoto(baseURL!, withPhoto);
    await page.addInitScript((value) => localStorage.setItem("mortero:tema", value), theme);
    await signIn(page, viewer);

    const tabs = page.getByRole("navigation", { name: "Vistas de Gente" });
    await expect(tabs.getByRole("link")).toHaveText(["Todos", "Nuevos", "Toques"]);
    await expect(tabs.getByRole("link", { name: "Todos" })).toHaveAttribute("aria-current", "page");

    // Todos: la grilla de siempre, con o sin foto
    await expect(tile(page, withPhoto)).toBeVisible();
    await expect(tile(page, noPhoto)).toBeVisible();

    // Nuevos: las cuentas recientes recién aparecen cuando suben una foto
    await tabs.getByRole("link", { name: "Nuevos" }).click();
    await expect(page).toHaveURL(/\/cerca\/nuevos$/);
    await expect(tabs.getByRole("link", { name: "Nuevos" })).toHaveAttribute("aria-current", "page");
    await expect(tile(page, withPhoto)).toBeVisible();
    await expect(tile(page, noPhoto)).toHaveCount(0);
    expect(await noSideScroll(page)).toBe(375);
    await page.screenshot({ path: test.info().outputPath(`gente-nuevos-${theme}.png`) });

    // Del perfil se vuelve a Nuevos, no a Todos
    await tile(page, withPhoto).click();
    await expect(page.getByRole("heading", { name: withPhoto.name, exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/cerca\/nuevos$/);
    await expect(tile(page, noPhoto)).toHaveCount(0);

    // Toques ya no está en Mi perfil: vive en Gente
    await page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: /^Yo/ }).click();
    const activity = page.getByRole("navigation", { name: "Tu actividad" });
    await expect(activity.getByRole("link", { name: "Quién me vio" })).toBeVisible();
    await expect(activity.getByRole("link", { name: /Toques/ })).toHaveCount(0);
    expect(await noSideScroll(page)).toBe(375);
    await page.screenshot({ path: test.info().outputPath(`mi-perfil-${theme}.png`) });
  });
}
