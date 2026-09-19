'use strict';

const fs = require('fs');
const path = require('path');
const {
  findPortalById,
  findPortalBySlug,
  loadDashboardStats,
  loadEncargadoOrderRows,
  countEq,
} = require('./db');

const DEFAULT_LOGO = '/assets/img/hunters547-logo.jpg';
const UPLOAD_ROOT = path.join(__dirname, '..', 'public', 'uploads', 'portals');
const DELIVERY_ROOT = path.join(__dirname, '..', 'public', 'uploads', 'deliveries');
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

async function uniqueSlug(base, excludeId) {
  const slug = slugify(base);
  for (let n = 0; n < 80; n++) {
    const candidate = n === 0 ? slug : `${slug}-${n + 1}`;
    const row = await findPortalBySlug(candidate);
    if (!row || (excludeId && Number(row.id) === Number(excludeId))) return candidate;
  }
  return `${slug}-${Date.now()}`;
}

async function getPortal(id) {
  if (!id) return null;
  return findPortalById(id);
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

function saveDeliveryAsset(orderId, file, kind) {
  if (!file || !file.buffer || !file.buffer.length) return null;
  const ext =
    ALLOWED_LOGO_MIME[file.mimetype] ||
    (path.extname(file.originalname || '').toLowerCase().match(/^\.(jpe?g|png|webp|gif)$/)
      ? path.extname(file.originalname).toLowerCase().replace('jpeg', 'jpg')
      : '.jpg');
  const dir = path.join(DELIVERY_ROOT, String(orderId));
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${kind}${ext}`;
  fs.writeFileSync(path.join(dir, filename), file.buffer);
  return `/uploads/deliveries/${orderId}/${filename}`;
}

function saveSignatureDataUrl(orderId, dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) return null;
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!match) return null;
  const ext = match[1].toLowerCase() === 'jpeg' || match[1].toLowerCase() === 'jpg' ? '.jpg' : `.${match[1].toLowerCase()}`;
  const dir = path.join(DELIVERY_ROOT, String(orderId));
  fs.mkdirSync(dir, { recursive: true });
  const filename = `signature${ext}`;
  fs.writeFileSync(path.join(dir, filename), Buffer.from(match[2], 'base64'));
  return `/uploads/deliveries/${orderId}/${filename}`;
}

function samePortal(user, row) {
  if (!row) return false;
  if (user && user.role === 'superadmin') return true;
  return Number(row.portal_id) === Number(user && user.portal_id);
}

function daysAgoTs(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString();
}

function startOfToday() {
  return new Date().toISOString().slice(0, 10) + ' 00:00:00';
}

async function loadDashboard() {
  const today = startOfToday();
  const weekStart = daysAgoTs(7).slice(0, 10) + ' 00:00:00';
  return loadDashboardStats({ today, weekStart });
}

/** Build { from, toExclusive } ISO-ish timestamps for dashboard presets. */
function resolveDateRange(preset, fromStr, toStr) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const startOfDay = (d) => ymd(d) + ' 00:00:00';
  const nextDay = (d) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    return startOfDay(x);
  };

  const p = String(preset || 'semana').toLowerCase();
  if (p === 'custom' || p === 'manual') {
    const from = String(fromStr || '').trim();
    const to = String(toStr || '').trim();
    if (from && to) {
      const fromDay = from.slice(0, 10);
      const toDay = to.slice(0, 10);
      return {
        preset: 'custom',
        from: fromDay + ' 00:00:00',
        toExclusive: nextDay(new Date(toDay + 'T12:00:00')),
        toInclusive: toDay,
        label: `${fromDay} → ${toDay}`,
      };
    }
  }

  let fromDate;
  let label;
  if (p === 'dia' || p === 'día' || p === 'day') {
    fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    label = 'Hoy';
    return {
      preset: 'dia',
      from: startOfDay(fromDate),
      toExclusive: nextDay(fromDate),
      toInclusive: ymd(fromDate),
      label,
    };
  }
  if (p === 'mes' || p === 'month') {
    fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
    label = 'Este mes';
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      preset: 'mes',
      from: startOfDay(fromDate),
      toExclusive: startOfDay(end),
      toInclusive: ymd(last),
      label,
    };
  }
  if (p === 'anio' || p === 'año' || p === 'year') {
    fromDate = new Date(now.getFullYear(), 0, 1);
    label = 'Este año';
    const end = new Date(now.getFullYear() + 1, 0, 1);
    return {
      preset: 'anio',
      from: startOfDay(fromDate),
      toExclusive: startOfDay(end),
      toInclusive: `${now.getFullYear()}-12-31`,
      label,
    };
  }
  fromDate = new Date(now.getTime() - 6 * 86400000);
  fromDate = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  label = 'Últimos 7 días';
  return {
    preset: 'semana',
    from: startOfDay(fromDate),
    toExclusive: nextDay(now),
    toInclusive: ymd(now),
    label,
  };
}

function inRange(ts, range) {
  if (!ts || !range) return false;
  return ts >= range.from && ts < range.toExclusive;
}

async function loadEncargadoMetrics(portalId, rangeOpts) {
  const pid = Number(portalId);
  const today = startOfToday();
  const weekStart = daysAgoTs(7).slice(0, 10) + ' 00:00:00';
  const range =
    rangeOpts && rangeOpts.from
      ? rangeOpts
      : resolveDateRange(rangeOpts && rangeOpts.preset, rangeOpts && rangeOpts.fromStr, rangeOpts && rangeOpts.toStr);

  const [orders, choferes, clientes] = await Promise.all([
    loadEncargadoOrderRows(pid),
    countEq('users', { portal_id: pid, role: 'chofer', active: true }),
    countEq('customers', { portal_id: pid, active: true }),
  ]);

  const ranged = orders.filter((o) => inRange(o.created_at, range));
  const byStatus = {};
  for (const r of ranged) byStatus[r.status] = (byStatus[r.status] || 0) + 1;

  const deliveredStamp = (o) => o.delivered_at || o.updated_at || '';

  return {
    total: ranged.length,
    ordersToday: orders.filter((o) => o.created_at >= today).length,
    ordersWeek: orders.filter((o) => o.created_at >= weekStart).length,
    enCamino: ranged.filter((o) => o.status === 'en_camino').length,
    deliveredToday: orders.filter(
      (o) => o.status === 'entregado' && deliveredStamp(o) >= today
    ).length,
    deliveredWeek: orders.filter(
      (o) => o.status === 'entregado' && deliveredStamp(o) >= weekStart
    ).length,
    delivered: ranged.filter((o) => o.status === 'entregado').length,
    cancelados: ranged.filter((o) => o.status === 'cancelado').length,
    choferes,
    clientes,
    byStatus,
    range,
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
  saveDeliveryAsset,
  saveSignatureDataUrl,
  samePortal,
  daysAgoTs,
  startOfToday,
  loadDashboard,
  loadEncargadoMetrics,
  resolveDateRange,
};
