# TrackerHunters547 — rastreo de pedidos (Node + Supabase)

Aplicación **Node.js + Express** para la agencia **Hunters 547**: portales de clientes, dashboard de encargado, choferes con GPS, remisiones provisionales y rastreo público. Versión **1.6.0**.

Persistencia **solo** en **Supabase Postgres** (esquema ya creado; no hay SQLite). Auth propia: **express-session + bcryptjs** contra `users.password_hash` — **no** se usa Supabase Auth. El servidor habla con PostgREST usando **service_role** (RLS activo, sin políticas anon).

## Cómo correr

1. Copia variables (sin secretos reales en git):

```bash
cp .env.example .env
```

2. Completa `.env` como mínimo:

| Variable | Uso |
|----------|-----|
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (servidor). Alias: `SUPABASE_API_KEY` |
| `SESSION_SECRET` | Secreto de cookie de sesión |

Opcional: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `PUBLIC_BASE_URL` (enlaces de rastreo en el correo). Si falta SMTP, los avisos **solo se escriben en consola**.

3. Instala y arranca:

```bash
npm install
npm run smoke    # comprueba env + fila superadmin
npm start
```

Abre **http://localhost:3000/login**.

**Login:** usuario `superadmin` (rol `superadmin`, `portal_id` null). La contraseña es la del hash bcrypt ya sembrado en Supabase; esta app **no la resetea**. `npm run seed` solo inserta `superadmin` si la fila no existe.

Nunca subas `.env` ni la service role al repo ni al navegador.

## Roles

| Rol | Qué puede hacer |
|-----|-----------------|
| **superadmin** | Agencia: portales, logo, credenciales de encargado, dashboard global |
| **encargado** | Dashboard + métricas + filtros de fecha, nuevo pedido (OC + partidas), altas clientes/choferes, remisiones |
| **chofer** | Pedidos asignados; GPS en **En camino**; foto + firma al marcar **Entregado** |
| **cliente** | Solo pedidos de su `customer_id` dentro de su portal |

**Estados:** Pedido colocado → Confirmado → En preparación → En camino → Entregado (+ Cancelado).

**Mapa:** Leaflet + OpenStreetMap. El chofer publica coordenadas; el público / cliente hace polling en `/api/track/:code`.

## Multi-tenant

Cada **portal** es un tenant. `users` (excepto superadmin), `orders`, `customers` y `remisiones` llevan `portal_id`. Superadmin tiene `portal_id` IS NULL (constraint en Postgres).

Columnas de portal: `name`, `slug`, `logo_path`, `contact_name`, `phone`, `email`, `address`, `notes`, `whatsapp_number`, `remision_next`, `active`, `created_at`.

### Aislamiento

- Encargado / chofer / cliente nunca ven filas de otro `portal_id`.
- Usuario `cliente` se vincula con `users.customer_id` → `customers.id` (el alias de sesión `cliente_id` se mapea a esa columna).
- El rastreo público `/rastreo?codigo=` solo expone un pedido si conoces el código.

## Panel encargado

- **Número de pedido** (`tracking_code`): capturado a mano; único por portal.
- **OC** (`purchase_order`) y **partidas** (`order_items`: description, uom, quantity).
- Autofill al elegir un cliente de alta (nombre, teléfono, email, dirección, notas).
- Dashboard filtrable por día / semana / mes / año o rango manual.
- **Remisiones provisionales:** sidebar → listado → alta → consulta/impresión. Folio consecutivo atómico vía `portals.remision_next` (compare-and-swap; unique `(portal_id, folio)`). Logo, razón social y dirección salen del portal.

### Mapeo remisión (PR #7 SQLite → columnas live)

| UI / PR #7 | Columna live |
|------------|----------------|
| folio consecutivo por portal | `portals.remision_next` + `remisiones.folio` + `UNIQUE(portal_id, folio)` |
| fecha | `remisiones.fecha` |
| nombre de cliente | `remisiones.customer_name` (no existe `cliente_id` en remisiones) |
| empresa / dirección | `remisiones.company_name`, `remisiones.company_address` (desde `portals.name` + `portals.address` / `notes`) |
| `company_logo_path` | `remisiones.logo_path` (copia de `portals.logo_path`) |
| `total_importe` | `remisiones.total` (numeric NOT NULL default 0) |
| `total_cantidad` | **no hay columna**; se suma `remision_items.cantidad` en el servidor |
| líneas qty / UOM / desc / lote / importe | `remision_items.cantidad`, `unidad`, `descripcion`, `lote`, `importe` (importe opcional en UI; se guarda 0 si vacío) |
| `users.cliente_id` (sesión) | `users.customer_id` (el alias `cliente_id` solo vive en memoria) |

## Stack

- Node.js 18+ + **Express**
- **@supabase/supabase-js** (un solo cliente server-side; realtime desactivado / transport dummy para Node 20 sin `ws`)
- **express-session** + **bcryptjs** + **multer** + **nodemailer**
- Vistas **EJS** + estáticos en `public/`

## Rutas

| Ruta | Descripción |
|------|-------------|
| `/login` | Login (sesión + bcrypt) |
| `/superadmin` | Dashboard agencia |
| `/superadmin/portals` | Alta / edición de portales |
| `/encargado` | Dashboard + métricas + filtro de fechas |
| `/encargado/nuevo` | Alta de pedido (OC + partidas + autofill) |
| `/encargado/clientes` | Altas de clientes |
| `/encargado/choferes` | Altas de choferes |
| `/encargado/remisiones` | Listado de remisiones provisionales |
| `/encargado/remisiones/nueva` | Alta (líneas + folio preview) |
| `/encargado/remisiones/:id` | Consulta / impresión |
| `/encargado/pedido/:id` | Detalle de pedido (OC, partidas, evidencia) |
| `/chofer` | Entregas + GPS + foto/firma **obligatorias** |
| `/cliente` | Mis pedidos |
| `/rastreo?codigo=…` | Rastreo público + mapa |

## Avisos de estado (email)

Al crear un pedido y en cada cambio de estado (incluido Entregado / Cancelado) se notifica al `orders.email` (o email del cliente) por SMTP. **No hay envío WhatsApp.** Sin `SMTP_HOST` + `SMTP_FROM` solo hay log en consola.

## GPS / estado

- `POST /api/location`: solo **chofer**; pedido asignado, mismo `portal_id`, status **`en_camino`**.
- `POST /api/status` (o `/api/deliver`): Entregado + **foto y firma requeridas**; mismo criterio.
- `GET /api/cliente/*`: `customer_id` + `portal_id` de sesión.

Geolocation del navegador exige HTTPS fuera de localhost.

## Tests

```bash
npm test
```

Los unit tests no necesitan credenciales. El smoke **sí** habla con el proyecto live:

```bash
# Requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_API_KEY) en .env
npm run smoke
```

Comprueba env + fila `users.username=superadmin` (no toca el password). Luego `npm start` y `/login`.

## Licencia

Uso interno Hunters 547. UNLICENSED.
