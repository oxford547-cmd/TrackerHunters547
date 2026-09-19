'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb, now, generateTrackingCode, loadOrderItems, parseOrderItemsFromBody, insertOrderItems } = require('../db');
const { requireAuth, requireRole, requirePortal, setFlash } = require('../middleware');
const { ENCARGADO_FLOW, ORDER_STATUSES } = require('../constants');
const { loadEncargadoMetrics, resolveDateRange } = require('../portal');
const { notifyOrderStatusAsync } = require('../services/whatsapp');

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
      `SELECT c.id, c.name, c.phone, c.address, c.notes, c.active, c.created_at,
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

    d.prepare(
      'INSERT INTO status_history (order_id, status, changed_by, notes, created_at) VALUES (?,?,?,?,?)'
    ).run(info.lastInsertRowid, 'pedido_colocado', req.session.user.id, 'Creado por encargado', ts);

    notifyOrderStatusAsync({
      tracking_code: code,
      status: 'pedido_colocado',
      phone,
      customer_name,
      portal_id: pid,
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
  notifyOrderStatusAsync({
    tracking_code: order.tracking_code,
    status: nxt,
    phone: order.phone,
    customer_name: order.customer_name,
    portal_id: pid,
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
  notifyOrderStatusAsync({
    tracking_code: order.tracking_code,
    status: 'cancelado',
    phone: order.phone,
    customer_name: order.customer_name,
    portal_id: pid,
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
      'INSERT INTO customers (name, phone, address, notes, active, created_at, portal_id) VALUES (?,?,?,?,?,?,?)'
    )
    .run(name, phone, address, notes, 1, ts, pid);

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
  const address = String(req.body.address || '').trim();
  const notes = String(req.body.notes || '').trim();
  if (!name) {
    setFlash(req, 'danger', 'Nombre requerido.');
    return res.redirect(`/encargado/clientes?edit=${id}`);
  }
  d.prepare(
    'UPDATE customers SET name = ?, phone = ?, address = ?, notes = ? WHERE id = ? AND portal_id = ?'
  ).run(name, phone, address, notes, id, pid);

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

module.exports = router;
