'use strict';

const express = require('express');
const { getDb } = require('../db');
const { requireAuth, requireRole, requirePortal } = require('../middleware');

const router = express.Router();
router.use(requireAuth, requireRole('chofer'), requirePortal);

router.get('/', (req, res) => {
  const d = getDb();
  const pid = req.session.user.portal_id;
  const orders = d
    .prepare(
      `SELECT o.* FROM orders o
       WHERE o.chofer_id = ?
         AND o.portal_id = ?
         AND o.status IN ('en_camino', 'en_preparacion', 'confirmado', 'pedido_colocado')
       ORDER BY
         CASE o.status
           WHEN 'en_camino' THEN 0
           WHEN 'en_preparacion' THEN 1
           ELSE 2
         END,
         o.updated_at DESC`
    )
    .all(req.session.user.id, pid);

  const recent = d
    .prepare(
      `SELECT o.* FROM orders o
       WHERE o.chofer_id = ? AND o.portal_id = ? AND o.status = 'entregado'
       ORDER BY o.delivered_at DESC LIMIT 10`
    )
    .all(req.session.user.id, pid);

  res.render('chofer', {
    title: 'Mis entregas',
    orders,
    recent,
  });
});

module.exports = router;
