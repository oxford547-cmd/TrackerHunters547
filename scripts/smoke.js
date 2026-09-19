'use strict';

/**
 * Smoke: env + Supabase REST with service_role.
 *   cp .env.example .env   # fill SUPABASE_* and SESSION_SECRET
 *   npm install
 *   npm run smoke
 *   npm start
 * Then open /login as the existing superadmin user (password is the seeded hash; not reset).
 */

require('../src/env');
const { getSupabase } = require('../src/supabase');

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_API_KEY;
  if (!url || !key) {
    console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_API_KEY).');
    process.exit(1);
  }
  if (!process.env.SESSION_SECRET) {
    console.warn('SESSION_SECRET no está definido; server.js usará el default de desarrollo.');
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from('users')
    .select('id, username, role, portal_id, active')
    .eq('username', 'superadmin')
    .maybeSingle();

  if (error) {
    console.error('Supabase error:', error.message);
    process.exit(1);
  }
  if (!data) {
    console.error('No existe users.username=superadmin. Corre npm run seed solo si falta.');
    process.exit(1);
  }
  if (data.role !== 'superadmin' || data.portal_id != null) {
    console.error('Fila superadmin inválida (role/portal_id).', data);
    process.exit(1);
  }
  if (!data.active) {
    console.error('superadmin está inactivo.');
    process.exit(1);
  }

  console.log('OK: conectado a', url);
  console.log('OK: superadmin id=%s role=%s portal_id=null', data.id, data.role);
  console.log('Siguiente: npm start  →  http://localhost:%s/login', process.env.PORT || 3000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
