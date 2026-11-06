const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { HttpError } = require('./http');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS dishes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL CHECK (price >= 0),
    emoji TEXT NOT NULL DEFAULT '🍽️',
    color TEXT NOT NULL DEFAULT '#e9eee4',
    tag TEXT NOT NULL DEFAULT '',
    popular INTEGER NOT NULL DEFAULT 0,
    image TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    table_no INTEGER NOT NULL,
    total INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'guest',
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL,
    updated_at TEXT,
    closed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS order_items (
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    dish_id TEXT NOT NULL,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    PRIMARY KEY (order_id, position)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS orders_status ON orders(status, created_at);
  CREATE INDEX IF NOT EXISTS orders_closed ON orders(closed_at);
`;

// Без похожих символов (0/O, 1/I), чтобы номер можно было продиктовать.
const ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomOrderId() {
  const bytes = crypto.randomBytes(7);
  return `A${[...bytes].map(byte => ID_ALPHABET[byte % ID_ALPHABET.length]).join('')}`;
}

function toDish(row) {
  return { ...row, popular: Boolean(row.popular) };
}

function createStore(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  const itemsOf = db.prepare('SELECT dish_id AS id, name, price, quantity FROM order_items WHERE order_id = ? ORDER BY position');
  const orderById = db.prepare('SELECT * FROM orders WHERE id = ?');
  const insertItem = db.prepare('INSERT INTO order_items (order_id, position, dish_id, name, price, quantity) VALUES (?, ?, ?, ?, ?, ?)');
  const insertOrder = db.prepare(`
    INSERT INTO orders (id, table_no, total, note, source, status, created_at, updated_at, closed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertDish = db.prepare(`
    INSERT INTO dishes (id, name, category, description, price, emoji, color, tag, popular, image)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  function hydrate(row) {
    return {
      id: row.id,
      table: row.table_no,
      items: itemsOf.all(row.id).map(item => ({ ...item })),
      total: row.total,
      note: row.note,
      source: row.source,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at || undefined,
      closedAt: row.closed_at || undefined,
    };
  }

  const dishes = {
    list: () => db.prepare('SELECT * FROM dishes ORDER BY rowid').all().map(toDish),
    count: () => db.prepare('SELECT COUNT(*) AS n FROM dishes').get().n,
    get(id) {
      const row = db.prepare('SELECT * FROM dishes WHERE id = ?').get(id);
      return row ? toDish(row) : null;
    },
    insert(dish) {
      insertDish.run(dish.id, dish.name, dish.category, dish.description, dish.price, dish.emoji, dish.color, dish.tag, dish.popular ? 1 : 0, dish.image);
      return dish;
    },
    update(id, dish) {
      const result = db.prepare(`
        UPDATE dishes SET name = ?, category = ?, description = ?, price = ?, emoji = ?, color = ?, tag = ?, popular = ?, image = ?
        WHERE id = ?
      `).run(dish.name, dish.category, dish.description, dish.price, dish.emoji, dish.color, dish.tag, dish.popular ? 1 : 0, dish.image, id);
      return result.changes > 0;
    },
    remove: id => db.prepare('DELETE FROM dishes WHERE id = ?').run(id).changes > 0,
  };

  const orders = {
    count: () => db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,

    // Цена и название всегда берутся из меню: клиенту здесь не доверяем.
    create({ table, items, note, source }) {
      return transaction(() => {
        const merged = new Map();
        for (const item of items) merged.set(item.id, (merged.get(item.id) || 0) + item.quantity);

        const missing = [];
        const lines = [];
        for (const [id, quantity] of merged) {
          const dish = dishes.get(id);
          if (!dish) missing.push(id);
          else lines.push({ id, name: dish.name, price: dish.price, quantity });
        }
        if (missing.length) throw new HttpError(409, 'Некоторых блюд больше нет в меню.', { missing });

        let id = randomOrderId();
        while (orderById.get(id)) id = randomOrderId();

        const total = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
        const now = new Date().toISOString();
        insertOrder.run(id, table, total, note, source, 'new', now, null, null);
        lines.forEach((line, index) => insertItem.run(id, index, line.id, line.name, line.price, line.quantity));
        return hydrate(orderById.get(id));
      });
    },

    get(id) {
      const row = orderById.get(id);
      return row ? hydrate(row) : null;
    },
    active: () => db.prepare("SELECT * FROM orders WHERE status <> 'closed' ORDER BY created_at, id").all().map(hydrate),
    closedBetween: (from, to) => db.prepare(`
      SELECT * FROM orders WHERE status = 'closed' AND closed_at >= ? AND closed_at < ? ORDER BY closed_at DESC
    `).all(from, to).map(hydrate),

    setStatus(id, status) {
      const now = new Date().toISOString();
      const closedAt = status === 'closed' ? now : null;
      const result = db.prepare('UPDATE orders SET status = ?, updated_at = ?, closed_at = ? WHERE id = ?').run(status, now, closedAt, id);
      return result.changes ? hydrate(orderById.get(id)) : null;
    },
    closeTable(table) {
      const now = new Date().toISOString();
      const result = db.prepare(`
        UPDATE orders SET status = 'closed', updated_at = ?, closed_at = ? WHERE table_no = ? AND status <> 'closed'
      `).run(now, now, table);
      return { table, closed: Number(result.changes), closedAt: now };
    },
    remove: id => db.prepare('DELETE FROM orders WHERE id = ?').run(id).changes > 0,

    importLegacy(order) {
      insertOrder.run(order.id, order.table, order.total, order.note, order.source, order.status, order.createdAt, order.updatedAt, order.closedAt);
      order.items.forEach((item, index) => insertItem.run(order.id, index, item.id, item.name, item.price, item.quantity));
    },
  };

  const sessions = {
    add(hash, expiresAt) {
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
      db.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)').run(hash, expiresAt);
    },
    isValid: hash => Boolean(db.prepare('SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?').get(hash, Date.now())),
    remove: hash => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash),
  };

  return {
    dishes,
    orders,
    sessions,
    transaction,
    backupTo: file => db.prepare('VACUUM INTO ?').run(file),
    close: () => db.close(),
  };
}

module.exports = { createStore };
