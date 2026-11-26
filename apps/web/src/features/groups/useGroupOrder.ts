import { useState } from "react";

function savedOrder(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function useGroupOrder<T extends { id: string }>(userId: string, groups: T[] | null) {
  const key = `mortero:group-order:${userId}`;
  const [order, setOrder] = useState(() => savedOrder(key));
  const rank = new Map(order.map((id, index) => [id, index]));
  const ordered = groups && [...groups].sort((a, b) =>
    (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));

  function save(ids: string[]) {
    setOrder(ids);
    try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* Puede estar deshabilitado. */ }
  }

  function move(index: number, delta: -1 | 1) {
    if (!ordered || index + delta < 0 || index + delta >= ordered.length) return;
    const ids = ordered.map((group) => group.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    save(ids);
  }

  return { ordered, move, reset: () => save([]) };
}
