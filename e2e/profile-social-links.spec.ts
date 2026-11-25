import { randomBytes } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createAccount } from "./fixtures";

test.setTimeout(120_000);
test.use({ hasTouch: true, serviceWorkers: "block" });

test("los usuarios de X e Instagram se validan, se publican y se pueden quitar", async ({ page, baseURL }) => {
  const account = await createAccount(baseURL!, "Perfil X");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 375, height: 812 });
  const session = await page.request.post("/api/auth/sign-in/email", {
    headers: { Origin: baseURL! }, data: { email: account.email, password: account.password },
  });
  await expect(session).toBeOK();
  await page.goto("/yo/editar");
  const suffix = randomBytes(4).toString("hex");
  const handle = "test_" + suffix;
  const instagramUsername = handle + "w".repeat(17);
  for (const [network, label, username, domain] of [
    ["x", "X", handle, "x.com"], ["instagram", "Instagram", instagramUsername, "www.instagram.com"],
  ]) {
    const field = page.getByRole("textbox", { name: "Usuario de " + label, exact: true });
    const group = page.getByRole("group", { name: label, exact: true });
    await field.fill("@dos..puntos");
    await group.getByRole("button", { name: "Generar código" }).click();
    await expect(group.getByRole("status")).toContainText("Revisá");
    await field.fill("test_" + suffix.slice(0, 6));
    await group.getByRole("button", { name: "Generar código" }).click();
    await group.getByRole("button", { name: "Verificar" }).click();
    await expect(group.getByRole("status")).toContainText("Todavía no pudimos confirmar", { timeout: 15000 });
    await expect(group.getByRole("button", { name: /Verificar en/ })).toBeDisabled();
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await expect(group.getByRole("button", { name: /Verificar en/ })).toBeDisabled();
    await field.fill("@" + username);
    await group.getByRole("button", { name: "Generar código" }).click();
    const staleRemoval = await page.request.post(`/api/me/social/${network}/remove`, {
      headers: { Origin: baseURL! }, data: { handle: username, version: "code:outdated" },
    });
    expect(staleRemoval.status()).toBe(409);
    const codeBox = await group.locator("strong").boundingBox();
    const copyBox = await group.getByRole("button", { name: "Copiar código" }).boundingBox();
    expect(Math.abs(codeBox!.y + codeBox!.height / 2 - copyBox!.y - copyBox!.height / 2)).toBeLessThan(1);
    const code = await group.locator("strong").innerText();
    if (network === "instagram") {
      await page.evaluate(() => Object.defineProperty(navigator.clipboard, "writeText", { value: undefined }));
    }
    await group.getByRole("button", { name: "Copiar código" }).click();
    await expect(group.getByRole("status")).toHaveText("Código copiado al portapapeles.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
    const bioFile = join(tmpdir(), `qule-bio-${domain}-${username}`);
    try {
      const beforeVerification = Date.now();
      await writeFile(bioFile, code);
      await group.getByRole("button", { name: "Verificar" }).click();
      await expect(group.getByText("Cuenta verificada")).toBeVisible({ timeout: 15000 });
      const { profile } = await (await page.request.get("/api/me")).json();
      const verifiedAt = Date.parse(profile[`${network}Proof`].verifiedAt);
      expect(verifiedAt).toBeGreaterThanOrEqual(beforeVerification);
      expect(verifiedAt).toBeLessThanOrEqual(Date.now());
      const previousTab = await page.request.post(`/api/me/social/${network}/remove`, {
        headers: { Origin: baseURL! }, data: { handle: username, version: "code:" + code },
      });
      expect(previousTab.status()).toBe(409);
      await expect(field).toHaveCount(0);
      const overwrite = await page.request.post(`/api/me/social/${network}/start`, {
        headers: { Origin: baseURL! }, data: { handle: "otra" },
      });
      expect(overwrite.status()).toBe(409);
    } finally {
      await rm(bioFile, { force: true });
    }
  }
  const link = page.getByRole("link", { name: `Abrir @${handle} en X` });
  const instagramLink = page.getByRole("link", { name: `Abrir @${instagramUsername} en Instagram` });
  const { user } = await (await page.request.get("/api/me")).json();
  await page.evaluate(() => localStorage.setItem("mortero:tema", "penumbra"));
  await page.goto(`/perfil/${user.id}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "penumbra");
  await link.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await expect(link).toBeInViewport({ ratio: 1 });
  await instagramLink.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await expect(instagramLink).toBeInViewport({ ratio: 1 });
  const xBox = await link.boundingBox();
  const instagramBox = await instagramLink.boundingBox();
  expect(xBox!.y).toBe(instagramBox!.y);
  const label = instagramLink.locator(".profile__handle");
  await expect(label).toHaveCSS("text-overflow", "ellipsis");
  expect(await label.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await instagramLink.evaluate((el) => el.getBoundingClientRect().width > el.parentElement!.clientWidth / 2)).toBe(true);
  for (const button of [link, instagramLink]) {
    const alignment = await button.evaluate((el) => {
      const bounds = el.getBoundingClientRect();
      const icon = el.querySelector("svg")!.getBoundingClientRect();
      const text = el.querySelector(".profile__handle")!.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el.querySelector(".profile__handle")!);
      const glyphs = range.getBoundingClientRect();
      return {
        topSpace: glyphs.top - text.top,
        bottomSpace: text.bottom - glyphs.bottom,
        horizontal: Math.abs((icon.left - bounds.left) - (bounds.right - text.right)),
        vertical: Math.abs((icon.y + icon.height / 2) - (text.y + text.height / 2)),
      };
    });
    expect(alignment.topSpace).toBeGreaterThanOrEqual(0);
    expect(alignment.bottomSpace).toBeGreaterThanOrEqual(0);
    expect(alignment.horizontal).toBeLessThanOrEqual(1);
    expect(alignment.vertical).toBeLessThanOrEqual(1);
  }
  await page.goto("/yo/editar");
  for (const label of ["X", "Instagram"]) {
    const group = page.getByRole("group", { name: label, exact: true });
    await group.getByRole("button", { name: "Cambiar" }).click();
    await expect(group.getByRole("textbox")).toHaveValue("");
    await expect(group.getByRole("button", { name: "Cambiar" })).toHaveCount(0);
  }
  await page.goto(`/perfil/${user.id}`);
  await expect(page.getByRole("link", { name: /Abrir @/ })).toHaveCount(0);
});

test("un 429 de Instagram pausa esa red y deja disponible X", async ({ page, baseURL }) => {
  const account = await createAccount(baseURL!, "Pausa");
  const headers = { Origin: baseURL! };
  await page.request.post("/api/auth/sign-in/email", { headers, data: { email: account.email, password: account.password } });
  const handle = "test_" + randomBytes(4).toString("hex");
  const post = (network: string, action: string, username = handle) =>
    page.request.post(`/api/me/social/${network}/${action}`, { headers, data: { handle: username } });
  const bioFile = join(tmpdir(), `qule-bio-www.instagram.com-${handle}`);
  await writeFile(bioFile, "fixture:429");
  try {
    await expect(await post("instagram", "start")).toBeOK();
    const paused = await post("instagram", "verify");
    expect(paused.status()).toBe(429);
    expect(Number(paused.headers()["retry-after"])).toBeGreaterThan(105);
    await expect(await post("instagram", "start", handle + "a")).toBeOK();
    const other = await post("instagram", "verify", handle + "a");
    expect(other.status()).toBe(429);
    expect(Number(other.headers()["retry-after"])).toBeGreaterThan(105);
    await expect(await post("x", "start")).toBeOK();
    expect((await post("x", "verify")).status()).toBe(422);
  } finally {
    await rm(bioFile, { force: true });
  }
});

test("la espera de una persona no aparece en otro perfil que ingresa el mismo usuario", async ({ playwright, baseURL }) => {
  const headers = { Origin: baseURL! };
  const handle = "test_" + randomBytes(4).toString("hex");
  const clients = await Promise.all(["Una", "Otra"].map(async name => {
    const account = await createAccount(baseURL!, name);
    const client = await playwright.request.newContext({ baseURL, extraHTTPHeaders: headers });
    await expect(await client.post("/api/auth/sign-in/email", { data: { email: account.email, password: account.password } })).toBeOK();
    await expect(await client.post("/api/me/social/x/start", { data: { handle } })).toBeOK();
    return client;
  }));
  try {
    const firstStart = Date.now();
    const first = await clients[0].post("/api/me/social/x/verify", { data: { handle } });
    expect(Date.now() - firstStart).toBeGreaterThanOrEqual(8900);
    expect(first.status()).toBe(422);
    const getWait = async (i: number) => (await (await clients[i].get("/api/me")).json()).profile.xProof.retryAt;
    expect(await getWait(0)).toBeGreaterThan(Date.now());
    expect(await getWait(1)).toBe(0);
    const secondStart = Date.now();
    const second = await clients[1].post("/api/me/social/x/verify", { data: { handle } });
    expect(Date.now() - secondStart).toBeGreaterThanOrEqual(8900);
    expect(second.status()).toBe(first.status());
    expect(await second.json()).toEqual(await first.json());
    expect(await getWait(1)).toBeGreaterThan(Date.now());
  } finally {
    await Promise.all(clients.map(client => client.dispose()));
  }
});
