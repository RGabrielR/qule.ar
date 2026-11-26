# Piloto de marca invisible en álbumes privados

El servidor entrega una copia marcada cuando una cuenta autorizada abre la foto o pide la miniatura de un álbum privado ajeno. El patrón DCT se deriva de una firma HMAC de la clave del archivo, la cuenta que mira y la variante de imagen. La marca queda en los píxeles y se atenúa en las zonas lisas para reducir la trama visible. El servidor mantiene los originales guardados, responde con `Cache-Control: no-store` y prescinde de un registro de vistas. La copia que recibe la persona dueña, las fotos públicas, los chats y los videos con su carátula siguen su circuito habitual. [Discusión #181](https://github.com/RGabrielR/qule.ar/discussions/181#discussioncomment-19869295)

## Activar en una instancia de prueba

Generá una clave propia con `openssl rand -base64 32` y guardala como `ALBUM_WATERMARK_KEY` en el entorno del servidor. Usá la misma clave en todos los procesos del API. Con la variable vacía el piloto queda apagado. Conservá la clave anterior si la cambiás y necesitás revisar una copia emitida antes de la rotación.

## Verificar una copia

Desde la app, abrí **Yo → Moderación → Reportes → Verificar foto**. Para el equipo, habilitá **Reportes** y **Verificar fotos**. El flujo queda vinculado al reporte y las consultas quedan en el registro.

Desde la raíz del repo, con la clave del piloto cargada en el entorno de una terminal autorizada:

```sh
node --import tsx apps/api/scripts/verify-album-watermark.ts \
  original.webp copia.jpg clave-de-archivo.webp id-de-cuenta photo
```

Usá como referencia el archivo que sirve el sistema sin marca. Para una miniatura usá la miniatura guardada sin marca y elegí `thumb`. Si la copia viene de una captura, aislá la imagen dentro de la captura. Para un recorte, pasá cuatro números al final, en el orden izquierda, arriba, ancho y alto, en píxeles de la referencia. El verificador ajusta la escala al rectángulo indicado. La alineación requiere revisión manual si hay rotación, perspectiva o un recorte desconocido. En fotos muy pequeñas o con poca superficie opaca pueden faltar bloques para verificar la marca.

El comando verifica una cuenta candidata y devuelve `match`, el número de bloques y dos métricas de señal. Una coincidencia sirve como indicio para revisar un reporte junto con otra evidencia. Describe compatibilidad con una copia que recibió esa cuenta. Evitá buscar coincidencias probando muchas cuentas o ajustando el recorte a partir del puntaje sin una referencia visual, porque eso aumenta las coincidencias por azar.

## Repetir la prueba

Con Chromium de Playwright instalado, pasá imágenes públicas o sintéticas. Este comando reproduce las tres imágenes del ensayo:

```sh
curl -fL https://raw.githubusercontent.com/scikit-image/scikit-image/v0.25.2/skimage/data/astronaut.png \
  -o /tmp/qule-watermark-astronaut.png
node --import tsx apps/api/scripts/measure-album-watermark.ts \
  docs/reacciones/propuesta-sistema.jpg docs/logos/qule-14-mate-culo-peludo.jpg \
  /tmp/qule-watermark-astronaut.png
```

En una prueba local con esas dos imágenes y el [retrato público de Eileen Collins](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut), se recuperó la marca en los seis archivos servidos y en sus seis variantes por cada prueba de recompresión JPEG q65, reducción al 50 % con JPEG q65, recorte central al 25 % del área y captura emulada a 375 px con DPR 2. A DPR 1 se recuperó en cinco de seis. Hubo cero coincidencias en 678 controles negativos del ensayo, incluidas cuentas distintas y copias sin marca.

La mediana de cinco procesamientos por variante fue de 23 a 58 ms por foto y de 19 a 23 ms por miniatura. El PSNR frente a la referencia sin marca quedó entre 39,2 y 42,4 dB. Es una muestra chica de tiempo de procesamiento y distorsión de píxeles. Quedan por medir la apertura de álbumes bajo carga, los reenvíos en servicios reales, las capturas en celulares físicos y una foto de la pantalla tomada con otro celular.

## Recorrido integrado con la marca visible

En Chromium a 375 px, tomamos una captura del visor privado con la marca visible del PR #214 y la adjuntamos a un reporte. La verificación encontró la marca invisible en esa misma captura. Probamos confirmación y cancelación de la suspensión, la respuesta privada y su llegada al hilo abierto.

1. [Visor privado con marca visible](evidencia/marca-invisible/01-marca-visible.jpg)
2. [Captura adjunta en el formulario de reporte](evidencia/marca-invisible/02-adjuntar-captura.jpg)
3. [Coincidencia en Moderación](evidencia/marca-invisible/03-coincidencia.jpg)
4. [Decisión sobre la cuenta y respuesta enviada](evidencia/marca-invisible/04-accion-y-respuesta.jpg)
5. [Respuesta en el hilo de Mis reportes](evidencia/marca-invisible/05-mis-reportes.jpg)

Las cuentas del recorrido son de prueba. La foto de muestra es el [retrato público de Eileen Collins](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut).
