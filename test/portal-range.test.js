'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveDateRange } = require('../src/portal');

test('preset día cubre solo hoy (from inclusive, to exclusive mañana)', () => {
  const r = resolveDateRange('dia');
  const today = new Date();
  const ymd = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  assert.equal(r.preset, 'dia');
  assert.equal(r.from, `${ymd(today)} 00:00:00`);
  assert.equal(r.toExclusive, `${ymd(tomorrow)} 00:00:00`);
  assert.equal(r.toInclusive, ymd(today));
  assert.equal(r.label, 'Hoy');
});

test('preset semana son los últimos 7 días incluyendo hoy', () => {
  const r = resolveDateRange('semana');
  const now = new Date();
  const fromDate = new Date(now.getTime() - 6 * 86400000);
  const fromLocal = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  assert.equal(r.preset, 'semana');
  assert.equal(r.from, `${ymd(fromLocal)} 00:00:00`);
  assert.equal(r.toExclusive, `${ymd(tomorrow)} 00:00:00`);
  assert.equal(r.label, 'Últimos 7 días');
});

test('preset mes va del día 1 al siguiente mes exclusive', () => {
  const r = resolveDateRange('mes');
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  assert.equal(r.preset, 'mes');
  assert.equal(r.from, `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01 00:00:00`);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  assert.equal(
    r.toExclusive,
    `${end.getFullYear()}-${pad(end.getMonth() + 1)}-01 00:00:00`
  );
  assert.equal(r.label, 'Este mes');
});

test('preset año cubre el año calendario', () => {
  const r = resolveDateRange('anio');
  const y = new Date().getFullYear();
  assert.equal(r.preset, 'anio');
  assert.equal(r.from, `${y}-01-01 00:00:00`);
  assert.equal(r.toExclusive, `${y + 1}-01-01 00:00:00`);
  assert.equal(r.toInclusive, `${y}-12-31`);
});

test('rango custom usa from/to inclusive del día final', () => {
  const r = resolveDateRange('custom', '2026-09-01', '2026-09-17');
  assert.equal(r.preset, 'custom');
  assert.equal(r.from, '2026-09-01 00:00:00');
  assert.equal(r.toExclusive, '2026-09-18 00:00:00');
  assert.equal(r.toInclusive, '2026-09-17');
  assert.equal(r.label, '2026-09-01 → 2026-09-17');
});
