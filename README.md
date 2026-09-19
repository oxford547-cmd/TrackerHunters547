# TrackerHunters547 — rastreo de pedidos (Node + Supabase)

Aplicación **Node.js + Express** para la agencia **Hunters 547**: portales de clientes, dashboard de encargado, choferes con GPS, remisiones provisionales y rastreo público. Versión **1.4.0**.

Persistencia en **Supabase Postgres** (esquema ya creado). Auth propia: **express-session + bcryptjs** contra `users.password_hash` — **no** se usa Supabase Auth. El servidor habla con PostgREST usando **service_role** (RLS activo, sin políticas anon).

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
- **Remisiones provisionales:** folio consecutivo atómico vía `portals.remision_next` (compare-and-swap; unique `(portal_id, folio)`).

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
| `/encargado/remisiones` | Remisiones provisionales |
| `/chofer` | Entregas + GPS + foto/firma |
| `/cliente` | Mis pedidos |
| `/rastreo?codigo=…` | Rastreo público + mapa |

## Avisos de estado (email)

Al crear un pedido y en cada cambio de estado (incluido Entregado / Cancelado) se notifica al `orders.email` (o email del cliente) por SMTP. **No hay envío WhatsApp.** Sin `SMTP_HOST` + `SMTP_FROM` solo hay log en consola.

## GPS / estado

- `POST /api/location`: solo **chofer**; pedido asignado, mismo `portal_id`, status **`en_camino`**.
- `POST /api/status` (o `/api/deliver`): Entregado + foto/firma opcionales; mismo criterio.
- `GET /api/cliente/*`: `customer_id` + `portal_id` de sesión.

Geolocation del navegador exige HTTPS fuera de localhost.

## Tests

```bash
npm test
```

## Licencia

Uso interno Hunters 547. UNLICENSED.
