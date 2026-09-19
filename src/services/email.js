'use strict';

const { ORDER_STATUSES, PUBLIC_BASE_URL } = require('../constants');
const { findPortalById } = require('../db');

function smtpFrom() {
  const primary = String(process.env.SMTP_FROM || '').trim();
  if (primary) return primary;
  return String(process.env.MAIL_FROM || '').trim();
}

function hasSmtpCreds() {
  return Boolean(process.env.SMTP_HOST && smtpFrom());
}

function statusLabel(statusKey) {
  return ORDER_STATUSES[statusKey] || statusKey;
}

function firstEmail(...candidates) {
  for (const raw of candidates) {
    const v = String(raw || '').trim();
    if (v && /@/.test(v)) return v;
  }
  return null;
}

function buildOrderMessage(order, portal) {
  const brand = (portal && portal.name) || 'Hunters 547';
  const code = order.tracking_code || '—';
  const label = statusLabel(order.status);
  const name = order.customer_name ? ` ${order.customer_name}` : '';
  const track =
    PUBLIC_BASE_URL && code !== '—'
      ? `\nRastreo: ${PUBLIC_BASE_URL}/rastreo?codigo=${encodeURIComponent(code)}`
      : '';
  if (order.status === 'pedido_colocado') {
    return {
      subject: `${brand}: pedido ${code} registrado`,
      text:
        `${brand}: Hola${name ? ',' + name : ''}. ` +
        `Tu pedido ${code} fue registrado. Estado: ${label}.${track}`,
    };
  }
  if (order.status === 'entregado') {
    return {
      subject: `${brand}: pedido ${code} entregado`,
      text: `${brand}: Tu pedido ${code} fue ${label}. ¡Gracias!${track}`,
    };
  }
  if (order.status === 'cancelado') {
    return {
      subject: `${brand}: pedido ${code} cancelado`,
      text: `${brand}: Tu pedido ${code} fue ${label}.${track}`,
    };
  }
  return {
    subject: `${brand}: actualización de pedido ${code}`,
    text: `${brand}: Actualización de tu pedido ${code}. Nuevo estado: ${label}.${track}`,
  };
}

async function loadPortalForOrder(order) {
  if (!order) return null;
  if (order.portal && typeof order.portal === 'object') return order.portal;
  if (!order.portal_id) return null;
  try {
    return await findPortalById(order.portal_id);
  } catch (_) {
    return null;
  }
}

async function sendMail({ to, subject, text }) {
  if (!to) {
    console.warn('[email] Sin destinatario; no se notifica.', { subject, text });
    return { ok: false, error: 'invalid_email' };
  }
  if (!hasSmtpCreds()) {
    console.log('[email] (log only — falta SMTP_*)', { to, subject, text });
    return { ok: true, logged: true };
  }

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (err) {
    console.warn('[email] nodemailer no disponible; solo log.', err.message);
    console.log('[email] (log only)', { to, subject, text });
    return { ok: true, logged: true };
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465 || String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth:
      process.env.SMTP_USER || process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '' }
        : undefined,
  });

  try {
    const info = await transporter.sendMail({
      from: smtpFrom(),
      to,
      subject,
      text,
    });
    console.log('[email] Enviado', { to, subject, id: info.messageId });
    return { ok: true, id: info.messageId };
  } catch (err) {
    console.error('[email] Falló el envío', err.message || err);
    return { ok: false, error: String(err.message || err) };
  }
}

async function notifyOrderStatus(order) {
  if (!order) return { ok: false, error: 'no_order' };
  const portal = await loadPortalForOrder(order);
  const to = firstEmail(order.email, order.customer_email, portal && portal.email);
  if (!to) {
    console.warn('[email] Pedido sin email; no se notifica.', {
      tracking_code: order.tracking_code,
    });
    return { ok: false, error: 'invalid_email' };
  }
  const msg = buildOrderMessage(order, portal);
  return sendMail({ to, subject: msg.subject, text: msg.text });
}

function notifyOrderStatusAsync(order) {
  setImmediate(() => {
    notifyOrderStatus(order).catch((err) => {
      console.error('[email] notifyOrderStatus', err);
    });
  });
}

module.exports = {
  smtpFrom,
  hasSmtpCreds,
  firstEmail,
  buildOrderMessage,
  sendMail,
  notifyOrderStatus,
  notifyOrderStatusAsync,
};
