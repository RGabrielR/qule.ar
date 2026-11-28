// Opciones del perfil. Son texto libre en la base: cualquiera puede proponer agregar o cambiar opciones.

export { BODY_TYPES, LOOKING_FOR, POSITIONS, RELATIONSHIP, TRIBES } from "@mortero/shared/peopleFilters";
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
