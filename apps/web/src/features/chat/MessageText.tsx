import { useState, type ReactNode } from "react";
import { ExternalLinkDialog } from "./ExternalLinkDialog";

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
      return url;
    }
  } catch {
    // Conservá el texto original si no forma una URL.
  }
  return null;
}

export function MessageText({ text }: { text: string | null }) {
  const [destination, setDestination] = useState<URL | null>(null);
  if (!text) return null;
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(links)) {
    const start = match.index;
    const label = trimTrailingPunctuation(match[0]);
    const url = toExternalUrl(label);
    if (!url) continue;

    parts.push(text.slice(cursor, start));
    parts.push(
      <button
        key={start}
        type="button"
        className="message-link"
        aria-haspopup="dialog"
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          setDestination(url);
        }}
      >
        {label}
      </button>,
    );
    cursor = start + label.length;
  }

  parts.push(text.slice(cursor));
  return (
    <>
      {parts}
      {destination && <ExternalLinkDialog destination={destination} onClose={() => setDestination(null)} />}
    </>
  );
}
