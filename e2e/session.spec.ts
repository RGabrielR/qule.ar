import { test } from "@playwright/test";
import { createAccount, openProfile, signIn } from "./fixtures";

test("inicia sesión y abre un perfil desde Gente", async ({ page, baseURL }) => {
  const viewer = await createAccount(baseURL!, "Andrea Navegación");
  const neighbor = await createAccount(baseURL!, "Beatriz Navegación");

  await signIn(page, viewer);
  await openProfile(page, neighbor);
});
