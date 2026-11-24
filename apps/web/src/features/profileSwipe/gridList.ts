import { api, type NearbyPerson } from "../../api";

/** Lo mínimo de cada persona de la grilla para pasar de un perfil al otro. */
export type GridPerson = Pick<NearbyPerson, "id" | "name" | "photo">;

export type GridList = {
  userId: string;
  /** Los filtros de la grilla, tal como van en `/api/nearby` (sin `offset`). */
  query: string;
  people: GridPerson[];
  hasMore: boolean;
};

type NearbyPage = { people: NearbyPerson[]; hasMore: boolean };

// Una lista por entrada del historial de la grilla, en memoria: no se guarda en el teléfono.
const lists = new Map<string, GridList>();
const pending = new Map<string, Promise<GridList | undefined>>();
const LIMIT = 20;

export function toGridPerson({ id, name, photo }: NearbyPerson): GridPerson {
  return { id, name, photo };
}

export function saveGridList(entry: string, list: GridList) {
  lists.delete(entry);
  lists.set(entry, list);
  if (lists.size > LIMIT) {
    const oldest = lists.keys().next().value;
    if (oldest !== undefined) lists.delete(oldest);
  }
}

export function getGridList(entry: string | undefined, userId: string | undefined): GridList | undefined {
  const list = entry ? lists.get(entry) : undefined;
  return list && list.userId === userId ? list : undefined;
}

/** Trae la página siguiente de la grilla con los mismos filtros, como "Ver más". */
export function loadMoreGrid(entry: string): Promise<GridList | undefined> {
  const running = pending.get(entry);
  if (running) return running;
  const list = lists.get(entry);
  if (!list?.hasMore) return Promise.resolve(list);
  const query = new URLSearchParams(list.query);
  query.set("offset", String(list.people.length));
  const request = api<NearbyPage>(`/nearby?${query}`)
    .then((page) => {
      const current = lists.get(entry);
      // Si mientras tanto la grilla se recargó con otros filtros, esta página ya no sirve.
      if (current !== list) return current;
      const seen = new Set(list.people.map((p) => p.id));
      const fresh = page.people.filter((p) => !seen.has(p.id)).map(toGridPerson);
      const next = { ...list, people: [...list.people, ...fresh], hasMore: page.hasMore && page.people.length > 0 };
      saveGridList(entry, next);
      return next;
    })
    .finally(() => pending.delete(entry));
  pending.set(entry, request);
  return request;
}
