'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseRemisionItemsFromBody,
  parseOrderItemsFromBody,
  decorateRemision,
  companyAddressOf,
  sumCantidad,
  sumImporte,
} = require('../src/parsers');

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
  assert.deepEqual(items, [{ description: 'Tubo PVC', uom: 'PZ', quantity: 4, sort_order: 0 }]);
});

test('decorateRemision mapea columnas live logo_path/total', () => {
  const row = decorateRemision(
    {
      id: 1,
      folio: '7',
      logo_path: '/uploads/portals/2/logo.png',
      total: 150.5,
      creator: { name: 'Ana' },
    },
    [
      { cantidad: 2, importe: 50 },
      { cantidad: 3, importe: 100.5 },
    ]
  );
  assert.equal(row.folio, 7);
  assert.equal(row.logo_path, '/uploads/portals/2/logo.png');
  assert.equal(row.company_logo_path, '/uploads/portals/2/logo.png');
  assert.equal(row.total, 150.5);
  assert.equal(row.total_importe, 150.5);
  assert.equal(row.total_cantidad, 5);
  assert.equal(row.created_by_name, 'Ana');
});

test('decorateRemision usa remisiones.total (NOT NULL default 0) como fuente', () => {
  const row = decorateRemision({ folio: 1, total: 0, logo_path: null }, [
    { cantidad: 1, importe: 10 },
    { cantidad: 2, importe: 20 },
  ]);
  assert.equal(row.total_cantidad, 3);
  assert.equal(row.total_importe, 0);
  assert.equal(row.company_logo_path, null);
});

test('companyAddressOf prefiere address y cae a notes', () => {
  assert.equal(companyAddressOf({ address: 'Calle 1', notes: 'x' }), 'Calle 1');
  assert.equal(companyAddressOf({ address: '  ', notes: 'Nota dir' }), 'Nota dir');
  assert.equal(companyAddressOf(null), '');
});

test('sumCantidad / sumImporte ignoran importes vacíos', () => {
  const items = [
    { cantidad: 2, importe: null },
    { cantidad: 3, importe: 15 },
    { cantidad: 1, importe: '' },
  ];
  assert.equal(sumCantidad(items), 6);
  assert.equal(sumImporte(items), 15);
  assert.equal(sumImporte([{ cantidad: 1 }]), null);
});
