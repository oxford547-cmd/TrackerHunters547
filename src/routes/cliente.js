'use strict';

const express = require('express');
const { getDb, loadOrderItems } = require('../db');
const { requireAuth, requireRole, requirePortal } = require('../middleware');

const router = express.Router();
router.use(requireAuth, requireRole('cliente'), requirePortal);

/**
 * Isolation: every query filters by req.session.user.cliente_id AND portal_id.
 * Never return orders belonging to another customer or portal.
 */
router.get('/', (req, res) => {
  const clienteId = req.session.user.cliente_id;
  const pid = req.session.user.portal_id;
  if (!clienteId) {
    return res.status(403).send('Cuenta de cliente sin customer vinculado.');
  }

  const d = getDb();
  const customer = d
    .prepare('SELECT * FROM customers WHERE id = ? AND portal_id = ?')
    .get(clienteId, pid);
  const orders = d
    .prepare(
      `SELECT o.*, u.name AS chofer_name
       FROM orders o
       LEFT JOIN users u ON u.id = o.chofer_id
       WHERE o.customer_id = ? AND o.portal_id = ?
       ORDER BY o.created_at DESC`
    )
    .all(clienteId, pid);

  res.render('cliente', {
    title: 'Mis pedidos',
    customer,
    orders,
  });
});

router.get('/pedido/:id', (req, res) => {
  const clienteId = req.session.user.cliente_id;
  const pid = req.session.user.portal_id;
  const id = Number(req.params.id);
  const d = getDb();

  // CRITICAL: filter by customer_id + portal_id from session — never trust URL alone
  const order = d
    .prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ? AND portal_id = ?')
    .get(id, clienteId, pid);

  if (!order) {
    return res.status(404).send('Pedido no encontrado o no pertenece a tu cuenta.');
  }

  const history = d
    .prepare(
      `SELECT h.*, u.name AS changed_by_name
       FROM status_history h
       LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.order_id = ?
       ORDER BY h.created_at ASC`
    )
    .all(order.id);

  const lastLoc = d
    .prepare(
      'SELECT * FROM location_updates WHERE order_id = ? ORDER BY created_at DESC LIMIT 1'
    )
    .get(order.id);

  const items = loadOrderItems(order.id);

  res.render('cliente-detalle', {
    title: `Pedido ${order.tracking_code}`,
    order,
    items,
    history,
    lastLoc,
  });
});

module.exports = router;
