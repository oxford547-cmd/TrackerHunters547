'use strict';

const path = require('path');
const express = require('express');
const multer = require('multer');
const {
  now,
  findOrderById,
  findOrderByTracking,
  insertLocation,
  updateOrder,
  insertStatusHistory,
  lastLocation,
  listCustomerOrders,
  findCustomerOrder,
} = require('../db');
const { requireAuth, requireRole, requirePortal, wrap } = require('../middleware');
const { ORDER_STATUSES } = require('../constants');
const { getPortal, branding, saveDeliveryAsset, saveSignatureDataUrl, ALLOWED_LOGO_MIME } = require('../portal');
const { notifyOrderStatusAsync } = require('../services/email');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file || !file.originalname) return cb(null, true);
    if (ALLOWED_LOGO_MIME[file.mimetype]) return cb(null, true);
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) return cb(null, true);
    cb(new Error('La foto debe ser una imagen (JPG, PNG, WEBP o GIF).'));
  },
});

function portalMismatch(user, order) {
  if (!order) return true;
  if (user.role === 'superadmin') return false;
  return Number(order.portal_id) !== Number(user.portal_id);
}

function sessionCustomerId(user) {
  return user.customer_id ?? user.cliente_id;
}

router.post(
  '/location',
  requireAuth,
  requireRole('chofer'),
  requirePortal,
  wrap(async (req, res) => {
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

    const order = await findOrderById(orderId);
    if (!order) {
      return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });
    }
    if (portalMismatch(req.session.user, order) || Number(order.chofer_id) !== Number(req.session.user.id)) {
      return res.status(403).json({ ok: false, error: 'Pedido no asignado a ti' });
    }
    if (order.status !== 'en_camino') {
      return res.status(403).json({
        ok: false,
        error: 'Solo se acepta GPS cuando el estado es En camino',
      });
    }

    const ts = now();
    await insertLocation({ order_id: orderId, lat, lng, accuracy, created_at: ts });
    await updateOrder(orderId, { updated_at: ts });

    res.json({ ok: true, at: ts, lat, lng });
  })
);

async function markDelivered(req, res) {
  const orderId = Number(req.body.order_id);
  const status = String(req.body.status || 'entregado').trim();
  const user = req.session.user;
  const order = await findOrderById(orderId);

  if (!order) {
    return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });
  }

  if (user.role !== 'chofer') {
    return res.status(403).json({ ok: false, error: 'Usa el panel de encargado para otros cambios' });
  }
  if (status !== 'entregado') {
    return res.status(403).json({ ok: false, error: 'Chofer solo puede marcar Entregado' });
  }
  if (portalMismatch(user, order) || Number(order.chofer_id) !== Number(user.id)) {
    return res.status(403).json({ ok: false, error: 'Pedido no asignado a ti' });
  }
  if (order.status !== 'en_camino') {
    return res.status(403).json({ ok: false, error: 'Debe estar En camino' });
  }

  const ts = now();
  const photo = req.file || (req.files && req.files.photo && req.files.photo[0]);
  const sigRaw = req.body.signature || req.body.delivery_signature;
  if (!photo) {
    return res.status(400).json({ ok: false, error: 'Foto de entrega requerida' });
  }
  if (!sigRaw) {
    return res.status(400).json({ ok: false, error: 'Firma de entrega requerida' });
  }
  const photoPath = saveDeliveryAsset(orderId, photo, 'photo');
  const signaturePath = saveSignatureDataUrl(orderId, String(sigRaw));
  if (!photoPath || !signaturePath) {
    return res.status(400).json({ ok: false, error: 'No se pudo guardar la evidencia de entrega' });
  }
  const patch = {
    status: 'entregado',
    updated_at: ts,
    delivered_at: ts,
    delivery_photo_path: photoPath,
    delivery_signature_path: signaturePath,
  };

  await updateOrder(orderId, patch);
  await insertStatusHistory({
    order_id: orderId,
    status: 'entregado',
    changed_by: user.id,
    notes: 'Marcado entregado por chofer',
    created_at: ts,
  });
  notifyOrderStatusAsync({
    tracking_code: order.tracking_code,
    status: 'entregado',
    phone: order.phone,
    email: order.email,
    customer_name: order.customer_name,
    portal_id: order.portal_id,
  });
  return res.json({ ok: true, status: 'entregado', label: ORDER_STATUSES.entregado });
}

function withOptionalPhoto(req, res, next) {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message || 'Error al subir foto' });
    next();
  });
}

router.post('/status', requireAuth, requirePortal, withOptionalPhoto, wrap(markDelivered));
router.post('/deliver', requireAuth, requireRole('chofer'), requirePortal, withOptionalPhoto, wrap(markDelivered));

router.get(
  '/track/:code',
  wrap(async (req, res) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    const order = await findOrderByTracking(code);

    if (!order) {
      return res.status(404).json({ ok: false, error: 'No encontrado' });
    }

    const lastLoc = await lastLocation(order.id);
    const portal = order.portal_id ? await getPortal(order.portal_id) : null;
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
  })
);

router.get(
  '/cliente/orders',
  requireAuth,
  requireRole('cliente'),
  requirePortal,
  wrap(async (req, res) => {
    const clienteId = sessionCustomerId(req.session.user);
    const pid = req.session.user.portal_id;
    if (!clienteId) {
      return res.status(403).json({ ok: false, error: 'Sin cliente vinculado' });
    }
    const all = await listCustomerOrders(clienteId, pid);
    const orders = all.map((o) => ({
      id: o.id,
      tracking_code: o.tracking_code,
      status: o.status,
      address: o.address,
      created_at: o.created_at,
      updated_at: o.updated_at,
      delivered_at: o.delivered_at,
    }));
    res.json({ ok: true, orders });
  })
);

router.get(
  '/cliente/orders/:id',
  requireAuth,
  requireRole('cliente'),
  requirePortal,
  wrap(async (req, res) => {
    const clienteId = sessionCustomerId(req.session.user);
    const pid = req.session.user.portal_id;
    const id = Number(req.params.id);
    const order = await findCustomerOrder(id, clienteId, pid);

    if (!order) {
      return res.status(404).json({ ok: false, error: 'No encontrado' });
    }
    res.json({
      ok: true,
      order: {
        id: order.id,
        tracking_code: order.tracking_code,
        customer_name: order.customer_name,
        phone: order.phone,
        email: order.email,
        address: order.address,
        notes: order.notes,
        status: order.status,
        created_at: order.created_at,
        updated_at: order.updated_at,
        delivered_at: order.delivered_at,
      },
    });
  })
);

module.exports = router;
