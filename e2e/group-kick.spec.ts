import { expect, test } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 } });

test("quien modera puede expulsar desde el menú de un mensaje del chat", async ({ page, browser, baseURL }) => {
  const owner = await createAccount(baseURL!, "Ana Dueña");
  const member = await createAccount(baseURL!, "Beto Molesto");
  const headers = { Origin: baseURL! };
  await signIn(page, owner);
  const created = await page.request.post("/api/groups", { data: { name: "Grupo de prueba para expulsar" }, headers });
  await expect(created).toBeOK();
  const { id } = await created.json();
  const rules = { intervalSeconds: 5, burst: 3, rotationWindow: 20, rotationMax: 10, newAccountHours: 0, maxQueued: 3 };
  await expect(await page.request.patch(`/api/groups/${id}`, { data: { rules }, headers })).toBeOK();

  const memberPage = await browser.newPage({ baseURL });
  try {
    await signIn(memberPage, member);
    await expect(await memberPage.request.post(`/api/groups/${id}/requests`, { data: { message: "Hola" }, headers })).toBeOK();
    const pending = await (await page.request.get(`/api/groups/${id}/requests`)).json() as { items: { id: string }[] };
    await expect(await page.request.post(`/api/groups/${id}/requests/${pending.items[0].id}/accept`, { headers })).toBeOK();
    await expect(await memberPage.request.post(`/api/groups/${id}/messages`, { data: { body: "mensaje molesto" }, headers })).toBeOK();
  } finally {
    await memberPage.close();
  }

  await page.goto(`/grupos/${id}`);
  const message = page.locator(".gmsg").filter({ hasText: "mensaje molesto" });
  await message.press("Shift+F10");
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain(`¿Expulsar a ${member.name} del grupo?`);
    void dialog.accept();
  });
  await page.getByRole("menuitem", { name: "Expulsar del grupo" }).click();
  await expect(page.getByText(`${member.name} ya no está en el grupo.`)).toBeVisible();
  const members = await (await page.request.get(`/api/groups/${id}/members`)).json() as { members: { name: string }[] };
  expect(members.members.map((m) => m.name)).not.toContain(member.name);
});
