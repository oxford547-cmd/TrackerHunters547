'use strict';

const nodemailer = require('nodemailer');
const { buildOrderStatusEmail } = require('./emailTemplates');

/**
 * SMTP email notifications for order lifecycle (replaces WhatsApp status channel).
 * Env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, optional SMTP_SECURE
 * Optional: PUBLIC_BASE_URL for rastreo link
 * If SMTP missing: log-only (no crash), same pattern as former WhatsApp stub.
 */

function hasSmtpConfig() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.MAIL_FROM
  );
}

function smtpSecure() {
  const raw = String(process.env.SMTP_SECURE || '').toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  const port = Number(process.env.SMTP_PORT);
  return port === 465;
}

function mailFromDisplay() {
  const from = String(process.env.MAIL_FROM || '').trim();
  if (!from) return '';
  const m = from.match(/<([^>]+)>/);
  if (m) return m[1].trim();
  // "Name <email>" already handled; plain email or "Name email"
  return from;
}

function isValidEmail(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 254) return false;
  // Practical check (not full RFC)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function publicTrackUrl(trackingCode) {
  const base = String(process.env.PUBLIC_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (!base || !trackingCode) return '';
  return `${base}/rastreo?codigo=${encodeURIComponent(trackingCode)}`;
}

function loadPortal(portalId) {
  if (!portalId) return null;
  try {
    const { getDb } = require('../db');
    return getDb().prepare('SELECT id, name FROM portals WHERE id = ?').get(portalId);
  } catch (_) {
    return null;
  }
}

function resolveCustomerEmail(order) {
  if (order && isValidEmail(order.email)) {
    return String(order.email).trim();
  }
  const customerId = order && order.customer_id;
  if (!customerId) return null;
  try {
    const { getDb } = require('../db');
    const row = getDb()
      .prepare('SELECT email, phone FROM customers WHERE id = ?')
      .get(customerId);
    if (row && isValidEmail(row.email)) return String(row.email).trim();
    return null;
  } catch (_) {
    return null;
  }
}

function loadOrderItemsSafe(orderId) {
  if (!orderId) return [];
  try {
    const { loadOrderItems } = require('../db');
    return loadOrderItems(orderId) || [];
  } catch (_) {
    return [];
  }
}

/**
 * Send (or log) an email.
 * @returns {Promise<{ ok: boolean, messageId?: string, logged?: boolean, error?: string }>}
 */
async function sendMail({ to, subject, text, html }) {
  if (!isValidEmail(to)) {
    console.warn('[mailer] Destinatario inválido; no se envía.', { to, subject });
    return { ok: false, error: 'invalid_email' };
  }

  if (!hasSmtpConfig()) {
    console.log('[mailer] (log only — falta SMTP_* / MAIL_FROM)', {
      to,
      subject,
      text: text && text.slice(0, 500),
    });
    return { ok: true, logged: true };
  }

  const port = Number(process.env.SMTP_PORT) || 587;
  const transportOpts = {
    host: process.env.SMTP_HOST,
    port,
    secure: smtpSecure(),
  };
  if (process.env.SMTP_USER || process.env.SMTP_PASS) {
    transportOpts.auth = {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    };
  }

  try {
    const transporter = nodemailer.createTransport(transportOpts);
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to,
      subject,
      text,
      html,
    });
    console.log('[mailer] Enviado', { to, subject, messageId: info.messageId });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error('[mailer] Falló el envío', err.message || err);
    return { ok: false, error: String(err.message || err) };
  }
}

/**
 * Notify customer email about order create or status change.
 * Skips (with log) when only phone exists / no email.
 *
 * @param {object} order
 * @param {string} order.tracking_code
 * @param {string} order.status - new status
 * @param {string} [order.previous_status]
 * @param {string} [order.email]
 * @param {number} [order.customer_id]
 * @param {string} [order.customer_name]
 * @param {number} [order.portal_id]
 * @param {string} [order.purchase_order]
 * @param {Array} [order.items]
 * @param {number} [order.id] - order id to load items
 * @param {string} [order.created_at]
 * @param {string} [order.updated_at]
 * @param {boolean} [order.is_create]
 */
function notifyOrderStatus(order) {
  if (!order) return Promise.resolve({ ok: false, error: 'no_order' });

  const email = resolveCustomerEmail(order);
  if (!email) {
    console.warn('[mailer] Sin email del cliente; se omite notificación.', {
      tracking_code: order.tracking_code,
      status: order.status,
      customer_id: order.customer_id || null,
      phone: order.phone || null,
    });
    return Promise.resolve({ ok: false, error: 'no_email' });
  }

  const portal = loadPortal(order.portal_id);
  const items =
    order.items && order.items.length
      ? order.items
      : loadOrderItemsSafe(order.id);

  const isCreate =
    Boolean(order.is_create) ||
    (order.status === 'pedido_colocado' && !order.previous_status);

  const built = buildOrderStatusEmail({
    portalName: (portal && portal.name) || 'Hunters 547',
    trackingCode: order.tracking_code,
    purchaseOrder: order.purchase_order || '',
    materials: items,
    items,
    previousStatus: order.previous_status || null,
    newStatus: order.status,
    customerName: order.customer_name || '',
    createdAt: order.created_at || '',
    updatedAt: order.updated_at || '',
    trackUrl: publicTrackUrl(order.tracking_code),
    mailFromDisplay: mailFromDisplay(),
    isCreate,
  });

  return sendMail({
    to: email,
    subject: built.subject,
    text: built.text,
    html: built.html,
  }).catch((err) => {
    console.error('[mailer] notifyOrderStatus', err);
    return { ok: false, error: String(err.message || err) };
  });
}

/** Non-blocking wrapper for routes (does not await). */
function notifyOrderStatusAsync(order) {
  setImmediate(() => {
    notifyOrderStatus(order);
  });
}

module.exports = {
  hasSmtpConfig,
  isValidEmail,
  sendMail,
  notifyOrderStatus,
  notifyOrderStatusAsync,
  publicTrackUrl,
  mailFromDisplay,
};
