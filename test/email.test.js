'use strict';

delete process.env.SMTP_HOST;
delete process.env.SMTP_PORT;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.SMTP_FROM;
delete process.env.MAIL_FROM;

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
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
  EMAIL_LOGO_CID,
} = require('../src/services/email');
const { defaultLogoFile } = require('../src/uploads');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let tmpUploads;

beforeEach(() => {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_FROM;
  delete process.env.MAIL_FROM;
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.UPLOADS_DIR;
  tmpUploads = fs.mkdtempSync(path.join(os.tmpdir(), 'h547-email-uploads-'));
  process.env.UPLOADS_DIR = tmpUploads;
});

afterEach(() => {
  delete process.env.UPLOADS_DIR;
  try {
    fs.rmSync(tmpUploads, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
});

function writePortalLogo(portalId, filename, bytes) {
  const dest = path.join(tmpUploads, 'portals', String(portalId));
  fs.mkdirSync(dest, { recursive: true });
  const file = path.join(dest, filename);
  fs.writeFileSync(file, bytes || PNG_1X1);
  return file;
}

test('firstEmail toma el primer valor con @', () => {
  assert.equal(firstEmail('', 'no', 'a@b.com'), 'a@b.com');
  assert.equal(firstEmail('   '), null);
});

test('plantilla de creado / estado / entregado / cancelado (es)', async () => {
  const created = await buildOrderMessage({
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

  const mid = await buildOrderMessage({ tracking_code: 'H547-TEST01', status: 'en_camino' });
  assert.match(mid.text, /En camino/);
  assert.match(mid.html, /En camino/);

  const done = await buildOrderMessage({ tracking_code: 'H547-TEST01', status: 'entregado' });
  assert.match(done.text, /Entregado/);
  assert.match(done.text, /Gracias/);
  assert.match(done.html, /Gracias/);

  const cancel = await buildOrderMessage({ tracking_code: 'H547-TEST01', status: 'cancelado' });
  assert.match(cancel.text, /Cancelado/);
  assert.match(cancel.html, /Cancelado/);
});

test('HTML incluye detalles, rastreo, nota anti-spam y hunters547.com', async () => {
  process.env.PUBLIC_BASE_URL = 'https://www.hunters547.cloud';
  process.env.SMTP_FROM = 'info@hunters547.cloud';
  const logoFile = writePortalLogo(2, 'logo.png');
  const msg = await buildOrderMessage(
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
  assert.match(msg.html, new RegExp(`src="cid:${EMAIL_LOGO_CID}"`));
  assert.doesNotMatch(msg.html, /src="https:\/\/www\.hunters547\.cloud\/uploads\//);
  assert.equal(msg.attachments.length, 1);
  assert.equal(msg.attachments[0].cid, EMAIL_LOGO_CID);
  assert.equal(msg.attachments[0].contentDisposition, 'inline');
  assert.equal(msg.attachments[0].path, logoFile);
  assert.notEqual(msg.attachments[0].path, defaultLogoFile());
  assert.equal(msg.attachments[0].filename, 'logo.png');
  assert.match(
    msg.html,
    /href="https:\/\/www\.hunters547\.cloud\/rastreo\?codigo=H547-SMTP-838677"/
  );
  assert.match(msg.html, /agrega info@hunters547\.cloud a tus contactos/);
  assert.match(msg.html, new RegExp(`href="${HUNTERS_SITE_URL.replace(/\./g, '\\.')}"`));
});

test('portal con logo en disco usa CID del portal, no Hunters 547', async () => {
  const logoFile = writePortalLogo(2, 'logo.png');
  const msg = await buildOrderMessage(
    { tracking_code: 'H547-LOGO-840646', status: 'en_camino' },
    { name: 'Marca ACME', logo_path: '/uploads/portals/2/logo.png' }
  );
  assert.doesNotMatch(msg.html, /src="[^"]*\/uploads\//i);
  assert.doesNotMatch(msg.html, /src="https?:\/\//i);
  assert.match(msg.html, /alt="Marca ACME"/);
  assert.match(msg.html, new RegExp(`src="cid:${EMAIL_LOGO_CID}"`));
  assert.equal(msg.attachments.length, 1);
  assert.equal(msg.attachments[0].path, logoFile);
  assert.notEqual(msg.attachments[0].path, defaultLogoFile());
  assert.equal(msg.attachments[0].filename, 'logo.png');
});

test('logo_path ausente en disco y sin HTTP usa CID del logo Hunters 547', async () => {
  process.env.PUBLIC_BASE_URL = 'https://www.hunters547.cloud';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 404 });
  try {
    const msg = await buildOrderMessage(
      { tracking_code: 'H547-TEST01', status: 'confirmado' },
      { name: 'Marca ACME', logo_path: '/uploads/portals/2/logo.png' }
    );
    assert.doesNotMatch(msg.html, /src="[^"]*\/uploads\//i);
    assert.doesNotMatch(msg.html, /src="https?:\/\//i);
    assert.match(msg.html, /Marca ACME/);
    assert.match(msg.html, new RegExp(`src="cid:${EMAIL_LOGO_CID}"`));
    assert.equal(msg.attachments.length, 1);
    assert.equal(msg.attachments[0].path, defaultLogoFile());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sin logo_path tampoco pone img remota; CID del fallback si el archivo existe', async () => {
  process.env.PUBLIC_BASE_URL = 'https://www.hunters547.cloud';
  const msg = await buildOrderMessage(
    { tracking_code: 'H547-TEST01', status: 'confirmado' },
    { name: 'Marca ACME', logo_path: null }
  );
  assert.doesNotMatch(msg.html, /src="[^"]*\/uploads\//i);
  assert.match(msg.html, /Marca ACME/);
  assert.match(msg.html, new RegExp(`src="cid:${EMAIL_LOGO_CID}"`));
  assert.equal(msg.attachments[0].path, defaultLogoFile());
  assert.equal(msg.attachments[0].filename, 'hunters547-logo.jpg');
});

test('portalLogoSrc no construye URL pública a un /uploads inexistente', () => {
  assert.equal(portalLogoSrc({ name: 'X' }), `cid:${EMAIL_LOGO_CID}`);
  process.env.PUBLIC_BASE_URL = 'https://www.hunters547.cloud/';
  assert.equal(
    portalLogoSrc({ logo_path: '/uploads/portals/2/logo.png' }),
    `cid:${EMAIL_LOGO_CID}`
  );
  assert.equal(portalLogoSrc({ logo_path: 'https://cdn.example/logo.png' }), 'https://cdn.example/logo.png');
});

test('escapa HTML en campos del pedido', async () => {
  const msg = await buildOrderMessage(
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
  assert.equal(msg.attachments.length, 0);
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

test('asunto usa la marca del portal', async () => {
  const msg = await buildOrderMessage(
    { tracking_code: 'H547-TEST01', status: 'pedido_colocado', customer_name: 'García' },
    { name: 'Logística Norte' }
  );
  assert.match(msg.subject, /Logística Norte/);
  assert.match(msg.text, /H547-TEST01/);
  assert.doesNotMatch(msg.text, /^Hunters 547:/);
  assert.match(msg.html, /Logística Norte/);
});
