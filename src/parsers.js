'use strict';

function asList(value) {
  return [].concat(value == null ? [] : value);
}

/** Parse material lines from form body (arrays or single values). */
function parseOrderItemsFromBody(body) {
  const descriptions = asList(body.item_description || body['item_description[]'] || []);
  const uoms = asList(body.item_uom || body['item_uom[]'] || []);
  const qtys = asList(
    body.item_quantity || body['item_quantity[]'] || body.item_qty || body['item_qty[]'] || []
  );
  const items = [];
  const n = Math.max(descriptions.length, uoms.length, qtys.length);
  for (let i = 0; i < n; i++) {
    const description = String(descriptions[i] || '').trim();
    const uom = String(uoms[i] || '').trim();
    const qtyRaw = qtys[i];
    const quantity = qtyRaw === '' || qtyRaw == null ? NaN : Number(qtyRaw);
    if (!description && !uom && (qtyRaw === '' || qtyRaw == null)) continue;
    if (!description) continue;
    items.push({
      description,
      uom: uom || 'PZ',
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      sort_order: items.length,
    });
  }
  return items;
}

/** Parse remisión lines from form body. */
function parseRemisionItemsFromBody(body) {
  const cantidades = asList(body.item_cantidad || body['item_cantidad[]'] || []);
  const unidades = asList(body.item_unidad || body['item_unidad[]'] || []);
  const descripciones = asList(body.item_descripcion || body['item_descripcion[]'] || []);
  const lotes = asList(body.item_lote || body['item_lote[]'] || []);
  const importes = asList(body.item_importe || body['item_importe[]'] || []);
  const items = [];
  const n = Math.max(
    cantidades.length,
    unidades.length,
    descripciones.length,
    lotes.length,
    importes.length
  );
  for (let i = 0; i < n; i++) {
    const descripcion = String(descripciones[i] || '').trim();
    const unidad = String(unidades[i] || '').trim();
    const lote = String(lotes[i] || '').trim();
    const qtyRaw = cantidades[i];
    const impRaw = importes[i];
    const cantidad = qtyRaw === '' || qtyRaw == null ? NaN : Number(qtyRaw);
    let importe = null;
    if (impRaw !== '' && impRaw != null) {
      const nImp = Number(impRaw);
      if (Number.isFinite(nImp)) importe = nImp;
    }
    if (!descripcion && !unidad && !lote && (qtyRaw === '' || qtyRaw == null) && importe == null) {
      continue;
    }
    if (!descripcion) continue;
    items.push({
      cantidad: Number.isFinite(cantidad) && cantidad > 0 ? cantidad : 1,
      unidad: unidad || 'PZ',
      descripcion,
      lote,
      importe,
    });
  }
  return items;
}

function formatFolio(n) {
  return String(n == null ? '' : n).padStart(4, '0');
}

function companyAddressOf(portal) {
  if (!portal) return '';
  const addr = String(portal.address || '').trim();
  if (addr) return addr;
  return String(portal.notes || '').trim();
}

function todayLocalDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function previewNextFolio(remisionNext, maxFolio) {
  const fromCounter = Number(remisionNext) || 1;
  const fromMax = (Number(maxFolio) || 0) + 1;
  return Math.max(fromMax, fromCounter);
}

function sumCantidad(items) {
  return (items || []).reduce((s, it) => s + (Number(it.cantidad) || 0), 0);
}

function sumImporte(items) {
  let any = false;
  let sum = 0;
  for (const it of items || []) {
    if (it.importe == null || it.importe === '') continue;
    const n = Number(it.importe);
    if (!Number.isFinite(n)) continue;
    sum += n;
    any = true;
  }
  return any ? sum : null;
}

/** View helper: live remisiones.total → total_importe; qty total from items. */
function decorateRemision(row, items) {
  if (!row) return null;
  const list = items || [];
  const total =
    row.total != null && row.total !== '' ? Number(row.total) : sumImporte(list);
  return {
    ...row,
    folio: Number(row.folio),
    logo_path: row.logo_path || null,
    company_logo_path: row.logo_path || null,
    total,
    total_importe: total,
    total_cantidad: sumCantidad(list),
    created_by_name:
      row.created_by_name ||
      (row.creator && row.creator.name) ||
      null,
  };
}

module.exports = {
  parseOrderItemsFromBody,
  parseRemisionItemsFromBody,
  formatFolio,
  companyAddressOf,
  todayLocalDate,
  previewNextFolio,
  sumCantidad,
  sumImporte,
  decorateRemision,
};
