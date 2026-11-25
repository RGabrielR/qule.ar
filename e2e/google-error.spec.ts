import { expect, test } from "@playwright/test";

// Al volver de Google con un mail que ya tiene cuenta con contraseña sin confirmar, Better Auth trae a /entrar con
// ?error=account_not_linked (errorCallbackURL en pages/Login.tsx)
test("explica qué hacer cuando Google no se puede unir a la cuenta", async ({ page }) => {
  await page.goto("/entrar?error=account_not_linked");
  const notice = page.getByRole("alert");
  await expect(notice).toContainText("Ya tenés una cuenta con ese mail");
  await expect(notice).toContainText("confirmá el mail desde Yo");
  // El código sale de la dirección para que no vuelva a aparecer al recargar
  await expect(page).toHaveURL(/\/entrar$/);
  await expect(page.getByRole("tab", { name: "Entrar" })).toHaveAttribute("aria-selected", "true");
});

test("otro error de Google muestra un aviso genérico y cancelar no muestra nada", async ({ page }) => {
  await page.goto("/entrar?error=invalid_code");
  await expect(page.getByRole("alert")).toHaveText("No se pudo entrar con Google. Probá de nuevo.");
  await page.goto("/entrar?error=access_denied");
  await expect(page.getByRole("tab", { name: "Entrar" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
