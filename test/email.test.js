'use strict';

delete process.env.SMTP_HOST;
delete process.env.SMTP_PORT;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.SMTP_FROM;
delete process.env.MAIL_FROM;

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  firstEmail,
  buildOrderMessage,
  notifyOrderStatus,
  hasSmtpCreds,
  smtpFrom,
  formatFromHeader,
  extractEmail,
  escapeHtml,
  portalLogoSrc,
  FROM_DISPLAY_NAME,
  HUNTERS_SITE_URL,
} = require('../src/services/email');

beforeEach(() => {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_FROM;
  delete process.env.MAIL_FROM;
  delete process.env.PUBLIC_BASE_URL;
});

test('firstEmail toma el primer valor con @', () => {
  assert.equal(firstEmail('', 'no', 'a@b.com'), 'a@b.com');
  assert.equal(firstEmail('   '), null);
});

test('plantilla de creado / estado / entregado / cancelado (es)', () => {
  const created = buildOrderMessage({
    tracking_code: 'H547-TEST01',
    status: 'pedido_colocado',
    customer_name: 'García',
  });
  assert.match(created.subject, /H547-TEST01/);
  assert.match(created.text, /Hunters 547/);
  assert.match(created.text, /registrado/);
  assert.match(created.text, /Pedido colocado/);
  assert.match(created.text, /García/);
  assert.match(created.html, /García/);
  assert.match(created.html, /Pedido colocado/);

  const mid = buildOrderMessage({ tracking_code: 'H547-TEST01', status: 'en_camino' });
  assert.match(mid.text, /En camino/);
  assert.match(mid.html, /En camino/);

  const done = buildOrderMessage({ tracking_code: 'H547-TEST01', status: 'entregado' });
  assert.match(done.text, /Entregado/);
  assert.match(done.text, /Gracias/);
  assert.match(done.html, /Gracias/);

  const cancel = buildOrderMessage({ tracking_code: 'H547-TEST01', status: 'cancelado' });
  assert.match(cancel.text, /Cancelado/);
  assert.match(cancel.html, /Cancelado/);
});

test('HTML incluye detalles, rastreo, nota anti-spam y hunters547.com', () => {
  process.env.PUBLIC_BASE_URL = 'https://www.hunters547.cloud';
  process.env.SMTP_FROM = 'info@hunters547.cloud';
  const msg = buildOrderMessage(
    {
      tracking_code: 'H547-SMTP-838677',
      purchase_order: 'OC-99',
      customer_name: 'García',
      status: 'en_preparacion',
      previous_status: 'confirmado',
      created_at: '2026-09-19T17:20:00.000Z',
      updated_at: '2026-09-19T17:24:00.000Z',
      items: [{ description: 'Tubo PVC', uom: 'PZ', quantity: 10 }],
    },
    { name: 'Marca ACME', logo_path: '/uploads/portals/2/logo.png' }
  );

  assert.equal(msg.subject, 'Marca ACME: actualización de pedido H547-SMTP-838677');
  assert.match(msg.text, /Marca \/ portal: Marca ACME/);
  assert.match(msg.text, /Orden de compra: OC-99/);
  assert.match(msg.text, /Estado anterior: Confirmado/);
  assert.match(msg.text, /Estado actual: En preparación/);
  assert.match(msg.text, /Código de rastreo: H547-SMTP-838677/);
  assert.match(msg.text, /10 PZ · Tubo PVC/);
  assert.match(msg.text, /Rastreo: https:\/\/www\.hunters547\.cloud\/rastreo\?codigo=H547-SMTP-838677/);
  assert.match(msg.text, /agrega info@hunters547\.cloud a tus contactos/);
  assert.equal(msg.text.includes(HUNTERS_SITE_URL), true);

  assert.match(msg.html, /lang="es-MX"/);
  assert.match(msg.html, /Marca ACME/);
  assert.match(msg.html, /OC-99/);
  assert.match(msg.html, /Confirmado/);
  assert.match(msg.html, /En preparación/);
  assert.match(msg.html, /Tubo PVC/);
  assert.match(msg.html, /src="https:\/\/www\.hunters547\.cloud\/uploads\/portals\/2\/logo\.png"/);
  assert.match(
    msg.html,
    /href="https:\/\/www\.hunters547\.cloud\/rastreo\?codigo=H547-SMTP-838677"/
  );
  assert.match(msg.html, /agrega info@hunters547\.cloud a tus contactos/);
  assert.match(msg.html, new RegExp(`href="${HUNTERS_SITE_URL.replace(/\./g, '\\.')}"`));
});

test('sin logo de portal no pone img rota', () => {
  process.env.PUBLIC_BASE_URL = 'https://www.hunters547.cloud';
  const msg = buildOrderMessage(
    { tracking_code: 'H547-TEST01', status: 'confirmado' },
    { name: 'Marca ACME', logo_path: null }
  );
  assert.doesNotMatch(msg.html, /<img /i);
  assert.match(msg.html, /Marca ACME/);
});

test('portalLogoSrc solo absoluta si hay logo_path y base pública', () => {
  assert.equal(portalLogoSrc({ name: 'X' }), '');
  process.env.PUBLIC_BASE_URL = 'https://www.hunters547.cloud/';
  assert.equal(portalLogoSrc({ logo_path: '/uploads/portals/2/logo.png' }), 'https://www.hunters547.cloud/uploads/portals/2/logo.png');
  assert.equal(portalLogoSrc({ logo_path: 'https://cdn.example/logo.png' }), 'https://cdn.example/logo.png');
});

test('escapa HTML en campos del pedido', () => {
  const msg = buildOrderMessage(
    {
      tracking_code: 'H547-<xss>',
      customer_name: '<script>alert(1)</script>',
      purchase_order: 'OC&1',
      status: 'confirmado',
      items: [{ description: 'Arena <b>fina</b>', uom: 'M3', quantity: 2 }],
    },
    { name: 'Marca & Co', logo_path: 'https://cdn.example/a.png?x="y"' }
  );
  assert.match(msg.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(msg.html, /<script>alert\(1\)<\/script>/);
  assert.match(msg.html, /Marca &amp; Co/);
  assert.match(msg.html, /OC&amp;1/);
  assert.match(msg.html, /Arena &lt;b&gt;fina&lt;\/b&gt;/);
  assert.match(msg.html, /src="https:\/\/cdn\.example\/a\.png\?x=&quot;y&quot;"/);
});

test('From display name es exactamente Notificaciones', () => {
  assert.equal(FROM_DISPLAY_NAME, 'Notificaciones');
  assert.equal(extractEmail('Hunters 547 <info@hunters547.cloud>'), 'info@hunters547.cloud');
  assert.equal(
    formatFromHeader('Hunters 547 <info@hunters547.cloud>'),
    'Notificaciones <info@hunters547.cloud>'
  );
  assert.equal(formatFromHeader('info@hunters547.cloud'), 'Notificaciones <info@hunters547.cloud>');
  assert.equal(escapeHtml('a&b'), 'a&amp;b');
});

test('sin SMTP solo registra (no crashea)', async () => {
  const result = await notifyOrderStatus({
    tracking_code: 'H547-NOKEYS',
    status: 'confirmado',
    email: 'demo@example.com',
    customer_name: 'Demo',
    portal: { name: 'Hunters 547 Demo' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.logged, true);
});

test('email inválido no lanza', async () => {
  const result = await notifyOrderStatus({
    tracking_code: 'H547-NOMAIL',
    status: 'pedido_colocado',
    email: '',
    portal: { name: 'Demo' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_email');
});

test('SMTP_FROM habilita envío; MAIL_FROM es alias', () => {
  process.env.SMTP_HOST = 'smtp.hostinger.com';
  assert.equal(hasSmtpCreds(), false);
  assert.equal(smtpFrom(), '');

  process.env.MAIL_FROM = '  info@yourdomain  ';
  assert.equal(hasSmtpCreds(), true);
  assert.equal(smtpFrom(), 'info@yourdomain');

  process.env.SMTP_FROM = 'hello@yourdomain';
  assert.equal(hasSmtpCreds(), true);
  assert.equal(smtpFrom(), 'hello@yourdomain');
  assert.equal(formatFromHeader(smtpFrom()), 'Notificaciones <hello@yourdomain>');
});

test('asunto usa la marca del portal', () => {
  const msg = buildOrderMessage(
    { tracking_code: 'H547-TEST01', status: 'pedido_colocado', customer_name: 'García' },
    { name: 'Logística Norte' }
  );
  assert.match(msg.subject, /Logística Norte/);
  assert.match(msg.text, /H547-TEST01/);
  assert.doesNotMatch(msg.text, /^Hunters 547:/);
  assert.match(msg.html, /Logística Norte/);
});
