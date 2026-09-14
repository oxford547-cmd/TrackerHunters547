'use strict';

const express = require('express');
const { getDb, now } = require('../db');
const { requireAuth, requireRole, requirePortal } = require('../middleware');
const { ORDER_STATUSES } = require('../constants');
const { getPortal, branding } = require('../portal');

const router = express.Router();

function portalMismatch(user, order) {
  if (!order) return true;
  if (user.role === 'superadmin') return false;
  return Number(order.portal_id) !== Number(user.portal_id);
}

/**
 * POST /api/location
 * Chofer only; order must be assigned to them, same portal, status === en_camino
 */
router.post('/location', requireAuth, requireRole('chofer'), requirePortal, (req, res) => {
  const orderId = Number(req.body.order_id);
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  const accuracy = req.body.accuracy != null ? Number(req.body.accuracy) : null;

  if (!orderId || Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ ok: false, error: 'Datos inválidos' });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ ok: false, error: 'Coordenadas fuera de rango' });
  }

  const d = getDb();
  const order = d.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) {
    return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });
  }
  if (portalMismatch(req.session.user, order) || order.chofer_id !== req.session.user.id) {
    return res.status(403).json({ ok: false, error: 'Pedido no asignado a ti' });
  }
  if (order.status !== 'en_camino') {
    return res.status(403).json({
      ok: false,
      error: 'Solo se acepta GPS cuando el estado es En camino',
    });
  }

  const ts = now();
  d.prepare(
    'INSERT INTO location_updates (order_id, lat, lng, accuracy, created_at) VALUES (?,?,?,?,?)'
  ).run(orderId, lat, lng, accuracy, ts);
  d.prepare('UPDATE orders SET updated_at = ? WHERE id = ?').run(ts, orderId);

  res.json({ ok: true, at: ts, lat, lng });
});

/**
 * POST /api/status — mark Entregado (chofer) or other controlled updates
 */
router.post('/status', requireAuth, requirePortal, (req, res) => {
  const orderId = Number(req.body.order_id);
  const status = String(req.body.status || '').trim();
  const user = req.session.user;
  const d = getDb();
  const order = d.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);

  if (!order) {
    return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });
  }

  // Chofer: only Entregado on own en_camino orders in same portal
  if (user.role === 'chofer') {
    if (status !== 'entregado') {
      return res.status(403).json({ ok: false, error: 'Chofer solo puede marcar Entregado' });
    }
    if (portalMismatch(user, order) || order.chofer_id !== user.id) {
      return res.status(403).json({ ok: false, error: 'Pedido no asignado a ti' });
    }
    if (order.status !== 'en_camino') {
      return res.status(403).json({ ok: false, error: 'Debe estar En camino' });
    }
    const ts = now();
    d.prepare(
      'UPDATE orders SET status = ?, updated_at = ?, delivered_at = ? WHERE id = ?'
    ).run('entregado', ts, ts, orderId);
    d.prepare(
      'INSERT INTO status_history (order_id, status, changed_by, notes, created_at) VALUES (?,?,?,?,?)'
    ).run(orderId, 'entregado', user.id, 'Marcado entregado por chofer', ts);
    return res.json({ ok: true, status: 'entregado', label: ORDER_STATUSES.entregado });
  }

  return res.status(403).json({ ok: false, error: 'Usa el panel de encargado para otros cambios' });
});

/**
 * GET /api/track/:code — public poll for map (single order by code)
 */
router.get('/track/:code', (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const d = getDb();
  const order = d
    .prepare(
      `SELECT id, tracking_code, customer_name, status, updated_at, delivered_at, portal_id
       FROM orders WHERE UPPER(tracking_code) = ?`
    )
    .get(code);

  if (!order) {
    return res.status(404).json({ ok: false, error: 'No encontrado' });
  }

  const lastLoc = d
    .prepare(
      'SELECT lat, lng, accuracy, created_at FROM location_updates WHERE order_id = ? ORDER BY created_at DESC LIMIT 1'
    )
    .get(order.id);

  const portal = order.portal_id ? getPortal(order.portal_id) : null;
  const b = branding(portal);

  res.json({
    ok: true,
    order: {
      tracking_code: order.tracking_code,
      customer_name: order.customer_name,
      status: order.status,
      status_label: ORDER_STATUSES[order.status] || order.status,
      updated_at: order.updated_at,
      delivered_at: order.delivered_at,
    },
    location: lastLoc || null,
    brand: { name: b.brandName, logo: b.brandLogo },
  });
});

/**
 * GET /api/cliente/orders — filtered by session cliente_id + portal_id
 */
router.get('/cliente/orders', requireAuth, requireRole('cliente'), requirePortal, (req, res) => {
  const clienteId = req.session.user.cliente_id;
  const pid = req.session.user.portal_id;
  if (!clienteId) {
    return res.status(403).json({ ok: false, error: 'Sin cliente vinculado' });
  }
  const d = getDb();
  const orders = d
    .prepare(
      `SELECT id, tracking_code, status, address, created_at, updated_at, delivered_at
       FROM orders WHERE customer_id = ? AND portal_id = ? ORDER BY created_at DESC`
    )
    .all(clienteId, pid);
  res.json({ ok: true, orders });
});

/**
 * GET /api/cliente/orders/:id — must belong to session customer + portal
 */
router.get('/cliente/orders/:id', requireAuth, requireRole('cliente'), requirePortal, (req, res) => {
  const clienteId = req.session.user.cliente_id;
  const pid = req.session.user.portal_id;
  const id = Number(req.params.id);
  const d = getDb();
  const order = d
    .prepare(
      `SELECT id, tracking_code, customer_name, phone, address, notes, status,
              created_at, updated_at, delivered_at
       FROM orders WHERE id = ? AND customer_id = ? AND portal_id = ?`
    )
    .get(id, clienteId, pid);

  if (!order) {
    return res.status(404).json({ ok: false, error: 'No encontrado' });
  }
  res.json({ ok: true, order });
});

module.exports = router;
