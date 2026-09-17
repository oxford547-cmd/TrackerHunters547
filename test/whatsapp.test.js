'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `h547-wa-${process.pid}-${Date.now()}.sqlite`);
process.env.DB_PATH = tmpDb;
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_WHATSAPP_FROM;
delete process.env.WHATSAPP_ENABLED;
delete process.env.WHATSAPP_PROVIDER;
delete process.env.PUBLIC_BASE_URL;
delete process.env.WHATSAPP_NOTIFY_CANCELADO;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMxE164, persistPhone } = require('../src/phone');
const { getDb, ensureSchema, now } = require('../src/db');
const wa = require('../src/services/whatsapp');

before(() => {
  ensureSchema();
});

after(() => {
  wa.resetWhatsAppForTests();
  try {
    const d = getDb();
    if (d) d.close();
  } catch (_) {
    /* ignore */
  }
  for (const p of [tmpDb, tmpDb + '-wal', tmpDb + '-shm']) {
    try {
      fs.unlinkSync(p);
    } catch (_) {
      /* ignore */
    }
  }
});

beforeEach(() => {
  wa.resetWhatsAppForTests();
  delete process.env.WHATSAPP_ENABLED;
  delete process.env.WHATSAPP_PROVIDER;
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.WHATSAPP_NOTIFY_CANCELADO;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_WHATSAPP_FROM;
});

test('normaliza móviles MX de 10 dígitos a E.164 +52', () => {
  assert.equal(normalizeMxE164('5512345678'), '+525512345678');
  assert.equal(normalizeMxE164('55 1234 5678'), '+525512345678');
  assert.equal(normalizeMxE164('(55) 1234-5678'), '+525512345678');
  assert.equal(normalizeMxE164('+52 55 1234 5678'), '+525512345678');
  assert.equal(normalizeMxE164('525512345678'), '+525512345678');
  assert.equal(normalizeMxE164('whatsapp:+525512345678'), '+525512345678');
});

test('quita prefijos legacy 044/045/01 y el 1 de móvil +521', () => {
  assert.equal(normalizeMxE164('0445512345678'), '+525512345678');
  assert.equal(normalizeMxE164('0455512345678'), '+525512345678');
  assert.equal(normalizeMxE164('015512345678'), '+525512345678');
  assert.equal(normalizeMxE164('+5215512345678'), '+525512345678');
  assert.equal(normalizeMxE164('5215512345678'), '+525512345678');
});

test('persistPhone guarda E.164 o el original si no se puede normalizar', () => {
  assert.equal(persistPhone('5512345678'), '+525512345678');
  assert.equal(persistPhone('  '), '');
  assert.equal(persistPhone('ext-12'), 'ext-12');
});

test('plantilla de creado incluye marca, número y estado', () => {
  const body = wa.buildOrderMessage({
    kind: 'created',
    brandName: 'Hunters 547 Demo',
    trackingCode: 'H547-TEST01',
    status: 'pedido_colocado',
  });
  assert.match(body, /Hunters 547 Demo/);
  assert.match(body, /H547-TEST01/);
  assert.match(body, /creado \/ registrado/);
  assert.match(body, /Pedido colocado/);
  assert.match(body, /Rastrea tu pedido/);
});

test('plantilla de estado y entregado (aviso final)', () => {
  const statusBody = wa.buildOrderMessage({
    kind: 'status',
    brandName: 'Logística Norte',
    trackingCode: 'H547-NTE',
    status: 'en_camino',
  });
  assert.match(statusBody, /Logística Norte/);
  assert.match(statusBody, /H547-NTE/);
  assert.match(statusBody, /En camino/);

  const done = wa.buildOrderMessage({
    kind: 'delivered',
    brandName: 'Hunters 547 Demo',
    trackingCode: 'H547-DONE',
    status: 'entregado',
  });
  assert.match(done, /entregado/);
  assert.match(done, /aviso final/i);
});

test('PUBLIC_BASE_URL entra en la pista de rastreo', () => {
  process.env.PUBLIC_BASE_URL = 'https://pedidos.example/app/';
  const hint = wa.trackingHint('H547-ABC');
  assert.equal(hint, 'Rastrea tu pedido aquí: https://pedidos.example/app/rastreo?codigo=H547-ABC');
});

test('mock provider records calls on status change', async () => {
  const calls = [];
  wa.setWhatsAppProvider(wa.createMemoryProvider(calls));

  const result = await wa.notifyOrderStatusChanged(
    {
      id: 9,
      tracking_code: 'H547-TEST01',
      phone: '55 1234 5678',
      portal_name: 'Hunters 547 Demo',
      portal_id: 1,
    },
    'en_camino'
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, '+525512345678');
  assert.match(calls[0].body, /Hunters 547 Demo/);
  assert.match(calls[0].body, /H547-TEST01/);
  assert.match(calls[0].body, /En camino/);
  assert.equal(calls[0].meta.status, 'en_camino');
  assert.equal(calls[0].meta.portalId, 1);
});

test('create + entregado + cancelado usan el mock y no se mezclan', async () => {
  const calls = [];
  wa.setWhatsAppProvider(wa.createMemoryProvider(calls));
  const order = {
    tracking_code: 'H547-LIFE',
    phone: '5512345678',
    portal_name: 'Hunters 547 Demo',
    portal_id: 3,
  };

  await wa.notifyOrderCreated({ ...order, status: 'pedido_colocado' });
  await wa.notifyOrderStatusChanged(order, 'confirmado');
  await wa.notifyOrderStatusChanged(order, 'entregado');
  await wa.notifyOrderStatusChanged(order, 'cancelado');

  assert.equal(calls.length, 4);
  assert.match(calls[0].body, /creado \/ registrado/);
  assert.match(calls[1].body, /Confirmado/);
  assert.match(calls[2].body, /entregado/);
  assert.match(calls[2].body, /aviso final/i);
  assert.match(calls[3].body, /cancelado/i);
});

test('WHATSAPP_NOTIFY_CANCELADO=false omite Cancelado', async () => {
  process.env.WHATSAPP_NOTIFY_CANCELADO = 'false';
  const calls = [];
  wa.setWhatsAppProvider(wa.createMemoryProvider(calls));
  const result = await wa.notifyOrderStatusChanged(
    { tracking_code: 'H547-CAN', phone: '5512345678', portal_name: 'Demo' },
    'cancelado'
  );
  assert.equal(result.skipped, 'cancelado');
  assert.equal(calls.length, 0);
});

test('sin teléfono o sin credenciales no lanza (solo log / skip)', async () => {
  wa.resetWhatsAppForTests();
  const skipped = await wa.notifyOrderCreated({
    tracking_code: 'H547-NOPHONE',
    phone: '',
    portal_name: 'Demo',
  });
  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, 'no_phone');

  const logged = await wa.notifyOrderStatusChanged(
    {
      tracking_code: 'H547-NOKEYS',
      phone: '5512345678',
      portal_name: 'Demo',
    },
    'confirmado'
  );
  assert.equal(logged.ok, true);
  assert.equal(logged.provider, 'log');
});

test('WHATSAPP_ENABLED=true sin keys no crashea', async () => {
  process.env.WHATSAPP_ENABLED = 'true';
  const result = await wa.notifyOrderStatusChanged(
    {
      tracking_code: 'H547-REQ',
      phone: '5512345678',
      portal_name: 'Demo',
    },
    'en_preparacion'
  );
  assert.equal(result.ok, true);
});

test('Twilio provider POST a Messages.json (fetch mock)', async () => {
  process.env.TWILIO_ACCOUNT_SID = 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  process.env.TWILIO_AUTH_TOKEN = 'test-token';
  process.env.TWILIO_WHATSAPP_FROM = '+14155238886';

  const fetches = [];
  wa.setWhatsAppFetch(async (url, opts) => {
    fetches.push({ url, opts });
    return { ok: true, json: async () => ({ sid: 'SM123' }) };
  });
  wa.setWhatsAppProvider(wa.createTwilioProvider());

  const result = await wa.notifyOrderStatusChanged(
    { tracking_code: 'H547-TW', phone: '+525512345678', portal_name: 'Demo' },
    'confirmado'
  );
  assert.equal(result.ok, true);
  assert.equal(fetches.length, 1);
  assert.match(fetches[0].url, /Accounts\/ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\/Messages\.json/);
  assert.equal(fetches[0].opts.method, 'POST');
  assert.match(fetches[0].opts.body, /whatsapp%3A%2B525512345678/);
});

function insertPortalOrder({ portalName, tracking, phone, otherPortal }) {
  const d = getDb();
  const ts = now();
  const portalId = d
    .prepare(
      `INSERT INTO portals (name, slug, contact_name, phone, email, notes, active, created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(portalName, `slug-${tracking.toLowerCase()}`, '', '', '', '', 1, ts).lastInsertRowid;

  const userId = d
    .prepare(
      `INSERT INTO users (username, password_hash, role, name, cliente_id, active, created_at, portal_id)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(`u-${tracking}`, 'x', 'encargado', 'Enc', null, 1, ts, portalId).lastInsertRowid;

  const orderId = d
    .prepare(
      `INSERT INTO orders
        (tracking_code, customer_id, customer_name, phone, address, notes, status, chofer_id, created_by, created_at, updated_at, portal_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(tracking, null, 'Cliente', phone, 'Calle 1', '', 'pedido_colocado', null, userId, ts, ts, portalId)
    .lastInsertRowid;

  return { portalId, orderId, otherPortal };
}

test('queueOrderNotification isola por portal_id y registra el cambio de estado', async () => {
  const a = insertPortalOrder({
    portalName: 'Portal A',
    tracking: 'H547-ISO-A',
    phone: '5511111111',
  });
  const b = insertPortalOrder({
    portalName: 'Portal B',
    tracking: 'H547-ISO-B',
    phone: '5522222222',
  });

  const calls = [];
  wa.setWhatsAppProvider(wa.createMemoryProvider(calls));

  const cross = await wa.queueOrderNotification({
    type: 'status',
    orderId: a.orderId,
    portalId: b.portalId,
    status: 'confirmado',
  });
  assert.equal(cross.skipped, 'not_found');
  assert.equal(calls.length, 0);

  const ok = await wa.queueOrderNotification({
    type: 'status',
    orderId: a.orderId,
    portalId: a.portalId,
    status: 'confirmado',
  });
  assert.equal(ok.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, '+525511111111');
  assert.match(calls[0].body, /Portal A/);
  assert.match(calls[0].body, /H547-ISO-A/);
  assert.match(calls[0].body, /Confirmado/);
  assert.equal(calls[0].meta.portalId, Number(a.portalId));
});
