export const DISCOVERY_COUNTRIES = ["AR", "MX"] as const;
export type DiscoveryCountry = (typeof DISCOVERY_COUNTRIES)[number];
export const DISCOVERY_NAMES: Record<DiscoveryCountry, string> = { AR: "Argentina", MX: "México" };

export function cityKey(name: string) {
  return name.trim().normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ");
}
