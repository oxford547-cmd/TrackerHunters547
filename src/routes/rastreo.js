'use strict';

const express = require('express');
const { findOrderByTracking, listStatusHistoryPublic, lastLocation } = require('../db');
const { getPortal, branding } = require('../portal');
const { wrap } = require('../middleware');

const router = express.Router();

router.get(
  '/',
  wrap(async (req, res) => {
    const codigo = String(req.query.codigo || '').trim().toUpperCase();
    let order = null;
    let history = [];
    let lastLoc = null;

    if (codigo) {
      order = await findOrderByTracking(codigo);
      if (order) {
        [history, lastLoc] = await Promise.all([
          listStatusHistoryPublic(order.id),
          lastLocation(order.id),
        ]);

        if (order.portal_id) {
          const portal = await getPortal(order.portal_id);
          const b = branding(portal);
          res.locals.portal = b.portal;
          res.locals.brandLogo = b.brandLogo;
          res.locals.brandName = b.brandName;
        }
      }
    }

    res.render('rastreo', {
      title: 'Rastrear pedido',
      codigo,
      order,
      history,
      lastLoc,
    });
  })
);

module.exports = router;
