import { expect, test } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 } });

/** Quién reporta va en su propia pestaña: no tapa los reportes abiertos, y la pestaña dice cuántas cuentas hay para mirar. */
test("Moderación: Quién reporta va aparte de Abiertos", async ({ page, baseURL }) => {
  await signIn(page, await createAccount(baseURL!, "Admin Prueba"));
  // La administración general sale de la configuración del servidor: acá se simula desde /api/me
  await page.route((url) => url.pathname === "/api/me", async (route) => {
    const me = await (await route.fetch()).json();
    await route.fulfill({ json: { ...me, user: { ...me.user, isAdmin: true, access: ["owner", "reports", "sanctions", "appeals"] } } });
  });
  await page.route((url) => url.pathname === "/api/admin/stats", (route) =>
    route.fulfill({ json: { users: 10, groups: 2, openReports: 0, suspended: 0, openAppeals: 0 } }));
  await page.route((url) => url.pathname === "/api/admin/reports", (route) => route.fulfill({ json: [] }));
  await page.route((url) => url.pathname === "/api/admin/report-spam", (route) => route.fulfill({
    json: {
      alerts: [{
        id: "a1", reporter: { id: "r1", name: "Reportona", age: null, photo: null }, signals: [{ kind: "noAction", total: 12 }],
        targets: 12, lastHour: 0, since: new Date().toISOString(), dismissable: 0,
        history: { total: 12, open: 2, dismissed: 10, actioned: 0 },
      }],
      muted: [],
    },
  }));

  await page.goto("/admin");
  const tabs = page.getByRole("tablist");
  await expect(tabs.getByRole("tab", { name: "Abiertos" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Reportona")).toHaveCount(0);
  const reporters = tabs.getByRole("tab", { name: "Quién reporta 1 para mirar" });
  await reporters.click();
  await expect(page.getByRole("region", { name: "Quién reporta" }).getByText("Reportona")).toBeVisible();
  await expect(page.getByText("Mandó 12 reportes en 90 días y ninguno terminó en una medida.")).toBeVisible();
});
