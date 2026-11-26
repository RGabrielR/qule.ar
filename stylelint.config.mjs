// Reglas de la marca para el CSS (npm run lint:css). Guía: docs/LOOK.md
// Los valores salen de packages/brand: acá solo se controla que el CSS use sus variables.
const token = (prefix) => new RegExp(`^var\\(--${prefix}-[a-z0-9-]+\\)$`);
const radius = /^(0|var\(--radius-[a-z0-9]+\))(\s+(0|var\(--radius-[a-z0-9]+\)))*$/;

/** @type {import("stylelint").Config} */
export default {
  rules: {
    // Colores: siempre con una variable (var(--accent), var(--danger-soft)…), nunca sueltos
    "color-no-hex": [true, { message: "Usá una variable de color de la marca (packages/brand), no un color suelto." }],
    "color-named": ["never", { message: "Usá una variable de color de la marca (packages/brand), no un color por nombre." }],
    "function-disallowed-list": [
      ["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color"],
      { message: "Usá una variable de color de la marca (packages/brand). Si necesitás una transparencia nueva, agregala ahí." },
    ],
    "declaration-property-value-allowed-list": [
      {
        "/^border(-[a-z]+)*-radius$/": [radius],
        "font-size": [token("(text|title|display|wordmark)"), "inherit"],
        "font-family": ["var(--font)", "var(--display)", "inherit"],
        "font-weight": ["400", "500", "600", "700", "800", "inherit"],
        "font": ["inherit", /^var\(--text-[a-z0-9-]+\)\/[\d.]+ var\(--(font|display)\)$/],
        "box-shadow": ["none", token("shadow")],
        "filter": ["none", /^drop-shadow\(var\(--shadow-[a-z0-9-]+\)\)$/],
        "z-index": [token("z"), "auto", "0"],
      },
      {
        message: (prop) =>
          `"${prop}" tiene que usar una variable de la marca (radius-*, text-*/title-*, shadow-*, z-*…). Si falta, agregala en packages/brand.`,
      },
    ],
    "declaration-block-no-duplicate-properties": true,
    "no-duplicate-selectors": true,
  },
};
