import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { limitApiBody } from "./requestBody.js";

test("la API limita JSON y multipart antes del handler", async () => {
  const app = new Hono();
  let handled = 0;
  app.use("/api/*", limitApiBody);
  app.post("/api/*", async (c) => {
    handled++;
    return c.json({ length: (await c.req.arrayBuffer()).byteLength });
  });

  const request = (path: string, type: string, body: string, length?: number) => app.request(path, {
    method: "POST", headers: { "content-type": type, ...(length == null ? {} : { "content-length": String(length) }) }, body,
  });
  const oversized = 65 * 1024;
  assert.equal((await request("/api/auth/test", "application/json", "{}", oversized)).status, 413);
  assert.equal((await request("/api/auth/test", "application/json", "x".repeat(oversized))).status, 413);
  assert.equal((await request("/api/auth/test", "multipart/form-data; boundary=qule", "", oversized)).status, 413);
  assert.equal((await request("/api/conversations/c/messages", "multipart/form-data; boundary=qule", "", 14 * 1024 ** 2)).status, 413);
  assert.equal((await request("/api/groups/g/photo", "multipart/form-data; boundary=qule", "", 14 * 1024 ** 2)).status, 413);
  assert.equal((await request("/api/me/photos", "multipart/form-data; boundary=qule", "", 82 * 1024 ** 2)).status, 413);
  assert.equal(handled, 0);
  const normal = await request("/api/auth/test", "application/json", "{}");
  assert.deepEqual(await normal.json(), { length: 2 });
  const form = new FormData();
  form.set("file", new Blob(["foto de prueba"], { type: "image/png" }), "foto.png");
  assert.equal((await app.request("/api/groups/g/photo", { method: "POST", body: form })).status, 200);
  assert.equal(handled, 2);
});
