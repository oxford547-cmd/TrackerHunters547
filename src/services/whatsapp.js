'use strict';

const { ORDER_STATUSES } = require('../constants');

/**
 * Twilio WhatsApp notifications for order lifecycle.
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
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
  // Fallback: assume MX mobile if 10–13 digits
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
 * Spanish body: order # + status.
 * @param {{ tracking_code: string, status: string, customer_name?: string }} order
 */
function buildOrderMessage(order) {
  const code = order.tracking_code || '—';
  const label = statusLabel(order.status);
  const name = order.customer_name ? ` ${order.customer_name}` : '';
  if (order.status === 'pedido_colocado') {
    return (
      `Hunters 547: Hola${name ? ',' + name : ''}. ` +
      `Tu pedido *${code}* fue registrado. Estado: *${label}*.`
    );
  }
  if (order.status === 'entregado') {
    return `Hunters 547: Tu pedido *${code}* fue *${label}*. ¡Gracias!`;
  }
  if (order.status === 'cancelado') {
    return `Hunters 547: Tu pedido *${code}* fue *${label}*.`;
  }
  return `Hunters 547: Actualización de tu pedido *${code}*. Nuevo estado: *${label}*.`;
}

/**
 * Send (or log) a WhatsApp text.
 * @returns {Promise<{ ok: boolean, sid?: string, logged?: boolean, error?: string }>}
 */
async function sendWhatsApp(toPhone, body) {
  const toE = toE164(toPhone);
  if (!toE) {
    console.warn('[whatsapp] Sin teléfono válido; no se notifica.', { toPhone, body });
    return { ok: false, error: 'invalid_phone' };
  }
  const to = whatsappAddress(toE);
  const from = process.env.TWILIO_WHATSAPP_FROM;

  if (!hasTwilioCreds()) {
    console.log('[whatsapp] (log only — falta TWILIO_*)', { to, from: from || null, body });
    return { ok: true, logged: true };
  }

  const fromAddr = whatsappAddress(from);
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
    console.log('[whatsapp] Enviado', { to, sid: data.sid });
    return { ok: true, sid: data.sid };
  } catch (err) {
    console.error('[whatsapp] Falló el envío', err.message || err);
    return { ok: false, error: String(err.message || err) };
  }
}

/**
 * Notify client phone about an order (create or status change).
 * Fire-and-forget safe: never throws to the caller.
 * Stops notifying after Entregado (still sends the Entregado message itself).
 */
function notifyOrderStatus(order) {
  if (!order) return Promise.resolve({ ok: false, error: 'no_order' });

  const phone = order.phone;
  const body = buildOrderMessage(order);

  return sendWhatsApp(phone, body).catch((err) => {
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
  sendWhatsApp,
  notifyOrderStatus,
  notifyOrderStatusAsync,
};
