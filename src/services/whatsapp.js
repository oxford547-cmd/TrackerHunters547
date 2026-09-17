'use strict';

/**
 * WhatsApp notifications for the order lifecycle.
 *
 * Provider interface: any object with `{ name, send({ to, body, meta }) }`.
 * Built-in: Twilio WhatsApp (default), log/stub, and a Meta placeholder.
 *
 * Env:
 *   WHATSAPP_PROVIDER=twilio|log|stub|meta
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
 *   WHATSAPP_ENABLED=true   → require a live send (still never crashes the app;
 *                             missing credentials are logged as errors)
 *   WHATSAPP_NOTIFY_CANCELADO=false → skip Cancelado notices
 *   PUBLIC_BASE_URL         → included in the tracking hint when set
 *
 * wa.me / api.whatsapp.com links cannot push from the server. Real delivery
 * needs Twilio (or Meta Cloud API later). Without keys, messages are logged.
 */

const { normalizeMxE164 } = require('../phone');
const { ORDER_STATUSES } = require('../constants');

let injectedProvider = null;
let fetchImpl = globalThis.fetch;

function setWhatsAppProvider(provider) {
  injectedProvider = provider || null;
}

function setWhatsAppFetch(fn) {
  fetchImpl = fn || globalThis.fetch;
}

function resetWhatsAppForTests() {
  injectedProvider = null;
  fetchImpl = globalThis.fetch;
}

function createMemoryProvider(calls) {
  const list = calls || [];
  return {
    name: 'memory',
    calls: list,
    async send(payload) {
      list.push({ ...payload });
      return { ok: true, provider: 'memory' };
    },
  };
}

function createLogProvider(reason) {
  return {
    name: 'log',
    reason: reason || 'log',
    async send({ to, body, meta }) {
      console.log('[whatsapp:log]', {
        reason: reason || 'demo / missing credentials',
        to,
        body,
        order: meta && meta.trackingCode,
        status: meta && meta.status,
        portalId: meta && meta.portalId,
      });
      return { ok: true, logged: true, provider: 'log' };
    },
  };
}

function envFlag(name, defaultTrue) {
  const raw = String(process.env[name] == null ? '' : process.env[name]).trim().toLowerCase();
  if (!raw) return defaultTrue;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  return defaultTrue;
}

function whatsappEnabledRequired() {
  return envFlag('WHATSAPP_ENABLED', false);
}

function shouldNotifyCancelado() {
  return envFlag('WHATSAPP_NOTIFY_CANCELADO', true);
}

function twilioCredentialsReady() {
  return Boolean(
    String(process.env.TWILIO_ACCOUNT_SID || '').trim() &&
      String(process.env.TWILIO_AUTH_TOKEN || '').trim() &&
      String(process.env.TWILIO_WHATSAPP_FROM || '').trim()
  );
}

function formatWhatsAppAddress(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^whatsapp:/i.test(raw)) return raw;
  const e164 = normalizeMxE164(raw) || raw;
  return `whatsapp:${e164}`;
}

function createTwilioProvider() {
  return {
    name: 'twilio',
    async send({ to, body }) {
      const sid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
      const token = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
      const from = formatWhatsAppAddress(process.env.TWILIO_WHATSAPP_FROM);
      const doFetch = fetchImpl;
      if (typeof doFetch !== 'function') {
        throw new Error('fetch no disponible para Twilio');
      }
      const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
      const params = new URLSearchParams({
        From: from,
        To: formatWhatsAppAddress(to),
        Body: body,
      });
      const res = await doFetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.message || `Twilio HTTP ${res.status}`);
        err.code = data.code;
        err.status = res.status;
        throw err;
      }
      return { ok: true, sid: data.sid, provider: 'twilio' };
    },
  };
}

function createMetaStubProvider() {
  const log = createLogProvider('meta not implemented');
  return {
    name: 'meta',
    async send(payload) {
      console.warn(
        '[whatsapp] Meta Cloud API no está implementado aún; se registra el mensaje. Usa WHATSAPP_PROVIDER=twilio para envío real.'
      );
      return log.send(payload);
    },
  };
}

function resolveProvider() {
  if (injectedProvider) return injectedProvider;

  const name = String(process.env.WHATSAPP_PROVIDER || 'twilio')
    .trim()
    .toLowerCase();
  const required = whatsappEnabledRequired();

  if (name === 'log' || name === 'stub') {
    return createLogProvider(name);
  }
  if (name === 'meta') {
    return createMetaStubProvider();
  }
  if (name === 'memory') {
    return createMemoryProvider();
  }

  if (twilioCredentialsReady()) {
    return createTwilioProvider();
  }

  if (required) {
    console.error(
      '[whatsapp] WHATSAPP_ENABLED=true pero faltan TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM. El mensaje se registra; no hay envío real.'
    );
  }
  return createLogProvider('missing credentials');
}

function statusLabel(status) {
  return ORDER_STATUSES[status] || status || '';
}

function brandNameOf(order) {
  if (order && order.portal_name) return String(order.portal_name);
  return 'Hunters 547';
}

function trackingHint(trackingCode) {
  const code = String(trackingCode || '').trim();
  const base = String(process.env.PUBLIC_BASE_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (base && code) {
    return `Rastrea tu pedido aquí: ${base}/rastreo?codigo=${encodeURIComponent(code)}`;
  }
  if (code) {
    return `Rastrea tu pedido en el portal con el número ${code}.`;
  }
  return 'Consulta el rastreo en el portal de tu empresa.';
}

/**
 * Spanish (es-MX) templates. `kind`: created | status | delivered | cancelled
 */
function buildOrderMessage({ kind, brandName, trackingCode, status }) {
  const brand = brandName || 'Hunters 547';
  const code = trackingCode || '—';
  const label = statusLabel(status);
  const hint = trackingHint(code);

  if (kind === 'created') {
    return [
      `*${brand}*`,
      `Pedido *${code}* creado / registrado.`,
      '',
      `Estado: ${label || 'Pedido colocado'}.`,
      '',
      hint,
    ].join('\n');
  }

  if (kind === 'delivered') {
    return [
      `*${brand}*`,
      `Tu pedido *${code}* fue *entregado*.`,
      '',
      'Este es el aviso final de entrega. ¡Gracias por tu preferencia!',
    ].join('\n');
  }

  if (kind === 'cancelled') {
    return [
      `*${brand}*`,
      `Tu pedido *${code}* fue *cancelado*.`,
      '',
      `Si no esperabas este aviso, contacta a ${brand}.`,
    ].join('\n');
  }

  return [
    `*${brand}*`,
    `Tu pedido *${code}* cambió de estado.`,
    '',
    `Nuevo estado: *${label}*.`,
    '',
    hint,
  ].join('\n');
}

function resolveNotifyPhone(order) {
  const candidates = [order && order.phone, order && order.customer_phone];
  for (const raw of candidates) {
    const e164 = normalizeMxE164(raw);
    if (e164) return e164;
  }
  return null;
}

function kindFor(type, status) {
  if (type === 'created') return 'created';
  if (status === 'entregado') return 'delivered';
  if (status === 'cancelado') return 'cancelled';
  return 'status';
}

function loadOrderForNotify(orderId, portalId) {
  if (!orderId || portalId == null || portalId === '') return null;
  const { getDb } = require('../db');
  return (
    getDb()
      .prepare(
        `SELECT o.*, p.name AS portal_name, c.phone AS customer_phone
         FROM orders o
         LEFT JOIN portals p ON p.id = o.portal_id
         LEFT JOIN customers c ON c.id = o.customer_id AND c.portal_id = o.portal_id
         WHERE o.id = ? AND o.portal_id = ?`
      )
      .get(Number(orderId), Number(portalId)) || null
  );
}

async function sendOrderWhatsApp(order, { type, status } = {}) {
  try {
    if (!order) {
      return { ok: true, skipped: 'no_order' };
    }

    const st = status || order.status || 'pedido_colocado';
    if (st === 'cancelado' && !shouldNotifyCancelado()) {
      return { ok: true, skipped: 'cancelado' };
    }

    const to = resolveNotifyPhone(order);
    const trackingCode = order.tracking_code;
    const brandName = brandNameOf(order);
    const kind = kindFor(type, st);
    const body = buildOrderMessage({ kind, brandName, trackingCode, status: st });
    const meta = {
      type,
      status: st,
      trackingCode,
      portalId: order.portal_id != null ? Number(order.portal_id) : null,
      orderId: order.id != null ? Number(order.id) : null,
    };

    if (!to) {
      console.warn('[whatsapp] sin teléfono E.164; se omite el aviso', {
        trackingCode,
        portalId: meta.portalId,
        raw: order.phone || order.customer_phone || '',
      });
      return { ok: true, skipped: 'no_phone', body, meta };
    }

    const provider = resolveProvider();
    const required = whatsappEnabledRequired();
    if (required && provider.name === 'log') {
      console.error('[whatsapp] envío requerido (WHATSAPP_ENABLED=true) pero no hay proveedor vivo; se registra el mensaje', {
        to,
        trackingCode,
      });
    }

    const result = await provider.send({ to, body, meta });
    return { ok: true, to, body, meta, provider: provider.name, result };
  } catch (err) {
    console.error('[whatsapp] error al enviar (el pedido no se interrumpe):', err && err.message ? err.message : err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function notifyOrderCreated(order) {
  return sendOrderWhatsApp(order, { type: 'created', status: order && order.status ? order.status : 'pedido_colocado' });
}

async function notifyOrderStatusChanged(order, newStatus) {
  return sendOrderWhatsApp(order, { type: 'status', status: newStatus || (order && order.status) });
}

async function queueOrderNotification({ type, orderId, portalId, status } = {}) {
  try {
    const order = loadOrderForNotify(orderId, portalId);
    if (!order) {
      console.warn('[whatsapp] pedido no encontrado en este portal; se omite', { orderId, portalId });
      return { ok: true, skipped: 'not_found' };
    }
    if (type === 'created') return notifyOrderCreated(order);
    return notifyOrderStatusChanged(order, status || order.status);
  } catch (err) {
    console.error('[whatsapp] queue failed:', err && err.message ? err.message : err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

/** Fire-and-forget wrapper for HTTP handlers — never throws. */
function notifyOrderLater(args) {
  const p = queueOrderNotification(args);
  p.catch((err) => {
    console.error('[whatsapp] unexpected:', err && err.message ? err.message : err);
  });
  return p;
}

module.exports = {
  setWhatsAppProvider,
  setWhatsAppFetch,
  resetWhatsAppForTests,
  createMemoryProvider,
  createLogProvider,
  createTwilioProvider,
  resolveProvider,
  buildOrderMessage,
  trackingHint,
  formatWhatsAppAddress,
  notifyOrderCreated,
  notifyOrderStatusChanged,
  queueOrderNotification,
  notifyOrderLater,
  loadOrderForNotify,
};
