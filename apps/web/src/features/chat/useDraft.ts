import { useEffect, useRef, useState } from "react";

// Los borradores viven solo en memoria: no se guardan en el servidor ni en el disco.
const drafts = new Map<string, string>();

/**
 * Guarda el texto sin enviar de un chat mientras se navega a otra pantalla.
 * No persiste si `enabled` es false (por ejemplo, mientras se edita un mensaje).
 */
export function useDraft(key: string, enabled = true) {
  const [text, setText] = useState(() => drafts.get(key) ?? "");
  const lastKey = useRef(key);

  useEffect(() => {
    if (lastKey.current !== key) {
      lastKey.current = key;
      setText(drafts.get(key) ?? "");
      return;
    }
    if (!enabled) return;
    if (text) drafts.set(key, text);
    else drafts.delete(key);
  }, [key, text, enabled]);

  return [text, setText] as const;
}
