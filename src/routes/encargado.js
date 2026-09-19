'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const {
  now,
  generateTrackingCode,
  isUniqueViolation,
  listChoferes,
  listCustomers,
  listOrders,
  findPortalOrder,
  findOrderByTracking,
  findCustomer,
  findChoferInPortal,
  insertOrder,
  insertOrderItems,
  insertStatusHistory,
  updateOrder,
  insertCustomer,
  updateCustomer,
  findClienteLogin,
  insertUser,
  updateUser,
  usernameTaken,
  listRemisiones,
  findRemision,
  listRemisionItems,
  createRemisionWithFolio,
  parseOrderItemsFromBody,
  parseRemisionItemsFromBody,
  companyAddressOf,
  todayLocalDate,
  formatFolio,
  nextFolioPreview,
  decorateRemision,
  sumImporte,
  listOrderItems,
  listStatusHistory,
  findUserById,
} = require('../db');
const { requireAuth, requireRole, requirePortal, setFlash, wrap } = require('../middleware');
const { ENCARGADO_FLOW, ORDER_STATUSES } = require('../constants');
const { loadEncargadoMetrics, resolveDateRange, getPortal, logoUrl } = require('../portal');
const { notifyOrderStatusAsync } = require('../services/email');

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

function parseOrderItems(body) {
  return parseOrderItemsFromBody(body);
}

function parseRemisionItems(body) {
  return parseRemisionItemsFromBody(body);
}

router.get(
  '/',
  wrap(async (req, res) => {
    const pid = portalIdOf(req);
    const range = parseRangeFromQuery(req.query);
    const [orders, choferes, metrics] = await Promise.all([
      listOrders(pid, range),
      listChoferes(pid),
      loadEncargadoMetrics(pid, range),
    ]);

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
  })
);

router.get(
  '/nuevo',
  wrap(async (req, res) => {
    const pid = portalIdOf(req);
    const customers = (await listCustomers(pid)).filter((c) => c.active !== 0);
    res.render('encargado-nuevo', {
      title: 'Nuevo pedido',
      customers,
      choferes: await listChoferes(pid),
      suggestedCode: generateTrackingCode(),
      withSidebar: true,
      activeNav: 'nuevo',
    });
  })
);

router.post(
  '/orders',
  wrap(async (req, res) => {
    const pid = portalIdOf(req);
    const customerId = req.body.customer_id ? Number(req.body.customer_id) : null;
    let customer_name = String(req.body.customer_name || '').trim();
    let phone = String(req.body.phone || '').trim();
    let email = String(req.body.email || '').trim();
    let address = String(req.body.address || '').trim();
    let notes = String(req.body.notes || '').trim();
    let chofer_id = req.body.chofer_id ? Number(req.body.chofer_id) : null;
    const purchase_order = String(req.body.purchase_order || '').trim();
    const code = normalizeTrackingCode(req.body.tracking_code);

    if (!code) {
      setFlash(req, 'danger', 'Debes ingresar el número de pedido (código de rastreo).');
      return res.redirect('/encargado/nuevo');
    }
    if (code.length < 3 || code.length > 64) {
      setFlash(req, 'danger', 'El número de pedido debe tener entre 3 y 64 caracteres.');
      return res.redirect('/encargado/nuevo');
    }

    const dup = await findOrderByTracking(code, pid);
    if (dup) {
      setFlash(req, 'danger', `El número de pedido “${code}” ya existe en este portal.`);
      return res.redirect('/encargado/nuevo');
    }

    if (customerId) {
      const c = await findCustomer(customerId, pid);
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
      const ch = await findChoferInPortal(chofer_id, pid, { activeOnly: true });
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

    const items = parseOrderItems(req.body);
    const ts = now();
    try {
      const order = await insertOrder({
        tracking_code: code,
        purchase_order,
        customer_id: customerId,
        customer_name,
        phone,
        email,
        address,
        notes,
        status: 'pedido_colocado',
        chofer_id,
        created_by: req.session.user.id,
        created_at: ts,
        updated_at: ts,
        portal_id: pid,
      });

      await insertOrderItems(order.id, items);
      await insertStatusHistory({
        order_id: order.id,
        status: 'pedido_colocado',
        changed_by: req.session.user.id,
        notes: 'Creado por encargado',
        created_at: ts,
      });

      notifyOrderStatusAsync({
        ...order,
        items,
      });

      setFlash(req, 'ok', `Pedido creado: ${code}`);
      return res.redirect('/encargado');
    } catch (err) {
      if (isUniqueViolation(err)) {
        setFlash(req, 'danger', `El número de pedido “${code}” ya existe en este portal.`);
        return res.redirect('/encargado/nuevo');
      }
      throw err;
    }
  })
);

router.post(
  '/orders/:id/assign',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const pid = portalIdOf(req);
    let chofer_id = req.body.chofer_id ? Number(req.body.chofer_id) : null;
    const order = await findPortalOrder(id, pid);
    if (!order) {
      setFlash(req, 'danger', 'Pedido no encontrado.');
      return res.redirect('/encargado');
    }
    if (['entregado', 'cancelado'].includes(order.status)) {
      setFlash(req, 'danger', 'No se puede reasignar un pedido cerrado.');
      return res.redirect('/encargado');
    }
    if (chofer_id) {
      const ch = await findChoferInPortal(chofer_id, pid, { activeOnly: true });
      if (!ch) {
        setFlash(req, 'danger', 'Chofer no pertenece a este portal o está bloqueado.');
        return res.redirect('/encargado');
      }
    } else {
      chofer_id = null;
    }
    await updateOrder(id, { chofer_id, updated_at: now() }, pid);
    setFlash(req, 'ok', 'Chofer asignado.');
    res.redirect('/encargado');
  })
);

router.post(
  '/orders/:id/advance',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const pid = portalIdOf(req);
    const order = await findPortalOrder(id, pid);
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
    await updateOrder(id, { status: nxt, updated_at: ts }, pid);
    await insertStatusHistory({
      order_id: id,
      status: nxt,
      changed_by: req.session.user.id,
      notes: '',
      created_at: ts,
    });
    notifyOrderStatusAsync({
      ...order,
      status: nxt,
      previous_status: order.status,
      updated_at: ts,
    });
    setFlash(req, 'ok', `Estado: ${ORDER_STATUSES[nxt]}`);
    res.redirect('/encargado');
  })
);

router.post(
  '/orders/:id/cancel',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const pid = portalIdOf(req);
    const order = await findPortalOrder(id, pid);
    if (!order || order.status === 'entregado') {
      setFlash(req, 'danger', 'No se puede cancelar.');
      return res.redirect('/encargado');
    }
    const ts = now();
    await updateOrder(id, { status: 'cancelado', updated_at: ts }, pid);
    await insertStatusHistory({
      order_id: id,
      status: 'cancelado',
      changed_by: req.session.user.id,
      notes: 'Cancelado',
      created_at: ts,
    });
    notifyOrderStatusAsync({
      ...order,
      status: 'cancelado',
      previous_status: order.status,
      updated_at: ts,
    });
    setFlash(req, 'ok', 'Pedido cancelado.');
    res.redirect('/encargado');
  })
);

router.get(
  '/choferes',
  wrap(async (req, res) => {
    const pid = portalIdOf(req);
    const editId = req.query.edit ? Number(req.query.edit) : null;
    const choferes = await listChoferes(pid);
    const editing = editId ? choferes.find((c) => Number(c.id) === editId) || null : null;
    res.render('encargado-choferes', {
      title: 'Altas choferes',
      choferes,
      editing,
      withSidebar: true,
      activeNav: 'choferes',
    });
  })
);

router.post(
  '/choferes',
  wrap(async (req, res) => {
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
    if (await usernameTaken(username)) {
      setFlash(req, 'danger', 'Ese usuario ya existe.');
      return res.redirect('/encargado/choferes');
    }
    await insertUser({
      username,
      password_hash: bcrypt.hashSync(password, 10),
      role: 'chofer',
      name,
      customer_id: null,
      active: true,
      created_at: now(),
      portal_id: pid,
    });
    setFlash(req, 'ok', `Chofer “${name}” creado.`);
    res.redirect('/encargado/choferes');
  })
);

router.post(
  '/choferes/:id',
  wrap(async (req, res) => {
    const pid = portalIdOf(req);
    const id = Number(req.params.id);
    const ch = await findChoferInPortal(id, pid);
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
    const fields = { name };
    if (password) {
      if (password.length < 6) {
        setFlash(req, 'danger', 'La contraseña debe tener al menos 6 caracteres.');
        return res.redirect(`/encargado/choferes?edit=${id}`);
      }
      fields.password_hash = bcrypt.hashSync(password, 10);
    }
    await updateUser(id, fields);
    setFlash(req, 'ok', `Chofer “${name}” actualizado.`);
    res.redirect('/encargado/choferes');
  })
);

router.post(
  '/choferes/:id/toggle',
  wrap(async (req, res) => {
    const pid = portalIdOf(req);
    const id = Number(req.params.id);
    const ch = await findChoferInPortal(id, pid);
    if (!ch) {
      setFlash(req, 'danger', 'Chofer no encontrado.');
      return res.redirect('/encargado/choferes');
    }
    const next = ch.active ? 0 : 1;
    await updateUser(id, { active: next });
    setFlash(req, 'ok', next ? `“${ch.name}” activo.` : `“${ch.name}” bloqueado.`);
    res.redirect('/encargado/choferes');
  })
);

router.get(
  '/clientes',
  wrap(async (req, res) => {
    const pid = portalIdOf(req);
    const editId = req.query.edit ? Number(req.query.edit) : null;
    const customers = await listCustomers(pid);
    const editing = editId ? customers.find((c) => Number(c.id) === editId) || null : null;
    res.render('encargado-clientes', {
      title: 'Altas clientes',
      customers,
      editing,
      withSidebar: true,
      activeNav: 'clientes',
    });
  })
);

router.post(
  '/clientes',
  wrap(async (req, res) => {
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
    const customer = await insertCustomer({
      name,
      phone,
      email,
      address,
      notes,
      active: true,
      created_at: ts,
      portal_id: pid,
    });

    if (username) {
      if (!password || password.length < 6) {
        setFlash(
          req,
          'danger',
          'Si das acceso al portal, la contraseña debe tener al menos 6 caracteres. El cliente se creó sin login.'
        );
        return res.redirect('/encargado/clientes');
      }
      if (await usernameTaken(username)) {
        setFlash(req, 'danger', 'Ese usuario ya existe. El cliente se creó sin acceso de login.');
        return res.redirect('/encargado/clientes');
      }
      await insertUser({
        username,
        password_hash: bcrypt.hashSync(password, 10),
        role: 'cliente',
        name,
        customer_id: customer.id,
        active: true,
        created_at: ts,
        portal_id: pid,
      });
    }

    setFlash(req, 'ok', `Cliente “${name}” creado.`);
    res.redirect('/encargado/clientes');
  })
);

router.post(
  '/clientes/:id',
  wrap(async (req, res) => {
    const pid = portalIdOf(req);
    const id = Number(req.params.id);
    const c = await findCustomer(id, pid);
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
    await updateCustomer(id, pid, { name, phone, email, address, notes });

    const loginUser = await findClienteLogin(id, pid);
    if (loginUser) {
      await updateUser(loginUser.id, { name });
    }

    const password = String(req.body.password || '');
    const username = String(req.body.username || '').trim();
    if (loginUser && password) {
      if (password.length < 6) {
        setFlash(req, 'danger', 'La contraseña debe tener al menos 6 caracteres.');
        return res.redirect(`/encargado/clientes?edit=${id}`);
      }
      await updateUser(loginUser.id, { password_hash: bcrypt.hashSync(password, 10) });
    } else if (!loginUser && username) {
      if (!password || password.length < 6) {
        setFlash(req, 'danger', 'Para dar acceso, usuario y contraseña (mín. 6) son requeridos.');
        return res.redirect(`/encargado/clientes?edit=${id}`);
      }
      if (await usernameTaken(username)) {
        setFlash(req, 'danger', 'Ese usuario ya existe.');
        return res.redirect(`/encargado/clientes?edit=${id}`);
      }
      await insertUser({
        username,
        password_hash: bcrypt.hashSync(password, 10),
        role: 'cliente',
        name,
        customer_id: id,
        active: true,
        created_at: now(),
        portal_id: pid,
      });
    }

    setFlash(req, 'ok', `Cliente “${name}” actualizado.`);
    res.redirect('/encargado/clientes');
  })
);

router.post(
  '/clientes/:id/toggle',
  wrap(async (req, res) => {
    const pid = portalIdOf(req);
    const id = Number(req.params.id);
    const c = await findCustomer(id, pid);
    if (!c) {
      setFlash(req, 'danger', 'Cliente no encontrado.');
      return res.redirect('/encargado/clientes');
    }
    const next = c.active ? 0 : 1;
    await updateCustomer(id, pid, { active: next });
    const login = await findClienteLogin(id, pid);
    if (login) {
      await updateUser(login.id, { active: next });
    }
    setFlash(req, 'ok', next ? `“${c.name}” activo.` : `“${c.name}” bloqueado.`);
    res.redirect('/encargado/clientes');
  })
);

router.get(
  '/pedido/:id',
  wrap(async (req, res) => {
    const pid = portalIdOf(req);
    const id = Number(req.params.id);
    const order = await findPortalOrder(id, pid);
    if (!order) {
      setFlash(req, 'danger', 'Pedido no encontrado.');
      return res.redirect('/encargado');
    }
    const [items, history, chofer] = await Promise.all([
      listOrderItems(order.id),
      listStatusHistory(order.id),
      order.chofer_id ? findUserById(order.chofer_id) : null,
    ]);
    res.render('encargado-detalle', {
      title: `Pedido ${order.tracking_code}`,
      order,
      items,
      history,
      chofer,
      withSidebar: true,
      activeNav: 'dashboard',
    });
  })
);

router.get(
  '/remisiones',
  wrap(async (req, res) => {
    const pid = portalIdOf(req);
    const remisiones = await listRemisiones(pid);
    res.render('encargado-remisiones', {
      title: 'Remisiones provisionales',
      remisiones,
      formatFolio,
      withSidebar: true,
      activeNav: 'remisiones',
    });
  })
);

router.get(
  '/remisiones/nueva',
  wrap(async (req, res) => {
    const pid = portalIdOf(req);
    const portal = await getPortal(pid);
    const [customers, previewFolio] = await Promise.all([
      listCustomers(pid).then((rows) => rows.filter((c) => c.active !== 0)),
      nextFolioPreview(pid),
    ]);
    res.render('encargado-remision-nueva', {
      title: 'Nueva remisión provisional',
      customers,
      previewFolio,
      today: todayLocalDate(),
      companyName: portal ? portal.name : '',
      companyAddress: companyAddressOf(portal),
      companyLogo: logoUrl(portal),
      formatFolio,
      withSidebar: true,
      activeNav: 'remisiones',
    });
  })
);

router.post(
  '/remisiones',
  wrap(async (req, res) => {
    const pid = portalIdOf(req);
    const portal = await getPortal(pid);
    if (!portal) {
      setFlash(req, 'danger', 'Portal no encontrado.');
      return res.redirect('/encargado/remisiones');
    }
    const customer_name = String(req.body.customer_name || '').trim();
    let fecha = String(req.body.fecha || '').trim() || todayLocalDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) fecha = todayLocalDate();
    const items = parseRemisionItems(req.body);
    if (!customer_name) {
      setFlash(req, 'danger', 'Nombre de cliente requerido.');
      return res.redirect('/encargado/remisiones/nueva');
    }
    if (!items.length) {
      setFlash(req, 'danger', 'Agrega al menos una línea con descripción.');
      return res.redirect('/encargado/remisiones/nueva');
    }

    let total = sumImporte(items);
    const totalField = String(req.body.total_importe || '').trim();
    if (totalField !== '') {
      const n = Number(totalField);
      if (Number.isFinite(n)) total = n;
    }

    try {
      const { remision } = await createRemisionWithFolio(
        {
          portal_id: pid,
          fecha,
          customer_name,
          company_name: portal.name,
          company_address: companyAddressOf(portal),
          logo_path: portal.logo_path || null,
          total: total == null ? 0 : total,
          created_by: req.session.user.id,
        },
        items
      );
      setFlash(req, 'ok', `Remisión folio ${formatFolio(remision.folio)} creada.`);
      return res.redirect(`/encargado/remisiones/${remision.id}`);
    } catch (err) {
      if (String(err.message || '').includes('UNIQUE') || err.code === '23505') {
        setFlash(req, 'danger', 'Conflicto de folio. Intenta de nuevo.');
        return res.redirect('/encargado/remisiones/nueva');
      }
      throw err;
    }
  })
);

router.get(
  '/remisiones/:id',
  wrap(async (req, res) => {
    const pid = portalIdOf(req);
    const remisionRow = await findRemision(Number(req.params.id), pid);
    if (!remisionRow) {
      setFlash(req, 'danger', 'Remisión no encontrada.');
      return res.redirect('/encargado/remisiones');
    }
    const items = await listRemisionItems(remisionRow.id);
    const remision = decorateRemision(remisionRow, items);
    const portal = await getPortal(pid);
    const creator = remision.created_by ? await findUserById(remision.created_by) : null;
    const printLogo = logoUrl({ logo_path: remision.logo_path || (portal && portal.logo_path) });
    res.render('encargado-remision-detalle', {
      title: `Remisión ${formatFolio(remision.folio)}`,
      remision,
      items,
      creator,
      printLogo,
      formatFolio,
      withSidebar: true,
      activeNav: 'remisiones',
    });
  })
);

module.exports = router;
