import { randomUUID } from "node:crypto";
import { expect, request, type Page } from "@playwright/test";

export async function createAccount(baseURL: string, name: string) {
  const id = randomUUID();
  const account = {
    name: `${name} ${id.slice(0, 8)}`,
    email: `${id}@example.test`,
    password: randomUUID(),
  };
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  try {
    const signup = await api.post("/api/auth/sign-up/email", { data: account });
    await expect(signup).toBeOK();
    const profile = await api.put("/api/me/profile", {
      data: { displayName: account.name, birthdate: "1990-01-01", acceptTerms: true },
    });
    await expect(profile).toBeOK();
    return account;
  } finally {
    await api.dispose();
  }
}

export async function signIn(page: Page, account: Awaited<ReturnType<typeof createAccount>>) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Email" }).fill(account.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("link", { name: "Gente", exact: true })).toBeVisible();
}

export async function openProfile(page: Page, account: Awaited<ReturnType<typeof createAccount>>) {
  await page.getByRole("link", { name: "Gente", exact: true }).click();
  await page.getByRole("link", { name: new RegExp(`^${account.name},`) }).click();
  await expect(page.getByRole("heading", { name: account.name, exact: true })).toBeVisible();
}
