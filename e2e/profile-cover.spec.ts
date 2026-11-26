import { expect, request, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { createAccount, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 600 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });

function gate() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { wait, release };
}

async function addPhoto(baseURL: string, account: Awaited<ReturnType<typeof createAccount>>) {
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  try {
    await expect(await api.post("/api/auth/sign-in/email", { data: { email: account.email, password: account.password } })).toBeOK();
    const buffer = await sharp({ create: { width: 900, height: 1125, channels: 3, background: "black" } }).png().toBuffer();
    const response = await api.post("/api/me/photos", {
      multipart: { file: { name: "portada.png", mimeType: "image/png", buffer } },
    });
    await expect(response).toBeOK();
    return (await response.json()).url as string;
  } finally {
    await api.dispose();
  }
}

async function checkTransition(page: Page, name: string, profilePath: string, photo: string, navigate: () => Promise<void>) {
  const profile = gate();
  const preview = gate();
  const full = gate();
  const routes = [
    { pattern: `**${profilePath.replace("/perfil/", "/api/users/")}`, wait: profile.wait },
    { pattern: `**${photo}?s=cover`, wait: preview.wait },
    { pattern: `**${photo}`, wait: full.wait },
  ];
  for (const { pattern, wait } of routes) {
    await page.route(pattern, async (route) => { await wait; await route.continue(); });
  }
  try {
    await navigate();
    await expect(page).toHaveURL(new RegExp(profilePath + "$"));
    const cover = page.locator(".profile__photo");
    const small = cover.locator('img[src$="?s=cover"]');
    const large = cover.getByRole("img", { name: `Foto de ${name}` });
    const skeleton = cover.locator(".profile__skeleton");
    await expect(skeleton).toBeVisible();
    const height = (await cover.boundingBox())?.height;

    preview.release();
    await expect(small).toBeVisible();
    expect(await small.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([384, 480]);

    profile.release();
    await expect(cover.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(small).toBeVisible();
    await expect(cover.locator(`img[src="${photo}"]`)).toBeHidden();
    await expect(skeleton).toHaveCount(0);
    expect((await cover.boundingBox())?.height).toBe(height);

    full.release();
    await expect(small).toHaveCount(0);
    await expect(large).toHaveAttribute("src", photo);
    expect(await large.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([900, 1125]);
    expect((await cover.boundingBox())?.height).toBe(height);
  } finally {
    profile.release();
    preview.release();
    full.release();
    for (const { pattern } of routes) await page.unroute(pattern);
  }
}

for (const theme of ["oscuro", "penumbra"]) {
  test(`mantiene la portada al entrar desde Gente y cambiar de perfil en ${theme}`, async ({ page, baseURL }) => {
    const origin = baseURL!;
    const viewer = await createAccount(origin, "Sol Portada");
    const first = await createAccount(origin, "Ana Portada");
    const second = await createAccount(origin, "Luz Portada");
    const photos = new Map([
      [first.name, await addPhoto(origin, first)],
      [second.name, await addPhoto(origin, second)],
    ]);
    await page.addInitScript((name) => localStorage.setItem("mortero:tema", name), theme);
    await page.route(/\/api\/nearby(?:\?|$)/, async (route) => {
      const response = await route.fetch();
      const grid = await response.json();
      const people = grid.people.filter((person: { name: string }) => photos.has(person.name));
      await route.fulfill({ response, json: { ...grid, people, hasMore: false } });
    });
    await signIn(page, viewer);
    expect(await page.locator("html").getAttribute("data-theme")).toBe(theme === "penumbra" ? theme : null);

    const tiles = page.getByRole("link", { name: new RegExp(`^(${first.name}|${second.name})$`) });
    await expect(tiles).toHaveCount(2);
    const [previous, next] = await tiles.evaluateAll((links) => links.map((link) => ({
      name: link.getAttribute("aria-label")!,
      path: link.getAttribute("href")!,
    })));
    const session = await page.context().newCDPSession(page);
    async function swipe(from: number, to: number) {
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y: 150 }] });
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: (from + to) / 2, y: 150 }] });
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: to, y: 150 }] });
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }

    await checkTransition(page, previous.name, previous.path, photos.get(previous.name)!, () => tiles.first().tap());
    await checkTransition(page, next.name, next.path, photos.get(next.name)!,
      () => page.getByRole("button", { name: `Perfil siguiente: ${next.name}`, exact: true }).tap());
    await swipe(85, 290);
    await expect(page.getByRole("img", { name: `Foto de ${previous.name}` })).toHaveAttribute("src", photos.get(previous.name)!);
    await swipe(290, 85);
    await expect(page.getByRole("img", { name: `Foto de ${next.name}` })).toHaveAttribute("src", photos.get(next.name)!);
  });
}
