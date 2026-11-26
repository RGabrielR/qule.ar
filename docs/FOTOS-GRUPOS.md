# Piloto de fotos en grupos

La beta arranca en un solo grupo: **CABA**, un grupo chico que administra Gabriel. Así se prueba con poca gente, en un grupo sin temática explícita, y quien administra puede pausar los envíos y juntar las devoluciones sin coordinar con otras personas. La [discusión del piloto](https://github.com/RGabrielR/qule.ar/discussions/237) documenta la propuesta.

Cruising CABA y Morbosos Pies quedan para una segunda etapa, si la beta sale bien y quienes los administran quieren sumarse. La regla sobre encuentros en lugares públicos se está definiendo en la [discusión #270](https://github.com/RGabrielR/qule.ar/discussions/270) y el #266.

- Las migraciones `0029_acciones_chats_privados` y `0030_fotos_grupos_piloto` agregan los ajustes por chat privado, los campos para fotos de mensajes y el control de pausa al grupo. Con `GROUP_PHOTO_PILOT_IDS` vacío, el piloto está apagado. Para la beta, configurar únicamente el ID del grupo CABA (`GROUP_PHOTO_PILOT_IDS=<id>`). El ID se ve en la dirección del grupo (`/grupos/<id>`). El chat general está excluido.
- Las fotos siguen las reglas del chat y se abren con **Ver foto**. No se incluyen miniaturas en la conversación, las citas o los avisos. El servidor comprueba la membresía y la visibilidad al servir el archivo.
- **Cuentas nuevas:** no pueden mandar fotos durante las primeras horas de cuenta nueva del grupo, igual que con los links. En el piloto el mínimo es de 24 horas, aunque el grupo haya bajado esa regla.
- **Tolerancia cero con lo urgente:** un reporte por menor de edad, contenido íntimo sin consentimiento o amenazas oculta la foto para todo el grupo con el primer reporte y avisa a moderación. No pasa si moderación decidió que los reportes de esa cuenta no cuentan, salvo por menor de edad, que cuenta siempre.
- **Otros motivos:** la foto se oculta con el reporte de tres cuentas distintas con al menos 48 horas de antigüedad y cuyos reportes cuentan. Las cuentas nuevas pueden reportar, pero no suman a ese número.
- Al ocultarse, se abre una tarjeta prioritaria para que el equipo revise si corresponde suspender. Moderación puede borrar el mensaje o restaurar la foto si los reportes no correspondían. Si alguno de los reportes abiertos es urgente, restaurarla requiere el permiso Suspensiones, como la suspensión preventiva. El registro guarda qué reportes se cerraron al restaurarla.
- En el menú del chat, el dueño y sus moderadores pueden pausar nuevas subidas. Si hace falta apagar el piloto completo, quitar el ID del grupo de la configuración y recrear el servicio.
- Antes de activar, probar en un teléfono con imágenes inocuas, incluida la selección desde Google Fotos. Verificar que una cuenta de otro grupo no pueda abrir un archivo, que una foto retirada deje de verse en un chat abierto y que funcione la pausa.

Para decidir si ampliarlo, preguntar qué fotos les sirvió compartir y qué tan claro les resultó abrirlas y reportarlas. Anotar cuántos reportes requirieron intervención y si el equipo pudo atenderlos. Recoger esa devolución sin compartir fotos de quienes participaron.
