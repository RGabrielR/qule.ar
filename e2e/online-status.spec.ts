import { expect, test } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 }, serviceWorkers: "block" });

for (const theme of ["oscuro", "penumbra"] as const) {
  test(`guardá el estado en línea sin perderlo al salir de Incógnito (${theme})`, async ({ page, request, baseURL }) => {
    const account = await createAccount(baseURL!, "Perfil en línea");
    const viewer = await createAccount(baseURL!, "Visita de privacidad");
    const headers = { Origin: baseURL! };
    await expect(await request.post("/api/auth/sign-in/email", { headers, data: viewer })).toBeOK();
    await page.addInitScript((value) => localStorage.setItem("mortero:tema", value), theme);
    await signIn(page, account);
    const { user } = await (await page.request.get("/api/me")).json();
    const publicStatus = async () => {
      const response = await request.get(`/api/users/${user.id}`);
      await expect(response).toBeOK();
      const profile = await response.json();
      return { online: profile.online, recent: profile.recent };
    };
    const nearby = async () => {
      const response = await request.get("/api/nearby");
      await expect(response).toBeOK();
      return (await response.json()).people as { id: string; online: boolean; recent: boolean }[];
    };

    await page.goto("/yo/configuracion");
    expect(await page.locator("html").getAttribute("data-theme")).toBe(theme === "penumbra" ? theme : null);
    const select = page.getByRole("combobox", { name: "Mostrarme en línea", exact: true });
    await expect(select.getByRole("option")).toHaveText(["Siempre", "Solo cuando estás conectado", "Nunca"]);
    await expect(select).toHaveValue("connected");

    await select.selectOption("never");
    await expect.poll(publicStatus).toEqual({ online: false, recent: false });
    expect((await nearby()).find((p) => p.id === user.id)).toMatchObject({ online: false, recent: false });

    await select.selectOption("always");
    await expect.poll(publicStatus).toEqual({ online: true, recent: true });
    const incognito = page.getByRole("checkbox", { name: /Modo incógnito/ });
    await incognito.click();
    await expect(incognito).toBeChecked();
    await expect(select).toBeDisabled();
    await expect(select).toHaveValue("never");
    const rejected = await page.request.put("/api/me/privacy", { headers, data: { onlineStatus: "connected" } });
    expect(rejected.status()).toBe(409);
    await expect.poll(publicStatus).toEqual({ online: false, recent: false });
    expect((await nearby()).some((p) => p.id === user.id)).toBe(false);

    await page.reload();
    await expect(incognito).toBeChecked();
    await expect(select).toBeDisabled();
    await expect(select).toHaveValue("never");
    await expect(select).toHaveAccessibleDescription(/Desactivá Incógnito/);
    await incognito.click();
    await expect(incognito).not.toBeChecked();
    await expect(select).toBeEnabled();
    await expect(select).toHaveValue("always");
    await expect.poll(publicStatus).toEqual({ online: true, recent: true });
    expect((await nearby()).find((p) => p.id === user.id)).toMatchObject({ online: true });
  });
}
