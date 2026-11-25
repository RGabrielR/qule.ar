import { expect, test } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 } });

test("un toque nuevo se marca en Yo, en vivo, y se apaga al abrir Toques", async ({ page, browser, baseURL }) => {
  const me = await createAccount(baseURL!, "Rita Recibe");
  const other = await createAccount(baseURL!, "Tomi Toca");
  await signIn(page, me);
  const myId = (await (await page.request.get("/api/me")).json()).user.id as string;
  const yo = page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: /^Yo/ });
  await expect(yo).toHaveAccessibleName("Yo");

  const otherPage = await browser.newPage({ baseURL });
  try {
    await signIn(otherPage, other);
    await expect(await otherPage.request.post(`/api/users/${myId}/toques`, { data: { kind: "fuego" }, headers: { Origin: baseURL! } })).toBeOK();
  } finally {
    await otherPage.close();
  }

  await expect(yo).toHaveAccessibleName("Yo 1 toque nuevo");
  await page.goto("/toques");
  await expect(page.getByRole("link", { name: new RegExp(other.name) })).toBeVisible();
  await expect(yo).toHaveAccessibleName("Yo");
});
