'use strict';

delete process.env.SMTP_HOST;
delete process.env.SMTP_PORT;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.MAIL_FROM;
delete process.env.SMTP_SECURE;
delete process.env.PUBLIC_BASE_URL;

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const {
  hasSmtpConfig,
  isValidEmail,
  sendMail,
  notifyOrderStatus,
  publicTrackUrl,
  mailFromDisplay,
} = require('../src/services/mailer');
const { buildOrderStatusEmail } = require('../src/services/emailTemplates');

const origCreateTransport = nodemailer.createTransport;

beforeEach(() => {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.MAIL_FROM;
  delete process.env.SMTP_SECURE;
  delete process.env.PUBLIC_BASE_URL;
  nodemailer.createTransport = origCreateTransport;
});

afterEach(() => {
  nodemailer.createTransport = origCreateTransport;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.MAIL_FROM;
  delete process.env.SMTP_SECURE;
  delete process.env.PUBLIC_BASE_URL;
});

test('isValidEmail acepta correos prácticos y rechaza basura', () => {
  assert.equal(isValidEmail('demo.garcia@example.com'), true);
  assert.equal(isValidEmail('  a.b@dominio.mx  '), true);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail('solo-telefono'), false);
  assert.equal(isValidEmail('sin@dominio'), false);
});

test('sin SMTP_* / MAIL_FROM solo registra (no crashea)', async () => {
  assert.equal(hasSmtpConfig(), false);
  const result = await notifyOrderStatus({
    tracking_code: 'H547-NOKEYS',
    status: 'confirmado',
    email: 'demo.garcia@example.com',
    customer_name: 'García',
  });
  assert.equal(result.ok, true);
  assert.equal(result.logged, true);
});

test('sin email del cliente se omite (teléfono solo)', async () => {
  const result = await notifyOrderStatus({
    tracking_code: 'H547-NOMAIL',
    status: 'pedido_colocado',
    is_create: true,
    phone: '5512345678',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'no_email');
});

test('email inválido no lanza', async () => {
  const result = await sendMail({
    to: 'no-es-correo',
    subject: 'x',
    text: 'x',
    html: '<p>x</p>',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_email');
});

test('plantilla create / avance / cancel / entregado incluye pedido, estado y pie de contactos', () => {
  const created = buildOrderStatusEmail({
    portalName: 'Hunters 547 Demo',
    trackingCode: 'H547-TEST01',
    purchaseOrder: 'OC-99',
    items: [{ description: 'Caja A', uom: 'PZ', quantity: 2 }],
    newStatus: 'pedido_colocado',
    isCreate: true,
    customerName: 'García',
    mailFromDisplay: 'noreply@example.com',
    trackUrl: 'https://pedidos.example.com/rastreo?codigo=H547-TEST01',
  });
  assert.match(created.subject, /H547-TEST01/);
  assert.match(created.subject, /registrado/);
  assert.match(created.text, /García/);
  assert.match(created.text, /OC-99/);
  assert.match(created.text, /Caja A/);
  assert.match(created.text, /Pedido colocado/);
  assert.match(created.text, /noreply@example.com/);
  assert.match(created.text, /contactos/);
  assert.match(created.html, /H547-TEST01/);
  assert.match(created.html, /agregar/);

  const mid = buildOrderStatusEmail({
    portalName: 'Hunters 547 Demo',
    trackingCode: 'H547-TEST01',
    previousStatus: 'confirmado',
    newStatus: 'en_camino',
    mailFromDisplay: 'noreply@example.com',
  });
  assert.match(mid.subject, /Actualización/);
  assert.match(mid.text, /Confirmado → En camino/);

  const done = buildOrderStatusEmail({
    portalName: 'Hunters 547 Demo',
    trackingCode: 'H547-TEST01',
    previousStatus: 'en_camino',
    newStatus: 'entregado',
    mailFromDisplay: 'noreply@example.com',
  });
  assert.match(done.subject, /entregado/);
  assert.match(done.text, /Entregado/);
  assert.match(done.text, /contactos/);

  const cancel = buildOrderStatusEmail({
    portalName: 'Hunters 547 Demo',
    trackingCode: 'H547-TEST01',
    previousStatus: 'en_preparacion',
    newStatus: 'cancelado',
    mailFromDisplay: 'noreply@example.com',
  });
  assert.match(cancel.subject, /cancelado/);
  assert.match(cancel.text, /Cancelado/);
});

test('publicTrackUrl y mailFromDisplay', () => {
  process.env.PUBLIC_BASE_URL = 'https://pedidos.example.com/';
  process.env.MAIL_FROM = 'Hunters 547 <noreply@example.com>';
  assert.equal(publicTrackUrl('H547-A'), 'https://pedidos.example.com/rastreo?codigo=H547-A');
  assert.equal(mailFromDisplay(), 'noreply@example.com');
});

test('mock nodemailer records SMTP send on status change', async () => {
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_PORT = '587';
  process.env.MAIL_FROM = 'Hunters 547 <noreply@example.com>';
  process.env.PUBLIC_BASE_URL = 'https://pedidos.example.com';

  const calls = [];
  nodemailer.createTransport = (opts) => {
    calls.push({ type: 'transport', opts });
    return {
      sendMail: async (msg) => {
        calls.push({ type: 'send', msg });
        return { messageId: 'mid-test-1' };
      },
    };
  };

  const result = await notifyOrderStatus({
    tracking_code: 'H547-MAIL01',
    status: 'en_camino',
    previous_status: 'en_preparacion',
    email: 'demo.garcia@example.com',
    customer_name: 'García',
    purchase_order: 'OC-10',
    items: [{ description: 'Pallet', uom: 'PZ', quantity: 1 }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.messageId, 'mid-test-1');
  const send = calls.find((c) => c.type === 'send');
  assert.ok(send);
  assert.equal(send.msg.to, 'demo.garcia@example.com');
  assert.match(send.msg.subject, /H547-MAIL01/);
  assert.match(send.msg.text, /En preparación → En camino/);
  assert.match(send.msg.text, /OC-10/);
  assert.match(send.msg.text, /Pallet/);
  assert.match(send.msg.text, /noreply@example.com/);
  assert.match(send.msg.html, /contactos|agregar/);
});

test('notifyOrderStatus usa el mock en create, avance, cancel y entregado', async () => {
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_PORT = '587';
  process.env.MAIL_FROM = 'noreply@example.com';

  const subjects = [];
  nodemailer.createTransport = () => ({
    sendMail: async (msg) => {
      subjects.push(msg.subject);
      return { messageId: `mid-${subjects.length}` };
    },
  });

  const base = {
    tracking_code: 'H547-LIFE',
    email: 'cliente@example.com',
    customer_name: 'García',
  };

  await notifyOrderStatus({ ...base, status: 'pedido_colocado', is_create: true });
  await notifyOrderStatus({
    ...base,
    status: 'confirmado',
    previous_status: 'pedido_colocado',
  });
  await notifyOrderStatus({
    ...base,
    status: 'cancelado',
    previous_status: 'confirmado',
  });
  await notifyOrderStatus({
    ...base,
    status: 'entregado',
    previous_status: 'en_camino',
  });

  assert.equal(subjects.length, 4);
  assert.match(subjects[0], /registrado/);
  assert.match(subjects[1], /Actualización/);
  assert.match(subjects[2], /cancelado/);
  assert.match(subjects[3], /entregado/);
});
