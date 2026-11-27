/**
 * Versión vigente de terminos.md y privacidad.md. Tiene que ser igual a TERMS_VERSION en apps/api/src/legal.ts.
 * Si cambiás algo importante de los textos, subí la fecha en los dos lados: a todas las personas les aparece
 * el cartel para aceptar la versión nueva. `npm run lint:legal` (también en el CI) avisa si cambiaste un texto
 * sin decidir si es importante: ver scripts/check-legal.mjs.
 */
export const TERMS_VERSION = "2026-11-27";
