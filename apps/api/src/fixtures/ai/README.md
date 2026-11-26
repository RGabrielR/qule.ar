# Imágenes de prueba con Content Credentials (C2PA)

Las usa `src/ai-provenance.test.ts`. Son de 48×48 y están firmadas de verdad con
[`c2patool`](https://github.com/contentauth/c2pa-rs/tree/main/cli) 0.27 y su certificado de prueba
(`sample/es256_*`), sin miniatura (`[builder.thumbnail] enabled = false`).

| Archivo | Manifiesto activo |
|---|---|
| `c2pa-generated.{jpg,png,webp}` | `c2pa.created` con `digitalSourceType` = `trainedAlgorithmicMedia` (como ChatGPT, Gemini o Firefly) |
| `c2pa-edited.jpg` | `c2pa.opened` + `c2pa.edited` con `compositeWithTrainedAlgorithmicMedia` (foto real retocada con IA) |
| `c2pa-camera.jpg` | `c2pa.created` con `digitalCapture` (foto de cámara) |
| `c2pa-reopened.jpg` | `c2pa.opened` + `c2pa.cropped`, con `c2pa-generated.jpg` como ingrediente `parentOf` |
| `c2pa-camera-reopened.jpg` | Lo mismo, con `c2pa-camera.jpg` como ingrediente |

Para rehacerlas: `c2patool base.jpg -m manifiesto.json -o salida.jpg` (y `-p padre.jpg` para las reabiertas), con un
manifiesto como este:

```json
{
  "alg": "es256",
  "private_key": "sample/es256_private.key",
  "sign_cert": "sample/es256_certs.pem",
  "claim_generator_info": [{ "name": "qule-test", "version": "1.0.0" }],
  "assertions": [{ "label": "c2pa.actions.v2", "data": { "actions": [
    { "action": "c2pa.created", "digitalSourceType": "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia" }
  ] } }]
}
```
