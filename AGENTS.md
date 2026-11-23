# Para asistentes de código (Claude, Copilot, Cursor…)

Si usás una IA para colaborar en qule.ar, estas son las reglas que tiene que seguir. Para personas, el punto de entrada es [CONTRIBUTING.md](CONTRIBUTING.md).

## Antes de tocar la pantalla

- Leé [docs/LOOK.md](docs/LOOK.md). Es la guía de la marca y se cumple siempre.
- La marca vive en `packages/brand/src/index.ts`: nombre, colores, temas, tipografía, radios, sombras y capas. No la dupliques en otro lado.
- En CSS, nada de valores sueltos de color, radio, sombra, `z-index`, familia o tamaño de letra: usá `var(--…)`. Si falta una variable, agregala en `packages/brand` con un nombre por uso y documentala en LOOK.md.
- No definas variables de la marca en `styles.css`.
- Sin colores en TS/TSX y sin `style={{ … }}` para cosas fijas: usá una clase.
- Lo nuevo tiene que verse bien en los dos temas (Oscuro y Penumbra) y en 375 px de ancho.
- Íconos de la interfaz: en `apps/web/src/components/Icons.tsx`, de línea, base 24, trazo 2, `currentColor`.

## Organización del frontend

- Cuando agregues componentes o lógica específicos de una funcionalidad, ponelos en `apps/web/src/features/<funcionalidad>/`. Las pantallas de rutas van en `apps/web/src/pages/` y los componentes reutilizables en `apps/web/src/components/`.
- Mové el código existente de a una funcionalidad por vez, en PRs chicos dedicados a mover archivos y actualizar sus imports. Postergá los archivos que estén tocando otros PRs abiertos hasta que se resuelvan.
- Consultá la [guía de organización del frontend](CONTRIBUTING.md#organización-del-frontend) para ver un ejemplo y el acuerdo original.

## Textos

- Español rioplatense con voseo, cortos y cálidos, sin emojis en la interfaz, sin culpar a quien usa la app.

## Antes de dar algo por terminado

- `npm run check` tiene que pasar (marca + tipos + build). Es lo mismo que corre el CI en cada PR.
- Si cambiaste la base: `npm run db:generate` e incluí la migración.

## Lo que no se negocia

Está en [CONTRIBUTING.md](CONTRIBUTING.md#cosas-que-no-se-negocian): todo gratis, privacidad primero, solo mayores de 18, nadie acapara los chats, datos mínimos.
