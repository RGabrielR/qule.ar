export const ZODIAC_SIGNS = [
  "aries", "tauro", "geminis", "cancer", "leo", "virgo",
  "libra", "escorpio", "sagitario", "capricornio", "acuario", "piscis",
] as const;

export type ZodiacSign = (typeof ZODIAC_SIGNS)[number];
