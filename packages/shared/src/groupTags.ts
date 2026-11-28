import { BODY_TYPES, LOOKING_FOR, POSITIONS, RELATIONSHIP, TRIBES } from "./peopleFilters.js";

function hashtags(options: readonly string[]) {
  return options.map((option) => `#${option.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replaceAll(" ", "-")}`);
}

export const GROUP_TAG_SECTIONS = [
  { label: "Contextura", tags: hashtags(BODY_TYPES) },
  { label: "Rol", tags: hashtags(POSITIONS) },
  { label: "Tribus", tags: hashtags(TRIBES) },
  { label: "Busca", tags: hashtags(LOOKING_FOR) },
  { label: "Relación", tags: hashtags(RELATIONSHIP) },
  { label: "Lugar", tags: ["#tiene-lugar", "#no-tiene-lugar"] },
  { label: "Otros filtros de Gente", tags: ["#edad", "#altura", "#peso", "#en-linea", "#favoritos", "#con-foto"] },
];

const allowedTags = new Set(GROUP_TAG_SECTIONS.flatMap(({ tags }) => tags));
export const GROUP_TAG_COUNT = allowedTags.size;
export const isGroupTag = (tag: string) => allowedTags.has(tag);

export function groupTagsFromQuery(value: string | null | undefined): string[] {
  return [...new Set((value ?? "").slice(0, 2048).split(",").filter(isGroupTag))].sort();
}
