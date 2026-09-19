'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseRemisionItemsFromBody,
  parseOrderItemsFromBody,
} = require('../src/db');

test('parseRemisionItemsFromBody lee cantidad/unidad/descripcion/lote/importe', () => {
  const items = parseRemisionItemsFromBody({
    item_cantidad: ['12', '50'],
    item_unidad: ['PZ', 'KG'],
    item_descripcion: ['Varilla 3/8', 'Cemento gris'],
    item_lote: ['L-2401', 'L-CEM09'],
    item_importe: ['960', '890'],
  });
  assert.deepEqual(items, [
    {
      cantidad: 12,
      unidad: 'PZ',
      descripcion: 'Varilla 3/8',
      lote: 'L-2401',
      importe: 960,
    },
    {
      cantidad: 50,
      unidad: 'KG',
      descripcion: 'Cemento gris',
      lote: 'L-CEM09',
      importe: 890,
    },
  ]);
});

test('parseRemisionItemsFromBody ignora líneas vacías y usa defaults', () => {
  const items = parseRemisionItemsFromBody({
    'item_cantidad[]': ['', '', '3'],
    'item_unidad[]': ['', '', ''],
    'item_descripcion[]': ['', '  ', 'Arena'],
    'item_lote[]': ['', '', ''],
    'item_importe[]': ['', '', ''],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].descripcion, 'Arena');
  assert.equal(items[0].unidad, 'PZ');
  assert.equal(items[0].cantidad, 3);
  assert.equal(items[0].lote, '');
  assert.equal(items[0].importe, null);
});

test('parseRemisionItemsFromBody acepta valores sueltos (no array)', () => {
  const items = parseRemisionItemsFromBody({
    item_cantidad: '2.5',
    item_unidad: 'M3',
    item_descripcion: 'Grava',
    item_lote: 'L-G1',
    item_importe: '120.5',
  });
  assert.deepEqual(items, [
    { cantidad: 2.5, unidad: 'M3', descripcion: 'Grava', lote: 'L-G1', importe: 120.5 },
  ]);
});

test('parseOrderItemsFromBody sigue disponible (materiales de pedido)', () => {
  const items = parseOrderItemsFromBody({
    item_description: ['Tubo PVC'],
    item_uom: ['PZ'],
    item_quantity: ['4'],
  });
  assert.deepEqual(items, [{ description: 'Tubo PVC', uom: 'PZ', quantity: 4 }]);
});
