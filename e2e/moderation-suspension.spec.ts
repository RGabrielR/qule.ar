import { expect, test } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 }, serviceWorkers: "block" });

for (const theme of ["oscuro", "penumbra"] as const) {
  test(`Moderación puede elegir el plazo de una suspensión (${theme})`, async ({ page, baseURL }) => {
    const moderator = await createAccount(baseURL!, "Modera");
    await page.addInitScript((value) => {
      localStorage.setItem("mortero:tema", value);
      localStorage.setItem("mortero:avisos-oculto", String(Date.now()));
    }, theme);
    await signIn(page, moderator);
    await page.route("**/api/me", async (route) => {
      const me = await (await route.fetch()).json();
      await route.fulfill({ json: { ...me, user: { ...me.user, isAdmin: true, access: ["sanctions"] } } });
    });
    await page.route("**/api/admin/stats", (route) => route.fulfill({
      json: { users: 2, groups: 0, openReports: 0, suspended: 0, openAppeals: 0 },
    }));
    await page.route((url) => url.pathname === "/api/admin/reports", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/admin/report-spam", (route) => route.fulfill({ json: { alerts: [], muted: [] } }));
    const targetId = "cuenta-de-prueba";
    let applied = false;
    await page.route("**/api/admin/accounts/search", (route) => route.fulfill({
      json: { ambiguous: false, account: { id: targetId, name: "Luz", suspendedAt: null } },
    }));
    await page.route(`**/api/admin/users/${targetId}/suspend`, (route) => {
      expect(route.request().postDataJSON()).toEqual({
        reason: "Incumplió las reglas del grupo", duration: { unit: "hours", amount: 2 },
      });
      applied = true;
      return route.fulfill({ json: { ok: true } });
    });
    await page.route("**/api/admin/suspended", (route) => route.fulfill({ json: applied ? [{
      id: targetId, name: "Luz", photo: null, suspendedAt: new Date().toISOString(),
      suspendedUntil: new Date(Date.now() + 7_200_000).toISOString(), preventive: false, automatic: false,
    }] : [] }));

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Moderación" })).toBeVisible();
    expect(await page.locator("html").getAttribute("data-theme")).toBe(theme === "penumbra" ? theme : null);
    await page.getByRole("tab", { name: "Suspendidas" }).click();
    await page.getByRole("textbox", { name: "ID de la cuenta o código de la captura" }).fill(targetId);
    await page.getByRole("button", { name: "Buscar cuenta" }).click();
    await page.getByRole("button", { name: "Suspender cuenta" }).click();

    const dialog = page.getByRole("dialog", { name: "Suspender a Luz" });
    const submit = dialog.getByRole("button", { name: "Suspender", exact: true });
    const duration = dialog.getByRole("combobox", { name: "Duración" });
    await expect(duration.getByRole("option")).toHaveText(["Elegí la duración", "Horas", "Días", "Meses", "Permanente"]);
    await dialog.getByRole("textbox", { name: "Motivo (la persona lo va a ver)" }).fill("Incumplió las reglas del grupo");
    await expect(submit).toBeDisabled();
    await duration.selectOption("permanent");
    await expect(dialog.getByText(/lo borrado no vuelve/)).toBeVisible();
    await expect(submit).toBeEnabled();
    await duration.selectOption("hours");
    await dialog.getByRole("spinbutton", { name: "Cantidad de horas" }).fill("2");
    await submit.click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(/Duración: 2 horas · Puede volver en/)).toBeVisible();
  });
}

test("la cuenta suspendida ve las horas totales y el tiempo restante se actualiza", async ({ page, baseURL }) => {
  await signIn(page, await createAccount(baseURL!, "Suspendida de prueba"));
  const now = Date.now();
  const start = new Date(now - 3_600_000).toISOString();
  const end = new Date(now + 3_600_000).toISOString();
  await page.clock.install({ time: new Date(now) });
  await page.route("**/api/me", async (route) => {
    const me = await (await route.fetch()).json();
    await route.fulfill({ json: { ...me, profile: { ...me.profile, suspendedAt: start, suspendedUntil: end } } });
  });
  await page.route("**/api/appeal", (route) => route.fulfill({ json: null }));
  await page.goto("/cerca");
  const timing = page.getByText(/Duración: 2 horas · Podés volver en/);
  await expect(timing).toContainText("1 hora");
  await page.clock.fastForward(120_000);
  await expect(timing).toContainText("58 minutos");
});
