'use strict';

const express = require('express');
const {
  findCustomer,
  listCustomerOrders,
  findCustomerOrder,
  listStatusHistory,
  lastLocation,
  listOrderItems,
} = require('../db');
const { requireAuth, requireRole, requirePortal, wrap } = require('../middleware');

const router = express.Router();
router.use(requireAuth, requireRole('cliente'), requirePortal);

function sessionCustomerId(user) {
  return user.customer_id ?? user.cliente_id;
}

router.get(
  '/',
  wrap(async (req, res) => {
    const clienteId = sessionCustomerId(req.session.user);
    const pid = req.session.user.portal_id;
    if (!clienteId) {
      return res.status(403).send('Cuenta de cliente sin customer vinculado.');
    }

    const [customer, orders] = await Promise.all([
      findCustomer(clienteId, pid),
      listCustomerOrders(clienteId, pid),
    ]);

    res.render('cliente', {
      title: 'Mis pedidos',
      customer,
      orders,
    });
  })
);

router.get(
  '/pedido/:id',
  wrap(async (req, res) => {
    const clienteId = sessionCustomerId(req.session.user);
    const pid = req.session.user.portal_id;
    const id = Number(req.params.id);

    const order = await findCustomerOrder(id, clienteId, pid);
    if (!order) {
      return res.status(404).send('Pedido no encontrado o no pertenece a tu cuenta.');
    }

    const [history, lastLoc, items] = await Promise.all([
      listStatusHistory(order.id),
      lastLocation(order.id),
      listOrderItems(order.id),
    ]);

    res.render('cliente-detalle', {
      title: `Pedido ${order.tracking_code}`,
      order,
      history,
      lastLoc,
      items,
    });
  })
);

module.exports = router;
