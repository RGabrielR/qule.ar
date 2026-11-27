import { expect, test } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

test("deslizar la fila de un mensaje para la derecha lo responde (ajeno o propio); un poco o para arriba, no", async ({ page, browser, baseURL }) => {
  const me = await createAccount(baseURL!, "Desliza");
  const other = await createAccount(baseURL!, "Deslizada");
  await signIn(page, me);
  const myId = (await (await page.request.get("/api/me")).json()).user.id as string;

  const otherPage = await browser.newPage({ baseURL });
  let chatId: string;
  try {
    await signIn(otherPage, other);
    const headers = { Origin: baseURL! };
    const chat = await otherPage.request.post("/api/conversations", { headers, data: { userId: myId } });
    await expect(chat).toBeOK();
    chatId = (await chat.json()).id;
    await expect(await otherPage.request.post(`/api/conversations/${chatId}/messages`, { headers, data: { body: "Mensaje ajeno" } })).toBeOK();
  } finally {
    await otherPage.close();
  }
  await expect(await page.request.post(`/api/conversations/${chatId}/messages`, { headers: { Origin: baseURL! }, data: { body: "Mensaje propio" } })).toBeOK();

  await page.goto(`/mensajes/${chatId}`);
  const cdp = await page.context().newCDPSession(page);
  // `fromEmpty`: arranca en el espacio vacío de la fila, no en el globo (se arrastra la fila entera, como en WhatsApp)
  const drag = async (text: string, dx: number, dy = 0, fromEmpty = false) => {
    const box = (await page.locator(".bubble", { hasText: text }).boundingBox())!;
    const x = fromEmpty ? 40 : box.x + 30;
    const y = box.y + box.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 10; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * i) / 10, y: y + (dy * i) / 10 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const cancel = page.getByRole("button", { name: "Cancelar respuesta" });

  await drag("Mensaje ajeno", 30);
  await drag("Mensaje ajeno", 10, 80);
  await expect(cancel).toHaveCount(0);

  for (const [text, fromEmpty] of [["Mensaje ajeno", false], ["Mensaje propio", true]] as const) {
    await drag(text, 110, 0, fromEmpty);
    await expect(cancel).toBeVisible();
    await expect(page.locator(".composer")).toContainText(text);
    await cancel.click();
  }
});
