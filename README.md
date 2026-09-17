# TrackerHunters547 — rastreo de pedidos (Node, multi-tenant)

Aplicación **Node.js + Express** para la agencia **Hunters 547**: portales de clientes, dashboard de encargado, choferes con GPS y rastreo público.

Demo local con **SQLite**. Más adelante se puede sustituir la persistencia por **Supabase** (Postgres) sin cambiar el modelo de roles ni el flujo de pedidos.

Marca tenant: lime `#84BD00`, charcoal `#232323`. Dashboard superadmin: carbón profundo, acentos naranja→rojo.

## Cómo correr

En la raíz del repo:

```bash
npm install && npm start
```

Abre **http://localhost:3000/** (login en `/login`).

| Variable | Default |
|----------|---------|
| `PORT` | `3000` |
| `SESSION_SECRET` | valor de desarrollo (cámbialo en producción) |
| `DB_PATH` | `data/pedidos.sqlite` (no se versiona) |
| `WHATSAPP_PROVIDER` | `twilio` (también `log` / `stub`; `meta` es un stub) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_FROM` | credenciales Twilio WhatsApp (`From` p. ej. `whatsapp:+14155238886`) |
| `WHATSAPP_ENABLED` | `true` para exigir envío real (si faltan keys, se **registra el error** y no se tira el proceso) |
| `PUBLIC_BASE_URL` | origen público para el enlace de rastreo en el mensaje |
| `WHATSAPP_NOTIFY_CANCELADO` | `true` por defecto; `false` omite avisos de Cancelado |

Copia la lista de `.env.example` e inyéctala en el proceso (export, systemd, panel del host). **No subas tokens.** `npm start` lee `process.env`; si existe un archivo `.env` en la raíz, se carga sin pisar variables ya definidas.

## WhatsApp (ciclo de vida del pedido)

Cada vez que un pedido se **crea** y en cada **cambio de estado** hasta **Entregado**, el sistema intenta un WhatsApp al **teléfono registrado del cliente** (campo `orders.phone`, con respaldo a `customers.phone` del **mismo** `portal_id`). Los números de México se normalizan a E.164 (`+52…`) cuando es posible.

| Evento | Mensaje (es-MX) |
|--------|------------------|
| Alta (encargado) | Pedido **creado / registrado** + estado inicial + pista de rastreo |
| Avance de estado (encargado) | Nuevo estado + número de pedido + marca del portal |
| Entregado (chofer) | Aviso **final** de entrega |
| Cancelado (encargado) | Aviso opcional (se puede desactivar con `WHATSAPP_NOTIFY_CANCELADO=false`) |

Un enlace `wa.me` **no puede** empujar mensajes desde el servidor: hace falta **Twilio WhatsApp** (o más adelante Meta Cloud API / WhatsApp Business). Sin credenciales, el demo **solo escribe el mensaje en el log** y el pedido sigue igual.

```bash
npm test
```

Prueba de humo: un proveedor mock registra cada llamada al cambiar el estado (sin Twilio).

Reiniciar datos demo:

```bash
npm run seed
```

## Usuarios demo

| Rol | Usuario | Contraseña | Qué puede hacer |
|-----|---------|------------|-----------------|
| **superadmin** | `superadmin` | `superadmin123` | Agencia: crea portales, logo, credenciales de encargado; dashboard global |
| **encargado** | `encargado` | `encargado123` | Portal *Hunters 547 Demo*: dashboard + métricas, **número de pedido manual**, altas clientes/choferes, avanza hasta **En camino** |
| **chofer** | `chofer` | `chofer123` | Pedidos asignados de **su** portal; GPS en **En camino**; marcar **Entregado** |
| **cliente** | `cliente` | `cliente123` | Solo pedidos de su `cliente_id` **dentro de su portal** |
| cliente (otro) | `cliente2` | `cliente123` | Pedidos del *otro* customer del mismo portal (aislamiento) |
| encargado (otro portal) | `encnorte` | `norte123` | Portal *Logística Norte* — no ve datos del portal demo |
| chofer / cliente Norte | `chofernorte` / `clientenorte` | `chofer123` / `cliente123` | Aislados al portal Norte |

También: `chofer2` / `chofer123` (María, portal demo).

**Estados:** Pedido colocado → Confirmado → En preparación → En camino → Entregado (+ Cancelado).

**Mapa:** Leaflet + OpenStreetMap. El chofer publica coordenadas; el público / cliente hace polling en `/api/track/:code`.

## Multi-tenant

Cada **portal** (empresa cliente de la agencia) es un tenant:

| Campo | Descripción |
|-------|-------------|
| `id` | PK |
| `name` | Nombre comercial |
| `slug` | Identificador único |
| `logo_path` | `/uploads/portals/{id}/logo.*` (si no hay, logo H547) |
| `contact_name`, `phone`, `email`, `notes` | Datos de contacto |
| `active` | Si está inactivo, sus usuarios no pueden iniciar sesión |
| `created_at` | Alta |

`users`, `orders` y `customers` llevan `portal_id` (el **superadmin** tiene `portal_id` nulo).

### Flujo de alta

1. Superadmin crea portal + usuario/contraseña del **encargado** + logo opcional.
2. Ese encargado entra a `/encargado` (**sidebar**: Dashboard, Nuevo pedido, Altas clientes/choferes, Rastreo). Asigna el **número de pedido a mano** (único por portal); gestiona choferes y clientes **solo de su portal**.
3. Los `cliente` finales solo ven sus propios pedidos dentro de ese portal.
4. GPS / mapa / estados siguen igual, filtrados por `portal_id`.

### Aislamiento entre portales

- Encargado / chofer / cliente **nunca** ven filas de otro `portal_id`.
- Las APIs (`/api/location`, `/api/status`, `/api/cliente/*`) comprueban `portal_id` de la sesión.
- Superadmin ve métricas y puede editar **todos** los portales.

Demo: inicia sesión como `encargado` — no aparece el pedido `H547-NTE01-…` de Logística Norte. Como `encnorte` no ves los `H547-DEMO…`.

### Aislamiento dentro del portal (cliente)

- Cada usuario `cliente` tiene `users.cliente_id` → `customers.id`.
- El portal `/cliente` y `/api/cliente/*` filtran **siempre** con `customer_id` y `portal_id` de sesión.
- El rastreo público `/rastreo?codigo=` solo expone **un** pedido si conoces el código (branding del portal).
- Demo: `cliente` ve pedidos de García. El `H547-OTRO01-…` de Pérez **no** aparece. Como `cliente2` solo ves el de Pérez.

## Panel encargado (UX)

- **Número de pedido** (`tracking_code`): lo captura el encargado al crear el pedido (campo obligatorio). La app puede sugerir un código, pero no lo genera sola como único camino. Unicidad validada por `portal_id`.
- **Dashboard** (`/encargado`): lista todos los pedidos del portal y KPIs (total, por estado, en camino, entregados hoy/semana, equipo).
- **Altas**: `/encargado/clientes` y `/encargado/choferes` (listado + alta).
- **Menú lateral** colapsable (hamburguesa): Dashboard, Rastreo, Nuevo pedido, Altas clientes, Altas choferes. En móvil abre como drawer. Chofer/cliente también tienen sidebar simple.

## Stack

- Node.js 18+ + **Express**
- **better-sqlite3** (demo local). **Supabase** (Postgres) previsto para producción.
- **express-session** (cookie) + **bcryptjs** + **multer** (logo)
- Vistas **EJS** + estáticos en `public/`
- Leaflet 1.9 (CDN) · Chart.js 4 (CDN, dashboard)

## Rutas

| Ruta | Descripción |
|------|-------------|
| `/login` | Login |
| `/superadmin` | Dashboard agencia (KPIs + charts) |
| `/superadmin/portals` | Alta / edición de portales, credenciales, logo |
| `/encargado` | Dashboard encargado: todos los pedidos + métricas |
| `/encargado/nuevo` | Alta de pedido (número de pedido **manual** / único por portal) |
| `/encargado/clientes` | Altas de clientes (+ login opcional) |
| `/encargado/choferes` | Altas de choferes (usuario/contraseña) |
| `/chofer` | Entregas + GPS |
| `/cliente` | Mis pedidos (filtrados) |
| `/rastreo?codigo=…` | Rastreo público + mapa |

### Flujo de demostración

1. Login **superadmin** → dashboard con métricas cruzadas → **Nuevo portal** (logo + usuario encargado).
2. Logout → login con ese encargado → Dashboard con métricas; **Nuevo pedido** (ingresa el nº de pedido); Altas clientes / choferes (solo su portal). Menú lateral colapsable.
3. Login **encargado** (demo) → avanza un pedido hasta **En camino**.
4. Logout → login **chofer** → **Compartir ubicación en vivo** → **Marcar Entregado**.
5. Otra pestaña: `/rastreo?codigo=H547-DEMO01-…` ve el mapa (polling cada 5 s).
6. Login **cliente** → solo sus pedidos; intenta `/cliente/pedido/<id-de-otro>` → 404.

> En escritorio sin GPS real: Chrome DevTools → Sensors → Location override.

## Estructura

```
.
├── server.js
├── package.json
├── README.md
├── data/                      # SQLite (no versionar .sqlite)
├── src/
│   ├── constants.js
│   ├── db.js                  # schema + portal_id
│   ├── phone.js               # E.164 MX para WhatsApp
│   ├── portal.js              # slugs, logos, métricas
│   ├── seed.js
│   ├── middleware.js
│   ├── services/whatsapp.js   # Twilio / log stub
│   └── routes/                # auth, superadmin, encargado, chofer, cliente, rastreo, api
├── test/                      # node:test (WhatsApp mock)
├── views/                     # EJS (incluye partials/sidebar.ejs)
└── public/
    ├── assets/                # css, js, img (logo H547)
    └── uploads/portals/{id}/  # logos de tenant (no versionar archivos)
```

## Modelo de datos (resumen)

- **portals** — tenants: `name`, `slug`, `logo_path`, contacto, `active`
- **users** — `username`, `password_hash`, `role` (`superadmin|encargado|chofer|cliente`), `name`, `cliente_id`, `portal_id` (null en superadmin)
- **customers** — `name`, `phone` (E.164 si se puede), `address`, `portal_id`
- **orders** — `tracking_code` (asignado por el encargado; único por `portal_id`), `customer_id`, `phone` (avisos WhatsApp), entrega, `status`, `chofer_id`, `portal_id`
- **location_updates** — GPS
- **status_history** — historial de estados

### Reglas de API GPS / estado

- `POST /api/location`: solo **chofer**; pedido **asignado a él**, mismo `portal_id` y status **`en_camino`**; si no → 403.
- `POST /api/status` (entregado): mismo criterio.
- `GET /api/cliente/*`: `customer_id` + `portal_id` de sesión.

## SQLite (demo) → Supabase (producción)

Este prototipo usa **SQLite** (`better-sqlite3`) para correr en un solo comando. El esquema lógico (portales, usuarios, pedidos, GPS) es el mismo que se mapearía a **Supabase**:

1. Tablas equivalentes en Postgres (RLS por `portal_id` / rol).
2. Sustituir `src/db.js` por el cliente Supabase (o `pg`) manteniendo las mismas consultas de negocio.
3. Variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY` / service role en servidor; `SESSION_SECRET` fuerte; cookie `secure: true` detrás de HTTPS.
4. Geolocation del navegador **exige HTTPS** fuera de localhost.

MySQL (p. ej. Hostinger) también es viable: `mysql2` en lugar de SQLite, mismas tablas.

## Licencia

Uso interno Hunters 547 / prototipo. UNLICENSED.
