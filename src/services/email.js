'use strict';

const { ORDER_STATUSES } = require('../constants');
const { findPortalById, listOrderItems } = require('../db');

const FROM_DISPLAY_NAME = 'Notificaciones';
const HUNTERS_SITE_URL = 'https://www.hunters547.com';
const HUNTERS_SITE_LABEL = 'www.hunters547.com';

function smtpFrom() {
  const primary = String(process.env.SMTP_FROM || '').trim();
  if (primary) return primary;
  return String(process.env.MAIL_FROM || '').trim();
}

function hasSmtpCreds() {
  return Boolean(process.env.SMTP_HOST && smtpFrom());
}

function publicBaseUrl() {
  return String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
}

function extractEmail(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const angled = s.match(/<([^>]+)>/);
  return (angled ? angled[1] : s).trim();
}

function formatFromHeader(raw) {
  const address = extractEmail(raw == null ? smtpFrom() : raw);
  if (!address) return FROM_DISPLAY_NAME;
  return `${FROM_DISPLAY_NAME} <${address}>`;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function portalLogoSrc(portal) {
  if (!portal) return '';
  const raw = String(portal.logo_path || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = publicBaseUrl();
  if (!base) return '';
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return `${base}${path}`;
}

function trackingUrl(code) {
  const base = publicBaseUrl();
  const tracking = String(code || '').trim();
  if (!base || !tracking || tracking === '—') return '';
  return `${base}/rastreo?codigo=${encodeURIComponent(tracking)}`;
}

function formatTimestamp(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  try {
    return new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Mexico_City',
    }).format(d);
  } catch (_) {
    return d.toISOString();
  }
}

function formatQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value == null ? '' : value);
  return Number.isInteger(n) ? String(n) : String(n);
}

function normalizeItems(order) {
  const list = Array.isArray(order && order.items)
    ? order.items
    : Array.isArray(order && order.order_items)
      ? order.order_items
      : [];
  return list
    .map((it) => ({
      description: String((it && (it.description || it.descripcion)) || '').trim(),
      uom: String((it && (it.uom || it.unidad)) || 'PZ').trim() || 'PZ',
      quantity: it && (it.quantity != null ? it.quantity : it.cantidad),
    }))
    .filter((it) => it.description);
}

function introCopy(status) {
  if (status === 'pedido_colocado') {
    return 'Tu pedido quedó registrado y ya puedes seguirlo con el código de rastreo.';
  }
  if (status === 'entregado') {
    return 'Tu pedido fue entregado. ¡Gracias por tu preferencia!';
  }
  if (status === 'cancelado') {
    return 'Tu pedido fue cancelado. Si no esperabas este cambio, habla con tu contacto en la planta.';
  }
  return 'Hay una actualización del estado de tu pedido.';
}

function greetingLine(order) {
  const name = String((order && order.customer_name) || '').trim();
  return name ? `Hola, ${name}.` : 'Hola.';
}

function subjectFor(status, brand, code) {
  if (status === 'pedido_colocado') return `${brand}: pedido ${code} registrado`;
  if (status === 'entregado') return `${brand}: pedido ${code} entregado`;
  if (status === 'cancelado') return `${brand}: pedido ${code} cancelado`;
  return `${brand}: actualización de pedido ${code}`;
}

function detailRows(order, portal) {
  const brand = (portal && portal.name) || 'Hunters 547';
  const rows = [
    ['Marca / portal', brand],
    ['Código de rastreo', order.tracking_code || '—'],
  ];
  const po = String(order.purchase_order || '').trim();
  if (po) rows.push(['Orden de compra', po]);
  const customer = String(order.customer_name || '').trim();
  if (customer) rows.push(['Cliente', customer]);
  const prev = order.previous_status;
  if (prev && prev !== order.status) {
    rows.push(['Estado anterior', statusLabel(prev)]);
  }
  rows.push(['Estado actual', statusLabel(order.status)]);
  const created = formatTimestamp(order.created_at);
  const updated = formatTimestamp(order.updated_at);
  const delivered = formatTimestamp(order.delivered_at);
  if (created) rows.push(['Registrado', created]);
  if (updated && String(order.updated_at) !== String(order.created_at || '')) {
    rows.push(['Actualizado', updated]);
  }
  if (delivered) rows.push(['Entregado', delivered]);
  return rows;
}

function spamNote(fromAddress) {
  const addr = extractEmail(fromAddress);
  if (addr) {
    return `Para que estos avisos no se vayan a spam, agrega ${addr} a tus contactos.`;
  }
  return 'Para que estos avisos no se vayan a spam, agrega este remitente a tus contactos.';
}

function buildOrderText(order, portal, extras) {
  const brand = (portal && portal.name) || 'Hunters 547';
  const code = order.tracking_code || '—';
  const track = extras.trackUrl ? `Rastreo: ${extras.trackUrl}` : '';
  const lines = [
    greetingLine(order),
    '',
    introCopy(order.status),
    '',
    'Detalles del pedido',
    ...detailRows(order, portal).map(([k, v]) => `${k}: ${v}`),
  ];
  if (extras.items.length) {
    lines.push('', 'Materiales');
    for (const it of extras.items) {
      lines.push(`- ${formatQty(it.quantity)} ${it.uom} · ${it.description}`);
    }
  }
  lines.push('', `Código de rastreo: ${code}`);
  if (track) lines.push(track);
  lines.push('', extras.spam, '', 'Hunters 547', HUNTERS_SITE_URL);
  return lines.join('\n');
}

function buildOrderHtml(order, portal, extras) {
  const brand = (portal && portal.name) || 'Hunters 547';
  const code = order.tracking_code || '—';
  const logoSrc = extras.logoSrc;
  const headerInner = logoSrc
    ? `<img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(brand)}" width="160" style="max-width:160px;height:auto;display:block;margin:0 auto;border:0;">`
    : `<p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">${escapeHtml(brand)}</p>`;

  const rowHtml = extras.rows
    .map(
      ([k, v], i) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid ${i === extras.rows.length - 1 ? 'transparent' : '#ececec'};color:#6b6b6b;font-size:13px;width:42%;vertical-align:top;">${escapeHtml(k)}</td>
        <td style="padding:8px 0;border-bottom:1px solid ${i === extras.rows.length - 1 ? 'transparent' : '#ececec'};color:#121212;font-size:13px;font-weight:600;vertical-align:top;">${escapeHtml(v)}</td>
      </tr>`
    )
    .join('');

  let itemsBlock = '';
  if (extras.items.length) {
    const itemRows = extras.items
      .map(
        (it) => `<tr>
          <td style="padding:8px 0;border-bottom:1px solid #ececec;color:#121212;font-size:13px;">${escapeHtml(it.description)}</td>
          <td style="padding:8px 0;border-bottom:1px solid #ececec;color:#121212;font-size:13px;text-align:right;white-space:nowrap;">${escapeHtml(formatQty(it.quantity))} ${escapeHtml(it.uom)}</td>
        </tr>`
      )
      .join('');
    itemsBlock = `
      <h2 style="margin:24px 0 8px;font-size:15px;color:#121212;">Materiales</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows}</table>`;
  }

  const trackBlock = extras.trackUrl
    ? `<p style="margin:8px 0 16px;font-size:14px;color:#121212;">
        <strong>Código de rastreo:</strong> ${escapeHtml(code)}<br>
        <a href="${escapeHtml(extras.trackUrl)}" style="color:#6FA000;word-break:break-all;">${escapeHtml(extras.trackUrl)}</a>
      </p>
      <p style="margin:0 0 20px;">
        <a href="${escapeHtml(extras.trackUrl)}" style="display:inline-block;background:#84BD00;color:#121212;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:8px;">Ver rastreo</a>
      </p>`
    : `<p style="margin:8px 0 20px;font-size:14px;color:#121212;"><strong>Código de rastreo:</strong> ${escapeHtml(code)}</p>`;

  return `<!DOCTYPE html>
<html lang="es-MX">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(extras.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f3f3;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f3f3;font-family:Arial,Helvetica,sans-serif;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e6e6;">
          <tr>
            <td style="background:#121212;padding:22px 24px;text-align:center;">${headerInner}</td>
          </tr>
          <tr>
            <td style="height:4px;background:#84BD00;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px 24px 8px;color:#121212;">
              <p style="margin:0 0 12px;font-size:16px;">${escapeHtml(greetingLine(order))}</p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">${escapeHtml(introCopy(order.status))}</p>
              <h2 style="margin:0 0 8px;font-size:15px;color:#121212;">Detalles del pedido</h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowHtml}</table>
              ${itemsBlock}
              ${trackBlock}
              <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#4a4a4a;">${escapeHtml(extras.spam)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 24px;font-size:13px;color:#6b6b6b;">
              Hunters 547 · <a href="${escapeHtml(HUNTERS_SITE_URL)}" style="color:#6FA000;text-decoration:underline;">${escapeHtml(HUNTERS_SITE_LABEL)}</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildOrderMessage(order, portal) {
  const safeOrder = order || {};
  const brand = (portal && portal.name) || 'Hunters 547';
  const code = safeOrder.tracking_code || '—';
  const fromRaw = smtpFrom();
  const extras = {
    subject: subjectFor(safeOrder.status, brand, code),
    items: normalizeItems(safeOrder),
    rows: detailRows(safeOrder, portal),
    trackUrl: trackingUrl(code),
    logoSrc: portalLogoSrc(portal),
    spam: spamNote(fromRaw),
  };
  return {
    subject: extras.subject,
    text: buildOrderText(safeOrder, portal, extras),
    html: buildOrderHtml(safeOrder, portal, extras),
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

async function attachItemsIfNeeded(order) {
  if (!order || Array.isArray(order.items) || Array.isArray(order.order_items)) return order;
  if (!order.id) return order;
  try {
    const items = await listOrderItems(order.id);
    return { ...order, items };
  } catch (_) {
    return order;
  }
}

async function sendMail({ to, subject, text, html }) {
  if (!to) {
    console.warn('[email] Sin destinatario; no se notifica.', { subject, text });
    return { ok: false, error: 'invalid_email' };
  }
  if (!hasSmtpCreds()) {
    console.log('[email] (log only — falta SMTP_*)', {
      to,
      subject,
      text,
      hasHtml: Boolean(html),
    });
    return { ok: true, logged: true };
  }

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (err) {
    console.warn('[email] nodemailer no disponible; solo log.', err.message);
    console.log('[email] (log only)', { to, subject, text, hasHtml: Boolean(html) });
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

  const payload = {
    from: formatFromHeader(smtpFrom()),
    to,
    subject,
    text,
  };
  if (html) payload.html = html;

  try {
    const info = await transporter.sendMail(payload);
    console.log('[email] Enviado', { to, subject, id: info.messageId });
    return { ok: true, id: info.messageId };
  } catch (err) {
    console.error('[email] Falló el envío', err.message || err);
    return { ok: false, error: String(err.message || err) };
  }
}

async function notifyOrderStatus(order) {
  if (!order) return { ok: false, error: 'no_order' };
  const enriched = await attachItemsIfNeeded(order);
  const portal = await loadPortalForOrder(enriched);
  const to = firstEmail(enriched.email, enriched.customer_email, portal && portal.email);
  if (!to) {
    console.warn('[email] Pedido sin email; no se notifica.', {
      tracking_code: enriched.tracking_code,
    });
    return { ok: false, error: 'invalid_email' };
  }
  const msg = buildOrderMessage(enriched, portal);
  return sendMail({ to, subject: msg.subject, text: msg.text, html: msg.html });
}

function notifyOrderStatusAsync(order) {
  setImmediate(() => {
    notifyOrderStatus(order).catch((err) => {
      console.error('[email] notifyOrderStatus', err);
    });
  });
}

module.exports = {
  FROM_DISPLAY_NAME,
  HUNTERS_SITE_URL,
  smtpFrom,
  hasSmtpCreds,
  firstEmail,
  extractEmail,
  formatFromHeader,
  escapeHtml,
  portalLogoSrc,
  buildOrderMessage,
  sendMail,
  notifyOrderStatus,
  notifyOrderStatusAsync,
};
