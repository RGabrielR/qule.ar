# Protocolo de moderación

Qué hacer con cada reporte, en cuánto tiempo y cuándo avisar a las autoridades. Es para las personas que moderan qule.ar.

> Esto no es asesoramiento legal. Ante un caso grave o con dudas, consultá con alguien que sepa de derecho.

## Por qué importa

En Argentina, una plataforma no responde por lo que publican otras personas **mientras no se entere**. Cuando le llega un aviso de algo claramente ilegal y no actúa, empieza a responder (Corte Suprema, "Rodríguez c/ Google", 2014). Un reporte es ese aviso. **Revisar los reportes rápido es lo que protege a quien usa la app, y también al proyecto.**

## Antes de empezar

- **Tiene que haber al menos dos personas moderando**, configuradas en `ADMIN_USER_IDS` (ver `docs/DEPLOY.md`), con las notificaciones activadas en la app. Si nadie modera, los reportes se acumulan sin que nadie los vea.
- Ante un reporte urgente, la app les manda una notificación a todas ("Hay un reporte urgente para revisar").
- El panel está en **Yo → Moderación** y muestra primero lo urgente.

## Prioridades

| Prioridad | Motivo del reporte | Tiempo para revisarlo |
|---|---|---|
| **Urgente** | Menor de edad · Contenido íntimo sin consentimiento · Amenazas o violencia | **Dentro de las 24 h**, idealmente en pocas horas |
| Normal | Acoso · Fotos inapropiadas · Perfil falso · Spam · Otro | Dentro de las 72 h |

**Ocultamiento por precaución.** Si un perfil recibe reportes urgentes de **3 personas distintas** que todavía nadie revisó, deja de aparecer en "Cerca" y en las listas para invitar a grupos. No es una suspensión: la cuenta sigue funcionando. Vuelve a aparecer cuando moderación cierra esos reportes. Así se limita el daño si nadie llega a revisarlo enseguida.

## Grupos

- **Se pueden reportar** desde la lista de grupos ("Reportar", sin necesidad de ser parte) o desde la info del grupo. Los motivos son los mismos que para las personas.
- **Ocultamiento por precaución:** con reportes urgentes de 3 personas distintas, el grupo deja de aparecer al explorar y no acepta pedidos de ingreso ni invitaciones hasta que moderación lo revise.
- **Dar de baja** (botón en el reporte, con motivo obligatorio): el grupo desaparece para todo el mundo, incluidos sus miembros, y queda guardado **90 días** como prueba, sin que nadie de la app lo vea. Después se borra del todo, y los reportes conservan la copia del nombre y la descripción. Si fue un error, se reactiva desde la pestaña "Grupos de baja".
- **Si el dueño borra un grupo con reportes**, o se va la última persona, no se borra: se da de baja igual que arriba, así no se pierde la prueba.

## Nombres de grupos que no se permiten

Un grupo **no se puede crear ni editar** si el nombre o la descripción apuntan a:

- **menores** ("+14", "-18", "15 años", "sub 18", "menores", "teen"…). Además, el intento le llega a moderación como alerta urgente sobre quien lo intentó;
- **vender o comprar** cosas o servicios ("vendo", "venta", "precio", "$ 500", "stock", "delivery"…);
- **masajes, acompañantes o servicios sexuales**;
- **drogas** ("tina", "chems", "party and play", "fiesta química", "merca", "poppers", 💊…).

La persona ve un mensaje que explica por qué no se puede. Las listas están en `FORBIDDEN_GROUP` (`apps/api/src/moderation.ts`), probadas para no frenar grupos inocentes: "Promo 2010" o "Juegos de mesa +18" pasan sin problema. Si aparece una forma nueva de esquivarlas, se suma ahí.

Los grupos que **ya existían** con esos nombres se revisan al arrancar la app y van a moderación como alerta automática, con el motivo "menor de edad" o "venta o drogas". No se repiten: si moderación ya lo revisó y el texto no cambió, no vuelve a aparecer.

**Mensajes:** las reglas se aplican a nombres y descripciones, no a lo que se escribe adentro. Si alguien ofrece drogas o vende algo en un chat, se reporta con el motivo **"venta o drogas"** y moderación borra el mensaje o suspende la cuenta.

## Alertas automáticas

La app revisa los nombres y las descripciones de los **perfiles y los grupos** cuando se crean o se editan. Si encuentra señales de que puede haber menores, crea un reporte urgente por "menor de edad", marcado como "Alerta automática de la app", y avisa a moderación. **No borra ni oculta nada sola:** lo decide una persona.

Hoy busca: "-18", "+14" (y cualquier "+" seguido de un número menor de 18; "+18" no cuenta), "15 años" o "16a", "sub 18", "menores", "menor de edad", "teen", "secundaria" y "liceo". La lista está en `MINOR_SIGNALS` (`apps/api/src/moderation.ts`). Si aparece una señal nueva, se suma ahí.

## Qué hacer en cada caso

### Menor de edad
1. **Si es un grupo** que sugiere menores en el nombre, la descripción o lo que pasa adentro, **dalo de baja**. Revisá también a quien lo creó y a quienes participan.
2. Si hay indicios razonables (lo dice el perfil, las fotos, los mensajes), **suspendé la cuenta**. El motivo queda registrado.
3. Si además hay contenido sexual de una persona menor o alguien adulto intentando contactarla con fines sexuales (*grooming*, art. 131 del Código Penal), seguí el caso de abajo.

### Contenido sexual de menores (el caso más grave)
1. **No descargues, no reenvíes y no hagas capturas del contenido.** Tenerlo o pasarlo es delito (art. 128 del Código Penal), aunque sea para denunciarlo.
2. **Suspendé la cuenta** enseguida. Así deja de estar visible.
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
- Los archivos guardados solo los puede pedir moderación. El panel dice cuántos hay, pero **no los muestra ni hace falta descargarlos**. Si una fiscalía los pide, quien administra el servidor los entrega.

## Reglas para quien modera

- **Mirá solo lo necesario** para resolver el reporte: el mensaje o el perfil reportado. Nada más. Son datos personales, y muchas veces sensibles (Ley 25.326).
- **No compartas** fuera del equipo de moderación nada de lo que ves en un reporte.
- **Escribí siempre el motivo** al suspender. Queda registrado y es lo que ve la persona suspendida.
- **Cuidado con los reportes falsos.** Si muchas cuentas nuevas reportan a la misma persona sin motivo, puede ser un ataque. Descartá esos reportes y, si hace falta, suspendé a quienes los mandan.
- **Si te equivocaste**, la suspensión se puede levantar desde la pestaña Suspendidas.

## Pendiente

- **Un canal privado de contacto**, por mail, para quien quiere apelar una suspensión o pedir ayuda. Depende del servicio de mails (discusión #25).
- **Mirar este protocolo cada tanto** y ajustarlo con lo que vaya pasando.
