import { expect, request, test, type Page } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

async function login(baseURL: string, account: Awaited<ReturnType<typeof createAccount>>) {
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  await expect(await api.post("/api/auth/sign-in/email", { data: { email: account.email, password: account.password } })).toBeOK();
  const me = await (await api.get("/api/me")).json();
  return { api, id: me.user.id as string };
}

async function openConversation(page: Page, account: Awaited<ReturnType<typeof createAccount>>, conversationId: string) {
  await signIn(page, account);
  await page.goto(`/mensajes/${conversationId}`);
  await expect(page.getByRole("textbox", { name: "Mensaje", exact: true })).toBeVisible();
}

test.use({ viewport: { width: 375, height: 700 } });

test("reaccionar a un mensaje viejo no lleva la vista al final de la charla", async ({ page, baseURL }) => {
  const ana = await createAccount(baseURL!, "Ana Scroll");
  const beto = await createAccount(baseURL!, "Beto Scroll");
  const a = await login(baseURL!, ana);
  const b = await login(baseURL!, beto);
  try {
    const conv = await (await a.api.post("/api/conversations", { data: { userId: b.id } })).json();
    for (let i = 1; i <= 30; i++) {
      await expect(await a.api.post(`/api/conversations/${conv.id}/messages`, {
        data: { body: `Mensaje ${i} para poder scrollear` },
      })).toBeOK();
    }

    await openConversation(page, beto, conv.id);
    const list = page.locator(".chat__list");
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await list.evaluate((el) => { el.scrollTop = 0; });
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0);

    const first = page.locator(".chat__list .bubble").first();
    await expect(first).toContainText("Mensaje 1 para poder scrollear");
    // Las acciones del mensaje se abren manteniéndolo apretado o con el teclado
    await first.press("Enter");
    // También se elige con el teclado: el clic de Playwright desplaza la lista para mostrar el botón mientras el
    // menú todavía entra animado, y eso movía la vista por su cuenta, no por la reacción
    await page.getByRole("button", { name: "Jaja", exact: true }).press("Enter");
    await expect(first.getByRole("button", { name: /Jaja/ })).toBeVisible();

    expect(await list.evaluate((el) => el.scrollTop)).toBeLessThan(100);
  } finally {
    await a.api.dispose();
    await b.api.dispose();
  }
});
