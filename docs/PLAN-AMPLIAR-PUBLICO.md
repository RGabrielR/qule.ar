# Plan: ampliar el público de qule.ar

## Objetivo

Hacer que qule.ar pueda servir para conocer gente y buscar vínculos entre personas de distintos géneros y orientaciones, sin dejar de ser un espacio respetuoso para la comunidad LGBTIQ+. Cada persona puede elegir opcionalmente si se identifica como parte de esa comunidad y, por separado, a quién quiere ver o conocer. La app no debería obligar a nadie a declarar su identidad u orientación ni presentar lo LGBTIQ+ como un modo que se prende o se apaga.

Este documento es una propuesta para conversar en Discusiones antes de implementar cambios de producto, según [CONTRIBUTING.md](../CONTRIBUTING.md).

**Estado:** implementación inicial aplicada. El perfil ahora admite datos opcionales de género, orientación, identidad trans y pertenencia LGBTIQ+; la grilla tiene filtros de género/orientación y el control visible “A quién querés ver”. Los datos no se publican ni se usan para filtros hasta activar cada permiso. Se agregó la migración `0011_blue_solo.sql` y se actualizaron los textos de privacidad, términos y README. Quedan pendientes la revisión legal y la conversación comunitaria sobre las etiquetas.

## Estado inicial (antes de implementar)

- La app se presenta como un espacio para la comunidad LGBTIQ+ y sus aliades en los [Términos y condiciones](../apps/web/src/legal/terminos.md). El [README](../README.md) la describe como una app para conocer gente y charlar en grupos.
- No existen campos estructurados de género ni orientación sexual en el perfil, ni filtros por esas características.
- El perfil permite elegir “Rol”, “Tribus”, “Busco”, relación y pronombres desde [MyProfile.tsx](../apps/web/src/pages/MyProfile.tsx).
- “Rol” hoy contiene “Activo”, “Versátil”, “Pasivo”, etc.: son roles sexuales, no género ni orientación.
- “Tribus” hoy incluye etiquetas como “Oso”, “Twink”, “Geek”, “Drag”, pero también “Trans”, “No binarie” y “Poz”. Mezcla subculturas, identidad de género y estado de salud; no es una lista clara de géneros u orientaciones. Las opciones están en [options.ts](../apps/web/src/options.ts).
- La grilla [Nearby.tsx](../apps/web/src/pages/Nearby.tsx) filtra edad, contextura, rol, tribus, qué busca, relación, actividad, foto y favoritos. La API aplica esos filtros en [nearby.ts](../apps/api/src/routes/nearby.ts).
- El modelo [schema.ts](../apps/api/src/db/schema.ts) guarda las tribus y lo que se busca como listas de texto. No hay campos de orientación o género.
- La [Política de privacidad](../apps/web/src/legal/privacidad.md) reconoce que orientación e identidad de género son datos sensibles; cualquier nuevo tratamiento debe explicarse y ser opcional.

## Qué significa “tribu”

En apps de citas, “tribu” suele ser una etiqueta informal para una subcultura o tipo corporal dentro de una comunidad, por ejemplo “oso”, “twink” o “deportista”. No es una categoría universal y puede resultar confusa para quien recién llega.

En la lista actual, “Trans” y “No binarie” describen identidades, y “Poz” refiere a salud; no son tribus en el mismo sentido. “Hetero” tampoco debería agregarse a esa lista: es una orientación, distinta de la identidad de género, del rol sexual y de lo que una persona busca.

**Recomendación:** conservar “tribus” por ahora para no romper perfiles existentes, pero explicar o renombrar la sección como etiquetas opcionales de comunidad y revisar cada etiqueta por separado. Mover las identidades y orientaciones a campos propios cuando se acuerde el nuevo modelo. No migrar automáticamente “Trans” o “No binarie” a campos de identidad: la persona debe poder revisar y confirmar datos sensibles.

## Propuesta de producto

### 1. Separar cuatro conceptos

1. **Género / identidad:** opcional, con opciones amplias y autodescripción, por ejemplo mujer, varón, persona no binaria u otra identidad. Incluir “Prefiero no decir” y permitir no completar.
2. **Orientación:** opcional, con opciones inclusivas, autodescripción y “Prefiero no decir”. Heterosexual, gay/lesbiana, bisexual, pansexual, asexual y queer pueden ser sugerencias, no una lista cerrada ni obligatoria.
3. **A quién querés ver o conocer:** preferencias de búsqueda, separadas de lo que la persona es. Dar una forma clara de elegir, por ejemplo, mujeres, hombres y personas no binarias, con opciones múltiples y “sin filtro”. Incluir filtros combinables por género y orientación para poder buscar, por ejemplo, mujeres heterosexuales, mujeres lesbianas/gays o varones gays. Esta preferencia tiene que ser fácil de encontrar y configurar antes de navegar la grilla, no quedar escondida entre filtros secundarios. Al filtrar por orientación, mostrar solamente a quienes la declararon y aceptaron usarla para el descubrimiento; no inferirla.
4. **Pertenencia a la comunidad LGBTIQ+:** pregunta opcional e independiente, con respuestas como “Sí”, “No” y “Prefiero no decir”, además de poder dejarla sin responder. La respuesta no determina el género, la orientación ni a quién quiere conocer la persona. No usarla para limitar la grilla; permitir elegir si se muestra en el perfil.
5. **Rol y etiquetas comunitarias:** mantenerlos aparte de identidad y orientación. Revisar los nombres para que se entiendan fuera de un público de varones gays; conservarlos opcionales y permitir no elegir ninguno.

Una mujer trans es una mujer. Si se ofrece una preferencia específica para encontrar personas trans, debe ser optativa, basada solo en la autodescripción y con consentimiento explícito; no convertir “trans” en un género separado ni exigir que una persona lo declare. La preferencia “ver personas trans” se combina con los géneros elegidos y solo encuentra a quienes aceptaron que ese dato se use en la búsqueda.

### 2. Preferencias y filtros

- Priorizar un control visible de **A quién querés ver** para evitar que una persona que busca mujeres termine navegando solo perfiles de hombres. Como mínimo, permitir elegir mujeres, hombres, personas no binarias y varias opciones a la vez.
- Agregar a la grilla filtros claros y combinables de **Género** y **Orientación**, además de una preferencia opcional para ver personas trans que eligieron ser encontradas con ese criterio.
- Permitir combinaciones como mujeres + heterosexuales sin hacer que una opción de género implique una orientación. Los filtros seleccionados se combinan con el resto de filtros actuales; varias opciones dentro de un mismo grupo permiten coincidencia con cualquiera de ellas.
- Un filtro vacío significa “no limitar por este dato”, no “mostrar solo personas que lo completaron”.
- Explicar que un filtro específico puede dejar afuera a quienes no comparten esos datos. Los perfiles no completados nunca deben clasificarse como una categoría.
- Mantener las preferencias de búsqueda privadas. No mostrarlas en el perfil público ni en respuestas públicas de la API.
- Decidir si una preferencia de búsqueda se guarda solo en el dispositivo (como los filtros actuales) o en el perfil privado. Si se guarda en el servidor, tratarla como dato sensible y permitir editarla y borrarla.

### 3. Ampliar el público sin borrar la identidad comunitaria

- No crear un interruptor llamado “desactivar LGBTQ+” ni presentar a la comunidad como un paquete o una tribu.
- Permitir que cualquier persona adulta use la app, sin tener que declarar pertenencia a LGBTIQ+ ni seleccionar un “modo”.
- La pertenencia LGBTIQ+ es una declaración opcional del perfil, no un filtro ni una condición de acceso. La audiencia deseada se configura aparte.
- Mantener protecciones explícitas contra acoso y discriminación. La ampliación del público no implica relajar las reglas comunitarias.
- Actualizar la descripción de la app y los términos para que quede claro que está abierta a todas las personas adultas, sin dejar de comunicar sus normas de respeto a la comunidad LGBTIQ+.

## Plan de implementación

### Fase 0 — Revisión comunitaria y legal pendiente

- Conversar en Discusiones la apertura a todas las personas adultas, con pertenencia LGBTIQ+ opcional y filtros para elegir a quién ver.
- Revisar las opciones y el vocabulario con personas de las comunidades involucradas; no asumir que una etiqueta pública implica consentimiento para filtrado.
- Revisar los textos de datos sensibles con asesoramiento legal apropiado antes del despliegue.

### Fase 1 — Modelo y API (implementada)

- Se agregaron campos opcionales, separados y ocultos por defecto para género, orientación, identidad trans y pertenencia LGBTIQ+.
- Las preferencias de búsqueda quedan en el dispositivo y se envían en el cuerpo de la solicitud; no se guardan en el perfil.
- La API filtra género y orientación solo si la persona habilitó su uso. El filtro trans solo incluye a quien se declaró trans y también habilitó aparecer en ese filtro.
- Los perfiles previos quedan vacíos en los campos nuevos; no se infieren datos desde “Tribus”, pronombres o rol.
- La migración `0011_blue_solo.sql` se generó con `npm run db:generate`.

### Fase 2 — Perfil y descubrimiento (implementada)

- El onboarding permite responder opcionalmente “Sí”, “No” o “Prefiero no decir” sobre pertenencia LGBTIQ+; no cambia quién aparece en la grilla.
- El perfil permite editar género, orientación, identidad trans y pertenencia, y habilitar por separado su visibilidad/uso en filtros.
- La grilla muestra “A quién querés ver” y permite combinar género y orientación; incluye la opción de personas trans con consentimiento de aparición.
- La experiencia usa estilos existentes; queda pendiente la revisión visual manual en 375 px y ambos temas.

### Fase 3 — Privacidad, términos y comunicación (implementada; revisión legal pendiente)

- Se actualizaron [privacidad.md](../apps/web/src/legal/privacidad.md), [terminos.md](../apps/web/src/legal/terminos.md), el onboarding y el README.
- Se incrementó la versión de términos para volver a pedir aceptación a cuentas existentes.
- La política explica que las preferencias se guardan localmente y se envían al servidor para filtrar resultados; no se usan para publicidad.
- Falta revisión legal antes del despliegue.

### Fase 4 — Validación y despliegue

- `npm run check` pasó: marca, estilos, tipos y build.
- Antes del despliegue, falta probar la migración sobre una base de desarrollo, recorrer los flujos manualmente y revisar el comportamiento en móvil y ambos temas.
- Confirmar que “Trans”/“No binarie” de tribus no se migren a identidad sin confirmación; la migración actual no los modifica.

## Criterios de aceptación

- Una persona puede completar un perfil sin indicar género, orientación, tribus o preferencias de búsqueda.
- Una persona puede dejar sin responder si pertenece a la comunidad LGBTIQ+, y esa respuesta no cambia quién aparece en su grilla.
- Identidad de género, orientación, rol, etiquetas comunitarias y preferencias de búsqueda son conceptos separados en interfaz y datos.
- Una persona puede elegir de forma visible a quién quiere ver (incluidas mujeres) y combinar género con orientación únicamente según las opciones que se acuerden; no se infieren datos de perfiles incompletos.
- Una persona puede ocultar o borrar los datos sensibles, y sus preferencias de búsqueda nunca se muestran a otras personas.
- Los perfiles existentes siguen funcionando sin migraciones inferidas ni cambios involuntarios.
- Las reglas de mayores de 18, privacidad, gratuidad y convivencia siguen vigentes.
- La experiencia se entiende en español rioplatense, funciona en 375 px y en los temas Oscuro y Penumbra.

## Decisiones pendientes

1. Revisar las opciones y los textos de género, orientación e identidad trans con personas de las comunidades involucradas.
2. ¿Qué etiquetas actuales de “Tribus” se mantienen, renombran o retiran? La decisión no debe borrar ni reinterpretar lo que ya eligieron las personas.
