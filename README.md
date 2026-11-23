# qule.ar

**Poné la pava.**

App comunitaria, gratuita y de código abierto para conocer gente cerca y charlar en grupos.

- **Gratis para siempre.** Todo lo que en otras apps es "premium" acá viene incluido.
- **Código abierto** (AGPL-3.0). Cualquiera puede leerlo, proponer cambios y sumarse.
- **Grupos en vez de "explorar".** Hay un chat general para toda la app y grupos a los que pedís entrar.
- **Chat sin acaparadores.** Un sistema de modo lento, cola y rotación hace que siempre aparezca gente nueva.

> Solo para mayores de 18 años. Está en [qule.ar](https://qule.ar).

## Estado

Fase 1 (MVP) en marcha. Ya funciona:

- Registro con email y contraseña, y con Google (si configurás las credenciales). Mail de bienvenida y recuperación de contraseña (si configurás SMTP).
- Alta de perfil con verificación de mayor de 18.
- Perfil con hasta 6 fotos (se les borran los metadatos y la ubicación GPS) y todos los datos: altura, peso, contextura, rol, tribus, qué buscás, relación, pronombres, estado serológico y último test.
- Chat general con antispam: modo lento, cola con cuenta regresiva (podés editar o cancelar lo que está en cola), rotación y límites para cuentas nuevas.
- Mensajes privados en tiempo real, con fotos y "visto".
- Bloquear, reportar y borrar tu cuenta con todo lo asociado.
- Grupos: cualquiera crea uno y queda como dueño. Se entra pidiendo ingreso (el dueño o los moderadores aceptan o rechazan) o aceptando una invitación del dueño o los moderadores: nadie queda adentro sin haberlo elegido. Si te rechazan o te expulsan, esperás 7 días para volver a pedir. Hay lista de todos los grupos con búsqueda, roles (dueño, moderador, miembro), expulsiones, borrado de mensajes por moderación y reglas antispam configurables por grupo. Si el dueño se va, el grupo pasa a un moderador o al miembro más antiguo.

- Grilla de gente cerca, de la más cercana a la más lejana, con estado en línea y filtros: edad, altura, peso, contextura, rol, tribus, qué busca, relación, solo en línea y solo con foto. Se guarda solo una zona de unos 500 m (nunca la posición exacta) que se actualiza sola mientras la app está abierta, la distancia se muestra en tramos para que no se pueda triangular a nadie, y cada persona puede esconder su distancia o borrar su ubicación.

- Todo lo "premium", gratis:
  - **Modo incógnito:** no aparecés en la grilla, no se ve si estás en línea y tus visitas no se registran.
  - **Quién me vio:** visitas de los últimos 30 días.
  - **Favoritos:** con filtro en la grilla. Nadie se entera de que lo marcaste.
  - **Álbum privado:** lo compartís con alguien puntual y lo revocás cuando quieras. Las fotos están protegidas también en el servidor.
  - **Fotos temporales:** se ven una sola vez durante 10 segundos y después se borran del servidor.
  - **Desenviar:** borra el mensaje para las dos personas.
  - **"Escribiendo…"**, "Visto" y sin publicidad.

- Notificaciones push discretas (no dicen quién te escribió ni qué) y panel de moderación para revisar reportes, borrar mensajes y suspender o reactivar cuentas. Quién modera se define con `ADMIN_EMAILS`.

Para subirlo a un servidor, seguí [docs/DEPLOY.md](docs/DEPLOY.md).

El plan completo está en [docs/PLAN.md](docs/PLAN.md).

## Levantarlo en tu compu

Necesitás Node 22 o más nuevo. No hace falta instalar Postgres: en desarrollo se usa [PGlite](https://pglite.dev), un Postgres embebido que guarda los datos en `data/`.

```bash
npm install
npm run dev
```

Abrí http://localhost:5173. El API corre en el puerto 3001 y Vite le hace de proxy.

### Variables de entorno

Copiá `.env.example` a `.env` y completá lo que necesites:

| Variable | Para qué |
|---|---|
| `BETTER_AUTH_SECRET` | Firma de las sesiones. **Obligatoria en producción.** |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Login con Google. Sin estas variables, el botón no aparece. |
| `DATA_KEY` | Clave que cifra los datos de salud en la base (estado serológico y último test). **Obligatoria en producción.** Se genera con `openssl rand -base64 32`; en desarrollo se crea sola en `data/`. Si se pierde, esos datos no se recuperan. |
| `DATABASE_URL` | Postgres real. Si no está, se usa PGlite. |
| `APP_URL` | URL pública de la web (por defecto `http://localhost:5173`). |
| `ADMIN_EMAILS` | Emails con acceso al panel de moderación, separados por coma. Solo cuentan si el mail de la cuenta está verificado (por ejemplo, si entra con Google). |
| `ADMIN_USER_IDS` | IDs de cuenta con la administración general (todos los permisos de moderación), separados por coma. Al resto del equipo se le dan permisos chicos desde el panel (ver docs/MODERACION.md). Para quien entra con mail y contraseña. El ID se ve en `/api/me` con la sesión iniciada. |
| `SMTP_URL` / `MAIL_FROM` | Mails de bienvenida y para recuperar la contraseña, por cualquier SMTP (Resend, Brevo, etc.). Sin esto no se mandan mails y no aparece "¿Te olvidaste la contraseña?". En desarrollo los mails salen por consola. |
| `CLIENT_IP_HEADER` | Encabezado con la IP real de cada persona (límite de intentos). `cf-connecting-ip` por defecto; con el nginx de `deploy/`, `x-real-ip`. Ver [docs/DEPLOY.md](docs/DEPLOY.md). |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Notificaciones push. Se generan con `npm run vapid`. En desarrollo se crean solas. |

Para Google, la URL de redirección autorizada es `{APP_URL}/api/auth/callback/google`.

### Cambios en la base de datos

Editá `apps/api/src/db/schema.ts` y corré `npm run db:generate`. Las migraciones se aplican solas al arrancar el API.

## Cómo sumarte

Es un proyecto comunitario: toda ayuda suma, también si no programás.

- **Ideas y debates** van en [Discusiones](https://github.com/RGabrielR/qule.ar/discussions).
- **Diseño**: leé [docs/LOOK.md](docs/LOOK.md) y proponé en el [hilo de look and feel](https://github.com/RGabrielR/qule.ar/discussions/3).
- **Código**: mirá los issues [`para empezar`](https://github.com/RGabrielR/qule.ar/labels/para%20empezar) y la guía [CONTRIBUTING.md](CONTRIBUTING.md).

## El nombre

La app se llama **qule.ar**: el nombre y el dominio son lo mismo. Arrancó como "mortero" y la charla del nombre quedó en el [hilo de Discusiones](https://github.com/RGabrielR/qule.ar/discussions/2). El repo también se llama `qule.ar` (antes era `mortero`: los links y clones viejos redirigen solos). Las carpetas, los paquetes y los contenedores todavía se llaman `mortero`: son nombres internos y se pueden cambiar más adelante.

## Licencia

[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html). Si alguien publica una versión modificada como servicio, también tiene que publicar su código.
