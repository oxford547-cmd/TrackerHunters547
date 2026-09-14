# Hunters 547 — Rastreo de Pedidos (SaaS multi-tenant)

Prototipo **local** de seguimiento de pedidos para la agencia **Hunters 547**.  
Marca tenant: lime `#84BD00`, charcoal `#232323`.  
Dashboard superadmin: carbón profundo, acentos naranja→rojo, botones cristal.

> Este paquete es un prototipo Node.js + SQLite. **No incluye despliegue a Hostinger.**  
> Para producción posterior se documenta el cambio a MySQL (abajo).

## Roles

| Rol | Usuario demo | Contraseña | Qué puede hacer |
|-----|--------------|------------|-----------------|
| **superadmin** | `superadmin` | `superadmin123` | Agencia: crea portales (empresas), logo, credenciales de encargado; dashboard global |
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
2. Ese encargado entra a `/encargado` (sidebar: Dashboard, Nuevo pedido, Altas clientes/choferes, Rastreo). Asigna el **número de pedido** a mano (único por portal); gestiona choferes y clientes **solo de su portal**.
3. Los `cliente` finales solo ven sus propios pedidos dentro de ese portal.
4. GPS / mapa / estados siguen igual, filtrados por `portal_id`.

## Aislamiento (importante)

### Entre portales

- Encargado / chofer / cliente **nunca** ven filas de otro `portal_id`.
- Las APIs (`/api/location`, `/api/status`, `/api/cliente/*`) comprueban `portal_id` de la sesión.
- Superadmin ve métricas y puede editar **todos** los portales.

Demo: inicia sesión como `encargado` — no aparece el pedido `H547-NTE01-…` de Logística Norte. Como `encnorte` no ves los `H547-DEMO…`.

### Dentro del portal (cliente)

- Cada usuario `cliente` tiene `users.cliente_id` → `customers.id`.
- El portal `/cliente` y `/api/cliente/*` filtran **siempre** con:

  ```sql
  WHERE customer_id = ? AND portal_id = ?
  ```

  usando la sesión (nunca un id enviado por el cliente sin cruzar).
- El rastreo público `/rastreo?codigo=` solo expone **un** pedido si conoces el código. Branding del portal del pedido (logo si existe).
- Demo: `cliente` ve 2+ pedidos de García. El `H547-OTRO01-…` de Pérez **no** aparece. Como `cliente2` solo ves el de Pérez.


## Panel encargado (UX)

- **Número de pedido** (`tracking_code`): lo captura el encargado al crear el pedido (campo obligatorio). La app puede sugerir un código, pero no lo genera sola como único camino. Unicidad validada por `portal_id`.
- **Dashboard** (`/encargado`): lista todos los pedidos del portal y KPIs (total, por estado, en camino, entregados hoy/semana, equipo).
- **Altas**: `/encargado/clientes` y `/encargado/choferes` (CRUD listado + alta).
- **Menú lateral** colapsable (hamburguesa): Dashboard, Rastreo, Nuevo pedido, Altas clientes, Altas choferes. En móvil abre como drawer. Chofer/cliente también tienen sidebar simple.

## Stack

- Node.js 18+ + **Express**
- **better-sqlite3** (demo local)
- **express-session** (cookie) + **bcryptjs** + **multer** (logo)
- Vistas **EJS** + estáticos en `public/`
- Leaflet 1.9 (CDN) · Chart.js 4 (CDN, dashboard)

## Cómo correr

```bash
cd pedidoshunters547-node
npm install
npm start
```

Abre: **http://localhost:3000/**

| Ruta | Descripción |
|------|-------------|
| `/login` | Login |
| `/superadmin` | Dashboard agencia (KPIs + charts) |
| `/superadmin/portals` | Alta / edición de portales, credenciales, logo |
| `/encargado` | Dashboard encargado: todos los pedidos + métricas |
| `/encargado/nuevo` | Alta de pedido (número de pedido manual / único por portal) |
| `/encargado/clientes` | Altas de clientes (+ login opcional) |
| `/encargado/choferes` | Altas de choferes (usuario/contraseña) |
| `/chofer` | Entregas + GPS |
| `/cliente` | Mis pedidos (filtrados) |
| `/rastreo?codigo=…` | Rastreo público + mapa |

Puerto: `PORT` (default **3000**). Sesión: `SESSION_SECRET`. BD: `DB_PATH` (default `data/pedidos.sqlite`).

Reiniciar datos demo:

```bash
npm run seed
# o: node src/seed.js --force
```

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
pedidoshunters547-node/
├── server.js
├── package.json
├── README.md
├── data/                      # SQLite (no versionar .sqlite)
├── src/
│   ├── constants.js
│   ├── db.js                  # schema + portal_id
│   ├── portal.js              # slugs, logos, métricas
│   ├── seed.js
│   ├── middleware.js
│   └── routes/                # auth, superadmin, encargado, chofer, cliente, rastreo, api
├── views/                     # EJS
└── public/
    ├── assets/                # css, js, img (logo H547)
    └── uploads/portals/{id}/  # logos de tenant
```

## Modelo de datos (resumen)

- **portals** — tenants: `name`, `slug`, `logo_path`, contacto, `active`
- **users** — `username`, `password_hash`, `role` (`superadmin|encargado|chofer|cliente`), `name`, `cliente_id`, `portal_id` (null en superadmin)
- **customers** — `name`, `phone`, `address`, `portal_id`
- **orders** — `tracking_code` (asignado por el encargado; único por `portal_id`), `customer_id`, entrega, `status`, `chofer_id`, `portal_id`
- **location_updates** — GPS
- **status_history** — historial de estados

### Reglas de API GPS / estado

- `POST /api/location`: solo **chofer**; pedido **asignado a él**, mismo `portal_id` y status **`en_camino`**; si no → 403.
- `POST /api/status` (entregado): mismo criterio.
- `GET /api/cliente/*`: `customer_id` + `portal_id` de sesión.

## MySQL para producción (Hostinger) — notas

El demo usa SQLite. Para Hostinger / MySQL más adelante:

1. Crear base MySQL en el panel Hostinger.
2. Sustituir `better-sqlite3` por `mysql2` (pool) y adaptar `src/db.js` a SQL MySQL (`AUTO_INCREMENT`, `DATETIME`, etc.). El esquema lógico es el mismo.
3. Variables de entorno típicas: `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`.
4. `SESSION_SECRET` fuerte; cookie `secure: true` detrás de HTTPS.
5. Geolocation del navegador **exige HTTPS** fuera de localhost.
6. Document root / proxy hacia el proceso Node (o PM2 + reverse proxy). **Este README no cubre el deploy concreto a Hostinger.**

## Zip / entrega

Preferir empaquetar **sin** `node_modules` (pesado por el binario nativo de better-sqlite3) ni SQLite:

```bash
cd /workspace
zip -r pedidoshunters547-node.zip pedidoshunters547-node \
  -x 'pedidoshunters547-node/node_modules/*' \
  -x 'pedidoshunters547-node/data/*.sqlite*'
```

Luego en el destino: `npm install && npm start`.

## Licencia

Uso interno Hunters 547 / prototipo. UNLICENSED.
