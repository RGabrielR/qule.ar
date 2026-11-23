import { HTTPException } from "hono/http-exception";
import { hit } from "./shared.js";

/**
 * Límites por persona para las acciones de la app. Frenan el abuso (mandar mensajes a cientos de personas,
 * llenar el disco con fotos, inundar a moderación con reportes) sin molestar a quien usa la app normalmente.
 * El login y el registro tienen su propio límite por IP (ver auth.ts).
 *
 * Se guardan en memoria. Con varios procesos del API, los cuenta el proceso principal para todos (ver shared.ts).
 */
type Rule = { max: number; windowMs: number; message: string };

const MIN = 60_000;
const HOUR = 60 * MIN;

export const LIMITS = {
  /** Mensajes privados de texto */
  dm: { max: 40, windowMs: MIN, message: "Vas muy rápido. Esperá un momento y seguí." },
  /** Charlas nuevas con alguien con quien nunca hablaste (el spam masivo empieza así) */
  newChat: { max: 30, windowMs: HOUR, message: "Abriste muchas charlas nuevas. Probá de nuevo en un rato." },
  /** Fotos por mensaje privado */
  dmPhoto: { max: 30, windowMs: HOUR, message: "Mandaste muchas fotos. Probá de nuevo en un rato." },
  /** Fotos y videos al perfil o al álbum (el álbum admite 40, así que se pueden subir todas de una) */
  upload: { max: 60, windowMs: HOUR, message: "Subiste muchas fotos. Probá de nuevo en un rato." },
  /** Reportes */
  report: { max: 15, windowMs: HOUR, message: "Mandaste muchos reportes. Si es urgente, esperá un rato y volvé a intentar." },
  /** Toques a cualquier persona (a una misma ya hay un límite de uno cada 12 horas) */
  toque: { max: 40, windowMs: HOUR, message: "Mandaste muchos toques. Probá de nuevo en un rato." },
  /** Pedidos de revisión de una suspensión (igual hay uno por suspensión y una sola ampliación) */
  appeal: { max: 5, windowMs: HOUR, message: "Probá de nuevo en un rato." },
} satisfies Record<string, Rule>;

/** Cuenta una acción y corta con 429 si la persona pasó el límite. Con varios procesos, cuenta en todos juntos. */
export async function limit(userId: string, action: keyof typeof LIMITS) {
  const rule = LIMITS[action];
  if (!(await hit(`${action}:${userId}`, rule.max, rule.windowMs))) {
    throw new HTTPException(429, { message: rule.message });
  }
}
