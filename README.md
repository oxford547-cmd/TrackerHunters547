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

Opcional: `PORT` (default 3000) y correo (ver abajo). Sin `SMTP_HOST` los avisos solo van a consola.

## Correo Hostinger

Los avisos de estado salen **From** `Hunters 547 <info@hunters547.cloud>` por SMTP de Hostinger.

| Variable | Valor |
|----------|--------|
| `SMTP_HOST` | `smtp.hostinger.com` |
| `SMTP_PORT` | `465` |
| `SMTP_SECURE` | `true` |
| `SMTP_USER` | `info@hunters547.cloud` |
| `SMTP_PASS` | solo en el `.env` del servidor (nunca en git) |
| `SMTP_FROM` | `Hunters 547 <info@hunters547.cloud>` |
| `MAIL_FROM` | alias opcional de `SMTP_FROM` (mismo valor) |
| `PUBLIC_BASE_URL` | URL pública sin slash final (enlaces de rastreo en el correo) |

Si `SMTP_FROM` / `MAIL_FROM` faltan pero hay `SMTP_HOST`, el From por defecto es `Hunters 547 <info@hunters547.cloud>`.

```bash
npm install
npm start
```

Abre **http://localhost:3000/login**. Usuario `superadmin` (contraseña del hash ya sembrado; esta app no la resetea).

```bash
npm test            # sin credenciales
npm run smoke       # requiere SUPABASE_* ; no toca el password
```
