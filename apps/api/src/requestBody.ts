import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";

const MiB = 1024 * 1024;

const limit = (maxSize: number) => bodyLimit({
  maxSize,
  onError: (c) => c.json({ error: "La solicitud supera el tamaño permitido." }, 413),
});
const small = limit(64 * 1024);
const photo = limit(13 * MiB);
const album = limit(81 * MiB);

export const limitApiBody = createMiddleware(async (c, next) => {
  const multipart = /^multipart\/form-data(?:;|$)/i.test(c.req.header("content-type") ?? "");
  if (!multipart) return small(c, next);

  if (c.req.method === "POST" && c.req.path === "/api/me/photos") return album(c, next);
  if (c.req.method === "POST" && /^\/api\/(?:conversations\/[^/]+\/messages|groups\/[^/]+\/photo)$/.test(c.req.path)) {
    return photo(c, next);
  }
  return small(c, next);
});
