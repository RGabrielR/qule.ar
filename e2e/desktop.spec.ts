import { expect, test } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

// La vista de compu: desde 1024 px, barra lateral y lista y detalle lado a lado
test.use({ viewport: { width: 1280, height: 800 } });

test("en compu, las pestañas van al costado y la charla se abre al lado de la bandeja", async ({ page, baseURL }) => {
  const me = await createAccount(baseURL!, "Rocío Compu");
  const other = await createAccount(baseURL!, "Sergio Compu");
  await signIn(page, me);

  const nav = page.getByRole("navigation", { name: "Secciones" });
  const box = await nav.boundingBox();
  expect(box!.x).toBe(0);
  expect(box!.height).toBe(800);

  // Charla nueva por la API, con un mensaje
  const conv = await page.request.post("/api/conversations", { data: { userId: await idOf(page, other.name) }, headers: { Origin: baseURL! } });
  await expect(conv).toBeOK();
  const { id } = await conv.json();
  await expect(await page.request.post(`/api/conversations/${id}/messages`, { data: { body: "Hola desde la compu" }, headers: { Origin: baseURL! } })).toBeOK();

  await nav.getByRole("link", { name: "Mensajes", exact: true }).click();
  await expect(page.getByText("Elegí una charla")).toBeVisible();
  const row = page.locator(".inbox__item").filter({ hasText: other.name });
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/mensajes/${id}$`));
  // La bandeja sigue a la vista y marca la charla abierta
  await expect(page.getByRole("heading", { name: "Mensajes" })).toBeVisible();
  await expect(row).toHaveAttribute("aria-current", "page");
  const active = page.locator(".inbox__row").filter({ has: row });
  const leftEdge = await active.evaluate((el) => {
    const marker = getComputedStyle(el, "::before");
    const avatar = el.querySelector(".inbox__avatar")!.getBoundingClientRect();
    return marker.content !== "none" && marker.left === "0px" && avatar.x === el.getBoundingClientRect().x;
  });
  expect(leftEdge).toBe(true);
  await expect(page.getByRole("textbox", { name: "Mensaje", exact: true })).toBeVisible();
  await expect(nav).toBeVisible();
});

test("en compu, los detalles de un grupo se abren a la derecha del chat", async ({ page, baseURL }) => {
  const owner = await createAccount(baseURL!, "Ana Compu");
  await signIn(page, owner);
  const name = "Caminatas por la costanera";
  const created = await page.request.post("/api/groups", { data: { name }, headers: { Origin: baseURL! } });
  await expect(created).toBeOK();
  const { id } = await created.json();

  await page.goto(`/grupos/${id}/info`);
  await expect(page.locator(".split__aside").getByText("Miembros")).toBeVisible();
  await expect(page.locator(".split__chat").getByRole("textbox", { name: /Mensaje|Escribí/ })).toBeVisible();
  await expect(page.locator(".split__list").getByRole("heading", { name: "Grupos" })).toBeVisible();
});

test("Moderación en compu: lista de temas y el elegido al lado, con teclado", async ({ page, baseURL }) => {
  await signIn(page, await createAccount(baseURL!, "Admin Compu"));
  await page.route((url) => url.pathname === "/api/me", async (route) => {
    const me = await (await route.fetch()).json();
    await route.fulfill({ json: { ...me, user: { ...me.user, isAdmin: true, access: ["reports", "sanctions"] } } });
  });
  await page.route((url) => url.pathname === "/api/admin/stats", (route) =>
    route.fulfill({ json: { users: 10, groups: 2, openReports: 2, suspended: 0, openAppeals: 0 } }));
  const now = Date.now();
  const report = (n: number, name: string, reason: string, details: string) => ({
    id: `r${n}`, subject: `u:p${n}`, subjectReporters: 1, reporterMuted: false, reason, details, status: "open", urgent: false, automatic: false,
    targetAutoHidden: false, targetAutoSuspendAt: null, resolution: null, createdAt: new Date(now - n * 60_000).toISOString(),
    messageId: null, messageKind: null, message: null, reporter: null, reporterHidden: true,
    target: { id: `p${n}`, name, age: 30, photo: null }, group: null, evidenceFiles: 0, photoVerification: false, photoEvidence: false,
    targetSuspendedAt: null, targetReportCount: n,
  });
  const first = report(1, "Perfil Uno", "spam", "Manda links");
  const messageReport = {
    ...first, id: "r3", createdAt: new Date(now - 3 * 60_000).toISOString(), details: null,
    messageId: "m3", messageKind: "dm", message: { body: "Mensaje reportado", photo: false, hidden: false, deleted: false },
  };
  let deleted = false;
  await page.route("**/api/admin/reports/r3/delete-message", (route) => {
    deleted = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route((url) => url.pathname === "/api/admin/reports", (route) => route.fulfill({
    json: new URL(route.request().url()).searchParams.get("status") === "closed" ? [] : [
      first,
      { ...report(2, "Perfil Dos", "amenazas o violencia", "Mensaje intimidante"), urgent: true },
      ...(deleted ? [] : [messageReport]),
    ],
  }));
  await page.route((url) => url.pathname === "/api/admin/report-spam", (route) => route.fulfill({ json: { alerts: [], muted: [] } }));
  await page.route((url) => /\/api\/admin\/reports\/r\d\/history$/.test(url.pathname), (route) => {
    const url = new URL(route.request().url());
    const older = url.searchParams.has("before");
    return route.fulfill({ json: { items: [{
      id: older ? "mas-antiguo" : "anterior", reason: "spam", status: "dismissed", resolution: null,
      createdAt: new Date(now - (older ? 2 : 1) * 86_400_000).toISOString(),
      details: older ? "Comentario de la segunda página" : "Comentario de un reporte anterior", targetName: null,
    }], next: !older && url.pathname.endsWith("/r1/history") ? "anterior" : null } });
  });

  await page.goto("/admin");
  await expect(page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Moderación" })).toHaveAttribute("aria-current", "page");
  const list = page.getByRole("region", { name: "Temas reportados" });
  const detail = page.getByRole("region", { name: "Tema elegido" });
  await expect(list.getByRole("list").getByRole("button").first()).toHaveAccessibleName(/Perfil Uno/);
  await expect(list.getByRole("button", { name: /Perfil Uno/ })).toHaveAttribute("aria-current", "true");
  await expect(detail.getByText("Mensaje reportado", { exact: true })).toBeVisible();
  await expect(detail.getByText("Comentario de un reporte anterior")).toBeVisible();
  await expect(detail.getByText("Descartado", { exact: true })).toBeVisible();
  await expect(detail.getByRole("heading", { name: "Reportes enviados por esta cuenta" })).toHaveCount(0);
  await detail.getByRole("button", { name: "Mostrar más" }).click();
  await expect(detail.getByText("Comentario de la segunda página")).toBeVisible();
  await detail.getByRole("button", { name: "Borrar este mensaje" }).click();
  await expect(detail.getByRole("button", { name: "Borrar este mensaje" })).toHaveCount(0);
  await expect(detail.getByText("“Manda links”")).toBeVisible();
  await expect(detail.getByText("Comentario de la segunda página")).toBeVisible();

  await page.keyboard.press("j");
  await expect(list.getByRole("button", { name: /Perfil Dos/ })).toHaveAttribute("aria-current", "true");
  await expect(detail.getByText("“Mensaje intimidante”")).toBeVisible();
  await expect(detail.getByText("Comentario de la segunda página")).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "Suspender", exact: true }).first()).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await expect(detail.getByText("Tema 1 de 2")).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole("region", { name: "Temas reportados" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Moderación" })).toBeVisible();
});

/** El id de una cuenta, buscándola por nombre en la grilla de Gente. */
async function idOf(page: import("@playwright/test").Page, name: string) {
  const res = await page.request.get("/api/nearby");
  const body = await res.json();
  const people: { id: string; name?: string; displayName?: string }[] = Array.isArray(body) ? body : body.people ?? body.items ?? [];
  const found = people.find((p) => (p.name ?? p.displayName) === name);
  if (!found) throw new Error(`No encontré a ${name} en /api/nearby: ${JSON.stringify(body).slice(0, 200)}`);
  return found.id;
}
