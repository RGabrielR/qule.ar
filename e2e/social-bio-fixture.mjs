// Solo se carga en el servidor de Playwright. El test publica la bio en un archivo temporal.
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const match = typeof input === "string" && /^https:\/\/(www\.instagram\.com|x\.com)\/(test_[a-z0-9]+)\/?$/.exec(input);
  if (!match) return originalFetch(input, options);
  const [, domain, handle] = match;
  const code = await readFile(join(tmpdir(), `qule-bio-${domain}-${handle}`), "utf8").catch(() => "");
  if (code === "fixture:429") return new Response(null, { status: 429, headers: { "Retry-After": "120" } });
  const bio = domain === "x.com" ? code : `31 Followers - @${handle} on Instagram: &quot;${code}&quot;`;
  return new Response(`<head><meta property="og:url" content="${input}"><meta name="twitter:creator" content="@${handle}"><meta name="description" content="${bio}"></head>`, { headers: { "content-type": "text/html" } });
};
