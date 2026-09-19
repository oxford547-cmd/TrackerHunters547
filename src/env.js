'use strict';

const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {
  /* dotenv is optional if the host already injects env */
}

function supabaseUrl() {
  return String(process.env.SUPABASE_URL || '').trim();
}

function supabaseServiceKey() {
  return String(
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_API_KEY || ''
  ).trim();
}

function requireSupabaseEnv() {
  const url = supabaseUrl();
  const key = supabaseServiceKey();
  if (!url || !key) {
    const err = new Error(
      'Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_API_KEY). Copia .env.example a .env.'
    );
    err.status = 500;
    throw err;
  }
  return { url, key };
}

module.exports = {
  supabaseUrl,
  supabaseServiceKey,
  requireSupabaseEnv,
};
