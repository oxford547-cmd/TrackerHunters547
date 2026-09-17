'use strict';

const { ORDER_STATUSES } = require('../constants');

/**
 * Twilio WhatsApp notifications for order lifecycle.
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
 * Portal may store whatsapp_number — preferred as Twilio FROM when set.
 * If any credential is missing, messages are logged only (no send).
 */

function hasTwilioCreds() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_WHATSAPP_FROM
  );
}

/** Normalize MX / local phones to E.164 digits with + prefix. */
function toE164(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('52') && digits.length >= 12) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+52${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  if (String(raw || '').trim().startsWith('+') && digits.length >= 10) {
    return `+${digits}`;
  }
  if (digits.length >= 10 && digits.length <= 13) {
    return digits.startsWith('52') ? `+${digits}` : `+52${digits}`;
  }
  return null;
}

function whatsappAddress(phoneE164) {
  if (!phoneE164) return null;
  return phoneE164.startsWith('whatsapp:') ? phoneE164 : `whatsapp:${phoneE164}`;
}

function statusLabel(statusKey) {
  return ORDER_STATUSES[statusKey] || statusKey;
}

/**
 * Resolve Twilio FROM: portal.whatsapp_number if set, else TWILIO_WHATSAPP_FROM.
 * @param {{ whatsapp_number?: string }|null|undefined} portal
 */
function resolveFromNumber(portal) {
  const portalWa = portal && String(portal.whatsapp_number || '').trim();
  if (portalWa) {
    const e164 = toE164(portalWa);
    if (e164) return e164;
    // Already may include whatsapp: prefix
    if (portalWa.startsWith('whatsapp:')) return portalWa.replace(/^whatsapp:/, '');
  }
  const envFrom = String(process.env.TWILIO_WHATSAPP_FROM || '').trim();
  if (!envFrom) return null;
  return envFrom.replace(/^whatsapp:/i, '');
}

/**
 * Load portal row for an order (by portal_id on order or explicit portal).
 */
function loadPortalForOrder(order) {
  if (!order) return null;
  if (order.portal && typeof order.portal === 'object') return order.portal;
  const pid = order.portal_id;
  if (!pid) return null;
  try {
    const { getDb } = require('../db');
    return getDb().prepare('SELECT id, name, whatsapp_number FROM portals WHERE id = ?').get(pid);
  } catch (_) {
    return null;
  }
}

/**
 * Spanish body: order # + status.
 * @param {{ tracking_code: string, status: string, customer_name?: string }} order
 * @param {{ name?: string }|null} portal
 */
function buildOrderMessage(order, portal) {
  const brand = (portal && portal.name) || 'Hunters 547';
  const code = order.tracking_code || '—';
  const label = statusLabel(order.status);
  const name = order.customer_name ? ` ${order.customer_name}` : '';
  if (order.status === 'pedido_colocado') {
    return (
      `${brand}: Hola${name ? ',' + name : ''}. ` +
      `Tu pedido *${code}* fue registrado. Estado: *${label}*.`
    );
  }
  if (order.status === 'entregado') {
    return `${brand}: Tu pedido *${code}* fue *${label}*. ¡Gracias!`;
  }
  if (order.status === 'cancelado') {
    return `${brand}: Tu pedido *${code}* fue *${label}*.`;
  }
  return `${brand}: Actualización de tu pedido *${code}*. Nuevo estado: *${label}*.`;
}

/**
 * Send (or log) a WhatsApp text.
 * @param {string} toPhone
 * @param {string} body
 * @param {{ fromPhone?: string }=} opts
 * @returns {Promise<{ ok: boolean, sid?: string, logged?: boolean, error?: string }>}
 */
async function sendWhatsApp(toPhone, body, opts = {}) {
  const toE = toE164(toPhone);
  if (!toE) {
    console.warn('[whatsapp] Sin teléfono válido; no se notifica.', { toPhone, body });
    return { ok: false, error: 'invalid_phone' };
  }
  const to = whatsappAddress(toE);
  const fromRaw = opts.fromPhone || process.env.TWILIO_WHATSAPP_FROM;
  const fromE = fromRaw ? toE164(String(fromRaw).replace(/^whatsapp:/i, '')) || String(fromRaw).replace(/^whatsapp:/i, '') : null;

  if (!hasTwilioCreds() && !opts.fromPhone) {
    console.log('[whatsapp] (log only — falta TWILIO_*)', { to, from: fromE || null, body });
    return { ok: true, logged: true };
  }
  // Allow send when SID/TOKEN present even if FROM comes from portal
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !fromE) {
    console.log('[whatsapp] (log only — falta TWILIO_* o FROM)', { to, from: fromE || null, body });
    return { ok: true, logged: true };
  }

  const fromAddr = whatsappAddress(fromE.startsWith('+') ? fromE : toE164(fromE) || fromE);
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const params = new URLSearchParams({
    From: fromAddr,
    To: to,
    Body: body,
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[whatsapp] Twilio error', res.status, data);
      return { ok: false, error: data.message || `http_${res.status}` };
    }
    console.log('[whatsapp] Enviado', { to, from: fromAddr, sid: data.sid });
    return { ok: true, sid: data.sid };
  } catch (err) {
    console.error('[whatsapp] Falló el envío', err.message || err);
    return { ok: false, error: String(err.message || err) };
  }
}

/**
 * Notify client phone about an order (create or status change).
 * Prefers portal.whatsapp_number as Twilio FROM when set.
 */
function notifyOrderStatus(order) {
  if (!order) return Promise.resolve({ ok: false, error: 'no_order' });

  const portal = loadPortalForOrder(order);
  const phone = order.phone;
  const body = buildOrderMessage(order, portal);
  const fromPhone = resolveFromNumber(portal);

  return sendWhatsApp(phone, body, { fromPhone: fromPhone || undefined }).catch((err) => {
    console.error('[whatsapp] notifyOrderStatus', err);
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
  hasTwilioCreds,
  toE164,
  buildOrderMessage,
  resolveFromNumber,
  sendWhatsApp,
  notifyOrderStatus,
  notifyOrderStatusAsync,
};
