'use strict';

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
