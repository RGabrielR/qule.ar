import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

test("una encuesta en el grupo se vota, se cambia el voto y los totales llegan en vivo", async ({ browser, baseURL }) => {
  const viewport = { width: 375, height: 700 };
  const ana = await browser.newContext({ baseURL, viewport });
  const beto = await browser.newContext({ baseURL, viewport });
  try {
    const a = await ana.newPage();
    const b = await beto.newPage();
    await signIn(a, await createAccount(baseURL!, "Ana Encuesta"));
    await signIn(b, await createAccount(baseURL!, "Beto Encuesta"));
    await a.goto("/grupos/general");
    await b.goto("/grupos/general");
    await expect(b.getByRole("textbox", { name: /Mensaje para/ })).toBeVisible();

    const question = `¿Cuándo hacemos la juntada? ${randomUUID().slice(0, 6)}`;
    await a.getByRole("button", { name: "Crear encuesta" }).click();
    const dialog = a.getByRole("dialog", { name: /Nueva encuesta/ });
    await dialog.getByRole("textbox", { name: "Pregunta" }).fill(question);
    await dialog.getByRole("textbox", { name: "Opción 1" }).fill("Viernes 20 h");
    await dialog.getByRole("textbox", { name: "Opción 2" }).fill("Viernes 20 h");
    await expect(dialog.getByText("Hay opciones repetidas.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Publicar", exact: true })).toBeDisabled();
    await dialog.getByRole("textbox", { name: "Opción 2" }).fill("Sábado 18 h");
    await dialog.getByRole("button", { name: "Sumar una opción" }).click();
    await dialog.getByRole("textbox", { name: "Opción 3" }).fill("Domingo al mediodía");
    // A 375 px la hoja entra entera, sin scroll horizontal
    expect(await a.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await dialog.getByRole("button", { name: "Publicar", exact: true }).click();
    await expect(dialog).toHaveCount(0);

    const pollA = a.getByRole("group", { name: `Encuesta: ${question}` });
    const pollB = b.getByRole("group", { name: `Encuesta: ${question}` });
    await expect(pollA).toBeVisible();
    await expect(pollB).toBeVisible();
    await expect(pollA.getByText("0 votos · nadie ve quién votó qué")).toBeVisible();

    // Beto vota y a Ana le llegan los totales en vivo
    await pollB.getByRole("button", { name: /^Sábado 18 h/ }).click();
    await expect(pollB.getByRole("button", { name: "Sábado 18 h: 1 voto, tu voto" })).toHaveAttribute("aria-pressed", "true");
    await expect(pollA.getByRole("button", { name: "Sábado 18 h: 1 voto" })).toHaveAttribute("aria-pressed", "false");

    // Cambia su voto: sigue habiendo un solo voto suyo
    await pollB.getByRole("button", { name: /^Viernes 20 h/ }).click();
    await expect(pollA.getByRole("button", { name: "Viernes 20 h: 1 voto" })).toBeVisible();
    await expect(pollA.getByRole("button", { name: "Sábado 18 h: 0 votos" })).toBeVisible();
    await expect(pollA.getByText("1 voto · nadie ve quién votó qué")).toBeVisible();

    // Ana vota y después Beto saca el suyo
    await pollA.getByRole("button", { name: /^Domingo al mediodía/ }).click();
    await expect(pollB.getByText("2 votos · nadie ve quién votó qué")).toBeVisible();
    await pollB.getByRole("button", { name: "Sacar mi voto" }).click();
    await expect(pollA.getByRole("button", { name: "Viernes 20 h: 0 votos" })).toBeVisible();
    await expect(pollA.getByRole("button", { name: "Domingo al mediodía: 1 voto, tu voto" })).toBeVisible();

    // Al recargar, cada quien ve su propio voto
    await b.reload();
    await expect(pollB.getByRole("button", { name: "Domingo al mediodía: 1 voto" })).toHaveAttribute("aria-pressed", "false");
    expect(await b.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  } finally {
    await ana.close();
    await beto.close();
  }
});
