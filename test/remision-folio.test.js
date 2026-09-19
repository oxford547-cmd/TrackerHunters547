'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `h547-remision-folio-${process.pid}.sqlite`);
process.env.DB_PATH = tmpDb;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { ensureSchema, getDb, nextRemisionFolio, now } = require('../src/db');

after(() => {
  try {
    const d = getDb();
    if (d) d.close();
  } catch {
    /* ignore */
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(tmpDb + suffix);
    } catch {
      /* ignore */
    }
  }
});

function insertPortal(d, name, slug) {
  const ts = now();
  return d
    .prepare(
      `INSERT INTO portals (name, slug, logo_path, contact_name, phone, email, notes, active, created_at, whatsapp_number, address)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(name, slug, null, '', '', '', '', 1, ts, '', 'Calle Demo 1').lastInsertRowid;
}

test('nextRemisionFolio es consecutivo por portal y no se cruza', () => {
  ensureSchema();
  const d = getDb();
  const p1 = insertPortal(d, 'Portal A', 'portal-a');
  const p2 = insertPortal(d, 'Portal B', 'portal-b');

  assert.equal(nextRemisionFolio(p1), 1);
  assert.equal(nextRemisionFolio(p1), 2);
  assert.equal(nextRemisionFolio(p2), 1);
  assert.equal(nextRemisionFolio(p1), 3);

  const a = d.prepare('SELECT remision_next FROM portals WHERE id = ?').get(p1);
  const b = d.prepare('SELECT remision_next FROM portals WHERE id = ?').get(p2);
  assert.equal(a.remision_next, 4);
  assert.equal(b.remision_next, 2);
});

test('folio UNIQUE(portal_id, folio) permite el mismo número en otro portal', () => {
  ensureSchema();
  const d = getDb();
  const p1 = d.prepare("SELECT id FROM portals WHERE slug = 'portal-a'").get().id;
  const p2 = d.prepare("SELECT id FROM portals WHERE slug = 'portal-b'").get().id;
  const ts = now();
  const ins = d.prepare(
    `INSERT INTO remisiones
      (portal_id, folio, fecha, customer_name, company_name, company_address, company_logo_path,
       total_importe, total_cantidad, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  ins.run(p1, 100, '2026-09-19', 'Cliente A', 'Portal A', '', null, null, 1, null, ts);
  ins.run(p2, 100, '2026-09-19', 'Cliente B', 'Portal B', '', null, null, 1, null, ts);
  const rows = d.prepare('SELECT portal_id, folio FROM remisiones WHERE folio = 100 ORDER BY portal_id').all();
  assert.equal(rows.length, 2);
  assert.throws(
    () => ins.run(p1, 100, '2026-09-19', 'Dup', 'Portal A', '', null, null, 1, null, ts),
    /UNIQUE/
  );
});
