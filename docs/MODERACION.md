# Protocolo de moderación

Qué hacer con cada reporte, en cuánto tiempo y cuándo avisar a las autoridades. Es para las personas que moderan qule.ar.

> Esto no es asesoramiento legal. Ante un caso grave o con dudas, consultá con alguien que sepa de derecho.

## Por qué importa

En Argentina, una plataforma no responde por lo que publican otras personas **mientras no se entere**. Cuando le llega un aviso de algo claramente ilegal y no actúa, empieza a responder (Corte Suprema, "Rodríguez c/ Google", 2014). Un reporte es ese aviso. **Revisar los reportes rápido es lo que protege a quien usa la app, y también al proyecto.**

## Antes de empezar

- **Tiene que haber al menos dos personas moderando** (administración general en `ADMIN_USER_IDS`, ver `docs/DEPLOY.md`, o equipo con el permiso Reportes), con las notificaciones activadas en la app. Si nadie modera, los reportes se acumulan sin que nadie los vea.
- Ante un reporte urgente, la app les manda una notificación a quienes tienen el permiso Reportes ("Reporte urgente"). Ante un pedido de revisión, a quienes tienen Revisiones.
- Cada persona del equipo puede apagar esos avisos en **Yo → Configuración → Notificaciones → Moderación**. Lo pendiente se sigue viendo en el panel. Que al menos una persona los deje prendidos. Los reportes urgentes por **menor de edad** le llegan siempre a la administración general, aunque lo tenga apagado.
- El panel está en **Yo → Moderación** y muestra primero lo urgente.

## Prioridades

| Prioridad | Motivo del reporte | Tiempo para revisarlo |
|---|---|---|
| **Urgente** | Menor de edad · Contenido íntimo sin consentimiento · Amenazas o violencia | **Dentro de las 24 h**, idealmente en pocas horas |
| Normal | Acoso · Fotos inapropiadas · Perfil falso · Spam · Otro | Dentro de las 72 h |

**Ocultamiento por precaución.** Si un perfil recibe reportes urgentes de **3 personas distintas** que todavía nadie revisó, deja de aparecer en "Cerca" y en las listas para invitar a grupos. No es una suspensión: la cuenta sigue funcionando. Vuelve a aparecer cuando moderación cierra esos reportes. Así se limita el daño si nadie llega a revisarlo enseguida.

**Suspensión automática.** Si **5 personas distintas** reportan a la misma cuenta **por el mismo motivo** en **3 semanas** y esos reportes siguen abiertos, a quienes tienen el permiso Suspensiones (y a la administración general, siempre) les llega un aviso, y en el reporte aparece cuándo se suspende sola. Si en **24 horas** nadie descarta esos reportes ni actúa, la app suspende la cuenta. Queda en Suspendidas como "Automática, falta revisarla": alguien del equipo la **mantiene** o **reactiva la cuenta**, y la persona puede pedir una revisión como en cualquier suspensión.

- **Qué no cuenta:** el motivo "otro", reportar varias veces a la misma persona, los reportes descartados, los de hace más de 3 semanas y los de cuentas con menos de 48 horas o suspendidas, y los de personas cuyos reportes no cuentan (ver más abajo). Así no sirve para atacar a alguien con cuentas recién creadas.
- **Al equipo no lo suspende sola:** si pasa con alguien del equipo, le avisa a la administración general.
- **Lo público se borra recién cuando una persona la mantiene.** Al suspender sola, la app guarda la prueba pero no borra los mensajes en grupos, las fotos ni los álbumes, por si fue un ataque. Se borran cuando alguien del equipo la **mantiene** (en Suspendidas o al responder una revisión).
- **Si no corresponde:** descartá los reportes antes de que se cumplan las 24 horas, o reactivá la cuenta después.

## Grupos

- **Se pueden reportar** al abrir la vista previa del grupo o desde **Ver detalles** si ya sos parte. Los motivos son los mismos que para las personas.
- **Ocultamiento por precaución:** con reportes urgentes de 3 personas distintas, el grupo deja de aparecer al explorar y no acepta pedidos de ingreso ni invitaciones hasta que moderación lo revise.
- **Dar de baja** (botón en el reporte, con motivo obligatorio): el grupo desaparece para todo el mundo, incluidos sus miembros, y queda guardado **90 días** como prueba, sin que nadie de la app lo vea. Después se borra del todo, y los reportes conservan la copia del nombre y la descripción. Si fue un error, se reactiva desde la pestaña "Grupos de baja".
- **Si el dueño borra un grupo con reportes**, o se va la última persona, no se borra: se da de baja igual que arriba, así no se pierde la prueba.

## Nombres de grupos que no se permiten

Un grupo **no se puede crear ni editar** si el nombre o la descripción apuntan a:

- **menores** ("+14", "-18", "15 años", "sub 18", "menorcitos", "teens", "busco menores"…). Además, el intento le llega a moderación como alerta urgente sobre quien lo intentó;
- **vender o comprar** cosas o servicios ("vendo", "venta", "precio", "$ 500", "stock", "delivery"…);
- **masajes, acompañantes o servicios sexuales**;
- **encuentros sexuales en lugares públicos** ("cruising", "sexo en la plaza", "garchar en parques"…). La app no puede organizarlos: el sexo en un lugar donde terceros lo pueden ver sin querer es exhibición obscena (Código Penal, art. 129), más grave si lo pueden ver menores, y los códigos contravencionales locales también lo sancionan. Las charlas sobre el tema, o los encuentros en lugares públicos que no son sexuales ("mate en la plaza"), sí se pueden.

**Las drogas no se filtran por palabras.** Hablar de consumo cuidado y de reducción de daños está permitido, y esos grupos son bienvenidos. Lo que no se permite es vender u ofrecer drogas: eso se reporta a mano (ver "Mensajes", más abajo).

La persona ve un mensaje que explica por qué no se puede. Las listas están en `FORBIDDEN_GROUP` (`apps/api/src/moderation.ts`), probadas para no frenar grupos inocentes: "Promo 2010" o "Juegos de mesa +18" pasan sin problema. Si aparece una forma nueva de esquivarlas, se suma ahí.

Los grupos que **ya existían** con esos nombres se revisan al arrancar la app y van a moderación como alerta automática, con el motivo "menor de edad", "venta o drogas" (para los de venta y servicios) u "otro" (para los de encuentros en lugares públicos). No se repiten: si moderación ya lo revisó y el texto no cambió, no vuelve a aparecer.

**Mensajes:** las reglas se aplican a nombres y descripciones, no a lo que se escribe adentro. Si alguien vende u ofrece drogas o vende algo en un chat, se reporta con el motivo **"venta o drogas"** y moderación borra el mensaje o suspende la cuenta.

## Alertas automáticas

La app revisa los nombres y las descripciones de los **perfiles y los grupos** cuando se crean o se editan. Si encuentra señales de que puede haber menores, crea un reporte urgente por "menor de edad", marcado como "Alerta automática de la app", y avisa a moderación. **No borra ni oculta nada sola:** lo decide una persona.

Busca edades concretas ("-18", "+14" y cualquier "+" seguido de un número menor de 18, "15 años", "16a", "sub 18"), "menorcito/s" y "teen/s", que no tienen uso inocente en una app de citas, y además:

- **"menores" o "menor de edad"**, salvo negados ("no menores", "sin menores", "nada de menores") o con una edad adulta ("menores a 40"). "Menores de 18" sí cuenta.
- **"secundaria", "secundario" o "liceo"**, solo como estudiante ("voy a la secundaria", "estoy en el liceo", "termino el secundario"). "Perfil secundario" o "exalumnos del liceo" no cuentan.

La lista está en `MINOR_SIGNALS` (`apps/api/src/moderation.ts`). Si aparece una señal nueva, se suma ahí, con su caso en `minor-signals.test.ts`.

## Reportes de mala fe

Hay quien reporta mucho y sin fundamento: para tapar los reportes de verdad, para llenar de avisos a moderación o para intentar que oculten o suspendan a alguien. Arriba de los reportes abiertos, quien tiene el permiso Suspensiones (o la administración general) ve **Quién reporta**: cuentas que reportan de una forma para mirar, con sus números de los últimos 90 días (cuántos reportes, cuántos descartados, cuántos con una medida y cuántos sin revisar) y por qué aparecen:

- reportó a **5 o más personas o grupos distintos en una hora**;
- de sus reportes ya revisados (al menos 5), **se descartó el 80 % o más**;
- mandó **15 o más reportes en 90 días y ninguno terminó en una medida**;
- **junto con otras cuentas reportó a la misma persona o grupo en un día** (3 o más cuentas), y varias son **nuevas** (menos de 7 días) o **se crearon casi a la misma hora**. Solo aparecen esas cuentas: quien reportó lo mismo desde una cuenta vieja, no.

Ninguna señal decide sola. Puede ser alguien que encontró varios problemas de verdad: mirá sus reportes antes de decidir. Las opciones son:

- **Que sus reportes no cuenten.** Siguen entrando y se ven en la lista (marcados "no cuenta"), pero no ocultan perfiles ni grupos, no mandan avisos, no suman personas en las tarjetas y **no alcanzan para una suspensión preventiva ni automática**. **Excepción: los reportes por menor de edad cuentan siempre** (avisan, suman y alcanzan para una suspensión preventiva): con menores en juego es preferible moderar de más. Se puede deshacer ("Que vuelvan a contar").
- **Descartar sus reportes de la última hora** de una vez (pide confirmación). Los urgentes y los anteriores se revisan de a uno.
- **Suspender** a quien reporta, con el diálogo de siempre.
- **Ignorar** la tarjeta: vuelve solo cuando pasó una hora, la cuenta mandó reportes nuevos y sigue habiendo alguna señal. Si la tarjeta era por reportar a muchas personas en una hora, mientras está activa sus reportes urgentes no mandan avisos; ignorarla los devuelve.

A quien reporta no se le dice nada, ni a quien reporta de buena fe ni a quien quedó marcado. Además hay un tope de 15 reportes por hora y 40 por día por persona. Todo queda en el registro de moderación. El nombre de quien reporta lo ve solo la administración general; el resto del equipo ve "Una cuenta" con los números y puede actuar igual (el panel no recibe el id de la cuenta: cada tarjeta tiene un identificador propio).

## Qué hacer en cada caso

### Menor de edad
1. **Si es un grupo** que sugiere menores en el nombre, la descripción o lo que pasa adentro, **dalo de baja**. Revisá también a quien lo creó y a quienes participan.
2. Si hay indicios razonables (lo dice el perfil, las fotos, los mensajes), **suspendé la cuenta**. El motivo queda registrado.
3. Si además hay contenido sexual de una persona menor o alguien adulto intentando contactarla con fines sexuales (*grooming*, art. 131 del Código Penal), seguí el caso de abajo.

### Contenido sexual de menores (el caso más grave)
1. **No descargues, no reenvíes y no hagas capturas del contenido.** Tenerlo o pasarlo es delito (art. 128 del Código Penal), aunque sea para denunciarlo.
2. **Suspendé la cuenta** enseguida. Así deja de estar visible: sus fotos y mensajes desaparecen de la app, pero con un reporte urgente abierto todos sus archivos quedan guardados en el servidor como prueba (ver "Las pruebas").
3. **No borres el mensaje ni la cuenta.** Hace falta como prueba.
4. **Denuncialo** ante el Ministerio Público Fiscal (la Unidad Fiscal Especializada en Ciberdelincuencia, UFECI) o en la policía. Indicá el ID de la cuenta y la fecha, y avisá a quien administra el servidor para que preserve los datos.
5. Seguí las indicaciones de la fiscalía.

### Contenido íntimo sin consentimiento
Fotos o videos íntimos de alguien compartidos sin su permiso. La Ley 27.736 ("Ley Olimpia") lo reconoce como violencia digital.
1. **Borrá el mensaje** desde el reporte ("Borrar mensaje") y **suspendé la cuenta** de quien lo compartió.
2. Si la persona afectada lo pide, ayudala con lo que pueda necesitar para denunciar. La línea 144 (violencia de género) orienta las 24 h.

### Amenazas o violencia
1. Si hay una amenaza concreta contra alguien, **suspendé la cuenta**.
2. Si hay riesgo inmediato, la persona tiene que llamar al **911**. La app no reemplaza eso.

### Acoso, fotos inapropiadas, perfil falso, spam, otro
- Primera vez y leve: descartá el reporte o borrá el mensaje, según el caso.
- Si se repite (el panel muestra cuántos reportes tiene la cuenta en total) o es grave: suspendé.
- Ante la duda, mirá el [Código de conducta](../CODE_OF_CONDUCT.md).

## Las pruebas

Al reportar, la app guarda una copia de lo reportado: el texto del mensaje y sus fotos o, si se reporta un perfil por algo urgente, sus fotos públicas. Esa copia **no se borra aunque la persona desenvíe el mensaje, borre la foto o borre su cuenta**. El reporte también queda aunque se borre alguna de las dos cuentas.

- Si **descartás** el reporte, la copia se borra.
- Si el reporte **termina en una medida** (borrar el mensaje o suspender), la copia se conserva como prueba.
- **Al suspender** se borra lo público de la persona: sus mensajes en grupos (también los que tenía en cola), sus reacciones en grupos, sus fotos, álbumes y videos, y las fotos que mandó por privado. Quienes tienen los grupos o las charlas abiertas lo ven desaparecer en vivo. Antes de borrar se guarda la prueba: si tiene un reporte urgente abierto o que terminó en una medida, **todos** sus archivos quedan guardados con ese reporte; los demás reportes sobre su perfil guardan sus fotos públicas. Los textos de sus mensajes privados no se borran: son privados y son la prueba de quien los recibió. Si después se reactiva la cuenta, lo borrado no vuelve.
- Los archivos guardados solo los puede pedir moderación. El panel dice cuántos hay, pero **no los muestra ni hace falta descargarlos**. Si una fiscalía los pide, quien administra el servidor los entrega.

### Verificar fotos de álbumes privados

Con el [piloto de marca invisible](ALBUM-WATERMARK.md) activo, abrí **Verificar foto** desde el reporte. La persona que reporta puede adjuntar una captura al enviar el reporte. Si la adjuntó, ya aparece cargada en Moderación. Elegí la foto original de una cuenta vinculada al caso e indicá el ID de la cuenta que querés verificar. Por defecto se propone la cuenta reportada. Podés ajustar el área en ambas imágenes si la captura incluye bordes o muestra solo una parte de la foto.

El panel identifica quién subió la foto original. Si la marca coincide, también muestra a qué cuenta se entregó esa copia. La coincidencia es un indicio para revisar junto con la demás evidencia. Puede haber circulado entre varias personas antes de que se tomara la captura.

Tras guardar una coincidencia, **Acción** permite enviar una respuesta privada que la persona puede leer en **Yo → Configuración → Mis reportes**. Los reportes aparecen desde que se envían. Cada uno muestra el texto enviado y la respuesta en el mismo hilo. El aviso abre el hilo directamente. Desde la misma pestaña, se puede borrar un mensaje reportado con un motivo o confirmar la suspensión dentro de la misma pestaña si la copia coincide con la cuenta reportada y quien modera tiene el permiso.

La consulta queda en **Registro** con el reporte y la acción. La captura que adjunta la persona al reportar se guarda cifrada y se elimina si se descarta el reporte. Si moderación carga una captura solo para verificarla, el verificador no conserva el archivo. El panel habilita la herramienta en reportes de personas abiertos o que terminaron en una medida, con ambas cuentas identificadas. Los reportes por menor de edad siguen el protocolo correspondiente.

## Reglas para quien modera

- **Mirá solo lo necesario** para resolver el reporte: el mensaje o el perfil reportado. Nada más. Son datos personales, y muchas veces sensibles (Ley 25.326).
- **No compartas** fuera del equipo de moderación nada de lo que ves en un reporte.
- **Escribí siempre el motivo** al suspender. Queda registrado y es lo que ve la persona suspendida.
- **Cuidado con los reportes falsos.** Si muchas cuentas nuevas reportan a la misma persona sin motivo, puede ser un ataque. Descartá esos reportes y, si hace falta, suspendé a quienes los mandan.
- **Si te equivocaste**, la suspensión se puede levantar desde la pestaña Suspendidas. Lo que se borró al suspender (mensajes en grupos, fotos y álbumes) no vuelve.

## Permisos del equipo

Quien administra en general (las cuentas de `ADMIN_USER_IDS` o `ADMIN_EMAILS` en el servidor) puede todo. Al resto del equipo se le dan permisos chicos de a uno, desde el panel en la pestaña **Equipo** o desde el perfil de la persona con el botón **Moderación** (solo lo ve la administración general):

| Permiso | Qué permite |
|---|---|
| Reportes | Ver los reportes, descartarlos y borrar el mensaje reportado. Ante un reporte por menor de edad, suspender de forma preventiva (ver abajo) |
| Suspensiones | Suspender y reactivar cuentas |
| Revisiones | Responder los pedidos de revisión de suspensiones (mantener o levantar) |
| Verificar fotos | Comparar capturas con fotos de los álbumes privados de las cuentas vinculadas a un reporte. También requiere Reportes |

**Suspensión preventiva por menor de edad.** Con un reporte abierto por "menor de edad" y indicios suficientes, quien tiene solo el permiso Reportes puede suspender la cuenta en el momento, sin esperar a alguien con Suspensiones. Le llega un aviso a quienes tienen Suspensiones (a la administración general, siempre) y la cuenta aparece en Suspendidas como "Preventiva, falta revisarla": otra persona la **mantiene** o **reactiva la cuenta**. Quien la hizo no la puede confirmar. Alcanza cualquier reporte por menor de edad, aunque venga de una cuenta cuyos reportes no cuentan (ver "Reportes de mala fe"). Igual que cualquier suspensión, la persona puede pedir una revisión.

Solo la administración general puede dar de baja o reactivar grupos, ver quién mandó cada reporte, dar y sacar permisos, suspender a alguien del equipo y ver el **Registro**. A la administración general no la puede suspender nadie desde la app. Nadie del equipo ve mails, IPs ni datos de salud. Los permisos se chequean en el servidor, no solo escondiendo botones.

Cada acción (descartar, borrar un mensaje, suspender, reactivar, responder una revisión, dar de baja un grupo, cambiar permisos) queda en el **Registro**: quién, cuándo, sobre qué y por qué.

## Pedidos de revisión

Quien está suspendido ve el motivo al entrar y puede **pedir una revisión** desde la app, en privado. Un pedido por suspensión, y puede sumar algo más una sola vez mientras no haya respuesta. Le llega un mail avisando la suspensión (sin el motivo) y otro cuando hay respuesta.

- Lo revisa alguien con el permiso **Revisiones**. Quien suspendió no puede resolverlo si hay otra persona con ese permiso; si no hay nadie más, puede, y queda registrado.
- El panel muestra el motivo, lo que escribió la persona y los reportes que terminaron en la medida, **sin decir quién reportó**.
- La respuesta es obligatoria y la persona la lee en la app. Si se levanta, la cuenta vuelve a funcionar enseguida.

## Pendiente

- **Un canal privado de contacto**, por mail, para quien quiere apelar una suspensión o pedir ayuda. Depende del servicio de mails (discusión #25).
- **Mirar este protocolo cada tanto** y ajustarlo con lo que vaya pasando.
