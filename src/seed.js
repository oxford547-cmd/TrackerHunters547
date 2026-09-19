'use strict';

require('./env');
const bcrypt = require('bcryptjs');
const { ensureReady, findUserByUsername, insertUser } = require('./db');

/**
 * Supabase seed is already live. Never wipe or overwrite the existing
 * superadmin. Only insert that user if the row is missing.
 */
async function seed() {
  await ensureReady();
  const existing = await findUserByUsername('superadmin');
  if (existing) {
    console.log('Usuario superadmin presente; se deja el password_hash intacto.');
    return existing;
  }

  const user = await insertUser({
    username: 'superadmin',
    password_hash: bcrypt.hashSync('superadmin123', 10),
    role: 'superadmin',
    name: 'Super Admin H547',
    portal_id: null,
    customer_id: null,
    active: true,
  });
  console.log('Usuario superadmin creado (faltaba). Usuario: superadmin');
  return user;
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { seed };
