'use strict';

const fs = require('fs');
const path = require('path');

/** Optional local `.env` (does not override real process env). Never logs values. */
function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (process.env[key] != null && process.env[key] !== '') continue;
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch (_) {
    /* ignore malformed .env */
  }
}

loadDotEnv();

/** Status keys → Spanish labels (México) */
const ORDER_STATUSES = {
  pedido_colocado: 'Pedido colocado',
  confirmado: 'Confirmado',
  en_preparacion: 'En preparación',
  en_camino: 'En camino',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

/** Encargado can advance along this chain (not to entregado — that's chofer) */
const ENCARGADO_FLOW = [
  'pedido_colocado',
  'confirmado',
  'en_preparacion',
  'en_camino',
];

const STATUS_BADGE = {
  pedido_colocado: 'badge-muted',
  confirmado: 'badge-info',
  en_preparacion: 'badge-warn',
  en_camino: 'badge-live',
  entregado: 'badge-ok',
  cancelado: 'badge-danger',
};

const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'hunters547-dev-secret-change-in-prod';
const DB_PATH = process.env.DB_PATH || require('path').join(__dirname, '..', 'data', 'pedidos.sqlite');

module.exports = {
  ORDER_STATUSES,
  ENCARGADO_FLOW,
  STATUS_BADGE,
  PORT,
  SESSION_SECRET,
  DB_PATH,
};
