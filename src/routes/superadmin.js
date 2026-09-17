'use strict';

const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { getDb, now } = require('../db');
const { requireAuth, requireRole, setFlash } = require('../middleware');
const {
  uniqueSlug,
  slugify,
  getPortal,
  saveLogo,
  logoUrl,
  loadDashboard,
  ALLOWED_LOGO_MIME,
} = require('../portal');
const { ORDER_STATUSES } = require('../constants');

const router = express.Router();
router.use(requireAuth, requireRole('superadmin'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file || !file.originalname) return cb(null, true);
    if (ALLOWED_LOGO_MIME[file.mimetype]) return cb(null, true);
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) return cb(null, true);
    cb(new Error('El logo debe ser una imagen (JPG, PNG, WEBP o GIF).'));
  },
});

function withUpload(req, res, next) {
  upload.single('logo')(req, res, (err) => {
    if (err) {
      setFlash(req, 'danger', err.message || 'Error al subir el logo.');
      const fallback = req.params.id
        ? `/superadmin/portals/${req.params.id}/edit`
        : '/superadmin/portals/new';
      return res.redirect(fallback);
    }
    next();
  });
}

router.get('/', (req, res) => {
  const metrics = loadDashboard();
  const chartData = {
    statuses: Object.keys(ORDER_STATUSES).map((k) => ({
      key: k,
      label: ORDER_STATUSES[k],
      count: metrics.byStatus[k] || 0,
    })),
    trend: metrics.trend,
    portals: metrics.perPortal.map((p) => ({
      name: p.name,
      orders: p.orders,
      today: p.orders_today,
      delivered: p.delivered,
    })),
  };
  res.render('superadmin-dashboard', {
    title: 'Dashboard agencia',
    dash: true,
    wide: true,
    metrics,
    chartData,
    statuses: ORDER_STATUSES,
  });
});

router.get('/portals', (req, res) => {
  const d = getDb();
  const portals = d
    .prepare(
      `SELECT p.*,
         (SELECT COUNT(*) FROM orders o WHERE o.portal_id = p.id) AS orders,
         (SELECT username FROM users u WHERE u.portal_id = p.id AND u.role = 'encargado' ORDER BY u.id LIMIT 1) AS encargado_username
       FROM portals p
       ORDER BY p.created_at DESC`
    )
    .all()
    .map((p) => ({ ...p, logo: logoUrl(p) }));
  res.render('superadmin-portals', {
    title: 'Portales',
    dash: true,
    wide: true,
    portals,
  });
});

router.get('/portals/new', (req, res) => {
  res.render('superadmin-portal-form', {
    title: 'Nuevo portal',
    dash: true,
    mode: 'create',
    portal: {
      name: '',
      slug: '',
      contact_name: '',
      phone: '',
      email: '',
      notes: '',
      active: 1,
      whatsapp_number: '',
    },
    encargado: null,
  });
});

router.post('/portals', withUpload, (req, res) => {
  const d = getDb();
  const name = String(req.body.name || '').trim();
  const contact_name = String(req.body.contact_name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const email = String(req.body.email || '').trim();
  const notes = String(req.body.notes || '').trim();
  const whatsapp_number = String(req.body.whatsapp_number || '').trim();
  const active = req.body.active ? 1 : 0;
  const slugInput = String(req.body.slug || '').trim() || name;
  const encName = String(req.body.encargado_name || '').trim() || contact_name || name;
  const encUser = String(req.body.encargado_username || '').trim();
  const encPass = String(req.body.encargado_password || '');

  if (!name) {
    setFlash(req, 'danger', 'El nombre de la empresa es requerido.');
    return res.redirect('/superadmin/portals/new');
  }
  if (!whatsapp_number) {
    setFlash(req, 'danger', 'El número de WhatsApp para actualizaciones es requerido.');
    return res.redirect('/superadmin/portals/new');
  }
  if (!encUser || !encPass) {
    setFlash(req, 'danger', 'Usuario y contraseña del encargado son requeridos.');
    return res.redirect('/superadmin/portals/new');
  }
  if (encPass.length < 6) {
    setFlash(req, 'danger', 'La contraseña del encargado debe tener al menos 6 caracteres.');
    return res.redirect('/superadmin/portals/new');
  }
  const taken = d.prepare('SELECT id FROM users WHERE username = ?').get(encUser);
  if (taken) {
    setFlash(req, 'danger', 'Ese nombre de usuario ya existe.');
    return res.redirect('/superadmin/portals/new');
  }

  const slug = uniqueSlug(slugInput);
  const ts = now();
  const info = d
    .prepare(
      `INSERT INTO portals (name, slug, logo_path, contact_name, phone, email, notes, active, created_at, whatsapp_number)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(name, slug, null, contact_name, phone, email, notes, active, ts, whatsapp_number);

  const portalId = info.lastInsertRowid;
  let logo_path = null;
  if (req.file) {
    try {
      logo_path = saveLogo(portalId, req.file);
      if (logo_path) {
        d.prepare('UPDATE portals SET logo_path = ? WHERE id = ?').run(logo_path, portalId);
      }
    } catch (err) {
      console.error(err);
    }
  }

  d.prepare(
    `INSERT INTO users (username, password_hash, role, name, cliente_id, active, created_at, portal_id)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(encUser, bcrypt.hashSync(encPass, 10), 'encargado', encName, null, 1, ts, portalId);

  setFlash(req, 'ok', `Portal “${name}” creado. Encargado: ${encUser}`);
  res.redirect('/superadmin/portals');
});

router.get('/portals/:id/edit', (req, res) => {
  const id = Number(req.params.id);
  const portal = getPortal(id);
  if (!portal) {
    setFlash(req, 'danger', 'Portal no encontrado.');
    return res.redirect('/superadmin/portals');
  }
  const d = getDb();
  const encargado = d
    .prepare(
      "SELECT id, username, name FROM users WHERE portal_id = ? AND role = 'encargado' ORDER BY id LIMIT 1"
    )
    .get(id);
  res.render('superadmin-portal-form', {
    title: 'Editar portal',
    dash: true,
    mode: 'edit',
    portal: { ...portal, logo: logoUrl(portal) },
    encargado,
  });
});

router.post('/portals/:id', withUpload, (req, res) => {
  const id = Number(req.params.id);
  const d = getDb();
  const portal = getPortal(id);
  if (!portal) {
    setFlash(req, 'danger', 'Portal no encontrado.');
    return res.redirect('/superadmin/portals');
  }

  const name = String(req.body.name || '').trim();
  const contact_name = String(req.body.contact_name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const email = String(req.body.email || '').trim();
  const notes = String(req.body.notes || '').trim();
  const whatsapp_number = String(req.body.whatsapp_number || '').trim();
  const active = req.body.active ? 1 : 0;
  const slugInput = String(req.body.slug || '').trim() || name;

  if (!name) {
    setFlash(req, 'danger', 'El nombre de la empresa es requerido.');
    return res.redirect(`/superadmin/portals/${id}/edit`);
  }
  if (!whatsapp_number) {
    setFlash(req, 'danger', 'El número de WhatsApp para actualizaciones es requerido.');
    return res.redirect(`/superadmin/portals/${id}/edit`);
  }

  const slug = uniqueSlug(slugify(slugInput) === slugify(portal.slug) ? portal.slug : slugInput, id);
  let logo_path = portal.logo_path;
  if (req.file) {
    try {
      const saved = saveLogo(id, req.file);
      if (saved) logo_path = saved;
    } catch (err) {
      console.error(err);
      setFlash(req, 'danger', 'No se pudo guardar el logo.');
      return res.redirect(`/superadmin/portals/${id}/edit`);
    }
  }

  d.prepare(
    `UPDATE portals
     SET name = ?, slug = ?, logo_path = ?, contact_name = ?, phone = ?, email = ?, notes = ?, active = ?, whatsapp_number = ?
     WHERE id = ?`
  ).run(name, slug, logo_path, contact_name, phone, email, notes, active, whatsapp_number, id);

  const encUser = String(req.body.encargado_username || '').trim();
  const encPass = String(req.body.encargado_password || '');
  const encName = String(req.body.encargado_name || '').trim();
  const existing = d
    .prepare(
      "SELECT id, username FROM users WHERE portal_id = ? AND role = 'encargado' ORDER BY id LIMIT 1"
    )
    .get(id);

  if (existing) {
    if (encName) {
      d.prepare('UPDATE users SET name = ? WHERE id = ?').run(encName, existing.id);
    }
    if (encPass) {
      if (encPass.length < 6) {
        setFlash(req, 'danger', 'La nueva contraseña debe tener al menos 6 caracteres.');
        return res.redirect(`/superadmin/portals/${id}/edit`);
      }
      d.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
        bcrypt.hashSync(encPass, 10),
        existing.id
      );
    }
  } else if (encUser && encPass) {
    const taken = d.prepare('SELECT id FROM users WHERE username = ?').get(encUser);
    if (taken) {
      setFlash(req, 'danger', 'Ese nombre de usuario ya existe.');
      return res.redirect(`/superadmin/portals/${id}/edit`);
    }
    if (encPass.length < 6) {
      setFlash(req, 'danger', 'La contraseña debe tener al menos 6 caracteres.');
      return res.redirect(`/superadmin/portals/${id}/edit`);
    }
    d.prepare(
      `INSERT INTO users (username, password_hash, role, name, cliente_id, active, created_at, portal_id)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      encUser,
      bcrypt.hashSync(encPass, 10),
      'encargado',
      encName || contact_name || name,
      null,
      1,
      now(),
      id
    );
  }

  setFlash(req, 'ok', 'Portal actualizado.');
  res.redirect('/superadmin/portals');
});

module.exports = router;
