/** Quita los controles que fuerzan o aíslan una dirección, y conserva las letras de cualquier idioma. */
export function stripBidiControls(name: string): string {
  return name.replace(/[\u202A-\u202E\u2066-\u2069]/g, "");
}
