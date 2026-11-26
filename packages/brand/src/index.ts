/**
 * La marca de qule.ar, en un solo lugar.
 *
 * Todo lo que define cómo se ve y cómo se llama la app sale de acá:
 * - la web: las variables CSS (las genera `tokensCss()`; vite.config.ts las inyecta), el manifest y el <head>
 * - el API: el nombre en notificaciones y mails, y los colores de los mails
 *
 * Reglas (las controla `npm run lint`):
 * - En el CSS no se escriben colores, radios, sombras, capas (z-index), fuentes ni tamaños de letra sueltos:
 *   se usa la variable que corresponde. Si falta una, se agrega acá y se documenta en docs/LOOK.md.
 * - Los nombres son por uso ("--danger-soft"), no por valor ("--rojo-claro"), así se puede cambiar el
 *   valor sin tocar cada pantalla.
 *
 * Guía completa: docs/LOOK.md
 */

// ---------- Nombre ----------

/** Nombre de la app. Para renombrarla alcanza con cambiar esto. */
export const APP_NAME = "qule.ar";
export const APP_DESCRIPTION = "App comunitaria, gratuita y de código abierto para conocer gente y charlar en grupos.";
/** El lema: va con el logo (login, mails, README, piezas para redes). Elegido en la discusión de Look and feel. */
export const APP_SLOGAN = "Poné la pava.";

// ---------- Colores ----------

/** Colores que no cambian con el tema. */
export const palette = {
  /** Brasa: botones principales, el logo en texto, lo que está activo. Se usa poco: si todo es naranja, nada se destaca. */
  accent: "#ff6a3d",
  /** Brasa más clara: hover del botón principal, links y texto sobre fondos brasa suaves. */
  accent2: "#ff8a63",
  /** Texto sobre brasa. */
  accentInk: "#1a0d08",
  /** Blanco: borde de citas sobre burbujas propias, para que se distinga del fondo brasa. */
  quoteLine: "#ffffff",
  /** Mensajes en cola del antispam, avisos informativos, favoritos. */
  queue: "#f5b84a",
  /** Borrar, bloquear, errores. */
  danger: "#ff4d6d",
  danger2: "#ff6680",
  dangerInk: "#ffffff",
  /** En línea, todo bien. */
  ok: "#4fd18b",
  /** Fondo detrás de fotos y videos a pantalla completa, y lo que va encima. */
  mediaBg: "#000000",
  onMedia: "#ffffff",
} as const;

export type ThemeColors = {
  /** Fondo de la app. También es el color de la barra del navegador y del manifest. */
  bg: string;
  /** Tarjetas, barras, hojas. */
  surface: string;
  /** Inputs, burbujas, botones secundarios. */
  surface2: string;
  /** Hover y lo que va encima de surface2. */
  surface3: string;
  /** Bordes y separadores. */
  line: string;
  text: string;
  /** Texto secundario. */
  muted: string;
};

/**
 * Los temas. No hay modo claro "blanco": la app tiene que poder abrirse en el colectivo sin que se note.
 * - oscuro: el de siempre, casi negro con un toque violeta. Es el tema por defecto.
 * - penumbra: un oscuro más suave para usar de día o con mucho brillo.
 * El acento y los colores de estado son los mismos en los dos.
 */
export const themes = {
  oscuro: {
    bg: "#0c0b0d",
    surface: "#151318",
    surface2: "#1e1b22",
    surface3: "#29252e",
    line: "#2e2a33",
    text: "#f2eef5",
    muted: "#9b94a4",
  },
  penumbra: {
    bg: "#2a2631",
    surface: "#332e3b",
    surface2: "#3d3746",
    surface3: "#484151",
    line: "#544c5e",
    text: "#f7f4fa",
    muted: "#bfb7c9",
  },
} as const satisfies Record<string, ThemeColors>;

export type ThemeName = keyof typeof themes;
export const DEFAULT_THEME: ThemeName = "oscuro";
export const THEME_LABELS: Record<ThemeName, string> = { oscuro: "Oscuro", penumbra: "Penumbra" };

/**
 * Mails: van sobre fondo claro porque muchos clientes de correo no respetan el modo oscuro.
 * Mismo acento, grises con el mismo toque violeta.
 */
export const mail = {
  bg: "#f4f1f6",
  card: "#ffffff",
  title: "#141216",
  text: "#2b2730",
  muted: "#8a8392",
  /** Brasa un poco más oscura: sobre blanco, #ff6a3d no se lee bien en texto chico. */
  link: "#e2532a",
  accent: palette.accent,
  accentInk: palette.accentInk,
} as const;

/** Un color #rrggbb con transparencia (0 a 1), como rgba(). */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ---------- Tipografía ----------

export const fonts = {
  /** Texto de toda la app. */
  text: { family: "Inter", weights: [400, 500, 600, 700] },
  /** Logo en texto y títulos grandes. */
  display: { family: "Bricolage Grotesque", weights: [600, 800] },
} as const;

const fallback = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Link de Google Fonts con exactamente los pesos que se usan (si falta un peso, el navegador inventa una negrita fea). */
export const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=" +
  `${fonts.display.family.replaceAll(" ", "+")}:opsz,wght@${fonts.display.weights.map((w) => `12..96,${w}`).join(";")}` +
  `&family=${fonts.text.family}:wght@${fonts.text.weights.join(";")}&display=swap`;

/** Tamaños de letra. El texto base es de 15 px. */
export const fontSizes = {
  "text-2xs": "11px",
  "text-xs": "12px",
  "text-sm": "13px",
  "text-md": "14px",
  "text-base": "15px",
  "text-lg": "16px",
  "text-xl": "18px",
  /** Campos donde se escribe. Con menos de 16 px el iPhone hace zoom al tocarlos y la pantalla queda ampliada. */
  "text-input": "16px",
  "title-xs": "20px",
  "title-sm": "22px",
  "title-md": "24px",
  "title-lg": "26px",
  "title-xl": "28px",
  "title-2xl": "32px",
  "title-3xl": "34px",
  /** Inicial grande cuando no hay foto (grilla y perfil). */
  "display-md": "40px",
  "display-xl": "120px",
  /** El nombre de la app en la pantalla de bienvenida. */
  "wordmark-hero": "clamp(48px, 14vw, 72px)",
} as const;

// ---------- Formas ----------

/** Bordes redondeados. Tarjetas: xl (14 px). Botones, chips y contadores: pill. */
export const radii = {
  hair: "3px",
  xs: "6px",
  sm: "8px",
  md: "10px",
  lg: "12px",
  xl: "14px",
  "2xl": "18px",
  "3xl": "20px",
  "4xl": "22px",
  pill: "999px",
} as const;

/** Capas: qué va encima de qué. */
export const zIndex = {
  raised: 1,
  sticky: 2,
  menu: 5,
  sheet: 20,
  toast: 30,
  viewer: 40,
  lightbox: 100,
} as const;

// ---------- Movimiento ----------

/**
 * Curvas y duraciones de las animaciones. Todo lo que se mueve usa estas, así la app se siente igual en todos lados.
 * Solo se anima transform y opacity (no tamaños ni posiciones), y siempre con una variante para movimiento reducido.
 */
export const motion = {
  /** Entrar, salir, responder a un toque: arranca rápido y frena suave. */
  "ease-out": "cubic-bezier(0.23, 1, 0.32, 1)",
  /** Algo que ya está en pantalla y se mueve o cambia de tamaño. */
  "ease-in-out": "cubic-bezier(0.77, 0, 0.175, 1)",
  /** Hojas que suben desde abajo, como en iOS. */
  "ease-sheet": "cubic-bezier(0.32, 0.72, 0, 1)",
  /** Respuesta a un toque (botones, chips). */
  "dur-press": "120ms",
  /** Fundidos chicos: fotos que terminan de cargar, avisos. */
  "dur-fast": "180ms",
  /** Lo que aparece en una lista, menús. */
  "dur-base": "240ms",
  /** Cambio de pantalla. */
  "dur-page": "280ms",
  /** Hojas y diálogos. */
  "dur-sheet": "320ms",
  /** Separación entre elementos que entran escalonados. */
  stagger: "35ms",
} as const;

// ---------- CSS ----------

const night = themes.oscuro;

/** Variables que dependen del tema. */
function themeVars(t: ThemeColors): Record<string, string> {
  return {
    bg: t.bg,
    surface: t.surface,
    "surface-2": t.surface2,
    "surface-3": t.surface3,
    line: t.line,
    text: t.text,
    muted: t.muted,
  };
}

/** Variables iguales en todos los temas. */
function globalVars(): Record<string, string> {
  const p = palette;
  return {
    accent: p.accent,
    "accent-2": p.accent2,
    "accent-ink": p.accentInk,
    "quote-line": p.quoteLine,
    "accent-ink-muted": alpha(p.accentInk, 0.65),
    "accent-soft": alpha(p.accent, 0.14),
    "accent-glow": alpha(p.accent, 0.18),
    "accent-line": alpha(p.accent, 0.5),

    queue: p.queue,
    "queue-soft": alpha(p.queue, 0.1),
    "queue-line": alpha(p.queue, 0.25),
    "queue-strong": alpha(p.queue, 0.5),

    danger: p.danger,
    "danger-2": p.danger2,
    "danger-ink": p.dangerInk,
    "danger-soft": alpha(p.danger, 0.12),
    "danger-line": alpha(p.danger, 0.25),
    "danger-strong": alpha(p.danger, 0.5),

    ok: p.ok,

    // Sobre fotos y videos: siempre oscuro, sin importar el tema, para que el texto se lea.
    "media-bg": p.mediaBg,
    "on-media": p.onMedia,
    "on-media-faint": alpha(p.onMedia, 0.08),
    "on-media-track": alpha(p.onMedia, 0.2),
    "on-media-dim": alpha(p.onMedia, 0.3),
    "on-media-muted": alpha(night.text, 0.75),
    "on-media-soft": alpha(night.text, 0.85),
    "scrim-light": alpha(night.bg, 0.6),
    scrim: alpha(night.bg, 0.75),
    "scrim-fade": alpha(night.bg, 0.88),
    "scrim-strong": alpha(night.bg, 0.95),
    backdrop: alpha("#000000", 0.6),

    "shadow-pop": `0 12px 30px ${alpha("#000000", 0.5)}`,
    "shadow-icon": `0 1px 2px ${alpha("#000000", 0.6)}`,
    "shadow-ring-ok": `0 0 0 2px ${alpha(p.ok, 0.25)}`,

    // El botón "Seguir con Google" respeta los colores de Google
    "google-bg": "#ffffff",
    "google-bg-hover": "#eeeeee",
    "google-ink": "#1f1f1f",

    font: `"${fonts.text.family}", ${fallback}`,
    display: `"${fonts.display.family}", var(--font)`,
    ...Object.fromEntries(Object.entries(fontSizes)),
    ...Object.fromEntries(Object.entries(radii).map(([k, v]) => [`radius-${k}`, v])),
    ...Object.fromEntries(Object.entries(zIndex).map(([k, v]) => [`z-${k}`, String(v)])),
    ...motion,
  };
}

const block = (selector: string, vars: Record<string, string>) =>
  `${selector} {\n${Object.entries(vars).map(([k, v]) => `  --${k}: ${v};`).join("\n")}\n}`;

/** Todas las variables CSS de la marca. Lo usa vite.config.ts; no hace falta llamarlo a mano. */
export function tokensCss(): string {
  const others = (Object.keys(themes) as ThemeName[]).filter((n) => n !== DEFAULT_THEME);
  return [
    "/* Generado por @mortero/brand (packages/brand/src/index.ts). No editar a mano. */",
    block(":root", { ...globalVars(), ...themeVars(themes[DEFAULT_THEME]) }),
    ...others.map((n) => block(`:root[data-theme="${n}"]`, themeVars(themes[n]))),
    "",
  ].join("\n\n");
}

/** El manifest de la PWA (lo arma vite.config.ts). */
export function webManifest() {
  const bg = themes[DEFAULT_THEME].bg;
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: bg,
    theme_color: bg,
    lang: "es",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    id: "/",
    scope: "/",
    orientation: "portrait",
  };
}
