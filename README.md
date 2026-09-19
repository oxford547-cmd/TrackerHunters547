# TrackerHunters547 — Beta

Rastreo de pedidos **Hunters 547**. Express + sesión/bcrypt, datos en **Supabase Postgres** (service role solo en el servidor). Versión **1.0.0-beta.1**.

## Arranque

```bash
cp .env.example .env
```

Completa `.env` (nunca subas secretos):

| Variable | Uso |
|----------|-----|
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (servidor). Alias: `SUPABASE_API_KEY` |
| `SESSION_SECRET` | Cookie de sesión |

Opcional: `PORT` (default 3000), `PUBLIC_BASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Sin SMTP los avisos solo van a consola.

```bash
npm install
npm start
```

Abre **http://localhost:3000/login**. Usuario `superadmin` (contraseña del hash ya sembrado; esta app no la resetea).

```bash
npm test            # sin credenciales
npm run smoke       # requiere SUPABASE_* ; no toca el password
```
