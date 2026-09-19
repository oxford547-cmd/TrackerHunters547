'use strict';

const { getSupabase, throwIfError } = require('./supabase');
const { ensureUploadDirs } = require('./uploads');
const {
  parseOrderItemsFromBody,
  parseRemisionItemsFromBody,
  formatFolio,
  companyAddressOf,
  todayLocalDate,
  previewNextFolio,
  decorateRemision,
  sumCantidad,
  sumImporte,
} = require('./parsers');

function now() {
  return new Date().toISOString();
}

/** Suggested placeholder only — encargado must set tracking_code manually. */
function generateTrackingCode() {
  const hex = require('crypto').randomBytes(3).toString('hex').toUpperCase();
  const ymd = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  return `H547-${hex}-${ymd}`;
}

function asBool01(v) {
  if (v === true || v === 1 || v === '1' || v === 't' || v === 'true') return 1;
  return 0;
}

function asId(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? v : n;
}

function toBool(v) {
  return Boolean(asBool01(v));
}

function mapUser(row) {
  if (!row) return null;
  const customer_id = asId(row.customer_id ?? row.cliente_id ?? null);
  return {
    ...row,
    id: asId(row.id),
    customer_id,
    cliente_id: customer_id,
    active: asBool01(row.active),
    portal_id: asId(row.portal_id),
  };
}

function mapPortal(row) {
  if (!row) return null;
  return {
    ...row,
    id: asId(row.id),
    active: asBool01(row.active),
    remision_next: Number(row.remision_next || 1),
  };
}

function mapCustomer(row) {
  if (!row) return null;
  return {
    ...row,
    id: asId(row.id),
    portal_id: asId(row.portal_id),
    active: asBool01(row.active),
  };
}

function mapOrder(row) {
  if (!row) return null;
  const chofer_name =
    row.chofer_name ??
    (row.chofer && typeof row.chofer === 'object' ? row.chofer.name : null) ??
    null;
  const { chofer, ...rest } = row;
  return {
    ...rest,
    id: asId(rest.id),
    portal_id: asId(rest.portal_id),
    customer_id: asId(rest.customer_id),
    chofer_id: asId(rest.chofer_id),
    created_by: asId(rest.created_by),
    chofer_name,
    purchase_order: rest.purchase_order || '',
  };
}

function isUniqueViolation(err) {
  return Boolean(
    err &&
      (err.code === '23505' ||
        String(err.message || '').toLowerCase().includes('duplicate') ||
        String(err.message || '').includes('UNIQUE'))
  );
}

async function findUserByUsername(username) {
  const sb = getSupabase();
  const res = await sb.from('users').select('*').eq('username', username).maybeSingle();
  throwIfError(res, 'findUserByUsername');
  return mapUser(res.data);
}

async function findActiveUserByUsername(username) {
  const sb = getSupabase();
  const res = await sb
    .from('users')
    .select('*')
    .eq('username', username)
    .eq('active', true)
    .maybeSingle();
  throwIfError(res, 'findActiveUserByUsername');
  return mapUser(res.data);
}

async function findUserById(id) {
  const sb = getSupabase();
  const res = await sb.from('users').select('*').eq('id', id).maybeSingle();
  throwIfError(res, 'findUserById');
  return mapUser(res.data);
}

async function usernameTaken(username, excludeId) {
  const row = await findUserByUsername(username);
  if (!row) return false;
  if (excludeId && Number(row.id) === Number(excludeId)) return false;
  return true;
}

async function insertUser(fields) {
  const sb = getSupabase();
  const payload = {
    username: fields.username,
    password_hash: fields.password_hash,
    role: fields.role,
    name: fields.name,
    customer_id: fields.customer_id ?? fields.cliente_id ?? null,
    portal_id: fields.role === 'superadmin' ? null : fields.portal_id ?? null,
    active: fields.active == null ? true : toBool(fields.active),
  };
  if (fields.created_at) payload.created_at = fields.created_at;
  const res = await sb.from('users').insert(payload).select('*').single();
  throwIfError(res, 'insertUser');
  return mapUser(res.data);
}

async function updateUser(id, fields) {
  const sb = getSupabase();
  const payload = {};
  if (fields.name != null) payload.name = fields.name;
  if (fields.password_hash != null) payload.password_hash = fields.password_hash;
  if (fields.active != null) payload.active = toBool(fields.active);
  if (fields.customer_id !== undefined) payload.customer_id = fields.customer_id;
  if (!Object.keys(payload).length) return findUserById(id);
  const res = await sb.from('users').update(payload).eq('id', id).select('*').single();
  throwIfError(res, 'updateUser');
  return mapUser(res.data);
}

async function findPortalById(id) {
  if (!id) return null;
  const sb = getSupabase();
  const res = await sb.from('portals').select('*').eq('id', id).maybeSingle();
  throwIfError(res, 'findPortalById');
  return mapPortal(res.data);
}

async function findPortalBySlug(slug) {
  const sb = getSupabase();
  const res = await sb.from('portals').select('id, slug').eq('slug', slug).maybeSingle();
  throwIfError(res, 'findPortalBySlug');
  return res.data;
}

async function insertPortal(fields) {
  const sb = getSupabase();
  const payload = {
    name: fields.name,
    slug: fields.slug,
    logo_path: fields.logo_path ?? null,
    contact_name: fields.contact_name || '',
    phone: fields.phone || '',
    email: fields.email || '',
    address: fields.address || '',
    notes: fields.notes || '',
    whatsapp_number: fields.whatsapp_number || '',
    remision_next: fields.remision_next != null ? Number(fields.remision_next) : 1,
    active: fields.active == null ? true : toBool(fields.active),
  };
  if (fields.created_at) payload.created_at = fields.created_at;
  const res = await sb.from('portals').insert(payload).select('*').single();
  throwIfError(res, 'insertPortal');
  return mapPortal(res.data);
}

async function updatePortal(id, fields) {
  const sb = getSupabase();
  const payload = {};
  for (const key of [
    'name',
    'slug',
    'logo_path',
    'contact_name',
    'phone',
    'email',
    'address',
    'notes',
    'whatsapp_number',
    'remision_next',
  ]) {
    if (fields[key] !== undefined) payload[key] = fields[key];
  }
  if (fields.active != null) payload.active = toBool(fields.active);
  const res = await sb.from('portals').update(payload).eq('id', id).select('*').single();
  throwIfError(res, 'updatePortal');
  return mapPortal(res.data);
}

async function listPortalsAdmin() {
  const sb = getSupabase();
  const portalsRes = await sb.from('portals').select('*').order('created_at', { ascending: false });
  throwIfError(portalsRes, 'listPortals');
  const portals = (portalsRes.data || []).map(mapPortal);
  const [ordersRes, usersRes] = await Promise.all([
    sb.from('orders').select('id, portal_id'),
    sb.from('users').select('id, portal_id, role, username').eq('role', 'encargado').order('id'),
  ]);
  throwIfError(ordersRes, 'listPortals.orders');
  throwIfError(usersRes, 'listPortals.users');
  const orderCount = new Map();
  for (const o of ordersRes.data || []) {
    const k = Number(o.portal_id);
    orderCount.set(k, (orderCount.get(k) || 0) + 1);
  }
  const encByPortal = new Map();
  for (const u of usersRes.data || []) {
    const k = Number(u.portal_id);
    if (!encByPortal.has(k)) encByPortal.set(k, u.username);
  }
  return portals.map((p) => ({
    ...p,
    orders: orderCount.get(Number(p.id)) || 0,
    encargado_username: encByPortal.get(Number(p.id)) || null,
  }));
}

async function findEncargado(portalId) {
  const sb = getSupabase();
  const res = await sb
    .from('users')
    .select('id, username, name')
    .eq('portal_id', portalId)
    .eq('role', 'encargado')
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  throwIfError(res, 'findEncargado');
  return res.data;
}

async function listChoferes(portalId) {
  const sb = getSupabase();
  const res = await sb
    .from('users')
    .select('id, name, username, active')
    .eq('role', 'chofer')
    .eq('portal_id', portalId)
    .order('name');
  throwIfError(res, 'listChoferes');
  return (res.data || []).map(mapUser);
}

async function findChoferInPortal(id, portalId, { activeOnly } = {}) {
  const sb = getSupabase();
  let q = sb.from('users').select('*').eq('id', id).eq('role', 'chofer').eq('portal_id', portalId);
  if (activeOnly) q = q.eq('active', true);
  const res = await q.maybeSingle();
  throwIfError(res, 'findChoferInPortal');
  return mapUser(res.data);
}

async function listCustomers(portalId) {
  const sb = getSupabase();
  const [custRes, userRes] = await Promise.all([
    sb.from('customers').select('*').eq('portal_id', portalId).order('name'),
    sb
      .from('users')
      .select('id, username, active, customer_id')
      .eq('portal_id', portalId)
      .eq('role', 'cliente'),
  ]);
  throwIfError(custRes, 'listCustomers');
  throwIfError(userRes, 'listCustomers.users');
  const loginByCust = new Map();
  for (const u of userRes.data || []) {
    if (u.customer_id != null) loginByCust.set(Number(u.customer_id), u);
  }
  return (custRes.data || []).map((c) => {
    const login = loginByCust.get(Number(c.id));
    return {
      ...mapCustomer(c),
      login_username: login ? login.username : null,
      user_id: login ? login.id : null,
      login_active: login ? asBool01(login.active) : null,
    };
  });
}

async function findCustomer(id, portalId) {
  const sb = getSupabase();
  let q = sb.from('customers').select('*').eq('id', id);
  if (portalId != null) q = q.eq('portal_id', portalId);
  const res = await q.maybeSingle();
  throwIfError(res, 'findCustomer');
  return mapCustomer(res.data);
}

async function insertCustomer(fields) {
  const sb = getSupabase();
  const payload = {
    portal_id: fields.portal_id,
    name: fields.name,
    phone: fields.phone || '',
    email: fields.email || '',
    address: fields.address || '',
    notes: fields.notes || '',
    active: fields.active == null ? true : toBool(fields.active),
  };
  if (fields.created_at) payload.created_at = fields.created_at;
  const res = await sb.from('customers').insert(payload).select('*').single();
  throwIfError(res, 'insertCustomer');
  return mapCustomer(res.data);
}

async function updateCustomer(id, portalId, fields) {
  const sb = getSupabase();
  const payload = {};
  for (const key of ['name', 'phone', 'email', 'address', 'notes']) {
    if (fields[key] !== undefined) payload[key] = fields[key];
  }
  if (fields.active != null) payload.active = toBool(fields.active);
  const res = await sb
    .from('customers')
    .update(payload)
    .eq('id', id)
    .eq('portal_id', portalId)
    .select('*')
    .single();
  throwIfError(res, 'updateCustomer');
  return mapCustomer(res.data);
}

async function findClienteLogin(customerId, portalId) {
  const sb = getSupabase();
  const res = await sb
    .from('users')
    .select('*')
    .eq('customer_id', customerId)
    .eq('role', 'cliente')
    .eq('portal_id', portalId)
    .maybeSingle();
  throwIfError(res, 'findClienteLogin');
  return mapUser(res.data);
}

function applyCreatedRange(q, range) {
  if (range && range.from && range.toExclusive) {
    return q.gte('created_at', range.from).lt('created_at', range.toExclusive);
  }
  return q;
}

async function listOrders(portalId, range) {
  const sb = getSupabase();
  let q = sb
    .from('orders')
    .select('*, chofer:users!orders_chofer_id_fkey(name)')
    .eq('portal_id', portalId)
    .order('created_at', { ascending: false });
  q = applyCreatedRange(q, range);
  const res = await q;
  throwIfError(res, 'listOrders');
  return (res.data || []).map(mapOrder);
}

async function findOrderById(id) {
  const sb = getSupabase();
  const res = await sb.from('orders').select('*').eq('id', id).maybeSingle();
  throwIfError(res, 'findOrderById');
  return mapOrder(res.data);
}

async function findPortalOrder(id, portalId) {
  const sb = getSupabase();
  const res = await sb.from('orders').select('*').eq('id', id).eq('portal_id', portalId).maybeSingle();
  throwIfError(res, 'findPortalOrder');
  return mapOrder(res.data);
}

async function findOrderByTracking(code, portalId) {
  const sb = getSupabase();
  let q = sb.from('orders').select('*').ilike('tracking_code', code);
  if (portalId != null) q = q.eq('portal_id', portalId);
  const res = await q.limit(1).maybeSingle();
  throwIfError(res, 'findOrderByTracking');
  return mapOrder(res.data);
}

async function insertOrder(fields) {
  const sb = getSupabase();
  const payload = {
    portal_id: fields.portal_id,
    tracking_code: fields.tracking_code,
    purchase_order: fields.purchase_order || '',
    customer_id: fields.customer_id ?? null,
    customer_name: fields.customer_name,
    phone: fields.phone || '',
    email: fields.email || '',
    address: fields.address || '',
    notes: fields.notes || '',
    status: fields.status || 'pedido_colocado',
    chofer_id: fields.chofer_id ?? null,
    created_by: fields.created_by ?? null,
    created_at: fields.created_at || now(),
    updated_at: fields.updated_at || now(),
    delivered_at: fields.delivered_at ?? null,
    delivery_photo_path: fields.delivery_photo_path ?? null,
    delivery_signature_path: fields.delivery_signature_path ?? null,
  };
  const res = await sb.from('orders').insert(payload).select('*').single();
  throwIfError(res, 'insertOrder');
  return mapOrder(res.data);
}

async function updateOrder(id, fields, portalId) {
  const sb = getSupabase();
  const payload = { ...fields };
  if (payload.active != null) delete payload.active;
  let q = sb.from('orders').update(payload).eq('id', id);
  if (portalId != null) q = q.eq('portal_id', portalId);
  const res = await q.select('*').single();
  throwIfError(res, 'updateOrder');
  return mapOrder(res.data);
}

async function insertOrderItems(orderId, items) {
  if (!items || !items.length) return [];
  const sb = getSupabase();
  const rows = items.map((it, i) => ({
    order_id: orderId,
    description: it.description,
    uom: it.uom || '',
    quantity: it.quantity == null || it.quantity === '' ? 0 : Number(it.quantity),
    sort_order: it.sort_order != null ? Number(it.sort_order) : i,
  }));
  const res = await sb.from('order_items').insert(rows).select('*');
  throwIfError(res, 'insertOrderItems');
  return res.data || [];
}

async function listOrderItems(orderId) {
  const sb = getSupabase();
  const res = await sb
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
    .order('sort_order', { ascending: true });
  throwIfError(res, 'listOrderItems');
  return res.data || [];
}

async function attachOrderItems(orders) {
  const list = orders || [];
  if (!list.length) return list;
  const sb = getSupabase();
  const ids = list.map((o) => o.id);
  const res = await sb
    .from('order_items')
    .select('*')
    .in('order_id', ids)
    .order('sort_order', { ascending: true });
  throwIfError(res, 'attachOrderItems');
  const by = new Map();
  for (const it of res.data || []) {
    const k = Number(it.order_id);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(it);
  }
  return list.map((o) => ({ ...o, items: by.get(Number(o.id)) || [] }));
}

async function insertStatusHistory(fields) {
  const sb = getSupabase();
  const payload = {
    order_id: fields.order_id,
    status: fields.status,
    changed_by: fields.changed_by ?? null,
    notes: fields.notes || '',
    created_at: fields.created_at || now(),
  };
  const res = await sb.from('status_history').insert(payload).select('*').single();
  throwIfError(res, 'insertStatusHistory');
  return res.data;
}

async function listStatusHistory(orderId) {
  const sb = getSupabase();
  const res = await sb
    .from('status_history')
    .select('*, changed_by_user:users!status_history_changed_by_fkey(name)')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  throwIfError(res, 'listStatusHistory');
  return (res.data || []).map((h) => ({
    ...h,
    changed_by_name: h.changed_by_user && h.changed_by_user.name ? h.changed_by_user.name : null,
  }));
}

async function listStatusHistoryPublic(orderId) {
  const sb = getSupabase();
  const res = await sb
    .from('status_history')
    .select('status, created_at, notes')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  throwIfError(res, 'listStatusHistoryPublic');
  return res.data || [];
}

async function insertLocation(fields) {
  const sb = getSupabase();
  const payload = {
    order_id: fields.order_id,
    lat: fields.lat,
    lng: fields.lng,
    accuracy: fields.accuracy ?? null,
    created_at: fields.created_at || now(),
  };
  const res = await sb.from('location_updates').insert(payload).select('*').single();
  throwIfError(res, 'insertLocation');
  return res.data;
}

async function lastLocation(orderId) {
  const sb = getSupabase();
  const res = await sb
    .from('location_updates')
    .select('lat, lng, accuracy, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfError(res, 'lastLocation');
  return res.data;
}

async function listChoferActiveOrders(choferId, portalId) {
  const sb = getSupabase();
  const res = await sb
    .from('orders')
    .select('*')
    .eq('chofer_id', choferId)
    .eq('portal_id', portalId)
    .in('status', ['en_camino', 'en_preparacion', 'confirmado', 'pedido_colocado']);
  throwIfError(res, 'listChoferActiveOrders');
  const rank = { en_camino: 0, en_preparacion: 1 };
  return (res.data || [])
    .map(mapOrder)
    .sort((a, b) => {
      const ra = rank[a.status] != null ? rank[a.status] : 2;
      const rb = rank[b.status] != null ? rank[b.status] : 2;
      if (ra !== rb) return ra - rb;
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });
}

async function listChoferRecentDelivered(choferId, portalId) {
  const sb = getSupabase();
  const res = await sb
    .from('orders')
    .select('*')
    .eq('chofer_id', choferId)
    .eq('portal_id', portalId)
    .eq('status', 'entregado')
    .order('delivered_at', { ascending: false, nullsFirst: false })
    .limit(10);
  throwIfError(res, 'listChoferRecentDelivered');
  return (res.data || []).map(mapOrder);
}

async function listCustomerOrders(customerId, portalId) {
  const sb = getSupabase();
  const res = await sb
    .from('orders')
    .select('*, chofer:users!orders_chofer_id_fkey(name)')
    .eq('customer_id', customerId)
    .eq('portal_id', portalId)
    .order('created_at', { ascending: false });
  throwIfError(res, 'listCustomerOrders');
  return (res.data || []).map(mapOrder);
}

async function findCustomerOrder(id, customerId, portalId) {
  const sb = getSupabase();
  const res = await sb
    .from('orders')
    .select('*')
    .eq('id', id)
    .eq('customer_id', customerId)
    .eq('portal_id', portalId)
    .maybeSingle();
  throwIfError(res, 'findCustomerOrder');
  return mapOrder(res.data);
}

/**
 * Atomically claim the next remisión folio from portals.remision_next
 * using compare-and-swap. Unique(portal_id, folio) is a second safety net.
 */
async function claimRemisionFolio(portalId) {
  const sb = getSupabase();
  for (let attempt = 0; attempt < 12; attempt++) {
    const read = await sb.from('portals').select('remision_next').eq('id', portalId).single();
    throwIfError(read, 'claimRemisionFolio.read');
    const folio = Number(read.data.remision_next || 1);
    const cas = await sb
      .from('portals')
      .update({ remision_next: folio + 1 })
      .eq('id', portalId)
      .eq('remision_next', folio)
      .select('id');
    throwIfError(cas, 'claimRemisionFolio.cas');
    if (cas.data && cas.data.length) return folio;
  }
  const err = new Error('No se pudo asignar el folio de remisión.');
  err.status = 409;
  throw err;
}

async function maxRemisionFolio(portalId) {
  const sb = getSupabase();
  const res = await sb
    .from('remisiones')
    .select('folio')
    .eq('portal_id', portalId)
    .order('folio', { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfError(res, 'maxRemisionFolio');
  return res.data ? Number(res.data.folio) : 0;
}

async function nextFolioPreview(portalId) {
  const [portal, maxFolio] = await Promise.all([findPortalById(portalId), maxRemisionFolio(portalId)]);
  return previewNextFolio(portal && portal.remision_next, maxFolio);
}

async function listRemisiones(portalId) {
  const sb = getSupabase();
  const res = await sb
    .from('remisiones')
    .select('*, creator:users!remisiones_created_by_fkey(name)')
    .eq('portal_id', portalId)
    .order('folio', { ascending: false });
  throwIfError(res, 'listRemisiones');
  const rows = res.data || [];
  const ids = rows.map((r) => r.id);
  let itemsBy = new Map();
  if (ids.length) {
    const itemsRes = await sb
      .from('remision_items')
      .select('remision_id, cantidad, importe')
      .in('remision_id', ids);
    throwIfError(itemsRes, 'listRemisiones.items');
    for (const it of itemsRes.data || []) {
      const k = Number(it.remision_id);
      if (!itemsBy.has(k)) itemsBy.set(k, []);
      itemsBy.get(k).push(it);
    }
  }
  return rows.map((r) => decorateRemision(r, itemsBy.get(Number(r.id)) || []));
}

async function findRemision(id, portalId) {
  const sb = getSupabase();
  const res = await sb
    .from('remisiones')
    .select('*')
    .eq('id', id)
    .eq('portal_id', portalId)
    .maybeSingle();
  throwIfError(res, 'findRemision');
  return res.data;
}

async function insertRemision(fields) {
  const sb = getSupabase();
  const payload = {
    portal_id: fields.portal_id,
    folio: fields.folio,
    fecha: fields.fecha,
    customer_name: fields.customer_name,
    company_name: fields.company_name || '',
    company_address: fields.company_address || '',
    logo_path: fields.logo_path ?? null,
    total: fields.total == null || fields.total === '' ? 0 : Number(fields.total),
    created_by: fields.created_by ?? null,
  };
  if (fields.created_at) payload.created_at = fields.created_at;
  const res = await sb.from('remisiones').insert(payload).select('*').single();
  throwIfError(res, 'insertRemision');
  return res.data;
}

async function insertRemisionItems(remisionId, items) {
  if (!items || !items.length) return [];
  const sb = getSupabase();
  const rows = items.map((it) => ({
    remision_id: remisionId,
    cantidad: it.cantidad == null || it.cantidad === '' ? 0 : Number(it.cantidad),
    unidad: it.unidad || '',
    descripcion: it.descripcion,
    lote: it.lote || '',
    importe: it.importe == null || it.importe === '' ? 0 : Number(it.importe),
  }));
  const res = await sb.from('remision_items').insert(rows).select('*');
  throwIfError(res, 'insertRemisionItems');
  return res.data || [];
}

async function listRemisionItems(remisionId) {
  const sb = getSupabase();
  const res = await sb.from('remision_items').select('*').eq('remision_id', remisionId).order('id');
  throwIfError(res, 'listRemisionItems');
  return res.data || [];
}

async function createRemisionWithFolio(fields, items) {
  let lastErr;
  for (let attempt = 0; attempt < 8; attempt++) {
    const folio = await claimRemisionFolio(fields.portal_id);
    try {
      const remision = await insertRemision({ ...fields, folio });
      const savedItems = await insertRemisionItems(remision.id, items);
      return { remision, items: savedItems };
    } catch (err) {
      lastErr = err;
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw lastErr || new Error('No se pudo crear la remisión.');
}

async function countEq(table, filters) {
  const sb = getSupabase();
  let q = sb.from(table).select('id', { count: 'exact', head: true });
  for (const [k, v] of Object.entries(filters || {})) {
    if (Array.isArray(v) && v[0] === 'gte') q = q.gte(k, v[1]);
    else if (Array.isArray(v) && v[0] === 'lt') q = q.lt(k, v[1]);
    else q = q.eq(k, v);
  }
  const res = await q;
  throwIfError(res, `count.${table}`);
  return res.count || 0;
}

async function loadDashboardStats({ today, weekStart }) {
  const sb = getSupabase();
  const [
    totalPortals,
    activePortals,
    ordersToday,
    ordersWeek,
    delivered,
    activeChoferes,
    totalOrders,
    byStatusRes,
    portalsRes,
    ordersRes,
    usersRes,
  ] = await Promise.all([
    countEq('portals'),
    countEq('portals', { active: true }),
    countEq('orders', { created_at: ['gte', today] }),
    countEq('orders', { created_at: ['gte', weekStart] }),
    countEq('orders', { status: 'entregado' }),
    countEq('users', { role: 'chofer', active: true }),
    countEq('orders'),
    sb.from('orders').select('status'),
    sb.from('portals').select('*').order('name'),
    sb.from('orders').select('id, portal_id, created_at, status'),
    sb.from('users').select('id, portal_id, role, active'),
  ]);
  throwIfError(byStatusRes, 'dashboard.byStatus');
  throwIfError(portalsRes, 'dashboard.portals');
  throwIfError(ordersRes, 'dashboard.orders');
  throwIfError(usersRes, 'dashboard.users');

  const byStatus = {};
  for (const r of byStatusRes.data || []) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  }

  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const from = day + ' 00:00:00';
    const to = day + ' 23:59:59';
    const count = (ordersRes.data || []).filter((o) => o.created_at >= from && o.created_at <= to)
      .length;
    trend.push({ day, label: day.slice(5).replace('-', '/'), count });
  }

  const perPortal = (portalsRes.data || []).map(mapPortal).map((p) => {
    const pid = Number(p.id);
    const pOrders = (ordersRes.data || []).filter((o) => Number(o.portal_id) === pid);
    const pUsers = (usersRes.data || []).filter((u) => Number(u.portal_id) === pid);
    return {
      ...p,
      orders: pOrders.length,
      orders_today: pOrders.filter((o) => o.created_at >= today).length,
      orders_week: pOrders.filter((o) => o.created_at >= weekStart).length,
      delivered: pOrders.filter((o) => o.status === 'entregado').length,
      choferes: pUsers.filter((u) => u.role === 'chofer' && asBool01(u.active)).length,
      clientes: pUsers.filter((u) => u.role === 'cliente' && asBool01(u.active)).length,
    };
  });

  return {
    totalPortals,
    activePortals,
    ordersToday,
    ordersWeek,
    delivered,
    activeChoferes,
    totalOrders,
    byStatus,
    trend,
    perPortal,
  };
}

async function loadEncargadoOrderRows(portalId) {
  const sb = getSupabase();
  const res = await sb
    .from('orders')
    .select('id, status, created_at, delivered_at, updated_at')
    .eq('portal_id', portalId);
  throwIfError(res, 'loadEncargadoOrderRows');
  return res.data || [];
}

/** Production path is Supabase-only. No SQLite schema is created. */
async function ensureReady() {
  getSupabase();
  ensureUploadDirs();
}

module.exports = {
  now,
  generateTrackingCode,
  asBool01,
  asId,
  toBool,
  mapUser,
  mapPortal,
  mapCustomer,
  mapOrder,
  isUniqueViolation,
  findUserByUsername,
  findActiveUserByUsername,
  findUserById,
  usernameTaken,
  insertUser,
  updateUser,
  findPortalById,
  findPortalBySlug,
  insertPortal,
  updatePortal,
  listPortalsAdmin,
  findEncargado,
  listChoferes,
  findChoferInPortal,
  listCustomers,
  findCustomer,
  insertCustomer,
  updateCustomer,
  findClienteLogin,
  listOrders,
  findOrderById,
  findPortalOrder,
  findOrderByTracking,
  insertOrder,
  updateOrder,
  insertOrderItems,
  listOrderItems,
  attachOrderItems,
  insertStatusHistory,
  listStatusHistory,
  listStatusHistoryPublic,
  insertLocation,
  lastLocation,
  listChoferActiveOrders,
  listChoferRecentDelivered,
  listCustomerOrders,
  findCustomerOrder,
  parseOrderItemsFromBody,
  parseRemisionItemsFromBody,
  formatFolio,
  companyAddressOf,
  todayLocalDate,
  previewNextFolio,
  decorateRemision,
  sumCantidad,
  sumImporte,
  claimRemisionFolio,
  maxRemisionFolio,
  nextFolioPreview,
  listRemisiones,
  findRemision,
  insertRemision,
  insertRemisionItems,
  listRemisionItems,
  createRemisionWithFolio,
  countEq,
  loadDashboardStats,
  loadEncargadoOrderRows,
  ensureReady,
  ensureUploadDirs,
};
