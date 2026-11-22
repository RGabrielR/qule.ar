import { eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { cityKey, DISCOVERY_COUNTRIES } from "../../../../packages/geo/discovery.js";
import { db, schema } from "../db/index.js";
import { distanceLabel, snapToCell, visibleKm } from "../geo.js";
import { ageFrom, firstPublicPhotoKeys, thumbUrl, requireProfile, requireUser, type AppEnv } from "../lib.js";
import { autoHiddenUsers } from "../moderation.js";
import { isOnline } from "../realtime.js";
import { hit } from "../shared.js";

const { profile } = schema;

/** Radio máximo de búsqueda de la grilla. */
const PAGE = 60;
/** Cuánto tiempo después de cerrar la app se te sigue mostrando como "hace un rato". */
const RECENT_MS = 15 * 60_000;

export const nearbyRoutes = new Hono<AppEnv>();
nearbyRoutes.use("/nearby", requireUser, requireProfile);
nearbyRoutes.use("/me/location", requireUser, requireProfile);
nearbyRoutes.use("/me/privacy", requireUser, requireProfile);

/**
 * Cuántas veces por hora se puede cambiar de zona. Alguien que se mueve de verdad cambia pocas veces; quien
 * intenta triangular a otra persona necesita moverse muchas. Pasado el límite se ignora en silencio.
 */
const MAX_CELL_CHANGES_PER_HOUR = 20;

/**
 * Guarda la ubicación redondeada a la celda. La posición exacta no se guarda ni se loguea.
 * `auto`: la manda la app sola para mantenerla al día. Si la persona borró su ubicación, se ignora:
 * volver a aparecer en la grilla siempre lo decide ella, tocando "Compartir".
 */
nearbyRoutes.put("/me/location", async (c) => {
  const u = c.get("user");
  const r = z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), auto: z.boolean().optional() })
    .safeParse(await c.req.json());
  if (!r.success) throw new HTTPException(400, { message: "Ubicación inválida" });
  const me = c.get("profile")!;
  if (r.data.auto && (me.cellLat == null || me.cellLng == null)) return c.json({ ok: true });
  const cell = snapToCell(r.data.lat, r.data.lng);
  if (me.cellLat !== cell.lat || me.cellLng !== cell.lng) {
    if (!(await hit(`cell:${u.id}`, MAX_CELL_CHANGES_PER_HOUR, 3_600_000))) return c.json({ ok: true });
  }
  await db
    .update(profile)
    .set({ cellLat: cell.lat, cellLng: cell.lng, locationUpdatedAt: new Date() })
    .where(eq(profile.userId, u.id));
  return c.json({ ok: true });
});

/** Borra la ubicación: dejás de aparecer en la grilla. */
nearbyRoutes.delete("/me/location", async (c) => {
  const u = c.get("user");
  await db.update(profile).set({ cellLat: null, cellLng: null, locationUpdatedAt: null }).where(eq(profile.userId, u.id));
  return c.json({ ok: true });
});

nearbyRoutes.put("/me/privacy", async (c) => {
  const u = c.get("user");
  const data = z.object({ showDistance: z.boolean().optional(), incognito: z.boolean().optional() }).parse(await c.req.json());
  await db.update(profile).set(data).where(eq(profile.userId, u.id));
  return c.json({ ok: true });
});

const list = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 20) : []));
const int = z.coerce.number().int().optional();

const filtersSchema = z.object({
  ageMin: int, ageMax: int,
  heightMin: int, heightMax: int,
  weightMin: int, weightMax: int,
  bodyType: list, position: list, tribes: list, lookingFor: list, relationship: list,
  online: z.enum(["1"]).optional(),
  country: z.enum(DISCOVERY_COUNTRIES).optional(),
  city: z.string().trim().min(2).max(60).refine((value) => /\p{L}/u.test(value)).optional(),
  withPhoto: z.enum(["1"]).optional(),
  favorites: z.enum(["1"]).optional(),
  offset: z.coerce.number().int().min(0).max(2000).default(0),
});

export type NearbyFilters = z.infer<typeof filtersSchema>;

/** Fecha de nacimiento límite para tener al menos `years` años hoy (misma cuenta que ageFrom). */
function bornOnOrBefore(years: number, now = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${String(now.getFullYear() - years).padStart(4, "0")}-${mm}-${dd}`;
}

type Candidate = { user_id: string; cell_lat: number | null; cell_lng: number | null; show_distance: boolean; seen: number };

/**
 * Grilla de gente cerca, de la más cercana a la más lejana.
 *
 * Es el pedido más usado de la app, así que se hace en dos pasos para no cargar perfiles enteros de más:
 * 1. Postgres aplica todos los filtros y devuelve solo lo necesario para ordenar (id, celda y última vez visto).
 * 2. Se ordena acá (en línea vive en memoria) y se buscan nombre, edad y foto solo de la página que se muestra.
 */
nearbyRoutes.get("/nearby", async (c) => {
  return c.json(await nearbyPage(c.get("profile")!, filtersSchema.parse(c.req.query())));
});

type Me = { userId: string; cellLat: number | null; cellLng: number | null; showDistance: boolean };

/** Una página de la grilla para `me`. Separada de la ruta para poder probarla sin sesión (ver nearby.test.ts). */
export async function nearbyPage(me: Me, f: NearbyFilters) {
  if (Boolean(f.country) !== Boolean(f.city)) {
    throw new HTTPException(400, { message: "Elegí un país y una ciudad." });
  }
  const u = { id: me.userId };
  // Mostramos a todes, sin límite de distancia: al principio somos pocas personas y la idea es que se encuentren.
  // Con ubicación, se ordena de más cerca a más lejos; sin ubicación, por quién está en línea.
  const meHasLoc = me.cellLat != null && me.cellLng != null;

  const conds = [
    sql`p.user_id <> ${u.id}`,
    sql`p.incognito = false`, // en incógnito no se aparece en la grilla
    sql`p.suspended_at is null`,
    sql`not exists (select 1 from block b where (b.blocker_id = ${u.id} and b.blocked_id = p.user_id) or (b.blocker_id = p.user_id and b.blocked_id = ${u.id}))`,
  ];
  if (f.country && f.city) conds.push(sql`p.discovery_country = ${f.country} and p.discovery_city_key = ${cityKey(f.city)}`);
  // Las fechas van como texto AAAA-MM-DD, igual que se guardan
  if (f.ageMin != null) conds.push(sql`p.birthdate <= ${bornOnOrBefore(f.ageMin)}::date`);
  if (f.ageMax != null) conds.push(sql`p.birthdate > ${bornOnOrBefore(f.ageMax + 1)}::date`);
  if (f.heightMin != null) conds.push(sql`p.height_cm >= ${f.heightMin}`);
  if (f.heightMax != null) conds.push(sql`p.height_cm <= ${f.heightMax}`);
  if (f.weightMin != null) conds.push(sql`p.weight_kg >= ${f.weightMin}`);
  if (f.weightMax != null) conds.push(sql`p.weight_kg <= ${f.weightMax}`);
  const textArray = (xs: string[]) => sql`array[${sql.join(xs.map((x) => sql`${x}`), sql`, `)}]::text[]`;
  if (f.bodyType.length) conds.push(sql`p.body_type = any(${textArray(f.bodyType)})`);
  if (f.position.length) conds.push(sql`p.position = any(${textArray(f.position)})`);
  if (f.relationship.length) conds.push(sql`p.relationship = any(${textArray(f.relationship)})`);
  if (f.tribes.length) conds.push(sql`jsonb_exists_any(p.tribes, ${textArray(f.tribes)})`);
  if (f.lookingFor.length) conds.push(sql`jsonb_exists_any(p.looking_for, ${textArray(f.lookingFor)})`);
  if (f.favorites) conds.push(sql`exists (select 1 from favorite fv where fv.user_id = ${u.id} and fv.favorite_id = p.user_id)`);
  if (f.withPhoto) conds.push(sql`exists (select 1 from photo ph where ph.user_id = p.user_id and ph.is_private = false)`);

  // Sin pasar por el ORM: son miles de filas chicas y convertirlas una por una era lo que más tiempo llevaba
  const [hidden, favorites, result] = await Promise.all([
    // Ocultos por precaución: varios reportes urgentes sin revisar (ver moderation.ts)
    autoHiddenUsers(),
    db.select({ id: schema.favorite.favoriteId }).from(schema.favorite).where(eq(schema.favorite.userId, u.id)),
    db.execute(sql`
      select p.user_id, p.cell_lat, p.cell_lng, p.show_distance, (extract(epoch from p.last_seen_at) * 1000)::float8 as seen
      from profile p
      where ${sql.join(conds, sql` and `)}
      order by p.last_seen_at desc
      limit 3000`),
  ]);
  const rows = (result as unknown as { rows: Candidate[] }).rows;
  const favs = new Set(favorites.map((r) => r.id));
  const now = Date.now();

  const candidates = rows
    .filter((p) => !hidden.has(p.user_id))
    .map((p) => {
      const km = f.city ? null : visibleKm(me, { cellLat: p.cell_lat, cellLng: p.cell_lng, showDistance: p.show_distance });
      const on = isOnline(p.user_id);
      return { id: p.user_id, seen: p.seen, km, online: on, recent: on || now - p.seen < RECENT_MS };
    })
    .filter((x) => !f.online || x.online);

  // Primero la distancia (por celda; quien no tiene ubicación va al final); a igual distancia, quien está en línea va antes
  const far = Number.POSITIVE_INFINITY;
  candidates.sort((a, b) =>
    (a.km ?? far) - (b.km ?? far) ||
    Number(b.online) - Number(a.online) ||
    b.seen - a.seen);

  const page = candidates.slice(f.offset, f.offset + PAGE);
  const ids = page.map((x) => x.id);
  const [details, first] = await Promise.all([
    ids.length
      ? db.select({ userId: profile.userId, displayName: profile.displayName, birthdate: profile.birthdate })
          .from(profile).where(inArray(profile.userId, ids))
      : [],
    firstPublicPhotoKeys(ids),
  ]);
  const byId = new Map(details.map((d) => [d.userId, d]));

  return {
    needLocation: false,
    hasLocation: meHasLoc,
    hasMore: candidates.length > f.offset + PAGE,
    total: candidates.length,
    people: page.flatMap(({ id, km, online, recent }) => {
      const d = byId.get(id);
      if (!d) return []; // borró la cuenta entre los dos pasos
      return [{
        id,
        name: d.displayName,
        age: ageFrom(d.birthdate),
        photo: thumbUrl(first.get(id)),
        online,
        recent,
        favorite: favs.has(id),
        // Si cualquiera de los dos eligió esconder la distancia, km es null (ver visibleKm)
        distance: km != null ? distanceLabel(km) : null,
      }];
    }),
  };
}

export const parseNearbyFilters = (q: Record<string, string>) => filtersSchema.parse(q);
