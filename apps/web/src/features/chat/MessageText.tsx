import type { ReactNode } from "react";

const links = /(?:^|(?<=[\s([{<"'“‘¿¡]))(?:https?:\/\/|www\.)[^\s<>"'“”‘’]+/gi;

const closingPairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

function trimTrailingPunctuation(value: string) {
  let url = value.replace(/[.,!?;:…]+$/u, "");
  for (;;) {
    const close = url.at(-1) ?? "";
    const open = closingPairs[close];
    if (!open || url.split(close).length <= url.split(open).length) return url;
    url = url.slice(0, -1).replace(/[.,!?;:…]+$/u, "");
  }
}

function toExternalUrl(value: string) {
  try {
    const url = new URL(/^www\./i.test(value) ? `https://${value}` : value);
    if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password) {
      return url.href;
    }
  } catch {
    // Conservá el texto original si no forma una URL.
  }
  return null;
}

export function MessageText({ text }: { text: string | null }) {
  if (!text) return null;
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(links)) {
    const start = match.index;
    const label = trimTrailingPunctuation(match[0]);
    const href = toExternalUrl(label);
    if (!href) continue;

    parts.push(text.slice(cursor, start));
    parts.push(
      <a key={start} className="message-link" href={href} target="_blank" rel="noopener noreferrer">
        {label}
      </a>,
    );
    cursor = start + label.length;
  }

  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
