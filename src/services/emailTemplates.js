'use strict';

const { ORDER_STATUSES } = require('../constants');

function statusLabel(key) {
  if (!key) return null;
  return ORDER_STATUSES[key] || key;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMaterialsText(items) {
  if (!items || !items.length) return 'Sin materiales registrados.';
  return items
    .map((it) => {
      const qty = it.quantity != null ? it.quantity : '';
      const uom = it.uom || '';
      const desc = it.description || '';
      return `• ${desc}${qty !== '' ? ` — ${qty}` : ''}${uom ? ` ${uom}` : ''}`.trim();
    })
    .join('\n');
}

function formatMaterialsHtml(items) {
  if (!items || !items.length) {
    return '<p style="margin:0;color:#666">Sin materiales registrados.</p>';
  }
  const rows = items
    .map((it) => {
      const qty = it.quantity != null ? escapeHtml(String(it.quantity)) : '';
      const uom = escapeHtml(it.uom || '');
      const desc = escapeHtml(it.description || '');
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${desc}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${qty}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${uom}</td>
      </tr>`;
    })
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px">
    <thead>
      <tr style="background:#f5f5f5;text-align:left">
        <th style="padding:8px 10px">Material</th>
        <th style="padding:8px 10px;text-align:right">Cant.</th>
        <th style="padding:8px 10px">U.M.</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function statusChangeLine(previousStatus, newStatus, isCreate) {
  const neu = statusLabel(newStatus) || newStatus || '—';
  if (isCreate || !previousStatus) {
    return { text: `Estado: ${neu} (pedido registrado)`, htmlLabel: neu, prev: null };
  }
  const prev = statusLabel(previousStatus) || previousStatus;
  return {
    text: `Estado: ${prev} → ${neu}`,
    htmlLabel: `${escapeHtml(prev)} → <strong>${escapeHtml(neu)}</strong>`,
    prev,
  };
}

/**
 * Build es-MX HTML + text email for order create / status update.
 * @param {object} opts
 * @returns {{ subject: string, text: string, html: string }}
 */
function buildOrderStatusEmail(opts) {
  const portalName = opts.portalName || 'Hunters 547';
  const trackingCode = opts.trackingCode || '—';
  const purchaseOrder = opts.purchaseOrder || '';
  const customerName = opts.customerName || '';
  const items = opts.items || [];
  const newStatus = opts.newStatus || opts.status || '';
  const previousStatus = opts.previousStatus || null;
  const isCreate = Boolean(opts.isCreate) || newStatus === 'pedido_colocado' && !previousStatus;
  const createdAt = opts.createdAt || '';
  const updatedAt = opts.updatedAt || '';
  const trackUrl = opts.trackUrl || '';
  const mailFromDisplay = opts.mailFromDisplay || process.env.MAIL_FROM || '';

  const change = statusChangeLine(previousStatus, newStatus, isCreate);
  const greeting = customerName ? `Hola ${customerName},` : 'Hola,';

  let subject;
  if (isCreate) {
    subject = `${portalName}: Pedido ${trackingCode} registrado`;
  } else if (newStatus === 'entregado') {
    subject = `${portalName}: Pedido ${trackingCode} entregado`;
  } else if (newStatus === 'cancelado') {
    subject = `${portalName}: Pedido ${trackingCode} cancelado`;
  } else {
    subject = `${portalName}: Actualización pedido ${trackingCode}`;
  }

  const ocLine = purchaseOrder ? `Orden de compra (OC): ${purchaseOrder}` : '';
  const trackHint = trackUrl
    ? `Consulta el rastreo aquí: ${trackUrl}`
    : 'Consulta el estado en el portal de rastreo con tu número de pedido.';

  const textParts = [
    `${portalName}`,
    '',
    greeting,
    '',
    isCreate
      ? `Tu pedido ${trackingCode} fue registrado correctamente.`
      : `Hay una actualización de tu pedido ${trackingCode}.`,
    change.text,
    ocLine,
    createdAt ? `Fecha de registro: ${createdAt}` : '',
    updatedAt ? `Última actualización: ${updatedAt}` : '',
    '',
    'Materiales:',
    formatMaterialsText(items),
    '',
    trackHint,
    '',
    '—',
    mailFromDisplay
      ? `Te recomendamos agregar ${mailFromDisplay} a tu lista de contactos para que estos avisos no lleguen a spam.`
      : 'Te recomendamos agregar la dirección de este remitente a tu lista de contactos para que estos avisos no lleguen a spam.',
    `${portalName} · Notificaciones de pedido`,
  ].filter((line) => line !== '');

  const text = textParts.join('\n');

  const html = `<!DOCTYPE html>
<html lang="es-MX">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#232323">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
        <tr>
          <td style="background:#232323;padding:18px 24px">
            <div style="color:#84BD00;font-size:18px;font-weight:700;letter-spacing:.02em">${escapeHtml(portalName)}</div>
            <div style="color:#ccc;font-size:12px;margin-top:4px">Notificación de pedido</div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px">
            <p style="margin:0 0 12px;font-size:15px">${escapeHtml(greeting)}</p>
            <p style="margin:0 0 16px;font-size:15px;line-height:1.45">
              ${
                isCreate
                  ? `Tu pedido <strong>${escapeHtml(trackingCode)}</strong> fue registrado correctamente.`
                  : `Hay una actualización de tu pedido <strong>${escapeHtml(trackingCode)}</strong>.`
              }
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin-bottom:18px">
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #eee;color:#666;width:40%">Núm. de pedido</td>
                <td style="padding:8px 0;border-bottom:1px solid #eee"><strong>${escapeHtml(trackingCode)}</strong></td>
              </tr>
              ${
                purchaseOrder
                  ? `<tr>
                <td style="padding:8px 0;border-bottom:1px solid #eee;color:#666">Orden de compra (OC)</td>
                <td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHtml(purchaseOrder)}</td>
              </tr>`
                  : ''
              }
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #eee;color:#666">Estado</td>
                <td style="padding:8px 0;border-bottom:1px solid #eee">${change.htmlLabel}</td>
              </tr>
              ${
                createdAt
                  ? `<tr>
                <td style="padding:8px 0;border-bottom:1px solid #eee;color:#666">Fecha de registro</td>
                <td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHtml(createdAt)}</td>
              </tr>`
                  : ''
              }
              ${
                updatedAt
                  ? `<tr>
                <td style="padding:8px 0;border-bottom:1px solid #eee;color:#666">Última actualización</td>
                <td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHtml(updatedAt)}</td>
              </tr>`
                  : ''
              }
            </table>
            <p style="margin:0 0 8px;font-size:14px;font-weight:600">Materiales</p>
            <div style="margin-bottom:18px">${formatMaterialsHtml(items)}</div>
            ${
              trackUrl
                ? `<p style="margin:0 0 8px;font-size:14px">
              <a href="${escapeHtml(trackUrl)}" style="display:inline-block;background:#84BD00;color:#232323;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:6px">Ver rastreo</a>
            </p>
            <p style="margin:0;font-size:12px;color:#888">O copia este enlace: ${escapeHtml(trackUrl)}</p>`
                : `<p style="margin:0;font-size:13px;color:#555">Consulta el estado en el portal de rastreo con tu número de pedido.</p>`
            }
          </td>
        </tr>
        <tr>
          <td style="background:#f7f7f7;padding:16px 24px;border-top:1px solid #eee;font-size:12px;color:#666;line-height:1.5">
            <p style="margin:0 0 8px">
              ${
                mailFromDisplay
                  ? `Te recomendamos agregar <strong>${escapeHtml(mailFromDisplay)}</strong> a tu lista de contactos para que estos avisos no lleguen a spam.`
                  : 'Te recomendamos agregar la dirección de este remitente a tu lista de contactos para que estos avisos no lleguen a spam.'
              }
            </p>
            <p style="margin:0">${escapeHtml(portalName)} · Notificaciones de pedido</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

module.exports = {
  buildOrderStatusEmail,
  statusLabel,
  formatMaterialsText,
};
