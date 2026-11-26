import { expect, request, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { createAccount, signIn } from "./fixtures";

// El servidor de las pruebas corre la cola con un detector de mentira (EXPLICIT_CHECK=test, ver e2e/server.mjs):
// marca como explícitas las fotos rojas. El modelo de verdad (NudeNet) no se usa en las pruebas.
test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });

type Account = Awaited<ReturnType<typeof createAccount>>;

async function addPhotos(baseURL: string, account: Account, colors: string[]) {
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  try {
    await expect(await api.post("/api/auth/sign-in/email", { data: { email: account.email, password: account.password } })).toBeOK();
    for (const background of colors) {
      const buffer = await sharp({ create: { width: 600, height: 750, channels: 3, background } }).png().toBuffer();
      await expect(await api.post("/api/me/photos", { multipart: { file: { name: "foto.png", mimeType: "image/png", buffer } } })).toBeOK();
    }
    // Espera a que la cola revise las fotos (la de prueba mira cada segundo)
    await expect.poll(async () => {
      const me = await (await api.get("/api/me")).json();
      return (me.photos as { explicit: boolean }[]).map((p) => p.explicit);
    }, { timeout: 15_000 }).toEqual(colors.map((c) => c === "red"));
  } finally {
    await api.dispose();
  }
}

const tile = (page: Page, account: Account) => page.getByRole("link", { name: new RegExp(`^${account.name}(?:,|$)`) });
/** El cartel de avisos queda fijo abajo y, con mucha gente en la grilla, puede tapar la foto que se quiere tocar. */
async function closeNotifyBanner(page: Page) {
  const banner = page.getByRole("region", { name: "Activar avisos" });
  if (await banner.isVisible()) await banner.getByRole("button", { name: "Ahora no" }).click();
  await expect(banner).toHaveCount(0);
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth);

for (const theme of ["oscuro", "penumbra"]) {
  test(`las fotos explícitas se ven borrosas para quien eligió taparlas (${theme}, 375 px)`, async ({ page, browser, baseURL }) => {
    // Son varias pantallas y dos cuentas: con toda la suite en paralelo, 30 s quedan justos
    test.setTimeout(60_000);
    const author = await createAccount(baseURL!, "Autor Fotos");
    const viewer = await createAccount(baseURL!, "Mira Tapado");
    await addPhotos(baseURL!, author, ["red", "orange"]);
    await page.addInitScript((value) => localStorage.setItem("mortero:tema", value), theme);

    // Cuenta nueva: la opción viene prendida. En la grilla, la foto del autor se ve borrosa.
    await signIn(page, viewer);
    const cell = tile(page, author);
    await expect(cell).toHaveAccessibleName(/foto tapada/);
    await expect(cell).toHaveClass(/tile--blur/);
    expect(await cell.locator("img").evaluate((img) => getComputedStyle(img).filter)).toContain("blur");
    await expect(page.getByRole("region", { name: "Tapar fotos explícitas" })).toHaveCount(0);
    expect(await noSideScroll(page)).toBe(375);

    // En el perfil sigue tapada, con "Ver foto". La segunda (naranja) no está tapada.
    await closeNotifyBanner(page);
    await cell.click();
    await expect(page.getByRole("heading", { name: author.name, exact: true })).toBeVisible();
    const cover = page.locator(".profile__photo");
    await expect(cover.locator(".profile__cover-media--blur")).toHaveCount(1);
    const reveal = cover.getByRole("button", { name: "Ver foto" });
    await expect(reveal).toBeVisible();
    expect(await noSideScroll(page)).toBe(375);
    await page.screenshot({ path: test.info().outputPath(`perfil-tapado-${theme}.png`) });
    await reveal.click();
    await expect(cover.locator(".profile__cover-media--blur")).toHaveCount(0);
    await expect(reveal).toHaveCount(0);
    await cover.getByRole("button", { name: "Foto siguiente" }).click();
    await expect(cover.locator(".profile__cover-media--blur")).toHaveCount(0);

    // Apagándola en Configuración, la grilla se ve normal (y la misma gente)
    await page.goto("/yo/configuracion");
    const option = page.getByRole("checkbox", { name: /Tapar fotos explícitas en la grilla/ });
    await expect(option).toBeChecked();
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/me/privacy") && r.request().method() === "PUT");
    await option.click();
    expect((await saved).ok()).toBe(true);
    await expect(option).not.toBeChecked();
    await page.getByRole("link", { name: "Gente", exact: true }).click();
    await expect(tile(page, author)).not.toHaveClass(/tile--blur/);

    // Quien la subió la ve normal, sabe que está tapada y puede pedir que la revisen
    const ownContext = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    try {
      const own = await ownContext.newPage();
      await own.addInitScript((value) => localStorage.setItem("mortero:tema", value), theme);
      await signIn(own, author);
      await own.goto("/yo/editar");
      await expect(own.getByText("Tapada", { exact: false }).first()).toBeVisible();
      await expect(own.locator(".photos__item img").first()).toBeVisible();
      expect(await own.locator(".photos__item img").first().evaluate((img) => getComputedStyle(img).filter)).toBe("none");
      await own.getByRole("button", { name: "Pedir revisión" }).click();
      await expect(own.getByText("Revisión pedida")).toBeVisible();
      expect(await noSideScroll(own)).toBe(375);
      await own.screenshot({ path: test.info().outputPath(`mis-fotos-${theme}.png`) });
    } finally {
      await ownContext.close();
    }
  });
}

test("a las cuentas que ya existían se les avisa que la opción existe (375 px)", async ({ page, baseURL }) => {
  const author = await createAccount(baseURL!, "Autor Aviso");
  const old = await createAccount(baseURL!, "Cuenta Vieja");
  await addPhotos(baseURL!, author, ["red"]);
  await signIn(page, old);
  // Como quedan las cuentas de antes de la migración: con la opción apagada
  await expect(await page.request.put("/api/me/privacy", { headers: { Origin: baseURL! }, data: { hideExplicit: false } })).toBeOK();
  await page.reload();
  await expect(tile(page, author)).not.toHaveClass(/tile--blur/);
  const notice = page.getByRole("region", { name: "Tapar fotos explícitas" });
  await expect(notice).toBeVisible();
  expect(await noSideScroll(page)).toBe(375);
  await page.screenshot({ path: test.info().outputPath("aviso-cuenta-vieja.png") });
  await notice.getByRole("button", { name: "Taparlas" }).click();
  await expect(notice).toHaveCount(0);
  await expect(tile(page, author)).toHaveClass(/tile--blur/);
});
