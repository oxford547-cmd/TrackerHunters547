'use strict';

delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_WHATSAPP_FROM;

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  toE164,
  buildOrderMessage,
  sendWhatsApp,
  notifyOrderStatus,
  resolveFromNumber,
} = require('../src/services/whatsapp');

const origFetch = global.fetch;

beforeEach(() => {
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_WHATSAPP_FROM;
  global.fetch = origFetch;
});

afterEach(() => {
  global.fetch = origFetch;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_WHATSAPP_FROM;
});

test('toE164 normaliza móviles MX a +52', () => {
  assert.equal(toE164('5512345678'), '+525512345678');
  assert.equal(toE164('55 1234 5678'), '+525512345678');
  assert.equal(toE164('+52 55 1234 5678'), '+525512345678');
  assert.equal(toE164('525512345678'), '+525512345678');
  assert.equal(toE164(''), null);
});

test('plantilla de creado / estado / entregado / cancelado (es)', () => {
  const created = buildOrderMessage({
    tracking_code: 'H547-TEST01',
    status: 'pedido_colocado',
    customer_name: 'García',
  });
  assert.match(created, /Hunters 547/);
  assert.match(created, /H547-TEST01/);
  assert.match(created, /registrado/);
  assert.match(created, /Pedido colocado/);
  assert.match(created, /García/);

  const mid = buildOrderMessage({
    tracking_code: 'H547-TEST01',
    status: 'en_camino',
  });
  assert.match(mid, /En camino/);
  assert.match(mid, /H547-TEST01/);

  const done = buildOrderMessage({
    tracking_code: 'H547-TEST01',
    status: 'entregado',
  });
  assert.match(done, /Entregado/);
  assert.match(done, /Gracias/);

  const cancel = buildOrderMessage({
    tracking_code: 'H547-TEST01',
    status: 'cancelado',
  });
  assert.match(cancel, /Cancelado/);
});

test('sin credenciales Twilio solo registra (no crashea)', async () => {
  const result = await notifyOrderStatus({
    tracking_code: 'H547-NOKEYS',
    status: 'confirmado',
    phone: '5512345678',
    customer_name: 'Demo',
  });
  assert.equal(result.ok, true);
  assert.equal(result.logged, true);
});

test('teléfono inválido no lanza', async () => {
  const result = await notifyOrderStatus({
    tracking_code: 'H547-NOPHONE',
    status: 'pedido_colocado',
    phone: '',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_phone');
});

test('mock fetch records Twilio call on status change', async () => {
  process.env.TWILIO_ACCOUNT_SID = 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  process.env.TWILIO_AUTH_TOKEN = 'test-token';
  process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+14155238886';

  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => ({ sid: 'SM123' }) };
  };

  const result = await notifyOrderStatus({
    tracking_code: 'H547-TEST01',
    status: 'en_camino',
    phone: '55 1234 5678',
    customer_name: 'García',
  });

  assert.equal(result.ok, true);
  assert.equal(result.sid, 'SM123');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /Accounts\/ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\/Messages\.json/);
  assert.equal(calls[0].opts.method, 'POST');
  assert.match(calls[0].opts.body, /whatsapp%3A%2B525512345678/);
  const decoded = decodeURIComponent(calls[0].opts.body.replace(/\+/g, ' '));
  assert.match(decoded, /H547-TEST01/);
  assert.match(decoded, /En camino/);
});

test('resolveFromNumber prefiere portals.whatsapp_number sobre TWILIO_WHATSAPP_FROM', () => {
  process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+14155238886';
  assert.equal(resolveFromNumber({ whatsapp_number: '5511112233' }), '+525511112233');
  assert.equal(resolveFromNumber({ whatsapp_number: '' }), '+14155238886');
  assert.equal(resolveFromNumber(null), '+14155238886');
});

test('buildOrderMessage usa la marca del portal cuando hay nombre', () => {
  const body = buildOrderMessage(
    { tracking_code: 'H547-TEST01', status: 'pedido_colocado', customer_name: 'García' },
    { name: 'Logística Norte' }
  );
  assert.match(body, /Logística Norte/);
  assert.match(body, /H547-TEST01/);
  assert.doesNotMatch(body, /^Hunters 547:/);
});

test('notifyOrderStatus usa FROM del portal en el POST a Twilio', async () => {
  process.env.TWILIO_ACCOUNT_SID = 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  process.env.TWILIO_AUTH_TOKEN = 'test-token';
  process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+14155238886';

  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => ({ sid: 'SM-PORTAL' }) };
  };

  const result = await notifyOrderStatus({
    tracking_code: 'H547-WA01',
    status: 'confirmado',
    phone: '5512345678',
    customer_name: 'García',
    portal: { name: 'Hunters 547 Demo', whatsapp_number: '5511112233' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.sid, 'SM-PORTAL');
  assert.equal(calls.length, 1);
  assert.match(calls[0].opts.body, /From=whatsapp%3A%2B525511112233/);
  const decoded = decodeURIComponent(calls[0].opts.body.replace(/\+/g, ' '));
  assert.match(decoded, /Hunters 547 Demo/);
});

test('sendWhatsApp usa el mock en create y entregado', async () => {
  process.env.TWILIO_ACCOUNT_SID = 'ACtest';
  process.env.TWILIO_AUTH_TOKEN = 'tok';
  process.env.TWILIO_WHATSAPP_FROM = '+14155238886';

  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => ({ sid: `SM${calls.length}` }) };
  };

  await notifyOrderStatus({
    tracking_code: 'H547-LIFE',
    status: 'pedido_colocado',
    phone: '5512345678',
  });
  await notifyOrderStatus({
    tracking_code: 'H547-LIFE',
    status: 'entregado',
    phone: '5512345678',
  });

  assert.equal(calls.length, 2);
  const b0 = decodeURIComponent(calls[0].opts.body.replace(/\+/g, ' '));
  const b1 = decodeURIComponent(calls[1].opts.body.replace(/\+/g, ' '));
  assert.match(b0, /registrado/);
  assert.match(b1, /Entregado/);
});
