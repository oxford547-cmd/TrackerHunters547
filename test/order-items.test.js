'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseOrderItemsFromBody } = require('../src/parsers');

test('parseOrderItemsFromBody lee arrays description/uom/quantity', () => {
  const items = parseOrderItemsFromBody({
    item_description: ['Varilla 3/8', 'Cemento'],
    item_uom: ['PZ', 'KG'],
    item_quantity: ['12', '50'],
  });
  assert.deepEqual(items, [
    { description: 'Varilla 3/8', uom: 'PZ', quantity: 12, sort_order: 0 },
    { description: 'Cemento', uom: 'KG', quantity: 50, sort_order: 1 },
  ]);
});

test('parseOrderItemsFromBody ignora líneas vacías y usa defaults', () => {
  const items = parseOrderItemsFromBody({
    'item_description[]': ['Solo desc', '', '  '],
    'item_uom[]': ['', '', ''],
    'item_quantity[]': ['', '', ''],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].description, 'Solo desc');
  assert.equal(items[0].uom, 'PZ');
  assert.equal(items[0].quantity, 1);
  assert.equal(items[0].sort_order, 0);
});

test('parseOrderItemsFromBody acepta valores sueltos (no array)', () => {
  const items = parseOrderItemsFromBody({
    item_description: 'Arena',
    item_uom: 'M3',
    item_quantity: '2.5',
  });
  assert.deepEqual(items, [{ description: 'Arena', uom: 'M3', quantity: 2.5, sort_order: 0 }]);
});
