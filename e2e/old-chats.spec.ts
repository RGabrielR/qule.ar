import { expect, test } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

/** Un resumen de chat de mentira, para armar una bandeja larga sin crear 100 cuentas. */
function chat(n: number) {
  const at = new Date(Date.UTC(2026, 0, 1) - n * 60_000).toISOString();
  return {
    id: `c${String(n).padStart(3, "0")}`, lastMessageAt: at, unread: 0,
    other: { id: `p${n}`, name: `Persona ${n}`, photo: null, presence: "offline" },
    last: {
      id: `m${n}`, conversationId: `c${n}`, senderId: `p${n}`, kind: "text", body: `Hola ${n}`, photo: null,
      expiring: false, opened: false, readAt: at, createdAt: at, replyTo: null, reactions: [],
    },
  };
}

test("Mensajes: carga los chats anteriores a los 100 más recientes", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await signIn(page, await createAccount(baseURL!, "Bandeja"));
  const pages: string[] = [];
  await page.route((url) => url.pathname === "/api/conversations", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (!query.has("before")) return route.fulfill({ json: Array.from({ length: 100 }, (_, i) => chat(i)) });
    pages.push(`${query.get("before")}|${query.get("beforeId")}`);
    await route.fulfill({ json: Array.from({ length: 5 }, (_, i) => chat(100 + i)) });
  });
  await page.goto("/mensajes");
  await expect(page.getByText("Persona 99", { exact: true })).toBeAttached();
  await expect(page.getByText("Persona 100", { exact: true })).toHaveCount(0);

  // El aviso para activar notificaciones flota abajo y tapa el final de la lista
  const later = page.getByRole("button", { name: "Ahora no" });
  if (await later.isVisible()) await later.click();
  const more = page.getByRole("button", { name: "Cargar chats anteriores" });
  await more.click();
  await expect(page.getByText("Persona 104", { exact: true })).toBeAttached();
  // Pidió desde el último de la primera página, y con 5 ya no hay más
  expect(pages).toEqual([`${chat(99).lastMessageAt}|${chat(99).id}`]);
  await expect(more).toHaveCount(0);
});

test("chat privado: ver mensajes anteriores sin perder el lugar", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await signIn(page, await createAccount(baseURL!, "Historia"));
  await page.route("**/api/conversations/c000", (route) => route.fulfill({ json: { other: chat(0).other } }));
  await page.route("**/api/conversations/c000/messages*", async (route) => {
    const older = new URL(route.request().url()).searchParams.has("before");
    const messages = Array.from({ length: 50 }, (_, i) => {
      const n = i + (older ? 0 : 50);
      const at = new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString();
      return { ...chat(0).last, id: `m${String(n).padStart(3, "0")}`, body: `Mensaje ${n}`, createdAt: at, readAt: at };
    });
    await route.fulfill({ json: { messages, hasMore: !older } });
  });
  await page.goto("/mensajes/c000");
  const older = page.getByRole("button", { name: "Ver mensajes anteriores" });
  await older.scrollIntoViewIfNeeded();
  const text = page.getByText("Mensaje 50", { exact: true });
  const top = await text.evaluate((el) => el.getBoundingClientRect().top);
  await older.click();
  await expect(page.getByText("Mensaje 0", { exact: true })).toBeAttached();
  expect(Math.abs(await text.evaluate((el) => el.getBoundingClientRect().top) - top)).toBeLessThanOrEqual(1);
  await expect(older).toHaveCount(0);
});
