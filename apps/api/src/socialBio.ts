import { Parser } from "htmlparser2";

export type Network = "instagram" | "x";

export function validHandle(network: Network, handle: string) {
  return network === "x" ? /^[a-z0-9_]{1,15}$/i.test(handle)
    : handle.length <= 30 && /^[a-z0-9_]+(?:\.[a-z0-9_]+)*$/i.test(handle);
}

export async function readBio(network: Network, handle: string): Promise<string | null | { retryAfter: string | null }> {
  if (!validHandle(network, handle)) return null;
  const url = network === "x" ? `https://x.com/${handle}` : `https://www.instagram.com/${handle}/`;
  try {
    const res = await fetch(url, {
      redirect: "error", signal: AbortSignal.timeout(8000),
      headers: { "Accept-Language": "en-US", "Cache-Control": "no-cache" },
    });
    if (res.status === 429) {
      await res.body?.cancel();
      return { retryAfter: res.headers.get("Retry-After") };
    }
    if (!res.body) return null;
    const reader = res.body.getReader();
    const meta = new Map<string, string>();
    let ended = false;
    const parser = new Parser({
      onopentag(tag, attrs) {
        if (tag === "body") ended = true;
        if (!ended && tag === "meta") meta.set(attrs.property ?? attrs.name, attrs.content);
      },
      onclosetag(tag) { if (tag === "head") ended = true; },
    });
    try {
      if (!res.ok || !res.headers.get("content-type")?.includes("text/html")) return null;
      const decoder = new TextDecoder();
      let size = 0;
      while (!ended) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000) return null;
        parser.write(decoder.decode(value, { stream: true }));
      }
      if (meta.get("og:url")?.toLowerCase() !== url.toLowerCase()) return null;
      const description = meta.get("description");
      if (network === "x") return meta.get("twitter:creator")?.toLowerCase() === `@${handle.toLowerCase()}` ? description ?? null : null;
      // Instagram incluye estadísticas y nombre antes de la bio entre comillas.
      if (!description) return null;
      // Instagram muestra (@usuario) con nombre visible o @usuario solo, según el perfil.
      // Tomamos el último delimitador para excluir estadísticas y nombre de presentación.
      const escaped = handle.replaceAll(".", "\\.");
      const boundary = new RegExp(`(?:\\(@${escaped}\\)|(?:^|\\s)@${escaped}) (?:on|en) Instagram:\\s*`, "gi");
      const marker = [...description.matchAll(boundary)].at(-1);
      if (!marker || marker.index === undefined) return null;
      const quoted = description.slice(marker.index + marker[0].length);
      const closing = { '"': '"', '“': '”', '«': '»' }[quoted[0]];
      return closing && quoted.endsWith(closing) ? quoted.slice(1, -1) : null;
    } finally {
      await reader.cancel();
    }
  } catch {
    return null;
  }
}
