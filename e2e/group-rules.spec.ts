import { expect, test } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 } });

test("los números del antispam se pueden borrar y reescribir, y avisan cuando se pasan", async ({ page, baseURL }) => {
  const owner = await createAccount(baseURL!, "Lea Reglas");
  await signIn(page, owner);
  const created = await page.request.post("/api/groups", { data: { name: "Reglas de prueba" }, headers: { Origin: baseURL! } });
  await expect(created).toBeOK();
  const { id } = await created.json();
  await page.goto(`/grupos/${id}/editar`);

  const seconds = page.getByRole("textbox", { name: "Segundos por mensaje" });
  const burst = page.getByRole("textbox", { name: "Ráfaga (mensajes seguidos)" });
  await seconds.fill("");
  await expect(seconds).toHaveValue("");
  await seconds.pressSequentially("5");
  await expect(seconds).toHaveValue("5");

  await burst.fill("60");
  await expect(burst).toHaveAttribute("aria-invalid", "true");
  await expect(burst).toHaveAccessibleDescription("Entre 1 y 10");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("alert")).toHaveText("Revisá los números marcados.");

  await burst.fill("05");
  await expect(burst).toHaveValue("5");
  await expect(burst).toHaveAttribute("aria-invalid", "false");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("button", { name: "Guardado" })).toBeVisible();
  const saved = await (await page.request.get(`/api/groups/${id}`)).json();
  expect(saved.rules).toMatchObject({ intervalSeconds: 5, burst: 5 });
});
