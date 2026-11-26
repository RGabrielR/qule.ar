# Términos y privacidad

Los textos que se ven en la app están en:

- [`apps/web/src/legal/terminos.md`](../../apps/web/src/legal/terminos.md): se ven en `/terminos`
- [`apps/web/src/legal/privacidad.md`](../../apps/web/src/legal/privacidad.md): se ven en `/privacidad`

Son Markdown simple: títulos `#` y `##`, párrafos, listas con `-` (un nivel de anidado), `**negrita**`, `[links](url)` y citas con `>`. Los links que empiezan con `/` se abren dentro de la app.

## Cómo se registra la aceptación

- Al crear el perfil hay que tildar "Leí y acepto". La API guarda en `profile.terms_version` y `profile.terms_accepted_at` qué versión se aceptó y cuándo. Es la prueba del consentimiento que pide la Ley 25.326 para los datos sensibles.
- Quien no aceptó la versión vigente (cuentas viejas, o cuando los textos cambian) ve un cartel arriba con "Leí y acepto".

**Si cambiás algo importante de los textos**, subí la fecha en los dos lados para que a todes les vuelva a aparecer el cartel:
- `apps/api/src/legal.ts` → `TERMS_VERSION`
- `apps/web/src/legal/version.ts` → `TERMS_VERSION`

Un arreglo de redacción no necesita cambiar la versión.

**Lenguaje de los textos legales:** sin lenguaje inclusivo con "e" (usuarie, todes, bienvenide…), por indicación legal. Se usa español estándar o formas neutras ("las personas", "quien usa la app"), y "el Usuario" como término definido. El resto de la app sigue la guía de tono de `docs/LOOK.md`.

## Lo que falta completar

Esta es una versión beta, escrita con lo que sabemos hoy. Pendiente:

- [ ] **Responsable de la base de datos:** quién figura (nombre y DNI/CUIT, o una organización) y un domicilio. La ley lo exige. Lo define Gabriel; no completar con nada provisorio.
- [ ] **Mail de contacto** para pedidos sobre datos personales. Hoy el contacto es GitHub Discusiones, que es público. Lo define Gabriel.
- [x] **Servidor:** VPS de Contabo en Europa (confirmado por Gabriel). El disco no está cifrado y así lo dice la política.
- [ ] **País exacto del servidor:** probablemente Alemania (el registro público de la IP dice Contabo GmbH, DE); Gabriel lo confirma en el panel de Contabo.
- [ ] **Inscribir la base de datos en la AAIP:** es obligatorio y gratuito. Después, sumar el número de registro a la política.
- [ ] **Mensajes borrados en grupos:** hoy el texto queda en la base (`status = 'deleted'`). Decidir si se borra de verdad o si se guarda un tiempo para moderar, y actualizar el punto 6 de la política.
- [x] **Backups:** cifrados con restic fuera del servidor, en Cloudflare R2, 14 días. La política ya lo dice.
- [x] **Proveedor de mails:** Amazon SES, región `us-east-2` (Estados Unidos). Nombrado en la política.
- [x] **Jurisdicción:** tribunales ordinarios de la Ciudad Autónoma de Buenos Aires, sin quitarle a quien usa la app el derecho a ir a los de su domicilio (consumidor, CCyC art. 1109).
- [ ] **Revisión legal:** que lo lea alguien que sepa de derecho, por ejemplo una organización LGBTIQ+ con área legal.
