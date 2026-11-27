/** Aísla un texto como <bdi> cuando el destino solo acepta texto plano. */
export function isolateText(text: string) {
  return `\u2068${text}\u2069`;
}
