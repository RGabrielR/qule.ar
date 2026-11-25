import { expect, test, type Page } from "@playwright/test";
import { SOCKET_ERRORS } from "../packages/shared/src/realtime";
import { createAccount, signIn } from "./fixtures";

/** Mira lo que recibe el chat en vivo de una pestaña: si el servidor rechazó la conexión y si después entró. */
function watchSocket(page: Page) {
  const seen = { rejected: false, connected: false };
  page.on("websocket", (ws) => {
    ws.on("framereceived", ({ payload }) => {
      const text = typeof payload === "string" ? payload : payload.toString();
      if (text.startsWith("44") && text.includes(SOCKET_ERRORS.tooManySockets)) seen.rejected = true;
      if (text.startsWith("40")) seen.connected = true;
    });
  });
  return seen;
}

test("con el cupo de conexiones lleno, la pestaña nueva reintenta sola cuando se libera uno", async ({ context, page, baseURL }) => {
  test.setTimeout(60_000);
  const account = await createAccount(baseURL!, "Carla Pestañas");
  const first = watchSocket(page);
  await signIn(page, account);
  await expect.poll(() => first.connected).toBe(true);

  // Cinco pestañas más: seis conexiones, el cupo por cuenta
  for (let i = 0; i < 5; i++) {
    const tab = await context.newPage();
    const seen = watchSocket(tab);
    await tab.goto("/");
    await expect.poll(() => seen.connected).toBe(true);
  }

  // La séptima queda afuera…
  const extra = await context.newPage();
  const seen = watchSocket(extra);
  await extra.goto("/");
  await expect.poll(() => seen.rejected).toBe(true);
  expect(seen.connected).toBe(false);

  // …y cuando se cierra una, entra sola, sin recargar
  await page.close();
  await expect.poll(() => seen.connected, { timeout: 20_000 }).toBe(true);
});
