import { expect, test } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 }, serviceWorkers: "block" });

const name = "خُورخي";

for (const theme of ["oscuro", "penumbra"]) {
  test(`el nombre en árabe queda antes de la edad en Moderación y en el perfil (${theme})`, async ({ page, baseURL }) => {
    const account = await createAccount(baseURL!, "Moderación");
    const target = await createAccount(baseURL!, "Perfil reportado");
    await signIn(page, target);
    await expect(await page.request.put("/api/me/profile", {
      headers: { Origin: baseURL! },
      data: { displayName: name, birthdate: "1990-01-01", acceptTerms: true },
    })).toBeOK();
    const { user } = await (await page.request.get("/api/me")).json();

    await page.context().clearCookies();
    await page.addInitScript((value) => localStorage.setItem("mortero:tema", value), theme);
    await signIn(page, account);
    await page.route("**/api/me", async (route) => {
      const response = await route.fetch();
      const me = await response.json();
      await route.fulfill({ response, json: { ...me, user: { ...me.user, isAdmin: true, access: ["reports"] } } });
    });
    await page.route("**/api/admin/stats", (route) => route.fulfill({
      json: { users: 2, groups: 0, openReports: 1, suspended: 0, openAppeals: 0 },
    }));
    await page.route("**/api/admin/reports?status=open", (route) => route.fulfill({
      json: [{
        id: "report", subject: `u:${user.id}`, subjectReporters: 1, reason: "spam",
        status: "open", createdAt: "2026-01-01T00:00:00Z", reporterHidden: true,
        target: { id: user.id, name, age: 29, photo: null }, targetReportCount: 2, evidenceFiles: 0,
      }],
    }));

    await page.goto("/admin");
    expect(await page.locator("html").getAttribute("data-theme")).toBe(theme === "penumbra" ? theme : null);
    const row = page.locator(".rcard__who");
    const reportedName = row.locator("b bdi");
    await expect(reportedName).toHaveText(name);
    await expect(row.getByText("2 reportes en total")).toBeVisible();
    const age = row.getByText("29", { exact: true });
    expect((await reportedName.boundingBox())!.x).toBeLessThan((await age.boundingBox())!.x);

    await row.click();
    const cover = page.locator(".profile__nameline");
    const profileName = cover.getByRole("heading").locator("bdi");
    await expect(profileName).toHaveText(name);
    const profileAge = cover.locator("span");
    await expect(profileAge).toHaveText(/^\d+$/);
    expect((await profileName.boundingBox())!.x).toBeLessThan((await profileAge.boundingBox())!.x);
  });
}
