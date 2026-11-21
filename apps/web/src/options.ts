// Opciones del perfil. Son texto libre en la base: cualquiera puede proponer agregar o cambiar opciones.

export const BODY_TYPES = ["Delgado", "Promedio", "Atlético", "Musculoso", "Robusto", "Grande"];
export const POSITIONS = ["Activo", "Versátil activo", "Versátil", "Versátil pasivo", "Pasivo", "Side"];
export const TRIBES = [
  "Oso", "Nutria", "Lobo", "Chaser", "Twink", "Maduro", "Deportista", "Geek",
  "Cuero", "Discreto", "Trans", "Poz", "No binarie", "Drag",
];
export const LOOKING_FOR = ["Charlar", "Amistad", "Citas", "Pareja", "Contactos", "Ahora", "Networking"];
export const RELATIONSHIP = ["Soltero", "Saliendo con alguien", "En pareja", "Relación abierta", "Casado", "Es complicado"];
export const PRONOUNS = ["él", "elle", "ella", "él/elle", "ella/elle"];
export const HIV_STATUS = [
  "Negativo", "Negativo, con PrEP", "Positivo", "Positivo, indetectable", "Prefiero no decir",
];
/** Tiene que coincidir con apps/api/src/moderation.ts. Los tres primeros son urgentes (ver docs/MODERACION.md). */
export const REPORT_REASONS = [
  "menor de edad",
  "contenido íntimo sin consentimiento",
  "amenazas o violencia",
  "venta o drogas",
  "acoso",
  "fotos inapropiadas",
  "perfil falso",
  "spam",
  "otro",
] as const;
export const URGENT_REASONS: readonly string[] = REPORT_REASONS.slice(0, 3);
