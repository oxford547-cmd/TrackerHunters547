'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DB_PATH } = require('./constants');

let db;

function getDb() {
  if (db) return db;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function now() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Suggested placeholder only — encargado must set tracking_code manually. */
function generateTrackingCode() {
  const hex = require('crypto').randomBytes(3).toString('hex').toUpperCase();
  const ymd = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  return `H547-${hex}-${ymd}`;
}

function hasColumn(d, table, column) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function addColumnIfMissing(d, table, column, sqlType) {
  if (!hasColumn(d, table, column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType}`);
  }
}

/**
 * Migrate orders.tracking_code from global UNIQUE to unique per portal_id.
 * Safe to re-run; no-op when already migrated.
 */
function migrateTrackingUniqueness(d) {
  const row = d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'").get();
  if (!row || !row.sql) return;
  const hasGlobalUnique = /tracking_code\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(row.sql);
  if (!hasGlobalUnique) {
    d.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_portal_tracking ON orders(portal_id, tracking_code)'
    );
    return;
  }

  d.exec('PRAGMA foreign_keys = OFF');
  const tx = d.transaction(() => {
    d.exec(`
      CREATE TABLE orders_mig (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tracking_code TEXT NOT NULL,
        customer_id INTEGER NULL,
        customer_name TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pedido_colocado',
        chofer_id INTEGER NULL,
        created_by INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        delivered_at TEXT NULL,
        portal_id INTEGER,
        purchase_order TEXT NOT NULL DEFAULT '',
        delivery_photo_path TEXT NULL,
        delivery_signature_path TEXT NULL,
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (chofer_id) REFERENCES users(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      );
      INSERT INTO orders_mig
        (id, tracking_code, customer_id, customer_name, phone, address, notes, status,
         chofer_id, created_by, created_at, updated_at, delivered_at, portal_id)
      SELECT id, tracking_code, customer_id, customer_name, phone, address, notes, status,
             chofer_id, created_by, created_at, updated_at, delivered_at, portal_id
      FROM orders;
      DROP TABLE orders;
      ALTER TABLE orders_mig RENAME TO orders;
      CREATE INDEX IF NOT EXISTS idx_orders_portal ON orders(portal_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_portal_tracking ON orders(portal_id, tracking_code);
    `);
  });
  tx();
  d.exec('PRAGMA foreign_keys = ON');
}

function ensureSchema() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS portals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      logo_path TEXT NULL,
      contact_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      whatsapp_number TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      name TEXT NOT NULL,
      cliente_id INTEGER NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (cliente_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tracking_code TEXT NOT NULL,
      customer_id INTEGER NULL,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pedido_colocado',
      chofer_id INTEGER NULL,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      delivered_at TEXT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (chofer_id) REFERENCES users(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS location_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      accuracy REAL NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      changed_by INTEGER NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );
  `);

  addColumnIfMissing(d, 'users', 'portal_id', 'INTEGER');
  addColumnIfMissing(d, 'orders', 'portal_id', 'INTEGER');
  addColumnIfMissing(d, 'customers', 'portal_id', 'INTEGER');
  addColumnIfMissing(d, 'customers', 'notes', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(d, 'customers', 'active', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(d, 'customers', 'email', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(d, 'portals', 'whatsapp_number', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(d, 'orders', 'purchase_order', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(d, 'orders', 'delivery_photo_path', 'TEXT NULL');
  addColumnIfMissing(d, 'orders', 'delivery_signature_path', 'TEXT NULL');

  d.exec(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      uom TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

    CREATE INDEX IF NOT EXISTS idx_users_portal ON users(portal_id);
    CREATE INDEX IF NOT EXISTS idx_orders_portal ON orders(portal_id);
    CREATE INDEX IF NOT EXISTS idx_customers_portal ON customers(portal_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
  `);

  migrateTrackingUniqueness(d);

  const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'portals');
  fs.mkdirSync(uploadDir, { recursive: true });
  const deliveryDir = path.join(__dirname, '..', 'public', 'uploads', 'deliveries');
  fs.mkdirSync(deliveryDir, { recursive: true });
}

function loadOrderItems(orderId) {
  return getDb()
    .prepare(
      'SELECT id, order_id, description, uom, quantity FROM order_items WHERE order_id = ? ORDER BY id ASC'
    )
    .all(orderId);
}

/** Parse material lines from form body (arrays or single values). */
function parseOrderItemsFromBody(body) {
  const descriptions = [].concat(body.item_description || body['item_description[]'] || []);
  const uoms = [].concat(body.item_uom || body['item_uom[]'] || []);
  const qtys = [].concat(body.item_quantity || body['item_quantity[]'] || []);
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
    });
  }
  return items;
}

function insertOrderItems(orderId, items) {
  if (!items || !items.length) return;
  const stmt = getDb().prepare(
    'INSERT INTO order_items (order_id, description, uom, quantity) VALUES (?,?,?,?)'
  );
  const tx = getDb().transaction((rows) => {
    for (const it of rows) {
      stmt.run(orderId, it.description, it.uom, it.quantity);
    }
  });
  tx(items);
}

module.exports = {
  getDb,
  now,
  generateTrackingCode,
  ensureSchema,
  DB_PATH,
  loadOrderItems,
  parseOrderItemsFromBody,
  insertOrderItems,
};
