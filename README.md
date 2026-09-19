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

Opcional: `PORT` (default 3000), `PUBLIC_BASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (alias `MAIL_FROM`), `UPLOADS_DIR`. El remitente visible es **Notificaciones** `<SMTP_FROM>`. Sin SMTP los avisos HTML solo van a consola. Los correos de estado incrustan el logo por CID (no dependen de un hotlink a `/uploads`).

```bash
npm install
npm start
```

Abre **http://localhost:3000/login**. Usuario `superadmin` (contraseña del hash ya sembrado; esta app no la resetea).

```bash
npm test            # sin credenciales
npm run smoke       # requiere SUPABASE_* ; no toca el password
```

## Logos y `/uploads` en Hostinger

Git deploy en Hostinger **reemplaza** `hbuilds/` y `public_html` en cada push. Los logos de portal se guardan en disco (`logo_path` p. ej. `/uploads/portals/2/logo.png`) y **no van en el repo**, así que tras un deploy el archivo desaparece: `https://www.hunters547.cloud/uploads/portals/2/logo.png` responde 404. El HTML del correo no hotlinkea esa URL; incrusta el archivo por CID usando la **misma raíz** que `GET /uploads` (`UPLOADS_DIR` / `public/uploads`). Si `logo_path` está en la base y el disco local no se puede leer, el mailer pide los bytes a `PUBLIC_BASE_URL + logo_path` y los embebe por CID. Solo usa el logo Hunters 547 cuando el portal no tiene logo, o cuando ese archivo no se puede leer ni por disco ni por HTTP.

Para que el logo **de cada marca** sobreviva deploys:

1. Crea un directorio **fuera** de `hbuilds` y `public_html`, por ejemplo `/home/USUARIO/hunters547-uploads`.
2. En hPanel → Node.js → variables de entorno, define `UPLOADS_DIR` con esa ruta absoluta.
3. Redeploy (o reinicia la app) y en **Superadmin → Portales** vuelve a subir el logo de Marca ACME y el resto.
4. Comprueba `https://www.hunters547.cloud/uploads/portals/2/logo.png` → **200** `image/png` (o jpeg).
5. Un pedido de prueba debe llegar a Gmail con el logo visible en el encabezado negro, From **Notificaciones**, sin icono de imagen rota.

Sin `UPLOADS_DIR`, los logos vuelven a perderse en el siguiente Git deploy (habría que re-subirlos otra vez). Si el archivo aún se sirve en `https://www.hunters547.cloud/uploads/...` (HTTP 200), el correo debe mostrar el logo de la marca; Hunters 547 solo aparece cuando el portal no tiene logo.
