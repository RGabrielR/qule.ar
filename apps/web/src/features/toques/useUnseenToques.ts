import { useEffect, useState } from "react";
import { api, getSocket } from "../../api";

/**
 * Cuántas personas te mandaron un toque que todavía no viste. Se actualiza cuando llega uno en vivo
 * y cuando abrís Toques (que los marca como vistos y avisa con `mortero:toques`).
 */
export function useUnseenToques(enabled: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const refresh = () => {
      api<{ count: number }>("/toques/unseen").then((r) => { if (alive) setCount(r.count); }).catch(() => {});
    };
    refresh();
    const s = getSocket();
    s.on("toque", refresh);
    window.addEventListener("mortero:toques", refresh);
    return () => {
      alive = false;
      s.off("toque", refresh);
      window.removeEventListener("mortero:toques", refresh);
    };
  }, [enabled]);
  return count;
}
