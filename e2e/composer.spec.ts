import { expect, test } from "@playwright/test";
import { createAccount, openProfile, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 } });

for (const theme of ["oscuro", "penumbra"]) {
  test(`los botones quedan abajo cuando crece el campo en ${theme}`, async ({ page, baseURL }) => {
    const sender = await createAccount(baseURL!, "Ana Chat");
    const recipient = await createAccount(baseURL!, "Sol Chat");
    await signIn(page, sender);
    await page.evaluate((name) => localStorage.setItem("mortero:tema", name), theme);
    await openProfile(page, recipient);
    await page.getByRole("button", { name: "Mandar mensaje" }).click();
    await expect(page).toHaveURL(/\/mensajes\/[^/]+$/);
    const privateChat = page.url();
    const created = await page.request.post("/api/groups", {
      data: { name: "Grupo de prueba del chat" },
      headers: { Origin: baseURL! },
    });
    await expect(created).toBeOK();
    const { id } = await created.json();

    for (const [url, expectedWidths] of [[privateChat, [40, 40, 44]], [`/grupos/${id}`, [40, 40, 44]]] as const) {
      await page.goto(url);
      const row = page.locator(".composer__row");
      const input = row.getByRole("textbox");
      const buttons = row.getByRole("button");
      await expect(buttons).toHaveCount(expectedWidths.length);
      const inputBox = (await input.boundingBox())!;
      expect(inputBox.height).toBe(48);
      const center = inputBox.y + inputBox.height / 2;

      for (const [index, width] of expectedWidths.entries()) {
        const box = (await buttons.nth(index).boundingBox())!;
        expect(box.width).toBe(width);
        expect(box.height).toBe(width);
        expect(box.y + box.height / 2).toBeCloseTo(center, 0);
      }

      await input.fill("Una línea");
      expect((await input.boundingBox())?.height).toBe(inputBox.height);

      await input.fill("Primera línea\nSegunda línea");
      const tallInput = (await input.boundingBox())!;
      expect(tallInput.height).toBeGreaterThan(inputBox.height);
      for (const button of await buttons.all()) {
        const box = (await button.boundingBox())!;
        expect(box.y + box.height / 2).toBeCloseTo(tallInput.y + tallInput.height - 24, 0);
      }
    }
  });
}
