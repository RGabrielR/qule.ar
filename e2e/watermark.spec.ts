import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { createAccount, openProfile, signIn } from "./fixtures";

// Marca de agua con quién mira (idea de @Saantiames, discusión #155): va en las fotos de los álbumes privados ajenos,
// nunca en los propios, y las fotos privadas se esconden cuando la app pierde el foco. La escribe el servidor en la
// foto (viewerMark.ts): dibujada solo encima, arrastrar la imagen a otra app se llevaba la foto limpia.
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

      // Quien mira el álbum ajeno recibe la foto con la marca escrita: distinta de la que ve el dueño
      await openProfile(viewerPage, owner);
      const ownerId = (await (await page.request.get("/api/me")).json()).user.id as string;
      const album = (await (await viewerPage.request.get(`/api/users/${ownerId}`)).json()).privateAlbum;
      const item = album.items[0] as { url: string; thumb: string };
      for (const url of [item.url, item.thumb]) {
        const seen = Buffer.from(await (await viewerPage.request.get(url)).body());
        const original = Buffer.from(await (await page.request.get(url)).body());
        expect(seen.equals(original)).toBe(false);
      }
      const grid = viewerPage.locator(".album__grid");
      // Ya no va una capa encima (quedaría doble), y la foto no se puede arrastrar a otra app
      await expect(grid.locator(".watermark")).toHaveCount(0);
      await expect(grid.locator("img").first()).toHaveAttribute("draggable", "false");
      await expect(grid.locator("img").first()).toHaveCSS("-webkit-user-drag", "none");
      await grid.getByRole("button", { name: "Foto 1" }).click();
      const lightbox = viewerPage.getByRole("dialog");
      await expect(lightbox.getByRole("img", { name: "Foto 1 de 1" })).toBeVisible();
      await expect(lightbox.locator(".watermark")).toHaveCount(0);
      await expect(lightbox.getByRole("img", { name: "Foto 1 de 1" })).toHaveAttribute("draggable", "false");
      await viewerPage.screenshot({ path: test.info().outputPath(`marca-${theme}.png`) });

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
