'use strict';

const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { now, usernameTaken, insertPortal, updatePortal, insertUser, updateUser, listPortalsAdmin, findEncargado } = require('../db');
const { requireAuth, requireRole, setFlash, wrap } = require('../middleware');
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

router.get(
  '/',
  wrap(async (req, res) => {
    const metrics = await loadDashboard();
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
  })
);

router.get(
  '/portals',
  wrap(async (req, res) => {
    const portals = (await listPortalsAdmin()).map((p) => ({ ...p, logo: logoUrl(p) }));
    res.render('superadmin-portals', {
      title: 'Portales',
      dash: true,
      wide: true,
      portals,
    });
  })
);

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
      address: '',
      notes: '',
      active: 1,
      whatsapp_number: '',
    },
    encargado: null,
  });
});

router.post(
  '/portals',
  withUpload,
  wrap(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const contact_name = String(req.body.contact_name || '').trim();
    const phone = String(req.body.phone || '').trim();
    const email = String(req.body.email || '').trim();
    const address = String(req.body.address || '').trim();
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
    if (!encUser || !encPass) {
      setFlash(req, 'danger', 'Usuario y contraseña del encargado son requeridos.');
      return res.redirect('/superadmin/portals/new');
    }
    if (encPass.length < 6) {
      setFlash(req, 'danger', 'La contraseña del encargado debe tener al menos 6 caracteres.');
      return res.redirect('/superadmin/portals/new');
    }
    if (await usernameTaken(encUser)) {
      setFlash(req, 'danger', 'Ese nombre de usuario ya existe.');
      return res.redirect('/superadmin/portals/new');
    }

    const slug = await uniqueSlug(slugInput);
    const portal = await insertPortal({
      name,
      slug,
      logo_path: null,
      contact_name,
      phone,
      email,
      address,
      notes,
      active,
      created_at: now(),
      whatsapp_number,
    });

    const portalId = portal.id;
    if (req.file) {
      try {
        const logo_path = saveLogo(portalId, req.file);
        if (logo_path) await updatePortal(portalId, { logo_path });
      } catch (err) {
        console.error(err);
      }
    }

    await insertUser({
      username: encUser,
      password_hash: bcrypt.hashSync(encPass, 10),
      role: 'encargado',
      name: encName,
      customer_id: null,
      active: true,
      created_at: now(),
      portal_id: portalId,
    });

    setFlash(req, 'ok', `Portal “${name}” creado. Encargado: ${encUser}`);
    res.redirect('/superadmin/portals');
  })
);

router.get(
  '/portals/:id/edit',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const portal = await getPortal(id);
    if (!portal) {
      setFlash(req, 'danger', 'Portal no encontrado.');
      return res.redirect('/superadmin/portals');
    }
    const encargado = await findEncargado(id);
    res.render('superadmin-portal-form', {
      title: 'Editar portal',
      dash: true,
      mode: 'edit',
      portal: { ...portal, logo: logoUrl(portal) },
      encargado,
    });
  })
);

router.post(
  '/portals/:id',
  withUpload,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const portal = await getPortal(id);
    if (!portal) {
      setFlash(req, 'danger', 'Portal no encontrado.');
      return res.redirect('/superadmin/portals');
    }

    const name = String(req.body.name || '').trim();
    const contact_name = String(req.body.contact_name || '').trim();
    const phone = String(req.body.phone || '').trim();
    const email = String(req.body.email || '').trim();
    const address = String(req.body.address || '').trim();
    const notes = String(req.body.notes || '').trim();
    const whatsapp_number = String(req.body.whatsapp_number || '').trim();
    const active = req.body.active ? 1 : 0;
    const slugInput = String(req.body.slug || '').trim() || name;

    if (!name) {
      setFlash(req, 'danger', 'El nombre de la empresa es requerido.');
      return res.redirect(`/superadmin/portals/${id}/edit`);
    }

    const slug = await uniqueSlug(
      slugify(slugInput) === slugify(portal.slug) ? portal.slug : slugInput,
      id
    );
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

    await updatePortal(id, {
      name,
      slug,
      logo_path,
      contact_name,
      phone,
      email,
      address,
      notes,
      active,
      whatsapp_number,
    });

    const encUser = String(req.body.encargado_username || '').trim();
    const encPass = String(req.body.encargado_password || '');
    const encName = String(req.body.encargado_name || '').trim();
    const existing = await findEncargado(id);

    if (existing) {
      const fields = {};
      if (encName) fields.name = encName;
      if (encPass) {
        if (encPass.length < 6) {
          setFlash(req, 'danger', 'La nueva contraseña debe tener al menos 6 caracteres.');
          return res.redirect(`/superadmin/portals/${id}/edit`);
        }
        fields.password_hash = bcrypt.hashSync(encPass, 10);
      }
      if (Object.keys(fields).length) await updateUser(existing.id, fields);
    } else if (encUser && encPass) {
      if (await usernameTaken(encUser)) {
        setFlash(req, 'danger', 'Ese nombre de usuario ya existe.');
        return res.redirect(`/superadmin/portals/${id}/edit`);
      }
      if (encPass.length < 6) {
        setFlash(req, 'danger', 'La contraseña debe tener al menos 6 caracteres.');
        return res.redirect(`/superadmin/portals/${id}/edit`);
      }
      await insertUser({
        username: encUser,
        password_hash: bcrypt.hashSync(encPass, 10),
        role: 'encargado',
        name: encName || contact_name || name,
        customer_id: null,
        active: true,
        created_at: now(),
        portal_id: id,
      });
    }

    setFlash(req, 'ok', 'Portal actualizado.');
    res.redirect('/superadmin/portals');
  })
);

module.exports = router;
