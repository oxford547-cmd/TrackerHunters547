'use strict';

const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');

const DEFAULT_LOGO = '/assets/img/hunters547-logo.jpg';
const UPLOAD_ROOT = path.join(__dirname, '..', 'public', 'uploads', 'portals');
const ALLOWED_LOGO_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function slugify(s) {
  const base = String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'portal';
}

function uniqueSlug(base, excludeId) {
  const d = getDb();
  const slug = slugify(base);
  for (let n = 0; n < 80; n++) {
    const candidate = n === 0 ? slug : `${slug}-${n + 1}`;
    const row = d.prepare('SELECT id FROM portals WHERE slug = ?').get(candidate);
    if (!row || (excludeId && Number(row.id) === Number(excludeId))) return candidate;
  }
  return `${slug}-${Date.now()}`;
}

function getPortal(id) {
  if (!id) return null;
  return getDb().prepare('SELECT * FROM portals WHERE id = ?').get(id);
}

function logoUrl(portal) {
  if (!portal || !portal.logo_path) return DEFAULT_LOGO;
  const rel = String(portal.logo_path).replace(/^\//, '');
  const abs = path.join(__dirname, '..', 'public', rel);
  if (fs.existsSync(abs)) return portal.logo_path;
  return DEFAULT_LOGO;
}

function branding(portal) {
  return {
    portal: portal || null,
    brandLogo: logoUrl(portal),
    brandName: portal && portal.name ? portal.name : 'Hunters 547',
  };
}

function saveLogo(portalId, file) {
  if (!file || !file.buffer || !file.buffer.length) return null;
  const ext =
    ALLOWED_LOGO_MIME[file.mimetype] ||
    (path.extname(file.originalname || '').toLowerCase().match(/^\.(jpe?g|png|webp|gif)$/)
      ? path.extname(file.originalname).toLowerCase().replace('jpeg', 'jpg')
      : '.jpg');
  const dir = path.join(UPLOAD_ROOT, String(portalId));
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith('logo.')) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch (_) {
        /* ignore */
      }
    }
  }
  const filename = 'logo' + ext;
  fs.writeFileSync(path.join(dir, filename), file.buffer);
  return `/uploads/portals/${portalId}/${filename}`;
}

function samePortal(user, row) {
  if (!row) return false;
  if (user && user.role === 'superadmin') return true;
  return Number(row.portal_id) === Number(user && user.portal_id);
}

function daysAgoTs(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function startOfToday() {
  return new Date().toISOString().slice(0, 10) + ' 00:00:00';
}

function loadDashboard() {
  const d = getDb();
  const today = startOfToday();
  const weekStart = daysAgoTs(7).slice(0, 10) + ' 00:00:00';

  const totalPortals = d.prepare('SELECT COUNT(*) AS c FROM portals').get().c;
  const activePortals = d.prepare('SELECT COUNT(*) AS c FROM portals WHERE active = 1').get().c;
  const ordersToday = d.prepare('SELECT COUNT(*) AS c FROM orders WHERE created_at >= ?').get(today).c;
  const ordersWeek = d.prepare('SELECT COUNT(*) AS c FROM orders WHERE created_at >= ?').get(weekStart).c;
  const delivered = d.prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'entregado'").get().c;
  const activeChoferes = d
    .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'chofer' AND active = 1")
    .get().c;
  const totalOrders = d.prepare('SELECT COUNT(*) AS c FROM orders').get().c;

  const byStatusRows = d.prepare('SELECT status, COUNT(*) AS c FROM orders GROUP BY status').all();
  const byStatus = {};
  for (const r of byStatusRows) byStatus[r.status] = r.c;

  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const count = d
      .prepare('SELECT COUNT(*) AS c FROM orders WHERE created_at >= ? AND created_at < ?')
      .get(day + ' 00:00:00', day + ' 23:59:59').c;
    const label = day.slice(5).replace('-', '/');
    trend.push({ day, label, count });
  }

  const perPortal = d
    .prepare(
      `SELECT p.id, p.name, p.slug, p.logo_path, p.active, p.contact_name, p.phone,
         (SELECT COUNT(*) FROM orders o WHERE o.portal_id = p.id) AS orders,
         (SELECT COUNT(*) FROM orders o WHERE o.portal_id = p.id AND o.created_at >= ?) AS orders_today,
         (SELECT COUNT(*) FROM orders o WHERE o.portal_id = p.id AND o.created_at >= ?) AS orders_week,
         (SELECT COUNT(*) FROM orders o WHERE o.portal_id = p.id AND o.status = 'entregado') AS delivered,
         (SELECT COUNT(*) FROM users u WHERE u.portal_id = p.id AND u.role = 'chofer' AND u.active = 1) AS choferes,
         (SELECT COUNT(*) FROM users u WHERE u.portal_id = p.id AND u.role = 'cliente' AND u.active = 1) AS clientes
       FROM portals p
       ORDER BY p.name`
    )
    .all(today, weekStart);

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


function loadEncargadoMetrics(portalId) {
  const d = getDb();
  const pid = Number(portalId);
  const today = startOfToday();
  const weekStart = daysAgoTs(7).slice(0, 10) + ' 00:00:00';

  const total = d.prepare('SELECT COUNT(*) AS c FROM orders WHERE portal_id = ?').get(pid).c;
  const ordersToday = d
    .prepare('SELECT COUNT(*) AS c FROM orders WHERE portal_id = ? AND created_at >= ?')
    .get(pid, today).c;
  const ordersWeek = d
    .prepare('SELECT COUNT(*) AS c FROM orders WHERE portal_id = ? AND created_at >= ?')
    .get(pid, weekStart).c;
  const enCamino = d
    .prepare("SELECT COUNT(*) AS c FROM orders WHERE portal_id = ? AND status = 'en_camino'")
    .get(pid).c;
  const deliveredToday = d
    .prepare(
      `SELECT COUNT(*) AS c FROM orders
       WHERE portal_id = ? AND status = 'entregado'
         AND COALESCE(delivered_at, updated_at) >= ?`
    )
    .get(pid, today).c;
  const deliveredWeek = d
    .prepare(
      `SELECT COUNT(*) AS c FROM orders
       WHERE portal_id = ? AND status = 'entregado'
         AND COALESCE(delivered_at, updated_at) >= ?`
    )
    .get(pid, weekStart).c;
  const delivered = d
    .prepare("SELECT COUNT(*) AS c FROM orders WHERE portal_id = ? AND status = 'entregado'")
    .get(pid).c;
  const cancelados = d
    .prepare("SELECT COUNT(*) AS c FROM orders WHERE portal_id = ? AND status = 'cancelado'")
    .get(pid).c;
  const choferes = d
    .prepare("SELECT COUNT(*) AS c FROM users WHERE portal_id = ? AND role = 'chofer' AND active = 1")
    .get(pid).c;
  const clientes = d.prepare('SELECT COUNT(*) AS c FROM customers WHERE portal_id = ?').get(pid).c;

  const byStatusRows = d
    .prepare('SELECT status, COUNT(*) AS c FROM orders WHERE portal_id = ? GROUP BY status')
    .all(pid);
  const byStatus = {};
  for (const r of byStatusRows) byStatus[r.status] = r.c;

  return {
    total,
    ordersToday,
    ordersWeek,
    enCamino,
    deliveredToday,
    deliveredWeek,
    delivered,
    cancelados,
    choferes,
    clientes,
    byStatus,
  };
}

module.exports = {
  DEFAULT_LOGO,
  ALLOWED_LOGO_MIME,
  slugify,
  uniqueSlug,
  getPortal,
  logoUrl,
  branding,
  saveLogo,
  samePortal,
  daysAgoTs,
  startOfToday,
  loadDashboard,
  loadEncargadoMetrics,
};
