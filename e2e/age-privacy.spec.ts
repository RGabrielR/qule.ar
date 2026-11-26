import { expect, test } from "@playwright/test";
import { createAccount, signIn } from "./fixtures";

test.use({ viewport: { width: 375, height: 812 } });

test("podés ocultar tu edad y quedar fuera de las búsquedas por edad", async ({ page, browser, baseURL }) => {
  const account = await createAccount(baseURL!, "Perfil discreto");
  const viewer = await createAccount(baseURL!, "Visita");
  await signIn(page, account);
  const { user } = await (await page.request.get("/api/me")).json();
  const other = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 } });
  try {
    const visitor = await other.newPage();
    await signIn(visitor, viewer);
    const profile = async () => {
      const response = await visitor.request.get(`/api/users/${user.id}`);
      await expect(response).toBeOK();
      return response.json();
    };
    const people = async (query = "") => {
      const response = await visitor.request.get(`/api/nearby${query}`);
      await expect(response).toBeOK();
      return (await response.json()).people;
    };

    const headers = { Origin: baseURL! };
    const created = await visitor.request.post("/api/groups", { headers, data: { name: "Grupo de privacidad" } });
    await expect(created).toBeOK();
    const { id: groupId } = await created.json();
    const group = `/api/groups/${groupId}`;
    await expect(await page.request.post(`${group}/requests`, { headers, data: {} })).toBeOK();
    const groupResults = async (path: string) => {
      const response = await visitor.request.get(group + path);
      await expect(response).toBeOK();
      return response.json();
    };

    const age = (await profile()).age;
    expect(age).toBeGreaterThan(18);
    expect(await people(`?ageMin=${age}&ageMax=${age}`)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: user.id, age })]),
    );

    await page.goto("/yo/configuracion");
    const showAge = page.getByRole("checkbox", { name: /Mostrar mi edad/ });
    await expect(showAge).toBeChecked();
    await showAge.click();
    await expect.poll(async () => (await profile()).age).toBeNull();
    expect(await people()).toEqual(expect.arrayContaining([expect.objectContaining({ id: user.id, age: null })]));
    for (const query of [`?ageMin=${age}`, `?ageMax=${age}`]) {
      expect(await people(query)).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: user.id })]));
    }

    const candidate = expect.objectContaining({ id: user.id });
    const application = expect.objectContaining({ user: candidate });
    expect((await groupResults(`/invite-candidates?q=${encodeURIComponent(account.name)}`)).people).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: user.id, age: null })]),
    );
    expect((await groupResults(`/invite-candidates?ageMin=${age}`)).people).not.toEqual(expect.arrayContaining([candidate]));
    expect((await groupResults("/requests")).items).toEqual(expect.arrayContaining([application]));
    expect((await groupResults(`/requests?edadMax=${age}`)).items).not.toEqual(expect.arrayContaining([application]));

    await page.reload();
    await expect(showAge).not.toBeChecked();
    await showAge.click();
    await expect.poll(async () => (await profile()).age).toBe(age);
  } finally {
    await other.close();
  }
});
