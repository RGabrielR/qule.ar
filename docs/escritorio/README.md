# qule.ar en la compu

Hasta ahora toda la app era la del celular, también en la compu: una columna de 720 px en el medio y la barra de pestañas abajo. Desde **1024 px de ancho** se arma una vista de compu:

- **Barra lateral** en vez de la barra de abajo, con el logo arriba. Moderación aparece ahí solo para el equipo (en el celular sigue en Yo).
- **Lista y detalle lado a lado** en Mensajes y Grupos: la charla o el grupo se abre a la derecha y se pasa de uno a otro sin volver. En Grupos, los detalles se abren a la derecha del chat.
- **Gente** a todo el ancho, con 6 columnas (7 desde 1440 px).
- **Perfil**: la foto a la izquierda, quieta, y los datos a la derecha.
- **Yo y Configuración**: una columna centrada, cómoda para leer.
- **Moderación**: una mesa con todos los temas en una lista densa y el elegido a la derecha, con la evidencia, las acciones y el historial completo de la cuenta (los reportes que recibió y los que hizo, lo que hizo moderación y sus pedidos de revisión). Se pasa de un tema a otro con las flechas o con J y K.
- Las **hojas** (reportar, suspender…) se abren en el medio de la pantalla, como un diálogo.

Abajo de 1024 px la app se ve exactamente como antes. Los colores, los temas (Oscuro y Penumbra) y las reglas de [LOOK.md](../LOOK.md) son los mismos.

Las capturas salen del prototipo que está en el código, a 1440 × 900, con cuentas y datos de prueba (las fotos son dibujos abstractos). Gente todavía muestra Cerca y Toques: el esquema ya incluye la pestaña Nuevos que propone la [Discusión #284](https://github.com/RGabrielR/qule.ar/discussions/284).

## Esquemas

![Cómo se arma cada pantalla en la compu](esquema-pantallas.png)

![La mesa de moderación, con notas](esquema-moderacion.png)

## Capturas

| Pantalla | Oscuro | Penumbra |
|---|---|---|
| Gente: Cerca | ![](01-gente-cerca-oscuro.png) | ![](01-gente-cerca-penumbra.png) |
| Gente: Toques | ![](02-gente-toques-oscuro.png) | ![](02-gente-toques-penumbra.png) |
| Perfil | ![](03-perfil-oscuro.png) | ![](03-perfil-penumbra.png) |
| Mensajes: bandeja | ![](04-mensajes-bandeja-oscuro.png) | ![](04-mensajes-bandeja-penumbra.png) |
| Mensajes: charla | ![](05-mensajes-chat-oscuro.png) | ![](05-mensajes-chat-penumbra.png) |
| Grupos: lista | ![](06-grupos-lista-oscuro.png) | ![](06-grupos-lista-penumbra.png) |
| Grupos: chat | ![](07-grupos-chat-oscuro.png) | ![](07-grupos-chat-penumbra.png) |
| Grupos: detalles | ![](08-grupos-detalles-oscuro.png) | ![](08-grupos-detalles-penumbra.png) |
| Yo | ![](09-yo-oscuro.png) | ![](09-yo-penumbra.png) |
| Configuración | ![](10-configuracion-oscuro.png) | ![](10-configuracion-penumbra.png) |
| Moderación: mesa de reportes | ![](11-moderacion-mesa-oscuro.png) | ![](11-moderacion-mesa-penumbra.png) |
| Moderación: otras pestañas | ![](12-moderacion-suspendidas-oscuro.png) | ![](12-moderacion-suspendidas-penumbra.png) |
| Moderación: historial de una cuenta | ![](13-moderacion-historial-oscuro.png) | ![](13-moderacion-historial-penumbra.png) |

## Dónde está en el código

| Qué | Dónde |
|---|---|
| Los anchos (`@media (min-width: 1024px)` y `1440px`) | Al final de `apps/web/src/styles.css`, con `--sidebar-w` y `--split-list-w` |
| Saber desde TS si se está en compu | `useDesktop()` en `apps/web/src/features/desktop/useDesktop.ts` |
| Lista y detalle, y el panel al costado del chat | `SplitView` y `ThreadWithAside` en `apps/web/src/features/desktop/SplitView.tsx`, usados por las rutas de `/mensajes` y `/grupos` en `App.tsx` |
| La mesa de moderación | `apps/web/src/features/moderation/ReportDesk.tsx` (reusa la tarjeta y los filtros de `ReportGroups.tsx`) |
| El historial de una cuenta | `GET /admin/users/:id/history` en `apps/api/src/routes/admin.ts`, con su prueba en `apps/api/src/account-history.test.ts` |
| Pruebas | `e2e/desktop.spec.ts`. Las demás e2e corren en 375 px |

## Lo que sigue

- **Historial de los grupos en la mesa.** Las cuentas ya tienen su historial completo; los grupos muestran su estado y los reportes resueltos (entre los últimos 300), sin lo que dice el Registro.
- **Las fotos como evidencia, a la vista.** Hoy se ven desde «Verificar foto» y en Fotos tapadas. En la mesa podrían ir en miniatura, tapadas hasta tocarlas.
- **Atajos para las acciones** (por ejemplo D para descartar), con confirmación para lo que no se puede deshacer.
- **Mesa para las otras pestañas** (Revisiones, Suspendidas, Fotos tapadas): hoy van en tarjetas a dos o tres columnas.
- **Gente con Nuevos**, cuando se decida la #284.
