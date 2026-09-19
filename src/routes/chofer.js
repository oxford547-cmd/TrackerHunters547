'use strict';

const express = require('express');
const { listChoferActiveOrders, listChoferRecentDelivered } = require('../db');
const { requireAuth, requireRole, requirePortal, wrap } = require('../middleware');

const router = express.Router();
router.use(requireAuth, requireRole('chofer'), requirePortal);

router.get(
  '/',
  wrap(async (req, res) => {
    const pid = req.session.user.portal_id;
    const [orders, recent] = await Promise.all([
      listChoferActiveOrders(req.session.user.id, pid),
      listChoferRecentDelivered(req.session.user.id, pid),
    ]);

    res.render('chofer', {
      title: 'Mis entregas',
      orders,
      recent,
    });
  })
);

module.exports = router;
