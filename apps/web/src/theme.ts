import { DEFAULT_THEME, themes, type ThemeName } from "./brand";

// El tema elegido se guarda en este celular/compu. index.html ya lo aplica antes de pintar
// (ver vite.config.ts) para que no parpadee; esto es para leerlo y cambiarlo desde la app.
const KEY = "mortero:tema";

const isTheme = (v: unknown): v is ThemeName => typeof v === "string" && v in themes;

export function getTheme(): ThemeName {
  try {
    const v = localStorage.getItem(KEY);
    if (isTheme(v)) return v;
  } catch {
    // Sin acceso al almacenamiento (modo privado): queda el de siempre
  }
  return DEFAULT_THEME;
}

/**
 * `update`: lo que la pantalla tiene que cambiar junto con el tema (por ejemplo, qué opción queda marcada),
 * para que entre en la misma transición. Tiene que actualizar el DOM en el momento (flushSync).
 */
export function setTheme(name: ThemeName, update?: () => void) {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // Igual se aplica, aunque no se recuerde
  }
  const apply = () => {
    applyTheme(name);
    update?.();
  };
  // La pantalla con el tema anterior se funde con la nueva en vez de saltar (ver ::view-transition en styles.css).
  // Sin soporte del navegador, cambia directo como siempre.
  if (document.startViewTransition) document.startViewTransition(apply);
  else apply();
}

function applyTheme(name: ThemeName) {
  const root = document.documentElement;
  if (name === DEFAULT_THEME) delete root.dataset.theme;
  else root.dataset.theme = name;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themes[name].bg);
}
