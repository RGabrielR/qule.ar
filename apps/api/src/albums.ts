import { asc, eq } from "drizzle-orm";
import { db, schema } from "./db/index.js";
import { newId } from "./lib.js";

const { album, photo } = schema;

/** Cuántos álbumes privados puede tener cada persona. */
export const MAX_ALBUMS = 5;
/** Cuántas fotos y videos privados puede tener cada persona, sumando todos sus álbumes. */
export const MAX_ALBUM_ITEMS = 40;
export const MAX_ALBUM_NAME = 30;
/** Nombre del álbum por defecto (el que se crea solo al subir el primer archivo privado). */
export const DEFAULT_ALBUM_NAME = "Álbum privado";

/** Los álbumes de alguien, en orden. El primero es el álbum por defecto. */
export function myAlbums(userId: string) {
  return db.select().from(album).where(eq(album.userId, userId)).orderBy(asc(album.position), asc(album.createdAt));
}

/** El álbum por defecto de alguien; si no tiene ninguno, lo crea. */
export async function defaultAlbum(userId: string) {
  const [first] = await myAlbums(userId);
  if (first) return first;
  const [row] = await db.insert(album).values({ id: newId(), userId, name: DEFAULT_ALBUM_NAME, position: 0 }).returning();
  return row;
}

/** Vuelve a numerar las fotos de alguien de 0 en adelante, en el mismo orden (después de borrar). */
export async function renumberPhotos(userId: string) {
  const rest = await db.select().from(photo).where(eq(photo.userId, userId)).orderBy(asc(photo.position));
  for (const [i, p] of rest.entries()) {
    if (p.position !== i) await db.update(photo).set({ position: i }).where(eq(photo.id, p.id));
  }
}
