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
  smtpFromAddress,
  DEFAULT_SMTP_FROM,
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
  assert.match(created.text, /info@hunters547\.cloud/);

  const mid = buildOrderMessage({ tracking_code: 'H547-TEST01', status: 'en_camino' });
  assert.match(mid.text, /En camino/);

  const done = buildOrderMessage({ tracking_code: 'H547-TEST01', status: 'entregado' });
  assert.match(done.text, /Entregado/);
  assert.match(done.text, /Gracias/);

  const cancel = buildOrderMessage({ tracking_code: 'H547-TEST01', status: 'cancelado' });
  assert.match(cancel.text, /Cancelado/);
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

test('SMTP_FROM habilita envío; MAIL_FROM es alias; From por defecto hunters547.cloud', () => {
  assert.equal(hasSmtpCreds(), false);
  assert.equal(smtpFrom(), DEFAULT_SMTP_FROM);
  assert.equal(smtpFromAddress(), 'info@hunters547.cloud');

  process.env.SMTP_HOST = 'smtp.hostinger.com';
  assert.equal(hasSmtpCreds(), true);
  assert.equal(smtpFrom(), DEFAULT_SMTP_FROM);

  process.env.MAIL_FROM = '  info@hunters547.cloud  ';
  assert.equal(hasSmtpCreds(), true);
  assert.equal(smtpFrom(), 'info@hunters547.cloud');

  process.env.SMTP_FROM = 'Hunters 547 <info@hunters547.cloud>';
  assert.equal(hasSmtpCreds(), true);
  assert.equal(smtpFrom(), 'Hunters 547 <info@hunters547.cloud>');
  assert.equal(smtpFromAddress(), 'info@hunters547.cloud');
});

test('asunto usa la marca del portal', () => {
  const msg = buildOrderMessage(
    { tracking_code: 'H547-TEST01', status: 'pedido_colocado', customer_name: 'García' },
    { name: 'Logística Norte' }
  );
  assert.match(msg.subject, /Logística Norte/);
  assert.match(msg.text, /H547-TEST01/);
  assert.doesNotMatch(msg.text, /^Hunters 547:/);
  assert.match(msg.text, /info@hunters547\.cloud/);
});
