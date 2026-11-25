import assert from "node:assert/strict";
import test from "node:test";
import { readBio } from "./socialBio.js";

test("Instagram separa la bio del nombre y falla cerrado cuando falta el perfil público", async t => {
  const canonical = '<meta property="og:url" content="https://www.instagram.com/ana.luz/">';
  for (const [tags, expected] of [
    [canonical + '<meta name="description" content="31 Followers - @ana.luz on Instagram: &quot;Una bio&quot;">', "Una bio"],
    [canonical + '<meta name="description" content="31 seguidores - Ana (@ana.luz) en Instagram: «Primera línea\nsegunda línea»">', "Primera línea\nsegunda línea"],
    [canonical + '<meta name="description" content="Código en el nombre (@ana.luz) on Instagram: &quot;Bio sin código&quot;">', "Bio sin código"],
    [canonical + '<meta property="og:description" content="See Instagram photos and videos from @ana.luz">', null],
    [canonical + '<meta name="description" content="Otra (@anaXluz) on Instagram: &quot;Otra bio&quot;">', null],
    ['<title>Instagram</title>', null],
  ]) {
    const fetch = t.mock.method(globalThis, "fetch", async () => new Response(`<head>${tags}</head>`, { headers: { "content-type": "text/html" } }));
    try {
      assert.equal(await readBio("instagram", "ana.luz"), expected);
    } finally {
      fetch.mock.restore();
    }
  }
});
