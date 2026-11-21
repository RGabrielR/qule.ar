# Look and feel

Así se ve, se llama y se siente qule.ar. Esta es la guía oficial: todo lo nuevo la tiene que seguir, y `npm run lint` controla lo que se puede controlar solo. Las propuestas para cambiarla se charlan en el hilo [Look and feel](https://github.com/RGabrielR/qule.ar/discussions/3).

## La idea

- **Oscuro y cálido.** Fondo casi negro con un toque violeta y un solo color de acento, naranja "brasa". Nada de amarillo chillón ni azul corporativo.
- **Discreto.** Se tiene que poder abrir en el colectivo sin que se note qué app es: sin fotos gigantes de entrada, notificaciones que no dicen nada.
- **Pocas cosas, bien hechas.** Cuatro pestañas (Cerca, Grupos, Mensajes, Yo). Si algo nuevo no entra ahí, probablemente vaya dentro de una.
- **Pensada para el celular.** Se diseña primero para una pantalla de 375 px de ancho y una mano.

## Dónde vive la marca

Todo sale de un solo archivo: [`packages/brand/src/index.ts`](../packages/brand/src/index.ts).

| Qué | De dónde sale |
|---|---|
| Nombre de la app (`APP_NAME`) y descripción | `packages/brand`. La web y el API lo importan de ahí (`./brand`). |
| Lema (`APP_SLOGAN`): "Poné la pava." | `packages/brand`. Va en el login, el pie de los mails, el README y las piezas de `docs/marca`. |
| Variables CSS: colores, temas, tamaños de letra, radios, sombras, capas | `packages/brand` las genera; `vite.config.ts` las carga con `import "virtual:brand.css"`. |
| Color de la barra del navegador, fuentes de Google y nombre en `index.html` | `vite.config.ts` completa los `%MARCADORES%` de `index.html`. |
| `manifest.webmanifest` (la app instalada) | Lo arma `vite.config.ts` con `webManifest()`. Ya no está en `public/`. |
| Colores de los mails | `mail` en `packages/brand`. |
| Íconos de la app (Android, iPhone, favicon, notificaciones) | `apps/web/brand/icono.svg` → `npm run icons --workspace web`. |
| El logo en la app (login y pantallas de entrada) | El mismo `icono.svg`, con el componente `Logo` ([`components/Logo.tsx`](../apps/web/src/components/Logo.tsx)). |
| El logo para redes y presentaciones | [`docs/marca`](marca/README.md): el mate solo y el mate con "qule.ar", en SVG y PNG en alta. |
| Íconos de la interfaz | [`apps/web/src/components/Icons.tsx`](../apps/web/src/components/Icons.tsx). |
| Título por defecto de las notificaciones | Escrito a mano en `apps/web/public/sw.js`; `npm run lint` avisa si no coincide con `APP_NAME`. |

Para renombrar la app alcanza con cambiar `APP_NAME`. Para cambiar un color, se cambia en `packages/brand` y se actualiza en todos lados.

## Reglas

Las controla `npm run lint` (stylelint + `scripts/check-brand.mjs`) y corre en cada PR:

1. **En el CSS no hay valores sueltos** de color, radio, sombra, capa (`z-index`), familia o tamaño de letra. Se usa la variable: `var(--danger)`, `var(--radius-xl)`, `var(--text-sm)`.
2. **Si falta una variable, se agrega en `packages/brand`**, con un nombre por uso (`--queue-soft`), no por valor (`--amarillo-claro`). Y se suma a esta guía.
3. **Las variables de la marca no se definen en el CSS.** En `styles.css` solo hay variables de layout (`--tabbar-h`, `--safe-b`).
4. **Sin colores en TS/TSX.** La única excepción es la "G" de Google (`components/GoogleMark.tsx`).
5. **Sin `style={{ … }}` para cosas fijas.** Un margen va en una clase de `styles.css`. `style` queda para valores que se calculan en el momento (el tamaño de un avatar, una barra de progreso).
6. **Pesos de letra que se cargan:** Inter 400, 500, 600 y 700; Bricolage Grotesque 600 y 800. Si hace falta otro, se agrega en `fonts` (`packages/brand`) para que se cargue de verdad.

## Colores

### Los que cambian con el tema

| Variable | Oscuro | Penumbra | Para qué |
|---|---|---|---|
| `--bg` | `#0c0b0d` | `#2a2631` | Fondo. También la barra del navegador. |
| `--surface` | `#151318` | `#332e3b` | Tarjetas, barras, hojas |
| `--surface-2` | `#1e1b22` | `#3d3746` | Inputs, burbujas, botones secundarios |
| `--surface-3` | `#29252e` | `#484151` | Hover y lo que va encima de surface-2 |
| `--line` | `#2e2a33` | `#544c5e` | Bordes y separadores |
| `--text` | `#f2eef5` | `#f7f4fa` | Texto |
| `--muted` | `#9b94a4` | `#bfb7c9` | Texto secundario |

### Los que no cambian

| Variable | Valor | Para qué |
|---|---|---|
| `--accent` | `#ff6a3d` | Brasa: botones principales, el logo en texto, lo activo. **Se usa poco**: si todo es naranja, nada se destaca. |
| `--accent-2` | `#ff8a63` | Hover del botón principal, links, texto sobre brasa suave |
| `--accent-ink` | `#1a0d08` | Texto sobre brasa |
| `--queue` | `#f5b84a` | Mensajes en cola del antispam, avisos, favoritos |
| `--danger` | `#ff4d6d` | Borrar, bloquear, errores |
| `--ok` | `#4fd18b` | En línea |

Cada color de estado tiene sus transparencias con el mismo nombre: `-soft` (fondo suave), `-line` (borde) y `-strong` (borde marcado). Por ejemplo `--danger-soft`, `--queue-line`, `--accent-line`.

**Sobre fotos y videos** se usan `--media-bg`, `--on-media*` y `--scrim*`. Son siempre oscuros, sin importar el tema, para que el texto encima de una foto se lea.

## Temas

No hay modo claro "blanco": rompería lo discreto de la app. Hay dos oscuros:

- **Oscuro** (por defecto): casi negro con el toque violeta, para la noche y el colectivo.
- **Penumbra**: un oscuro más suave para usar de día o con mucho brillo.

Se elige en **Yo → Configuración → Apariencia** y se guarda en el dispositivo. Solo cambian los colores de la tabla de arriba: el acento y los colores de estado son los mismos. Para sumar un tema se agrega en `themes` (`packages/brand`) con los mismos siete colores.

## Tipografía

- **Bricolage Grotesque** (`var(--display)`, 800) para el logo en texto y los títulos grandes.
- **Inter** (`var(--font)`) para todo lo demás. Texto base de 15 px.

Tamaños (`font-size: var(--…)`):

| Texto | | Títulos | | Especiales | |
|---|---|---|---|---|---|
| `--text-2xs` | 11 px | `--title-xs` | 20 px | `--display-md` | 40 px (inicial sin foto, grilla) |
| `--text-xs` | 12 px | `--title-sm` | 22 px | `--display-xl` | 120 px (inicial sin foto, perfil) |
| `--text-sm` | 13 px | `--title-md` | 24 px | `--wordmark-hero` | 48–72 px (bienvenida) |
| `--text-md` | 14 px | `--title-lg` | 26 px | | |
| `--text-base` | 15 px | `--title-xl` | 28 px | | |
| `--text-lg` | 16 px | `--title-2xl` | 32 px | | |
| `--text-xl` | 18 px | `--title-3xl` | 34 px | | |

## Formas

- **Radios** (`border-radius: var(--radius-…)`): `hair` 3 · `xs` 6 · `sm` 8 · `md` 10 · `lg` 12 · `xl` 14 · `2xl` 18 · `3xl` 20 · `4xl` 22 · `pill` 999. Tarjetas en `xl`; botones, chips y contadores en `pill`; hojas modales en `4xl`.
- **Sombras**: `--shadow-pop` (menús, toasts, carteles flotantes), `--shadow-icon` (íconos sobre fotos, con `filter: drop-shadow()`), `--shadow-ring-ok` (el puntito de en línea).
- **Capas** (`z-index: var(--z-…)`), de abajo hacia arriba: `raised` · `sticky` · `menu` · `sheet` · `toast` · `viewer` · `lightbox`.
- La grilla de gente es de fotos cuadradas, sin espacio entre ellas, con el nombre y el estado encima.

## Íconos

- **De la interfaz** (`Icons.tsx`): de línea, en una base de 24 × 24, trazo de 2 px redondeado y `currentColor` (toman el color del texto). Un ícono nuevo va ahí, con el mismo estilo.
- **De la app**: el mate culo. El original es el vector `apps/web/brand/icono.svg` (fondo transparente, recortado al dibujo); después de cambiarlo se corre `npm run icons --workspace web`, que genera todos los tamaños sobre el fondo de la app (`--bg` del tema Oscuro) y la silueta blanca de las notificaciones de Android.

## Logo

El mate culo: un mate con su bombilla en el que el cuenco es una cola. Hay contexto y referencias en [`docs/logos`](logos/README.md) y en el hilo de Look and feel.

- **En la app** se usa el componente `Logo`. En las pantallas de entrada (login, bienvenida, contraseña) va arriba del nombre en texto (`Wordmark`). Sin texto alternativo, porque el nombre ya está al lado.
- **Fuera de la app** (redes, presentaciones): los archivos de [`docs/marca`](marca/README.md).

## Lema

**Poné la pava.** Es una invitación: poner la pava es lo primero que hacés cuando viene alguien, el arranque de la charla. Tiene el mismo guiño que el mate. Se eligió en el hilo de Look and feel y vive en `APP_SLOGAN` (`packages/brand`): no se escribe a mano en las pantallas.

## Tono de los textos

- Español rioplatense con voseo: "Tenés", "Pedí entrar", "Escribí algo".
- Corto y cálido, sin chistes forzados ni emojis en la interfaz.
- Nunca culpar a quien usa la app: "No se pudo enviar, probá de nuevo", no "Error 500".
- Lenguaje inclusivo cuando hace falta ("todes"), sin forzarlo en cada frase.

## Para lo nuevo

Antes de abrir un PR que toque la pantalla:

- [ ] Usa clases y variables que ya existen. Si inventa una, la agrega en `packages/brand` y en esta guía.
- [ ] Se ve bien en los dos temas (Yo → Configuración → Apariencia).
- [ ] Se ve bien en 375 px de ancho.
- [ ] Los textos siguen el tono de arriba.
- [ ] `npm run lint` pasa.

## Pendiente

Cosas para seguir mejorando la marca desde esta base:

- **Llevar el color del mate a la app.** El ícono usa un degradé de amarillo a magenta (`#feb107` → `#fe6514` → `#fb134a`) y la app un solo naranja brasa (`#ff6a3d`). Falta decidir cómo conviven.
- **Escala de espacios.** Márgenes y paddings todavía están en px sueltos; el próximo paso es una escala (`--space-*`) controlada igual que el resto.
- **Íconos propios** en el estilo del mate, empezando por las cuatro pestañas.
