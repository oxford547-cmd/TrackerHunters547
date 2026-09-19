# TrackerHunters547 — rastreo de pedidos (Node, multi-tenant)

Aplicación **Node.js + Express** para la agencia **Hunters 547**: portales de clientes, dashboard de encargado, choferes con GPS y rastreo público. Versión **1.5.0**.

Demo local con **SQLite**. Persistencia en **Supabase** (Postgres) queda prevista para más adelante; este repo no incluye esquema ni migraciones de Supabase.

Marca tenant: lime `#84BD00`, charcoal `#232323`. Dashboard superadmin: carbón profundo, acentos naranja→rojo.

## Versión 1.5.0

- **Notificaciones por email** (SMTP / nodemailer): al crear un pedido y en cada cambio de estado hasta Entregado (y cancelación). Reemplaza WhatsApp como canal de avisos de estado.
- Clientes: campo opcional `email`; Nuevo pedido / Altas clientes lo capturan.
- **Orden de compra** (`purchase_order`) en alta de pedido y vistas de detalle / cliente / chofer / rastreo.
- **Material enviado**: tabla hija `order_items` (description, uom, quantity); líneas add/remove en Nuevo pedido.
- **Entrega con evidencia**: al marcar **Entregado**, el chofer debe subir **foto** y capturar **firma** (canvas). Se guardan en `public/uploads/deliveries/{orderId}/`. Sin ambas, no se completa la entrega.
- Detalle encargado: `/encargado/pedido/:id`.

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
| `SMTP_HOST` | Host SMTP (avisos de pedido) |
| `SMTP_PORT` | `587` (o `465`) |
| `SMTP_USER` | Usuario SMTP (opcional si el relay no autentica) |
| `SMTP_PASS` | Contraseña SMTP |
| `MAIL_FROM` | Remitente, p. ej. `Hunters 547 <noreply@example.com>` |
| `SMTP_SECURE` | Opcional: `true`/`false` (por defecto `true` si el puerto es 465) |
| `PUBLIC_BASE_URL` | Opcional: URL pública sin slash final para el enlace de rastreo |

Si faltan **`SMTP_HOST`**, **`SMTP_PORT`** o **`MAIL_FROM`**, **no se envía** nada: solo se escribe en consola (`[mailer] (log only — falta SMTP_* / MAIL_FROM)`). El demo local corre sin SMTP.

```bash
export SMTP_HOST=smtp.example.com
export SMTP_PORT=587
export SMTP_USER=noreply@example.com
export SMTP_PASS=cambia-esto
export MAIL_FROM="Hunters 547 <noreply@example.com>"
export PUBLIC_BASE_URL=https://pedidos.example.com
npm start
```

**No subas contraseñas.** Implementación: `src/services/mailer.js` + `src/services/emailTemplates.js`. Hooks: `POST /encargado/orders`, avance/cancelación del encargado, `POST /api/status` (Entregado por chofer).

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
| `whatsapp_number` | Reservado; los avisos de estado van por email |
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
- **Nuevo pedido**: al elegir un **cliente de alta**, se autofillan contacto, **email**, teléfono, dirección y notas. Incluye **Nº Orden de Compra** y líneas de **Material enviado**.
- **Dashboard** (`/encargado`): lista de pedidos y KPIs filtrables por presets **día / semana / mes / año** o rango manual.
- **Altas** (`/encargado/clientes`, `/encargado/choferes`): buscar, editar, **Activo / Bloqueado**. Email opcional en clientes (avisos de estado).
- **Menú lateral** colapsable (hamburguesa): Dashboard, Rastreo, Nuevo pedido, Altas clientes, Altas choferes. En móvil abre como drawer. Chofer/cliente también tienen sidebar simple.

## Stack

- Node.js 20+ + **Express**
- **better-sqlite3** (demo local)
- **nodemailer** (SMTP; log-only si faltan credenciales)
- **express-session** (cookie) + **bcryptjs** + **multer** (logo + foto de entrega)
- Vistas **EJS** + estáticos en `public/`
- Leaflet 1.9 (CDN) · Chart.js 4 (CDN, dashboard)

## Rutas

| Ruta | Descripción |
|------|-------------|
| `/login` | Login |
| `/superadmin` | Dashboard agencia (KPIs + charts) |
| `/superadmin/portals` | Alta / edición de portales, credenciales, logo |
| `/encargado` | Dashboard encargado: pedidos + métricas + filtro de fechas |
| `/encargado/nuevo` | Alta de pedido (número de pedido **manual** / único por portal; autofill + OC + materiales) |
| `/encargado/pedido/:id` | Detalle de pedido |
| `/encargado/clientes` | Altas de clientes: email, editar, bloquear, buscar (+ login opcional) |
| `/encargado/choferes` | Altas de choferes: editar, bloquear, buscar |
| `/chofer` | Entregas + GPS (foto + firma al marcar Entregado) |
| `/cliente` | Mis pedidos (filtrados) |
| `/rastreo?codigo=…` | Rastreo público + mapa |

### Flujo de demostración

1. Login **superadmin** → dashboard con métricas cruzadas → **Nuevo portal** (logo + usuario encargado).
2. Logout → login con ese encargado → Dashboard con filtros de fecha; **Nuevo pedido** (elige cliente de alta → autofill email/teléfono; OC + materiales); Altas clientes / choferes (editar / bloquear / buscar).
3. Login **encargado** (demo) → avanza un pedido hasta **En camino**.
4. Logout → login **chofer** → **Compartir ubicación en vivo** → **Marcar Entregado** (foto + firma obligatorias).
5. Otra pestaña: `/rastreo?codigo=H547-DEMO01-…` ve el mapa (polling cada 5 s).
6. Login **cliente** → solo sus pedidos; intenta `/cliente/pedido/<id-de-otro>` → 404.

> En escritorio sin GPS real: Chrome DevTools → Sensors → Location override.

## Estructura

```
.
├── server.js
├── db.js                      # cliente Supabase opcional (no usado por el demo SQLite)
├── package.json
├── README.md
├── data/                      # SQLite (no versionar .sqlite)
├── src/
│   ├── constants.js
│   ├── db.js                  # schema SQLite + portal_id + customers.email
│   ├── portal.js              # slugs, logos, métricas, resolveDateRange
│   ├── seed.js
│   ├── middleware.js
│   ├── services/
│   │   ├── mailer.js          # SMTP nodemailer (o log-only sin creds)
│   │   ├── emailTemplates.js  # HTML + texto es-MX
│   │   └── whatsapp.js        # legado; ya no se usa para avisos de estado
│   └── routes/                # auth, superadmin, encargado, chofer, cliente, rastreo, api
├── test/                      # node:test
├── views/                     # EJS
└── public/
    ├── assets/                # css, js, img (logo H547)
    └── uploads/
        ├── portals/{id}/           # logos de tenant
        └── deliveries/{orderId}/   # foto + firma de entrega
```

## Modelo de datos (resumen)

- **portals** — tenants: `name`, `slug`, `logo_path`, contacto, `active`
- **users** — `username`, `password_hash`, `role` (`superadmin|encargado|chofer|cliente`), `name`, `cliente_id`, `portal_id` (null en superadmin), `active`
- **customers** — `name`, `phone`, `email` (opcional, avisos), `address`, `notes`, `active` (Activo/Bloqueado), `portal_id`
- **orders** — `tracking_code` (asignado por el encargado; único por `portal_id`), `customer_id`, entrega, `status`, `chofer_id`, `portal_id`, `purchase_order`, `delivery_photo_path`, `delivery_signature_path`
- **order_items** — líneas de material (`order_id`, `description`, `uom`, `quantity`)
- **location_updates** — GPS
- **status_history** — historial de estados

### Reglas de API GPS / estado

- `POST /api/location`: solo **chofer**; pedido **asignado a él**, mismo `portal_id` y status **`en_camino`**; si no → 403.
- `POST /api/status` (entregado): mismo criterio; **multipart** con `photo` (archivo) + `signature` (data URL PNG). Sin ambos → 400.
- `GET /api/cliente/*`: `customer_id` + `portal_id` de sesión.

## Email (notificaciones de pedido)

Al **crear** un pedido y en **cada cambio de estado** hasta **Entregado** (incluido) y en **cancelación**, la app envía un correo al **email registrado del cliente** (`customers.email`, o el capturado en Nuevo pedido).

Si el cliente **solo tiene teléfono** (sin email), **no se envía** nada: se registra en consola (`[mailer] Sin email del cliente; se omite notificación.`). El campo teléfono se conserva; WhatsApp **ya no** se usa para avisos de estado.

Plantilla **es-MX** (HTML + texto): nombre del portal/empresa, número de pedido / rastreo, OC si existe, resumen de materiales, estado anterior → nuevo (o “registrado”), fechas, enlace a `/rastreo?codigo=…` si `PUBLIC_BASE_URL` está definido, y pie pidiendo agregar el remitente (`MAIL_FROM`) a contactos.

> **WhatsApp discontinuado** para notificaciones de estado. `src/services/whatsapp.js` y `portals.whatsapp_number` pueden permanecer sin uso activo.

## Licencia

Uso interno Hunters 547 / prototipo. UNLICENSED.
