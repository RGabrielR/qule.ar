# Seguridad

qule.ar guarda datos muy sensibles: orientación, estado serológico, ubicación aproximada y chats privados. Si encontrás un problema de seguridad, gracias por avisarnos. Te pedimos que lo hagas **en privado**, así podemos arreglarlo antes de que alguien lo use para dañar a otras personas.

## Cómo reportar una vulnerabilidad

1. Entrá a la pestaña **Security** del repositorio y tocá **Report a vulnerability**. Lo que escribas ahí lo ve solo el equipo del proyecto.
2. Contanos:
   - qué encontraste y dónde (la pantalla, la ruta del API o el archivo);
   - cómo reproducirlo, paso a paso;
   - qué podría hacer alguien con eso (por ejemplo, ver chats ajenos o ubicar a una persona).

**No lo publiques** en un issue, en una discusión ni en redes hasta que esté arreglado.

## Qué te prometemos

- Responder en **72 horas** para confirmar que lo recibimos.
- Contarte qué vamos a hacer y avisarte cuando esté arreglado.
- Si querés, nombrarte en el arreglo. Si preferís el anonimato, también.

Somos un proyecto voluntario y no tenemos un programa de recompensas, pero sí mucho agradecimiento.

## Probar de buena fe

Si investigás de buena fe y respetás esto, no vamos a tomar ninguna acción en tu contra:

- **Usá cuentas propias.** No entres a cuentas, chats, fotos ni datos de otras personas. Si sin querer ves datos ajenos, frená, no los guardes y avisanos.
- **Probá en tu compu** (el proyecto se levanta en local, ver el README) siempre que puedas, antes que en qule.ar.
- **No hagas** pruebas de saturación (DoS), spam, ingeniería social con el equipo ni con quienes usan la app, ni pruebas físicas.

## Qué está dentro y fuera

**Dentro:** el código de este repositorio y la app en qule.ar (web, API y chat en vivo).

**Fuera:** los servicios de terceros que usamos (Cloudflare, Google, el proveedor de mails), salvo que el problema esté en cómo los usamos nosotros. Esos problemas se reportan directamente a cada servicio.

## Lo que ya hace la app

Para que sepas desde dónde partimos:

- Encabezados de seguridad (CSP, anti-iframe, HSTS): `apps/api/src/security.ts`.
- Límite de intentos de login por IP, y límites por persona en mensajes, fotos y reportes: `apps/api/src/auth.ts` y `apps/api/src/ratelimit.ts`.
- Cada PR pasa por CodeQL, el análisis de seguridad automático de GitHub: `.github/workflows/codeql.yml`. Lo que encuentra se ve en **Security > Code scanning**.
- Dependabot avisa cuando una dependencia tiene una vulnerabilidad conocida y abre solo el PR que la arregla: `.github/dependabot.yml`.
- La ubicación se guarda redondeada a una zona de ~500 m, y la distancia escondida no se usa para nada: `apps/api/src/geo.ts`.
- Lo que se sabe y lo que falta está en la [Política de privacidad](apps/web/src/legal/privacidad.md), sin letra chica.
