import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { createAccount, openProfile, signIn } from "./fixtures";

// Marca de agua con quién mira (idea de @Saantiames, discusión #155): va sobre los álbumes privados ajenos,
// nunca sobre los propios, y las fotos privadas se esconden cuando la app pierde el foco.
for (const theme of ["oscuro", "penumbra"]) {
  test(`marca de agua en el álbum ajeno y fotos escondidas al salir de la app (${theme}, 375 px)`, async ({ page, browser, baseURL }) => {
    const owner = await createAccount(baseURL!, "Dueño Marca");
    const viewer = await createAccount(baseURL!, "Mira Marca");
    const viewport = { width: 375, height: 760 };
    await page.setViewportSize(viewport);
    await page.addInitScript((t) => localStorage.setItem("mortero:tema", t), theme);
    const viewerContext = await browser.newContext({ baseURL, viewport });
    try {
      await signIn(page, owner);
      const photo = await sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: 214, g: 196, b: 170 } } }).png().toBuffer();
      await expect(await page.request.post("/api/me/photos", {
        multipart: { file: { name: "foto.png", mimeType: "image/png", buffer: photo }, private: "1" },
        headers: { Origin: baseURL! },
      })).toBeOK();

      const viewerPage = await viewerContext.newPage();
      await viewerPage.addInitScript((t) => localStorage.setItem("mortero:tema", t), theme);
      await signIn(viewerPage, viewer);
      const viewerMe = await (await viewerPage.request.get("/api/me")).json();
      await expect(await page.request.put(`/api/album/grants/${viewerMe.user.id}`, {
        data: { hours: 24 }, headers: { Origin: baseURL! },
      })).toBeOK();

      // Quien mira el álbum ajeno ve su nombre, su ID corto y la fecha encima de las fotos
      await openProfile(viewerPage, owner);
      const grid = viewerPage.locator(".album__grid");
      await expect(grid.locator(".watermark")).toHaveCount(1);
      await expect(grid.locator(".watermark span").first()).toContainText(viewer.name);
      await expect(grid.locator(".watermark span").first()).toContainText(viewerMe.user.id.slice(0, 8));
      await grid.getByRole("button", { name: "Foto 1" }).click();
      const lightbox = viewerPage.getByRole("dialog");
      await expect(lightbox.locator(".watermark")).toHaveCount(1);
      await expect(lightbox.getByRole("img", { name: "Foto 1 de 1" })).toBeVisible();
      await viewerPage.screenshot({ path: test.info().outputPath(`marca-${theme}.png`) });

      // La marca no se puede tocar: no bloquea cerrar ni moverse
      await expect(lightbox.locator(".watermark")).toHaveCSS("pointer-events", "none");

      // Al salir de la app (otra pestaña, el selector de apps), la foto privada no queda a la vista
      await viewerPage.evaluate(() => window.dispatchEvent(new Event("blur")));
      await expect(lightbox.getByRole("img", { name: "Foto 1 de 1" })).toBeHidden();
      await viewerPage.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(lightbox.getByRole("img", { name: "Foto 1 de 1" })).toBeVisible();
      await lightbox.getByRole("button", { name: "Cerrar" }).click();

      // En el álbum propio no hay marca
      await page.goto("/yo");
      await page.getByRole("link", { name: "Gente", exact: true }).click();
      await page.goto(`/perfil/${(await (await page.request.get("/api/me")).json()).user.id}`);
      await expect(page.locator(".album__grid").first()).toBeVisible();
      await expect(page.locator(".watermark")).toHaveCount(0);
    } finally {
      await viewerContext.close();
    }
  });
}
