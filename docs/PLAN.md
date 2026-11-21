# Plan de mortero

## 1. Funcionalidades

### Cuenta y perfil
- Registro con Google o con email y contraseña. Fecha de nacimiento obligatoria: solo mayores de 18.
- Perfil: foto principal, álbum público, nombre visible, edad, altura, peso, contextura, rol, tribus, qué busca, estado de relación, pronombres, género, orientación, pertenencia LGBTIQ+, estado serológico y último test. Todo opcional salvo la edad; los datos sensibles solo se muestran o se usan en filtros con permiso explícito.
- Borrar la cuenta borra de verdad todos los datos y fotos.

### Grilla de gente cerca
- Perfiles ordenados por distancia, con filtros (a quién querés ver, género, orientación, personas trans que eligieron aparecer en ese filtro, edad, altura, peso, rol, tribus, qué busca, online ahora, con foto).
- **La ubicación nunca se muestra exacta:** se guarda redondeada (celda de unos 500 m) y la distancia que se muestra se redondea y lleva ruido, para que nadie pueda triangular a otra persona.
- Favoritos y "taps".

### Chat 1 a 1
- Texto, fotos, fotos que se borran solas, ubicación aproximada si la persona quiere.
- Desenviar, confirmación de lectura, "escribiendo…", frases guardadas.
- Compartir el álbum privado con alguien puntual y revocarlo cuando quieras.

### Grupos
- **Chat general:** todas las cuentas lo integran automáticamente.
- **Cualquiera puede crear un grupo.** Quien lo crea es su dueño.
- **Nadie puede meter a otra persona en un grupo.** Siempre entra quien eligió entrar, de una de estas dos formas:
  1. **Pidiendo ingreso:** desde la lista de todos los grupos, alguien que no es miembro manda una **solicitud** (con un mensaje opcional), y el dueño o los moderadores la **aceptan o rechazan**.
  2. **Con una invitación:** el dueño o los moderadores invitan a alguien (desde la info del grupo o desde su perfil), y esa persona **acepta o no**. Si la rechaza, no se le puede volver a invitar por 7 días. Un grupo puede tener hasta 50 invitaciones sin responder.
  3. Cualquier miembro puede **salirse** cuando quiera.
- Roles por grupo:
  | Rol | Puede |
  |---|---|
  | Dueño | Todo: editar el grupo, nombrar o sacar moderadores, aprobar solicitudes, expulsar, borrar el grupo |
  | Moderador | Aprobar o rechazar solicitudes, borrar mensajes, silenciar y expulsar miembros |
  | Miembro | Leer, escribir, salirse |
- Si alguien fue rechazado o expulsado, no puede volver a pedir ingreso por un tiempo (por ejemplo 7 días), para que no se vuelva spam de solicitudes.

### "Premium" gratis
Perfiles ilimitados, modo incógnito, quién me vio, filtros avanzados, álbumes privados, fotos que se borran solas, desenviar, confirmación de lectura, sin publicidad.

### Seguridad y moderación
- Bloquear (la otra persona deja de verte en todos lados) y reportar perfiles, mensajes y fotos.
- Panel de administración para revisar reportes y suspender cuentas.
- Datos sensibles (orientación, estado serológico) tratados según la Ley 25.326: pedir solo lo necesario y permitir borrarlos.

## 2. Antispam en chats de grupo

Tres reglas combinadas, configurables por grupo:

1. **Modo lento con cola.** Por defecto, 1 mensaje por minuto con una ráfaga de 2. Si estás en cooldown, tu mensaje no se rechaza: queda **en cola** ("sale en 0:42") y lo podés editar o cancelar mientras espera.
2. **Rotación.** Si tus mensajes son muchos de los últimos del chat (por ejemplo 3 de los últimos 20), tu cooldown se alarga. Así se prioriza que hable gente distinta.
3. **Cuentas nuevas.** Durante las primeras 24 horas, cooldown más largo y sin links.

La cola vive en el servidor: aunque cierres la app, el mensaje sale cuando te toca.

## 3. Stack

| Parte | Elección | Por qué |
|---|---|---|
| Frontend | React + Vite, como PWA instalable | Se instala desde el navegador en iPhone y Android, con notificaciones push, sin depender de las tiendas |
| Backend | Node + Hono, WebSockets con Socket.IO | Liviano y conocido, fácil para sumar gente |
| Base de datos | Postgres + PostGIS, con Drizzle ORM (PGlite en desarrollo) | PostGIS resuelve "gente cerca"; PGlite evita instalar Postgres para colaborar |
| Login | Better Auth (Google + email) | Open source, sin servicios pagos |
| Fotos | Cloudflare R2 | 10 GB gratis y sin costo de tráfico de salida |
| Deploy | Contenedores Docker detrás de nginx | Portable: si cambia el servidor, se mueve fácil |

Estructura del repo:

```
mortero/
  apps/web     # PWA (React + Vite)
  apps/api     # API + WebSockets (Node), esquema y migraciones en src/db y drizzle/
  docs/
```

## 4. Modelo de datos (borrador)

- `users`: cuenta, email, fecha de nacimiento, estado (activa, suspendida).
- `profiles`: datos del perfil, ubicación redondeada (`geography`), última conexión, incógnito.
- `photos`: foto, álbum (público o privado), orden, si se borra sola.
- `album_grants`: a quién le compartiste tu álbum privado.
- `blocks`, `favorites`, `taps`, `profile_views`, `reports`.
- `conversations` y `messages`: chat 1 a 1.
- `groups`: nombre, descripción, foto, dueño, si es el chat general, reglas de antispam.
- `group_members`: usuario, grupo, rol (dueño, moderador, miembro), fecha de ingreso.
- `group_join_requests`: usuario, grupo, mensaje, estado (pendiente, aceptada, rechazada), quién la resolvió.
- `group_messages`: mensaje, estado (en cola, publicado, borrado), hora en que sale.

## 5. Fases

1. **MVP:** login, perfil con fotos, chat general con antispam, chat 1 a 1, bloquear y reportar.
2. **Grupos:** crear, listar, pedir ingreso, aprobar o rechazar, salirse, moderar.
3. **Grilla de gente cerca** con ubicación protegida y filtros.
4. **"Premium" gratis:** incógnito, quién me vio, álbumes privados, fotos que se borran.
5. **Notificaciones push, panel de admin y deploy.**

## 6. Deploy

- Servidor actual: una VPS en Europa que ya tiene otros sitios detrás de nginx. mortero se agrega como un bloque más de nginx, con su propio subdominio y certificado.
- Postgres y la app corren en contenedores levantados uno por uno, sin tocar lo que ya está corriendo.
- Backup diario de la base a R2.
