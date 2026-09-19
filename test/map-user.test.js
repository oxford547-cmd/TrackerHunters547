'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mapUser, mapOrder, asBool01, isUniqueViolation } = require('../src/db');

test('mapUser expone customer_id y alias cliente_id', () => {
  const u = mapUser({
    id: '3',
    username: 'cliente',
    role: 'cliente',
    customer_id: '9',
    active: true,
    portal_id: '2',
  });
  assert.equal(u.id, 3);
  assert.equal(u.customer_id, 9);
  assert.equal(u.cliente_id, 9);
  assert.equal(u.active, 1);
  assert.equal(u.portal_id, 2);
});

test('mapUser acepta el alias de sesión cliente_id (columna live: customer_id)', () => {
  const u = mapUser({ id: 1, cliente_id: 4, active: false, portal_id: null });
  assert.equal(u.customer_id, 4);
  assert.equal(u.cliente_id, 4);
  assert.equal(u.active, 0);
});

test('mapOrder aplana chofer.name', () => {
  const o = mapOrder({
    id: 1,
    tracking_code: 'X',
    chofer: { name: 'Luis' },
    purchase_order: null,
  });
  assert.equal(o.chofer_name, 'Luis');
  assert.equal(o.purchase_order, '');
});

test('asBool01 y unique violation', () => {
  assert.equal(asBool01(true), 1);
  assert.equal(asBool01(0), 0);
  assert.equal(isUniqueViolation({ code: '23505' }), true);
  assert.equal(isUniqueViolation({ message: 'UNIQUE constraint' }), true);
  assert.equal(isUniqueViolation({ message: 'nope' }), false);
});
