'use strict';

const express = require('express');
const { getDb, loadOrderItems } = require('../db');
const { getPortal, branding } = require('../portal');

const router = express.Router();

router.get('/', (req, res) => {
  const codigo = String(req.query.codigo || '').trim().toUpperCase();
  let order = null;
  let history = [];
  let lastLoc = null;

  if (codigo) {
    const d = getDb();
    order = d.prepare('SELECT * FROM orders WHERE UPPER(tracking_code) = ?').get(codigo);
    if (order) {
      // Public view: do not leak other customers' lists — single order by secret-ish code only
      history = d
        .prepare(
          'SELECT status, created_at, notes FROM status_history WHERE order_id = ? ORDER BY created_at ASC'
        )
        .all(order.id);
      lastLoc = d
        .prepare(
          'SELECT lat, lng, accuracy, created_at FROM location_updates WHERE order_id = ? ORDER BY created_at DESC LIMIT 1'
        )
        .get(order.id);

      if (order.portal_id) {
        const portal = getPortal(order.portal_id);
        const b = branding(portal);
        res.locals.portal = b.portal;
        res.locals.brandLogo = b.brandLogo;
        res.locals.brandName = b.brandName;
      }
    }
  }

  const items = order ? loadOrderItems(order.id) : [];

  res.render('rastreo', {
    title: 'Rastrear pedido',
    codigo,
    order,
    items,
    history,
    lastLoc,
  });
});

module.exports = router;
