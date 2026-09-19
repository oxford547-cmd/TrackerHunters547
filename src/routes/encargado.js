'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb, now, generateTrackingCode, loadOrderItems, parseOrderItemsFromBody, insertOrderItems, loadRemisionItems, parseRemisionItemsFromBody, insertRemisionItems, nextRemisionFolio } = require('../db');
const { logoUrl } = require('../portal');
const { requireAuth, requireRole, requirePortal, setFlash } = require('../middleware');
const { ENCARGADO_FLOW, ORDER_STATUSES } = require('../constants');
const { loadEncargadoMetrics, resolveDateRange } = require('../portal');
const { notifyOrderStatusAsync } = require('../services/mailer');

const router = express.Router();
router.use(requireAuth, requireRole('encargado'), requirePortal);

function portalIdOf(req) {
  return req.session.user.portal_id;
}

function nextStatus(current) {
  const i = ENCARGADO_FLOW.indexOf(current);
  if (i < 0 || i >= ENCARGADO_FLOW.length - 1) return null;
  return ENCARGADO_FLOW[i + 1];
}

function getPortalOrder(d, id, pid) {
  return d.prepare('SELECT * FROM orders WHERE id = ? AND portal_id = ?').get(id, pid);
}

function loadChoferes(d, pid) {
  return d
    .prepare(
      "SELECT id, name, username, active FROM users WHERE role = 'chofer' AND portal_id = ? ORDER BY name"
    )
    .all(pid);
}

function loadCustomers(d, pid) {
  return d
    .prepare(
      `SELECT c.id, c.name, c.phone, c.email, c.address, c.notes, c.active, c.created_at,
              u.username AS login_username, u.id AS user_id, u.active AS login_active
       FROM customers c
       LEFT JOIN users u ON u.cliente_id = c.id AND u.role = 'cliente' AND u.portal_id = c.portal_id
       WHERE c.portal_id = ?
       ORDER BY c.name`
    )
    .all(pid);
}

function loadOrders(d, pid, range) {
  if (range && range.from && range.toExclusive) {
    return d
      .prepare(
        `SELECT o.*, u.name AS chofer_name
         FROM orders o
         LEFT JOIN users u ON u.id = o.chofer_id
         WHERE o.portal_id = ? AND o.created_at >= ? AND o.created_at < ?
         ORDER BY o.created_at DESC`
      )
      .all(pid, range.from, range.toExclusive);
  }
  return d
    .prepare(
      `SELECT o.*, u.name AS chofer_name
       FROM orders o
       LEFT JOIN users u ON u.id = o.chofer_id
       WHERE o.portal_id = ?
       ORDER BY o.created_at DESC`
    )
    .all(pid);
}

function normalizeTrackingCode(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

function parseRangeFromQuery(query) {
  const preset = String(query.range || query.preset || 'semana').toLowerCase();
  return resolveDateRange(preset, query.from, query.to);
}

/** Dashboard: all portal orders + metrics + date presets */
router.get('/', (req, res) => {
  const d = getDb();
  const pid = portalIdOf(req);
  const range = parseRangeFromQuery(req.query);
  const orders = loadOrders(d, pid, range);
  const choferes = loadChoferes(d, pid);
  const metrics = loadEncargadoMetrics(pid, range);

  res.render('encargado', {
    title: 'Dashboard encargado',
    orders,
    choferes,
    metrics,
    range,
    statuses: ORDER_STATUSES,
    nextStatus,
    withSidebar: true,
    activeNav: 'dashboard',
  });
});

/** Nuevo pedido form */
router.get('/nuevo', (req, res) => {
  const d = getDb();
  const pid = portalIdOf(req);
  const customers = loadCustomers(d, pid).filter((c) => c.active !== 0);
  res.render('encargado-nuevo', {
    title: 'Nuevo pedido',
    customers,
    choferes: loadChoferes(d, pid),
    suggestedCode: generateTrackingCode(),
    withSidebar: true,
    activeNav: 'nuevo',
  });
});

router.post('/orders', (req, res) => {
  const d = getDb();
  const pid = portalIdOf(req);
  const customerId = req.body.customer_id ? Number(req.body.customer_id) : null;
  let customer_name = String(req.body.customer_name || '').trim();
  let phone = String(req.body.phone || '').trim();
  let email = String(req.body.email || '').trim();
  let address = String(req.body.address || '').trim();
  let notes = String(req.body.notes || '').trim();
  let chofer_id = req.body.chofer_id ? Number(req.body.chofer_id) : null;
  const code = normalizeTrackingCode(req.body.tracking_code);

  if (!code) {
    setFlash(req, 'danger', 'Debes ingresar el número de pedido (código de rastreo).');
    return res.redirect('/encargado/nuevo');
  }
  if (code.length < 3 || code.length > 64) {
    setFlash(req, 'danger', 'El número de pedido debe tener entre 3 y 64 caracteres.');
    return res.redirect('/encargado/nuevo');
  }

  const dup = d
    .prepare(
      'SELECT id FROM orders WHERE portal_id = ? AND UPPER(tracking_code) = UPPER(?)'
    )
    .get(pid, code);
  if (dup) {
    setFlash(req, 'danger', `El número de pedido “${code}” ya existe en este portal.`);
    return res.redirect('/encargado/nuevo');
  }

  if (customerId) {
    const c = d
      .prepare('SELECT * FROM customers WHERE id = ? AND portal_id = ?')
      .get(customerId, pid);
    if (c) {
      if (c.active === 0) {
        setFlash(req, 'danger', 'Ese cliente está bloqueado.');
        return res.redirect('/encargado/nuevo');
      }
      customer_name = customer_name || c.name;
      phone = phone || c.phone;
      email = email || c.email || '';
      address = address || c.address;
      notes = notes || c.notes || '';
    } else {
      setFlash(req, 'danger', 'Cliente no pertenece a este portal.');
      return res.redirect('/encargado/nuevo');
    }
  }

  if (chofer_id) {
    const ch = d
      .prepare("SELECT id FROM users WHERE id = ? AND role = 'chofer' AND portal_id = ? AND active = 1")
      .get(chofer_id, pid);
    if (!ch) {
      setFlash(req, 'danger', 'Chofer no pertenece a este portal.');
      return res.redirect('/encargado/nuevo');
    }
  } else {
    chofer_id = null;
  }

  if (!customer_name) {
    setFlash(req, 'danger', 'Nombre del cliente requerido.');
    return res.redirect('/encargado/nuevo');
  }

  const purchase_order = String(req.body.purchase_order || '').trim();
  const items = parseOrderItemsFromBody(req.body);

  const ts = now();
  try {
    const info = d
      .prepare(
        `INSERT INTO orders
          (tracking_code, customer_id, customer_name, phone, address, notes, status, chofer_id, created_by, created_at, updated_at, portal_id, purchase_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        code,
        customerId,
        customer_name,
        phone,
        address,
        notes,
        'pedido_colocado',
        chofer_id,
        req.session.user.id,
        ts,
        ts,
        pid,
        purchase_order
      );

    insertOrderItems(info.lastInsertRowid, items);

    if (customerId && email) {
      d.prepare(
        "UPDATE customers SET email = ? WHERE id = ? AND portal_id = ? AND (email IS NULL OR email = '')"
      ).run(email, customerId, pid);
    }

    d.prepare(
      'INSERT INTO status_history (order_id, status, changed_by, notes, created_at) VALUES (?,?,?,?,?)'
    ).run(info.lastInsertRowid, 'pedido_colocado', req.session.user.id, 'Creado por encargado', ts);

    notifyOrderStatusAsync({
      id: info.lastInsertRowid,
      tracking_code: code,
      status: 'pedido_colocado',
      previous_status: null,
      is_create: true,
      phone,
      email,
      customer_id: customerId,
      customer_name,
      portal_id: pid,
      purchase_order,
      items,
      created_at: ts,
      updated_at: ts,
    });

    setFlash(req, 'ok', `Pedido creado: ${code}`);
    return res.redirect('/encargado');
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      setFlash(req, 'danger', `El número de pedido “${code}” ya existe en este portal.`);
      return res.redirect('/encargado/nuevo');
    }
    throw err;
  }
});

router.post('/orders/:id/assign', (req, res) => {
  const id = Number(req.params.id);
  const pid = portalIdOf(req);
  let chofer_id = req.body.chofer_id ? Number(req.body.chofer_id) : null;
  const d = getDb();
  const order = getPortalOrder(d, id, pid);
  if (!order) {
    setFlash(req, 'danger', 'Pedido no encontrado.');
    return res.redirect('/encargado');
  }
  if (['entregado', 'cancelado'].includes(order.status)) {
    setFlash(req, 'danger', 'No se puede reasignar un pedido cerrado.');
    return res.redirect('/encargado');
  }
  if (chofer_id) {
    const ch = d
      .prepare("SELECT id FROM users WHERE id = ? AND role = 'chofer' AND portal_id = ? AND active = 1")
      .get(chofer_id, pid);
    if (!ch) {
      setFlash(req, 'danger', 'Chofer no pertenece a este portal o está bloqueado.');
      return res.redirect('/encargado');
    }
  } else {
    chofer_id = null;
  }
  d.prepare('UPDATE orders SET chofer_id = ?, updated_at = ? WHERE id = ? AND portal_id = ?').run(
    chofer_id,
    now(),
    id,
    pid
  );
  setFlash(req, 'ok', 'Chofer asignado.');
  res.redirect('/encargado');
});

router.post('/orders/:id/advance', (req, res) => {
  const id = Number(req.params.id);
  const pid = portalIdOf(req);
  const d = getDb();
  const order = getPortalOrder(d, id, pid);
  if (!order) {
    setFlash(req, 'danger', 'Pedido no encontrado.');
    return res.redirect('/encargado');
  }
  const nxt = nextStatus(order.status);
  if (!nxt) {
    setFlash(req, 'danger', 'No se puede avanzar más desde este estado (encargado).');
    return res.redirect('/encargado');
  }
  if (nxt === 'en_camino' && !order.chofer_id) {
    setFlash(req, 'danger', 'Asigna un chofer antes de pasar a En camino.');
    return res.redirect('/encargado');
  }
  const ts = now();
  d.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND portal_id = ?').run(
    nxt,
    ts,
    id,
    pid
  );
  d.prepare(
    'INSERT INTO status_history (order_id, status, changed_by, notes, created_at) VALUES (?,?,?,?,?)'
  ).run(id, nxt, req.session.user.id, '', ts);
  const custAdvance = order.customer_id
    ? d.prepare('SELECT email FROM customers WHERE id = ?').get(order.customer_id)
    : null;
  notifyOrderStatusAsync({
    id: order.id,
    tracking_code: order.tracking_code,
    status: nxt,
    previous_status: order.status,
    phone: order.phone,
    email: (custAdvance && custAdvance.email) || '',
    customer_id: order.customer_id,
    customer_name: order.customer_name,
    portal_id: pid,
    purchase_order: order.purchase_order || '',
    created_at: order.created_at,
    updated_at: ts,
  });
  setFlash(req, 'ok', `Estado: ${ORDER_STATUSES[nxt]}`);
  res.redirect('/encargado');
});

router.post('/orders/:id/cancel', (req, res) => {
  const id = Number(req.params.id);
  const pid = portalIdOf(req);
  const d = getDb();
  const order = getPortalOrder(d, id, pid);
  if (!order || order.status === 'entregado') {
    setFlash(req, 'danger', 'No se puede cancelar.');
    return res.redirect('/encargado');
  }
  const ts = now();
  d.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND portal_id = ?').run(
    'cancelado',
    ts,
    id,
    pid
  );
  d.prepare(
    'INSERT INTO status_history (order_id, status, changed_by, notes, created_at) VALUES (?,?,?,?,?)'
  ).run(id, 'cancelado', req.session.user.id, 'Cancelado', ts);
  const custCancel = order.customer_id
    ? d.prepare('SELECT email FROM customers WHERE id = ?').get(order.customer_id)
    : null;
  notifyOrderStatusAsync({
    id: order.id,
    tracking_code: order.tracking_code,
    status: 'cancelado',
    previous_status: order.status,
    phone: order.phone,
    email: (custCancel && custCancel.email) || '',
    customer_id: order.customer_id,
    customer_name: order.customer_name,
    portal_id: pid,
    purchase_order: order.purchase_order || '',
    created_at: order.created_at,
    updated_at: ts,
  });
  setFlash(req, 'ok', 'Pedido cancelado.');
  res.redirect('/encargado');
});

/** Altas choferes */
router.get('/choferes', (req, res) => {
  const d = getDb();
  const pid = portalIdOf(req);
  const editId = req.query.edit ? Number(req.query.edit) : null;
  const choferes = loadChoferes(d, pid);
  const editing = editId ? choferes.find((c) => c.id === editId) || null : null;
  res.render('encargado-choferes', {
    title: 'Altas choferes',
    choferes,
    editing,
    withSidebar: true,
    activeNav: 'choferes',
  });
});

router.post('/choferes', (req, res) => {
  const d = getDb();
  const pid = portalIdOf(req);
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const name = String(req.body.name || '').trim();
  if (!username || !password || !name) {
    setFlash(req, 'danger', 'Nombre, usuario y contraseña del chofer son requeridos.');
    return res.redirect('/encargado/choferes');
  }
  if (password.length < 6) {
    setFlash(req, 'danger', 'La contraseña debe tener al menos 6 caracteres.');
    return res.redirect('/encargado/choferes');
  }
  const exists = d.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) {
    setFlash(req, 'danger', 'Ese usuario ya existe.');
    return res.redirect('/encargado/choferes');
  }
  d.prepare(
    `INSERT INTO users (username, password_hash, role, name, cliente_id, active, created_at, portal_id)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(username, bcrypt.hashSync(password, 10), 'chofer', name, null, 1, now(), pid);
  setFlash(req, 'ok', `Chofer “${name}” creado.`);
  res.redirect('/encargado/choferes');
});

router.post('/choferes/:id', (req, res) => {
  const d = getDb();
  const pid = portalIdOf(req);
  const id = Number(req.params.id);
  const ch = d
    .prepare("SELECT * FROM users WHERE id = ? AND role = 'chofer' AND portal_id = ?")
    .get(id, pid);
  if (!ch) {
    setFlash(req, 'danger', 'Chofer no encontrado.');
    return res.redirect('/encargado/choferes');
  }
  const name = String(req.body.name || '').trim();
  const password = String(req.body.password || '');
  if (!name) {
    setFlash(req, 'danger', 'Nombre requerido.');
    return res.redirect(`/encargado/choferes?edit=${id}`);
  }
  d.prepare('UPDATE users SET name = ? WHERE id = ? AND portal_id = ?').run(name, id, pid);
  if (password) {
    if (password.length < 6) {
      setFlash(req, 'danger', 'La contraseña debe tener al menos 6 caracteres.');
      return res.redirect(`/encargado/choferes?edit=${id}`);
    }
    d.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      bcrypt.hashSync(password, 10),
      id
    );
  }
  setFlash(req, 'ok', `Chofer “${name}” actualizado.`);
  res.redirect('/encargado/choferes');
});

router.post('/choferes/:id/toggle', (req, res) => {
  const d = getDb();
  const pid = portalIdOf(req);
  const id = Number(req.params.id);
  const ch = d
    .prepare("SELECT id, active, name FROM users WHERE id = ? AND role = 'chofer' AND portal_id = ?")
    .get(id, pid);
  if (!ch) {
    setFlash(req, 'danger', 'Chofer no encontrado.');
    return res.redirect('/encargado/choferes');
  }
  const next = ch.active ? 0 : 1;
  d.prepare('UPDATE users SET active = ? WHERE id = ?').run(next, id);
  setFlash(req, 'ok', next ? `“${ch.name}” activo.` : `“${ch.name}” bloqueado.`);
  res.redirect('/encargado/choferes');
});

/** Altas clientes */
router.get('/clientes', (req, res) => {
  const d = getDb();
  const pid = portalIdOf(req);
  const editId = req.query.edit ? Number(req.query.edit) : null;
  const customers = loadCustomers(d, pid);
  const editing = editId ? customers.find((c) => c.id === editId) || null : null;
  res.render('encargado-clientes', {
    title: 'Altas clientes',
    customers,
    editing,
    withSidebar: true,
    activeNav: 'clientes',
  });
});

router.post('/clientes', (req, res) => {
  const d = getDb();
  const pid = portalIdOf(req);
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const email = String(req.body.email || '').trim();
  const address = String(req.body.address || '').trim();
  const notes = String(req.body.notes || '').trim();
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!name) {
    setFlash(req, 'danger', 'Nombre del cliente requerido.');
    return res.redirect('/encargado/clientes');
  }

  const ts = now();
  const info = d
    .prepare(
      'INSERT INTO customers (name, phone, email, address, notes, active, created_at, portal_id) VALUES (?,?,?,?,?,?,?,?)'
    )
    .run(name, phone, email, address, notes, 1, ts, pid);

  if (username) {
    if (!password || password.length < 6) {
      setFlash(
        req,
        'danger',
        'Si das acceso al portal, la contraseña debe tener al menos 6 caracteres. El cliente se creó sin login.'
      );
      return res.redirect('/encargado/clientes');
    }
    const exists = d.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) {
      setFlash(req, 'danger', 'Ese usuario ya existe. El cliente se creó sin acceso de login.');
      return res.redirect('/encargado/clientes');
    }
    d.prepare(
      `INSERT INTO users (username, password_hash, role, name, cliente_id, active, created_at, portal_id)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(username, bcrypt.hashSync(password, 10), 'cliente', name, info.lastInsertRowid, 1, ts, pid);
  }

  setFlash(req, 'ok', `Cliente “${name}” creado.`);
  res.redirect('/encargado/clientes');
});

router.post('/clientes/:id', (req, res) => {
  const d = getDb();
  const pid = portalIdOf(req);
  const id = Number(req.params.id);
  const c = d.prepare('SELECT * FROM customers WHERE id = ? AND portal_id = ?').get(id, pid);
  if (!c) {
    setFlash(req, 'danger', 'Cliente no encontrado.');
    return res.redirect('/encargado/clientes');
  }
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const email = String(req.body.email || '').trim();
  const address = String(req.body.address || '').trim();
  const notes = String(req.body.notes || '').trim();
  if (!name) {
    setFlash(req, 'danger', 'Nombre requerido.');
    return res.redirect(`/encargado/clientes?edit=${id}`);
  }
  d.prepare(
    'UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, notes = ? WHERE id = ? AND portal_id = ?'
  ).run(name, phone, email, address, notes, id, pid);

  const loginUser = d
    .prepare("SELECT id FROM users WHERE cliente_id = ? AND role = 'cliente' AND portal_id = ?")
    .get(id, pid);
  if (loginUser) {
    d.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, loginUser.id);
  }

  const password = String(req.body.password || '');
  const username = String(req.body.username || '').trim();
  if (loginUser && password) {
    if (password.length < 6) {
      setFlash(req, 'danger', 'La contraseña debe tener al menos 6 caracteres.');
      return res.redirect(`/encargado/clientes?edit=${id}`);
    }
    d.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      bcrypt.hashSync(password, 10),
      loginUser.id
    );
  } else if (!loginUser && username) {
    if (!password || password.length < 6) {
      setFlash(req, 'danger', 'Para dar acceso, usuario y contraseña (mín. 6) son requeridos.');
      return res.redirect(`/encargado/clientes?edit=${id}`);
    }
    const exists = d.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) {
      setFlash(req, 'danger', 'Ese usuario ya existe.');
      return res.redirect(`/encargado/clientes?edit=${id}`);
    }
    d.prepare(
      `INSERT INTO users (username, password_hash, role, name, cliente_id, active, created_at, portal_id)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(username, bcrypt.hashSync(password, 10), 'cliente', name, id, 1, now(), pid);
  }

  setFlash(req, 'ok', `Cliente “${name}” actualizado.`);
  res.redirect('/encargado/clientes');
});

router.post('/clientes/:id/toggle', (req, res) => {
  const d = getDb();
  const pid = portalIdOf(req);
  const id = Number(req.params.id);
  const c = d
    .prepare('SELECT id, name, active FROM customers WHERE id = ? AND portal_id = ?')
    .get(id, pid);
  if (!c) {
    setFlash(req, 'danger', 'Cliente no encontrado.');
    return res.redirect('/encargado/clientes');
  }
  const next = c.active ? 0 : 1;
  d.prepare('UPDATE customers SET active = ? WHERE id = ?').run(next, id);
  const login = d
    .prepare("SELECT id FROM users WHERE cliente_id = ? AND role = 'cliente' AND portal_id = ?")
    .get(id, pid);
  if (login) {
    d.prepare('UPDATE users SET active = ? WHERE id = ?').run(next, login.id);
  }
  setFlash(req, 'ok', next ? `“${c.name}” activo.` : `“${c.name}” bloqueado.`);
  res.redirect('/encargado/clientes');
});


/** Detalle de pedido (materiales, OC, evidencia de entrega) */
router.get('/pedido/:id', (req, res) => {
  const d = getDb();
  const pid = portalIdOf(req);
  const id = Number(req.params.id);
  const order = getPortalOrder(d, id, pid);
  if (!order) {
    setFlash(req, 'danger', 'Pedido no encontrado.');
    return res.redirect('/encargado');
  }
  const items = loadOrderItems(id);
  const history = d
    .prepare(
      `SELECT h.*, u.name AS changed_by_name
       FROM status_history h
       LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.order_id = ?
       ORDER BY h.created_at ASC`
    )
    .all(id);
  const chofer = order.chofer_id
    ? d.prepare('SELECT id, name FROM users WHERE id = ?').get(order.chofer_id)
    : null;
  res.render('encargado-detalle', {
    title: `Pedido ${order.tracking_code}`,
    order,
    items,
    history,
    chofer,
    withSidebar: true,
    activeNav: 'dashboard',
  });
});


/** —— Remisión provisional —— */
function todayLocalDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function companyAddressOf(portal) {
  if (!portal) return '';
  const addr = String(portal.address || '').trim();
  if (addr) return addr;
  return String(portal.notes || '').trim();
}

function getPortalRemision(d, id, pid) {
  return d.prepare('SELECT * FROM remisiones WHERE id = ? AND portal_id = ?').get(id, pid);
}

router.get('/remisiones', (req, res) => {
  const d = getDb();
  const pid = portalIdOf(req);
  const remisiones = d
    .prepare(
      `SELECT r.*, u.name AS created_by_name
       FROM remisiones r
       LEFT JOIN users u ON u.id = r.created_by
       WHERE r.portal_id = ?
       ORDER BY r.folio DESC, r.created_at DESC`
    )
    .all(pid);
  res.render('encargado-remisiones', {
    title: 'Remisiones provisionales',
    remisiones,
    withSidebar: true,
    activeNav: 'remisiones',
  });
});

router.get('/remisiones/nueva', (req, res) => {
  const d = getDb();
  const pid = portalIdOf(req);
  const portal = d.prepare('SELECT * FROM portals WHERE id = ?').get(pid);
  const nextFolioRow = d
    .prepare('SELECT COALESCE(MAX(folio), 0) + 1 AS n FROM remisiones WHERE portal_id = ?')
    .get(pid);
  const counter = portal && portal.remision_next ? Number(portal.remision_next) : 1;
  const previewFolio = Math.max(nextFolioRow.n, counter);
  const customers = loadCustomers(d, pid).filter((c) => c.active !== 0);
  res.render('encargado-remision-nueva', {
    title: 'Nueva remisión provisional',
    customers,
    previewFolio,
    today: todayLocalDate(),
    companyName: portal ? portal.name : '',
    companyAddress: companyAddressOf(portal),
    companyLogo: logoUrl(portal),
    withSidebar: true,
    activeNav: 'remisiones',
  });
});

router.post('/remisiones', (req, res) => {
  const d = getDb();
  const pid = portalIdOf(req);
  const portal = d.prepare('SELECT * FROM portals WHERE id = ?').get(pid);
  if (!portal) {
    setFlash(req, 'danger', 'Portal no encontrado.');
    return res.redirect('/encargado/remisiones');
  }

  const customer_name = String(req.body.customer_name || '').trim();
  let fecha = String(req.body.fecha || '').trim() || todayLocalDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    fecha = todayLocalDate();
  }
  const items = parseRemisionItemsFromBody(req.body);
  if (!customer_name) {
    setFlash(req, 'danger', 'Nombre de cliente requerido.');
    return res.redirect('/encargado/remisiones/nueva');
  }
  if (!items.length) {
    setFlash(req, 'danger', 'Agrega al menos una línea con descripción.');
    return res.redirect('/encargado/remisiones/nueva');
  }

  const total_cantidad = items.reduce((s, it) => s + (Number(it.cantidad) || 0), 0);
  const importeSum = items.reduce((s, it) => {
    if (it.importe == null) return s;
    return (s == null ? 0 : s) + Number(it.importe);
  }, null);
  let total_importe = importeSum;
  const totalField = String(req.body.total_importe || '').trim();
  if (totalField !== '') {
    const n = Number(totalField);
    if (Number.isFinite(n)) total_importe = n;
  }

  const company_name = portal.name;
  const company_address = companyAddressOf(portal);
  const company_logo_path = portal.logo_path || null;
  const ts = now();

  try {
    const createTx = d.transaction(() => {
      const folio = nextRemisionFolio(pid);
      const info = d
        .prepare(
          `INSERT INTO remisiones
            (portal_id, folio, fecha, customer_name, company_name, company_address, company_logo_path,
             total_importe, total_cantidad, created_by, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          pid,
          folio,
          fecha,
          customer_name,
          company_name,
          company_address,
          company_logo_path,
          total_importe,
          total_cantidad,
          req.session.user.id,
          ts
        );
      insertRemisionItems(info.lastInsertRowid, items);
      return info.lastInsertRowid;
    });
    const remisionId = createTx();
    setFlash(req, 'ok', 'Remisión provisional creada.');
    return res.redirect(`/encargado/remisiones/${remisionId}`);
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      setFlash(req, 'danger', 'Conflicto de folio. Intenta de nuevo.');
      return res.redirect('/encargado/remisiones/nueva');
    }
    throw err;
  }
});

router.get('/remisiones/:id', (req, res) => {
  const d = getDb();
  const pid = portalIdOf(req);
  const id = Number(req.params.id);
  const remision = getPortalRemision(d, id, pid);
  if (!remision) {
    setFlash(req, 'danger', 'Remisión no encontrada.');
    return res.redirect('/encargado/remisiones');
  }
  const items = loadRemisionItems(id);
  const creator = remision.created_by
    ? d.prepare('SELECT name FROM users WHERE id = ?').get(remision.created_by)
    : null;
  const logo =
    remision.company_logo_path ||
    logoUrl(d.prepare('SELECT * FROM portals WHERE id = ?').get(pid));
  res.render('encargado-remision-detalle', {
    title: `Remisión ${remision.folio}`,
    remision,
    items,
    creator,
    printLogo: logo,
    withSidebar: true,
    activeNav: 'remisiones',
    printMode: String(req.query.print || '') === '1',
  });
});


module.exports = router;
