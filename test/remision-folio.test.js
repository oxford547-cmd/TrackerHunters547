'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatFolio, previewNextFolio } = require('../src/parsers');
const { isUniqueViolation } = require('../src/db');

test('formatFolio rellena a 4 dígitos', () => {
  assert.equal(formatFolio(1), '0001');
  assert.equal(formatFolio(128), '0128');
  assert.equal(formatFolio(10000), '10000');
});

test('previewNextFolio usa el mayor entre remision_next y max folio + 1', () => {
  assert.equal(previewNextFolio(1, 0), 1);
  assert.equal(previewNextFolio(5, 2), 5);
  assert.equal(previewNextFolio(1, 9), 10);
  assert.equal(previewNextFolio(null, null), 1);
});

test('isUniqueViolation cubre Postgres 23505 y texto UNIQUE (folio por portal)', () => {
  assert.equal(isUniqueViolation({ code: '23505' }), true);
  assert.equal(isUniqueViolation({ message: 'duplicate key value violates unique constraint' }), true);
  assert.equal(isUniqueViolation({ message: 'UNIQUE constraint failed' }), true);
  assert.equal(isUniqueViolation({ message: 'ok' }), false);
});
