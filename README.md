# TrackerHunters547 — rastreo de pedidos (Node, multi-tenant)

Aplicación **Node.js + Express** para la agencia **Hunters 547**: portales de clientes, dashboard de encargado, choferes con GPS y rastreo público. Versión **1.4.0**.

Demo local con **SQLite**. Más adelante se puede sustituir la persistencia por **Supabase** (Postgres) sin cambiar el modelo de roles ni el flujo de pedidos. Este repositorio **no crea esquema en Supabase**.

Marca tenant: lime `#84BD00`, charcoal `#232323`. Dashboard superadmin: carbón profundo, acentos naranja→rojo.

## Novedades 1.4.0

- **Orden de compra** (`purchase_order`) en alta de pedido y en detalle / cliente / chofer / rastreo.
- **Material enviado**: tabla hija `order_items` (`description`, `uom`, `quantity`); líneas add/remove en Nuevo pedido.
- **Entrega con evidencia**: al marcar **Entregado**, el chofer debe subir **foto** y capturar **firma**. Se guardan en `public/uploads/deliveries/{orderId}/` (`delivery_photo_path`, `delivery_signature_path`). Sin ambas, no se completa la entrega.
- Detalle encargado: `/encargado/pedido/:id` (OC, materiales, evidencia).

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
| `TWILIO_ACCOUNT_SID` | Account SID de Twilio (WhatsApp) |
| `TWILIO_AUTH_TOKEN` | Auth Token de Twilio |
| `TWILIO_WHATSAPP_FROM` | Remitente, p. ej. `whatsapp:+14155238886` (Sandbox o sender aprobado) |
| `SUPABASE_URL` | Placeholder del cliente en `db.js` (raíz). No se usa en el demo SQLite. |
| `SUPABASE_API_KEY` | Placeholder del cliente en `db.js` (raíz). |

Si falta **alguna** de las tres `TWILIO_*`, **no se envía** nada: solo se escribe en consola (`[whatsapp] (log only — falta TWILIO_*)`). El demo local corre sin cuenta Twilio. Un enlace `wa.me` no puede empujar mensajes desde el servidor.

Al crear un portal, el superadmin captura **WhatsApp para actualizaciones** (`portals.whatsapp_number`). Si está definido, el servicio lo usa como remitente (FROM) preferido frente a `TWILIO_WHATSAPP_FROM`.

```bash
export TWILIO_ACCOUNT_SID=ACxxxxxxxx
export TWILIO_AUTH_TOKEN=xxxxxxxx
export TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
npm start
```

**No subas tokens.** Implementación: `src/services/whatsapp.js` (REST Twilio, sin SDK). Hooks: `POST /encargado/orders`, avance/cancelación del encargado, `POST /api/status` (Entregado por chofer). Mensajes en español con número de pedido y estado.

```bash
npm test
```

Reiniciar datos demo:

```bash
npm run seed
```

## Usuarios demo

| Rol | Usuario | Contraseña | Qué puede hacer |
|-----|---------|------------|-----------------|
| **superadmin** | `superadmin` | `superadmin123` | Agencia: crea portales, logo, credenciales de encargado; dashboard global |
| **encargado** | `encargado` | `encargado123` | Portal *Hunters 547 Demo*: dashboard + métricas, **número de pedido manual**, altas clientes/choferes, avanza hasta **En camino** |
| **chofer** | `chofer` | `chofer123` | Pedidos asignados de **su** portal; GPS en **En camino**; marcar **Entregado** (foto + firma) |
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
| `whatsapp_number` | WhatsApp del portal para actualizaciones (FROM preferido) |
| `active` | Si está inactivo, sus usuarios no pueden iniciar sesión |
| `created_at` | Alta |

`users`, `orders` y `customers` llevan `portal_id` (el **superadmin** tiene `portal_id` nulo).

### Flujo de alta

1. Superadmin crea portal + usuario/contraseña del **encargado** + logo opcional + WhatsApp de actualizaciones.
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
- **Nuevo pedido**: al elegir un **cliente de alta**, se autofillan contacto, teléfono, dirección y notas. Incluye **Nº Orden de Compra** y líneas de **Material enviado** (descripción, UoM, cantidad).
- **Dashboard** (`/encargado`): lista de pedidos y KPIs filtrables por presets **día / semana / mes / año** o rango manual. Enlace a **Detalle**.
- **Altas** (`/encargado/clientes`, `/encargado/choferes`): buscar, editar, **Activo / Bloqueado**.
- **Menú lateral** colapsable (hamburguesa): Dashboard, Rastreo, Nuevo pedido, Altas clientes, Altas choferes. En móvil abre como drawer. Chofer/cliente también tienen sidebar simple.

## Stack

- Node.js 18+ + **Express**
- **better-sqlite3** (demo local). **Supabase** (Postgres) previsto para producción; el cliente placeholder vive en `db.js` de la raíz.
- **express-session** (cookie) + **bcryptjs** + **multer** (logo y foto de entrega)
- Vistas **EJS** + estáticos en `public/`
- Leaflet 1.9 (CDN) · Chart.js 4 (CDN, dashboard)

## Rutas

| Ruta | Descripción |
|------|-------------|
| `/login` | Login |
| `/superadmin` | Dashboard agencia (KPIs + charts) |
| `/superadmin/portals` | Alta / edición de portales, credenciales, logo, WhatsApp |
| `/encargado` | Dashboard encargado: pedidos + métricas + filtro de fechas |
| `/encargado/nuevo` | Alta de pedido (número de pedido **manual** / único por portal; OC + materiales) |
| `/encargado/pedido/:id` | Detalle: OC, materiales, evidencia de entrega |
| `/encargado/clientes` | Altas de clientes: editar, bloquear, buscar (+ login opcional) |
| `/encargado/choferes` | Altas de choferes: editar, bloquear, buscar |
| `/chofer` | Entregas + GPS + evidencia (foto + firma) |
| `/cliente` | Mis pedidos (filtrados) |
| `/rastreo?codigo=…` | Rastreo público + mapa + OC / materiales / evidencia |

### Flujo de demostración

1. Login **superadmin** → dashboard con métricas cruzadas → **Nuevo portal** (logo + usuario encargado + WhatsApp).
2. Logout → login con ese encargado → Dashboard con filtros de fecha; **Nuevo pedido** (elige cliente de alta → autofill; OC + materiales); Altas clientes / choferes (editar / bloquear / buscar). Menú lateral colapsable.
3. Login **encargado** (demo) → avanza un pedido hasta **En camino**.
4. Logout → login **chofer** → **Compartir ubicación en vivo** → **Marcar Entregado** (foto + firma obligatorias).
5. Otra pestaña: `/rastreo?codigo=H547-DEMO01-…` ve el mapa (polling cada 5 s) y, si está entregado, la evidencia.
6. Login **cliente** → solo sus pedidos; el detalle muestra OC, materiales y evidencia; intenta `/cliente/pedido/<id-de-otro>` → 404.

> En escritorio sin GPS real: Chrome DevTools → Sensors → Location override.

## Estructura

```
.
├── server.js
├── db.js                      # cliente Supabase (placeholder; no crea esquema)
├── package.json
├── README.md
├── data/                      # SQLite (no versionar .sqlite)
├── src/
│   ├── constants.js
│   ├── db.js                  # schema SQLite + portal_id + order_items + evidencia
│   ├── portal.js              # slugs, logos, métricas, resolveDateRange
│   ├── seed.js
│   ├── middleware.js
│   ├── services/
│   │   └── whatsapp.js        # Twilio WhatsApp (FROM de portal o env)
│   └── routes/                # auth, superadmin, encargado, chofer, cliente, rastreo, api
├── test/                      # node:test
├── views/                     # EJS (incluye partials/sidebar.ejs)
└── public/
    ├── assets/                # css, js, img (logo H547)
    └── uploads/
        ├── portals/{id}/           # logos de tenant (no versionar archivos)
        └── deliveries/{orderId}/   # foto + firma (no versionar archivos; sí .gitkeep)
```

## Modelo de datos (resumen)

- **portals** — tenants: `name`, `slug`, `logo_path`, contacto, `whatsapp_number`, `active`
- **users** — `username`, `password_hash`, `role` (`superadmin|encargado|chofer|cliente`), `name`, `cliente_id`, `portal_id` (null en superadmin), `active`
- **customers** — `name`, `phone`, `address`, `notes`, `active` (Activo/Bloqueado), `portal_id`
- **orders** — `tracking_code` (asignado por el encargado; único por `portal_id`), `customer_id`, `phone` (avisos WhatsApp), entrega, `status`, `chofer_id`, `portal_id`, `purchase_order`, `delivery_photo_path`, `delivery_signature_path`
- **order_items** — líneas de material (`order_id`, `description`, `uom`, `quantity`)
- **location_updates** — GPS
- **status_history** — historial de estados

### Reglas de API GPS / estado

- `POST /api/location`: solo **chofer**; pedido **asignado a él**, mismo `portal_id` y status **`en_camino`**; si no → 403.
- `POST /api/status` (entregado): mismo criterio; **multipart** con `photo` (archivo) + `signature` (data URL). Sin ambos → 400.
- `GET /api/cliente/*`: `customer_id` + `portal_id` de sesión.

## WhatsApp (notificaciones de pedido)

Al **crear** un pedido y en **cada cambio de estado** hasta **Entregado** (incluido), la app notifica al teléfono registrado del cliente (`orders.phone`) vía Twilio WhatsApp. Mensajes en **español**, con marca del portal (si aplica), número de pedido (`tracking_code`) y estado legible. Cancelado también avisa.

Si falta alguna de `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_FROM`, **no se envía** nada: solo se escribe en consola. Implementación: `src/services/whatsapp.js` (REST Twilio, sin SDK). Hooks: `POST /encargado/orders`, avance/cancelación del encargado, `POST /api/status` (Entregado por chofer).

## SQLite (demo) → Supabase (producción)

Este prototipo usa **SQLite** (`better-sqlite3`) para correr en un solo comando. El esquema lógico (portales, usuarios, pedidos, materiales, evidencia, GPS) es el mismo que se mapearía a **Supabase**:

1. Tablas equivalentes en Postgres (RLS por `portal_id` / rol). **No se crean desde este sync.**
2. El archivo `db.js` de la raíz es un cliente `@supabase/supabase-js` con `SUPABASE_URL` / `SUPABASE_API_KEY`. El demo local sigue usando `src/db.js` (SQLite).
3. Variables: `SUPABASE_URL`, `SUPABASE_API_KEY` / service role en servidor; `SESSION_SECRET` fuerte; cookie `secure: true` detrás de HTTPS.
4. Geolocation del navegador **exige HTTPS** fuera de localhost.

## Licencia

Uso interno Hunters 547 / prototipo. UNLICENSED.
