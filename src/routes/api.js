'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { getDb, now, loadOrderItems } = require('../db');
const { requireAuth, requireRole, requirePortal } = require('../middleware');
const { ORDER_STATUSES } = require('../constants');
const { getPortal, branding } = require('../portal');
const { notifyOrderStatusAsync } = require('../services/whatsapp');

const router = express.Router();

const DELIVERY_ROOT = path.join(__dirname, '..', '..', 'public', 'uploads', 'deliveries');
const ALLOWED_PHOTO_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const deliveryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file) return cb(null, true);
    if (ALLOWED_PHOTO_MIME[file.mimetype]) return cb(null, true);
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) return cb(null, true);
    cb(new Error('La foto de entrega debe ser una imagen (JPG, PNG, WEBP o GIF).'));
  },
});

function portalMismatch(user, order) {
  if (!order) return true;
  if (user.role === 'superadmin') return false;
  return Number(order.portal_id) !== Number(user.portal_id);
}

function saveDeliveryAssets(orderId, photoFile, signatureDataUrl) {
  const dir = path.join(DELIVERY_ROOT, String(orderId));
  fs.mkdirSync(dir, { recursive: true });

  if (!photoFile || !photoFile.buffer || !photoFile.buffer.length) {
    throw Object.assign(new Error('Foto de entrega requerida'), { status: 400 });
  }
  const photoExt =
    ALLOWED_PHOTO_MIME[photoFile.mimetype] ||
    (path.extname(photoFile.originalname || '').toLowerCase().match(/^\.(jpe?g|png|webp|gif)$/)
      ? path.extname(photoFile.originalname).toLowerCase().replace('jpeg', 'jpg')
      : '.jpg');
  const photoName = 'photo' + photoExt;
  fs.writeFileSync(path.join(dir, photoName), photoFile.buffer);
  const photoPath = `/uploads/deliveries/${orderId}/${photoName}`;

  const sigRaw = String(signatureDataUrl || '').trim();
  const m = sigRaw.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!m || !m[2]) {
    throw Object.assign(new Error('Firma del receptor requerida'), { status: 400 });
  }
  const sigExt = m[1].toLowerCase() === 'png' ? '.png' : m[1].toLowerCase().includes('webp') ? '.webp' : '.jpg';
  const sigBuf = Buffer.from(m[2], 'base64');
  if (!sigBuf.length || sigBuf.length < 64) {
    throw Object.assign(new Error('Firma inválida o vacía'), { status: 400 });
  }
  const sigName = 'signature' + sigExt;
  fs.writeFileSync(path.join(dir, sigName), sigBuf);
  const signaturePath = `/uploads/deliveries/${orderId}/${sigName}`;

  return { photoPath, signaturePath };
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
 * POST /api/status — mark Entregado (chofer) with required photo + signature
 * Accepts multipart/form-data: order_id, status, photo (file), signature (data URL)
 * Also accepts JSON only for non-delivery updates (none currently for chofer).
 */
function handleStatus(req, res) {
  const orderId = Number(req.body.order_id);
  const status = String(req.body.status || '').trim();
  const user = req.session.user;
  const d = getDb();
  const order = d.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);

  if (!order) {
    return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });
  }

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

    let assets;
    try {
      assets = saveDeliveryAssets(orderId, req.file, req.body.signature);
    } catch (err) {
      const code = err.status || 400;
      return res.status(code).json({ ok: false, error: err.message || 'Evidencia incompleta' });
    }

    const ts = now();
    d.prepare(
      `UPDATE orders SET status = ?, updated_at = ?, delivered_at = ?,
        delivery_photo_path = ?, delivery_signature_path = ? WHERE id = ?`
    ).run('entregado', ts, ts, assets.photoPath, assets.signaturePath, orderId);
    d.prepare(
      'INSERT INTO status_history (order_id, status, changed_by, notes, created_at) VALUES (?,?,?,?,?)'
    ).run(orderId, 'entregado', user.id, 'Marcado entregado por chofer (foto + firma)', ts);
    notifyOrderStatusAsync({
      tracking_code: order.tracking_code,
      status: 'entregado',
      phone: order.phone,
      customer_name: order.customer_name,
      portal_id: order.portal_id,
    });
    return res.json({
      ok: true,
      status: 'entregado',
      label: ORDER_STATUSES.entregado,
      delivery_photo_path: assets.photoPath,
      delivery_signature_path: assets.signaturePath,
    });
  }

  return res.status(403).json({ ok: false, error: 'Usa el panel de encargado para otros cambios' });
}

router.post(
  '/status',
  requireAuth,
  requirePortal,
  (req, res, next) => {
    deliveryUpload.single('photo')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ ok: false, error: err.message || 'Error al subir la foto' });
      }
      next();
    });
  },
  handleStatus
);

/**
 * GET /api/track/:code — public poll for map (single order by code)
 */
router.get('/track/:code', (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const d = getDb();
  const order = d
    .prepare(
      `SELECT id, tracking_code, customer_name, status, updated_at, delivered_at, portal_id,
              purchase_order, delivery_photo_path, delivery_signature_path
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

  const items = loadOrderItems(order.id);
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
      purchase_order: order.purchase_order || '',
      delivery_photo_path: order.delivery_photo_path || null,
      delivery_signature_path: order.delivery_signature_path || null,
      items,
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
      `SELECT id, tracking_code, status, address, created_at, updated_at, delivered_at, purchase_order
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
              created_at, updated_at, delivered_at, purchase_order,
              delivery_photo_path, delivery_signature_path
       FROM orders WHERE id = ? AND customer_id = ? AND portal_id = ?`
    )
    .get(id, clienteId, pid);

  if (!order) {
    return res.status(404).json({ ok: false, error: 'No encontrado' });
  }
  const items = loadOrderItems(order.id);
  res.json({ ok: true, order: { ...order, items } });
});

module.exports = router;
