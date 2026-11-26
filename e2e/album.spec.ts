import { expect, test } from "@playwright/test";
import { createAccount, openProfile, signIn } from "./fixtures";

// PNG de 1x1: alcanza para probar la subida (el servidor no pide tamaño mínimo).
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("compartir el álbum avisa en vivo, cambiar el plazo actualiza y revocar marca a ambos", async ({ page, browser, baseURL }) => {
  const owner = await createAccount(baseURL!, "Dueña Álbum");
  const guest = await createAccount(baseURL!, "Invitada Álbum");
  const guestContext = await browser.newContext({ baseURL });
  try {
    const guestPage = await guestContext.newPage();
    await signIn(page, owner);

    // Foto privada por API (más rápido que el selector de archivos) y recarga para que el menú la vea.
    await expect(await page.request.post("/api/me/photos", {
      multipart: { file: { name: "foto.png", mimeType: "image/png", buffer: pixel }, private: "1" },
      headers: { Origin: baseURL! },
    })).toBeOK();
    await page.reload();

    // Charla abierta en las dos sesiones antes de compartir.
    await openProfile(page, guest);
    await page.getByRole("button", { name: "Mandar mensaje" }).click();
    const composer = page.getByRole("textbox", { name: "Mensaje", exact: true });
    await composer.waitFor();
    await composer.fill("Hola, te comparto mi álbum.");
    await page.getByRole("button", { name: "Mandar", exact: true }).click();
    await signIn(guestPage, guest);
    await guestPage.goto("/mensajes");
    await guestPage.locator(".inbox__item").filter({ hasText: owner.name }).click();
    await expect(guestPage.getByText("Hola, te comparto mi álbum.", { exact: true })).toBeVisible();

    // Compartir por 1 hora desde el menú de fotos del chat.
    await page.getByRole("button", { name: "Mandar foto" }).click();
    await page.getByRole("menuitem", { name: /Álbum privado/ }).click();
    await expect(page.locator(".album-menu__head").getByText("Álbum privado", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "1 hora", exact: true }).click();
    await expect(page.getByText(/Le compartiste tu álbum privado por 1 hora/)).toBeVisible();
    await expect(page.locator(".bubble--album").getByText(/Vence en \d+ min/)).toBeVisible();
    await expect(guestPage.getByText(/Te compartió su álbum privado por 1 hora/)).toBeVisible();
    await expect(guestPage.getByRole("link", { name: /Te compartió su álbum privado/ })).toBeVisible();

    // El acceso es real: el link abre el álbum con la foto.
    await guestPage.getByRole("link", { name: /Te compartió su álbum privado/ }).click();
    await expect(guestPage.getByRole("dialog")).toBeVisible();
    // Cerrar el álbum abierto desde el chat vuelve al chat (#252)
    await guestPage.getByRole("button", { name: "Cerrar" }).click();
    await expect(guestPage).toHaveURL(/\/mensajes\//);
    await expect(guestPage.getByText(/Te compartió su álbum privado por 1 hora/)).toBeVisible();

    // Cambiar el plazo actualiza el mismo aviso en vivo, sin duplicar.
    await page.getByRole("button", { name: "24 horas", exact: true }).click();
    await expect(page.getByText(/Le compartiste tu álbum privado por 24 horas/)).toBeVisible();
    await expect(guestPage.getByText(/Te compartió su álbum privado por 24 horas/)).toBeVisible();
    await expect(page.getByText(/por 1 hora/)).toBeHidden();
    await expect(guestPage.getByText(/por 1 hora/)).toBeHidden();
    await expect(page.locator(".bubble--album")).toHaveCount(1);
    await expect(guestPage.locator(".bubble--album")).toHaveCount(1);

    // Dejar de compartir lo marca como revocado en las dos sesiones, sin link.
    await page.getByRole("button", { name: "Dejar de compartir" }).click();
    await expect(page.getByText("Le dejaste de compartir tu álbum privado")).toBeVisible();
    await expect(guestPage.getByText("Te dejó de compartir su álbum privado")).toBeVisible();
    await expect(guestPage.getByRole("link", { name: /Te compartió su álbum privado/ })).toHaveCount(0);
    await expect(page.locator(".bubble--album")).toHaveCount(1);
    await expect(guestPage.locator(".bubble--album")).toHaveCount(1);

    // Y el acceso se corta de verdad: el perfil ya no muestra el álbum.
    await guestPage.locator(".topbar__who").click();
    await expect(guestPage.getByText(/todavía no te compartió ningún álbum/)).toBeVisible();
    await expect(guestPage.getByRole("dialog")).toHaveCount(0);
    await guestPage.goBack();
    await expect(guestPage.getByText("Te dejó de compartir su álbum privado")).toBeVisible();

    // La bandeja muestra el estado final.
    await guestPage.goBack();
    const conversation = guestPage.locator(".inbox__item").filter({ hasText: owner.name });
    await expect(conversation.getByText("Dejó de compartir el álbum", { exact: true })).toBeVisible();

    // Reactivar con los dos chats abiertos tiene que emitir una lectura nueva.
    await conversation.click();
    const readPath = `${new URL(guestPage.url()).pathname.replace("/mensajes/", "/api/conversations/")}/read`;
    let releaseRead!: () => void;
    const allowRead = new Promise<void>((resolve) => { releaseRead = resolve; });
    await guestPage.route(`**${readPath}`, async (route) => {
      await allowRead;
      await route.continue();
    });
    try {
      const newRead = guestPage.waitForRequest((request) => new URL(request.url()).pathname === readPath);
      await page.getByRole("button", { name: "Sin límite", exact: true }).click();
      await expect(guestPage.getByRole("link", { name: /Te compartió su álbum privado/ })).toBeVisible();
      await newRead;
      await expect(page.getByText("Visto", { exact: true })).toHaveCount(0);
    } finally {
      releaseRead();
    }
    await expect(page.getByText("Visto", { exact: true })).toBeVisible();
  } finally {
    await guestContext.close();
  }
});

for (const theme of ["oscuro", "penumbra"]) {
  test(`el aviso lleva a su álbum y se vence con el chat abierto (${theme}, 375 px)`, async ({ page, browser, baseURL }) => {
    const owner = await createAccount(baseURL!, "Dueña Dos Álbumes");
    const guest = await createAccount(baseURL!, "Invitada Dos Álbumes");
    const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    try {
      const guestPage = await context.newPage();
      await guestPage.clock.install();
      await guestPage.addInitScript((value) => localStorage.setItem("mortero:tema", value), theme);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.addInitScript((value) => localStorage.setItem("mortero:tema", value), theme);
      await signIn(page, owner);
      await signIn(guestPage, guest);
      const headers = { Origin: baseURL! };
      const upload = (album?: string) => page.request.post("/api/me/photos", {
        headers, multipart: { file: { name: "foto.png", mimeType: "image/png", buffer: pixel }, ...(album ? { album } : { private: "1" }) },
      });
      const defaultPhoto = await upload();
      await expect(defaultPhoto).toBeOK();
      const { albumId: firstId } = await defaultPhoto.json();
      const second = await page.request.post("/api/album/albums", { headers, data: { name: "Segundo álbum" } });
      await expect(second).toBeOK();
      const { id: secondId } = await second.json();
      await expect(await upload(secondId)).toBeOK();
      const guestId = (await (await guestPage.request.get("/api/me")).json()).user.id;
      for (const albumId of [firstId, secondId]) {
        await expect(await page.request.put(`/api/album/albums/${albumId}/grants/${guestId}`, {
          headers, data: { hours: albumId === secondId ? 1 : null },
        })).toBeOK();
      }

      await page.goto("/mensajes");
      await page.locator(".inbox__item").filter({ hasText: guest.name }).click();
      await page.getByRole("button", { name: "Mandar foto" }).click();
      await page.getByRole("menuitem", { name: /Álbum privado/ }).click();
      await expect(page.locator(".album-menu__head").getByText("Álbumes privados", { exact: true })).toBeVisible();

      await guestPage.goto("/mensajes");
      await guestPage.locator(".inbox__item").filter({ hasText: owner.name }).click();
      const secondNotice = guestPage.locator(".bubble--album").filter({ hasText: /por 1 hora/ });
      const noticeLink = secondNotice.getByRole("link");
      await expect(noticeLink).toBeVisible();
      expect(await secondNotice.locator(".bubble__meta").innerText()).toMatch(/^Vence en \d+ min · \d{1,2}:\d{2}/);
      await noticeLink.click();
      await expect(guestPage.getByRole("dialog").getByText("Segundo álbum", { exact: true })).toBeVisible();
      // Cerrar el álbum abierto desde el chat vuelve al chat (#252)
      await guestPage.getByRole("button", { name: "Cerrar" }).click();
      await expect(guestPage).toHaveURL(/\/mensajes\//);
      await secondNotice.getByRole("button", { name: "Reaccionar u opciones del mensaje" }).click();
      await secondNotice.getByRole("group", { name: "Reaccionar" }).getByRole("button", { name: "Fuego" }).click();
      await expect(secondNotice.getByRole("button", { name: /Fuego: 1/ })).toBeVisible();
      expect(await guestPage.evaluate(() => document.documentElement.scrollWidth)).toBe(375);

      await guestPage.clock.fastForward(3_605_000);
      await expect(secondNotice).toContainText("Vencido");
      await expect(secondNotice.getByRole("link")).toHaveCount(0);
      await expect(guestPage.locator(".bubble--album").getByRole("link")).toHaveCount(1);
      await guestPage.getByRole("button", { name: "Volver", exact: true }).click();
      await expect(guestPage.getByText("Venció lo que te compartieron", { exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });
}
