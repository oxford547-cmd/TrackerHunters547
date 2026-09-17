'use strict';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { getDb, ensureSchema, now, DB_PATH } = require('./db');
const { daysAgoTs } = require('./portal');

function wipePortalUploads() {
  const root = path.join(__dirname, '..', 'public', 'uploads', 'portals');
  fs.mkdirSync(root, { recursive: true });
  for (const name of fs.readdirSync(root)) {
    if (name === '.gitkeep') continue;
    fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
}

function seed(force = false) {
  ensureSchema();
  const d = getDb();
  const count = d.prepare('SELECT COUNT(*) AS c FROM users').get().c;

  if (count > 0 && !force) {
    console.log('BD ya tiene usuarios; usa --force para reiniciar seed.');
    console.log('Ruta:', DB_PATH);
    return;
  }

  const tx = d.transaction(() => {
    if (force) {
      d.exec(`
        DELETE FROM location_updates;
        DELETE FROM status_history;
        DELETE FROM orders;
        DELETE FROM users;
        DELETE FROM customers;
        DELETE FROM portals;
      `);
      wipePortalUploads();
    }

    const ts = now();
    const hashEnc = bcrypt.hashSync('encargado123', 10);
    const hashCho = bcrypt.hashSync('chofer123', 10);
    const hashCli = bcrypt.hashSync('cliente123', 10);
    const hashSa = bcrypt.hashSync('superadmin123', 10);
    const hashNorte = bcrypt.hashSync('norte123', 10);

    const insPortal = d.prepare(
      `INSERT INTO portals (name, slug, logo_path, contact_name, phone, email, notes, active, created_at, whatsapp_number)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    );
    const portal1 = insPortal.run(
      'Hunters 547 Demo',
      'hunters-demo',
      null,
      'Ana Encargada',
      '5511112233',
      'demo@hunters547.com',
      'Portal demo por defecto. Conserva los usuarios históricos.',
      1,
      ts,
      '5511112233'
    ).lastInsertRowid;
    const portal2 = insPortal.run(
      'Logística Norte',
      'logistica-norte',
      null,
      'Roberto Sánchez',
      '8180001111',
      'norte@example.com',
      'Segundo portal para demostrar aislamiento multi-tenant.',
      1,
      ts,
      '8180001111'
    ).lastInsertRowid;

    const insCust = d.prepare(
      'INSERT INTO customers (name, phone, address, notes, active, created_at, portal_id) VALUES (?,?,?,?,?,?,?)'
    );
    const cust1 = insCust.run(
      'Cliente Demo García',
      '5512345678',
      'Av. Reforma 100, Col. Centro, CDMX',
      'Entregar en recepción',
      1,
      ts,
      portal1
    ).lastInsertRowid;
    const cust2 = insCust.run(
      'Otro Cliente Pérez',
      '5587654321',
      'Insurgentes Sur 200, CDMX',
      '',
      1,
      ts,
      portal1
    ).lastInsertRowid;
    const custN = insCust.run(
      'Cliente Norte López',
      '8185550101',
      'Av. Constitución 50, Monterrey, NL',
      'Horario 9–18 h',
      1,
      ts,
      portal2
    ).lastInsertRowid;

    const insUser = d.prepare(
      `INSERT INTO users (username, password_hash, role, name, cliente_id, active, created_at, portal_id)
       VALUES (?,?,?,?,?,?,?,?)`
    );
    insUser.run('superadmin', hashSa, 'superadmin', 'Super Admin H547', null, 1, ts, null);

    const encId = insUser.run(
      'encargado',
      hashEnc,
      'encargado',
      'Ana Encargada',
      null,
      1,
      ts,
      portal1
    ).lastInsertRowid;
    const choId = insUser.run(
      'chofer',
      hashCho,
      'chofer',
      'Luis Chofer',
      null,
      1,
      ts,
      portal1
    ).lastInsertRowid;
    insUser.run('chofer2', hashCho, 'chofer', 'María Chofer', null, 1, ts, portal1);
    insUser.run('cliente', hashCli, 'cliente', 'Demo García', cust1, 1, ts, portal1);
    insUser.run('cliente2', hashCli, 'cliente', 'Otro Pérez', cust2, 1, ts, portal1);

    const encN = insUser.run(
      'encnorte',
      hashNorte,
      'encargado',
      'Roberto Sánchez',
      null,
      1,
      ts,
      portal2
    ).lastInsertRowid;
    const choN = insUser.run(
      'chofernorte',
      hashCho,
      'chofer',
      'Elena Chofer Norte',
      null,
      1,
      ts,
      portal2
    ).lastInsertRowid;
    insUser.run('clientenorte', hashCli, 'cliente', 'Norte López', custN, 1, ts, portal2);

    const ymd = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const code1 = `H547-DEMO01-${ymd}`;
    const code2 = `H547-DEMO02-${ymd}`;
    const codeOther = `H547-OTRO01-${ymd}`;
    const codeLive = `H547-LIVE01-${ymd}`;
    const codeDone = `H547-DONE01-${ymd}`;
    const codeN1 = `H547-NTE01-${ymd}`;
    const codeN2 = `H547-NTE02-${ymd}`;
    const codeN3 = `H547-NTE03-${ymd}`;
    const codeN4 = `H547-NTE04-${ymd}`;

    const insOrd = d.prepare(
      `INSERT INTO orders
        (tracking_code, customer_id, customer_name, phone, address, notes, status, chofer_id, created_by, created_at, updated_at, delivered_at, portal_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );

    const o1 = insOrd.run(
      code1,
      cust1,
      'Cliente Demo García',
      '5512345678',
      'Av. Reforma 100, Col. Centro, CDMX',
      'Pedido demo 1 — avanzar a En camino y probar GPS',
      'pedido_colocado',
      choId,
      encId,
      ts,
      ts,
      null,
      portal1
    ).lastInsertRowid;

    const o2 = insOrd.run(
      code2,
      cust1,
      'Cliente Demo García',
      '5512345678',
      'Av. Reforma 100, Col. Centro, CDMX',
      'Pedido demo 2 del mismo cliente',
      'confirmado',
      choId,
      encId,
      ts,
      ts,
      null,
      portal1
    ).lastInsertRowid;

    const oOther = insOrd.run(
      codeOther,
      cust2,
      'Otro Cliente Pérez',
      '5587654321',
      'Insurgentes Sur 200, CDMX',
      'Pedido de OTRO cliente — el portal cliente NO debe verlo',
      'en_preparacion',
      choId,
      encId,
      ts,
      ts,
      null,
      portal1
    ).lastInsertRowid;

    const ts3 = daysAgoTs(3);
    const oLive = insOrd.run(
      codeLive,
      cust1,
      'Cliente Demo García',
      '5512345678',
      'Av. Reforma 100, Col. Centro, CDMX',
      'Pedido en camino (seed) para mapa / GPS',
      'en_camino',
      choId,
      encId,
      ts3,
      ts,
      null,
      portal1
    ).lastInsertRowid;

    const ts5 = daysAgoTs(5);
    const oDone = insOrd.run(
      codeDone,
      cust2,
      'Otro Cliente Pérez',
      '5587654321',
      'Insurgentes Sur 200, CDMX',
      'Pedido entregado de demostración',
      'entregado',
      choId,
      encId,
      ts5,
      ts5,
      ts5,
      portal1
    ).lastInsertRowid;

    const oN1 = insOrd.run(
      codeN1,
      custN,
      'Cliente Norte López',
      '8185550101',
      'Av. Constitución 50, Monterrey, NL',
      'Pedido Norte — no visible en portal demo',
      'pedido_colocado',
      choN,
      encN,
      ts,
      ts,
      null,
      portal2
    ).lastInsertRowid;

    const ts2 = daysAgoTs(2);
    const oN2 = insOrd.run(
      codeN2,
      custN,
      'Cliente Norte López',
      '8185550101',
      'Av. Constitución 50, Monterrey, NL',
      'En camino Norte',
      'en_camino',
      choN,
      encN,
      ts2,
      ts,
      null,
      portal2
    ).lastInsertRowid;

    const ts4 = daysAgoTs(4);
    const oN3 = insOrd.run(
      codeN3,
      custN,
      'Cliente Norte López',
      '8185550101',
      'Av. Constitución 50, Monterrey, NL',
      'Entregado Norte',
      'entregado',
      choN,
      encN,
      ts4,
      ts4,
      ts4,
      portal2
    ).lastInsertRowid;

    const ts6 = daysAgoTs(6);
    const oN4 = insOrd.run(
      codeN4,
      custN,
      'Cliente Norte López',
      '8185550101',
      'Av. Constitución 50, Monterrey, NL',
      'Cancelado Norte',
      'cancelado',
      null,
      encN,
      ts6,
      ts6,
      null,
      portal2
    ).lastInsertRowid;

    const hist = d.prepare(
      'INSERT INTO status_history (order_id, status, changed_by, notes, created_at) VALUES (?,?,?,?,?)'
    );
    hist.run(o1, 'pedido_colocado', encId, 'Pedido de demostración', ts);
    hist.run(o2, 'pedido_colocado', encId, 'Creado', ts);
    hist.run(o2, 'confirmado', encId, 'Confirmado', ts);
    hist.run(oOther, 'pedido_colocado', encId, 'Creado', ts);
    hist.run(oOther, 'confirmado', encId, 'Confirmado', ts);
    hist.run(oOther, 'en_preparacion', encId, 'En preparación', ts);
    hist.run(oLive, 'pedido_colocado', encId, 'Creado', ts3);
    hist.run(oLive, 'en_camino', encId, 'En camino', ts);
    hist.run(oDone, 'pedido_colocado', encId, 'Creado', ts5);
    hist.run(oDone, 'entregado', choId, 'Entregado', ts5);
    hist.run(oN1, 'pedido_colocado', encN, 'Creado Norte', ts);
    hist.run(oN2, 'pedido_colocado', encN, 'Creado', ts2);
    hist.run(oN2, 'en_camino', encN, 'En camino', ts);
    hist.run(oN3, 'pedido_colocado', encN, 'Creado', ts4);
    hist.run(oN3, 'entregado', choN, 'Entregado', ts4);
    hist.run(oN4, 'pedido_colocado', encN, 'Creado', ts6);
    hist.run(oN4, 'cancelado', encN, 'Cancelado', ts6);

    return { code1, code2, codeOther, codeLive, codeDone, codeN1, portal1, portal2 };
  });

  const codes = tx();
  console.log('BD inicializada:', DB_PATH);
  console.log('Usuarios demo:');
  console.log('  superadmin   / superadmin123   (agencia — todos los portales)');
  console.log('  encargado    / encargado123    (portal Hunters 547 Demo)');
  console.log('  chofer       / chofer123');
  console.log('  cliente      / cliente123      (ve solo pedidos de Cliente Demo García)');
  console.log('  cliente2     / cliente123      (ve solo pedidos de Otro Cliente Pérez)');
  console.log('  encnorte     / norte123        (portal Logística Norte — aislamiento)');
  console.log('  chofernorte  / chofer123');
  console.log('  clientenorte / cliente123');
  console.log('Pedidos demo cliente:', codes.code1, codes.code2);
  console.log('Pedido otro cliente (aislamiento):', codes.codeOther);
  console.log('Portal 2 (no visible para encargado demo):', codes.codeN1);
}

if (require.main === module) {
  const force = process.argv.includes('--force');
  seed(force);
}

module.exports = { seed };
