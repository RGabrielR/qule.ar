# Piloto de fotos en grupos

Los grupos propuestos son Cruising CABA y Morbosos Pies. Antes de activarlo, confirmar con quienes los administran que quieren participar y acordar quién puede pausar los envíos y cómo recoger devoluciones. La [discusión del piloto](https://github.com/RGabrielR/qule.ar/discussions/237) documenta la propuesta.

- La migración agrega campos para fotos de mensajes y el control de pausa al grupo. Con `GROUP_PHOTO_PILOT_IDS` vacío, el piloto está apagado. Para la beta, configurar únicamente los IDs confirmados de los dos grupos. El chat general está excluido.
- Las fotos siguen las reglas del chat y se abren con **Ver foto**. No se incluyen miniaturas en la conversación, las citas o los avisos. El servidor comprueba la membresía y la visibilidad al servir el archivo.
- Al tercer reporte abierto de cuentas distintas sobre la misma foto, se oculta y se abre una tarjeta prioritaria para que el equipo revise si corresponde suspender. Los reportes urgentes avisan desde el primero. Moderación puede confirmar la baja o restaurar la foto si corresponde.
- En el menú del chat, el dueño y sus moderadores pueden pausar nuevas subidas. Si hace falta apagar el piloto completo, quitar el ID del grupo de la configuración y recrear el servicio.
- Antes de activar, probar en un teléfono con imágenes inocuas, incluida la selección desde Google Fotos. Verificar que una cuenta de otro grupo no pueda abrir un archivo, que una foto retirada deje de verse en un chat abierto y que funcione la pausa.

Para decidir si ampliarlo, preguntar qué fotos les sirvió compartir y qué tan claro les resultó abrirlas y reportarlas. Anotar cuántos reportes requirieron intervención y si el equipo pudo atenderlos. Recoger esa devolución sin compartir fotos de quienes participaron.
