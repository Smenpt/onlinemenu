const fs = require('node:fs');
const path = require('node:path');
const { STATUSES } = require('./validate');

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    // Лучше не запуститься, чем молча начать с пустой базой.
    throw new Error(`Не удалось прочитать ${path.basename(file)}: ${error.message}`);
  }
}

function archive(file, archiveDir) {
  fs.mkdirSync(archiveDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.renameSync(file, path.join(archiveDir, `${stamp}-${path.basename(file)}`));
}

function toDish(item, images) {
  return {
    id: String(item.id),
    name: String(item.name),
    category: String(item.category),
    description: String(item.description ?? ''),
    price: Math.max(0, Math.round(Number(item.price) || 0)),
    emoji: String(item.emoji || '🍽️'),
    color: /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : '#e9eee4',
    tag: String(item.tag ?? ''),
    popular: Boolean(item.popular),
    image: String(item.image || '').startsWith('data:') ? images.resolve(item.image) : '',
  };
}

function toOrder(order) {
  const status = STATUSES.includes(order.status) ? order.status : 'closed';
  const closedAt = status === 'closed' ? order.closedAt || order.updatedAt || order.createdAt : null;
  return {
    id: String(order.id),
    table: Number(order.table),
    total: Math.round(Number(order.total) || 0),
    note: String(order.note ?? ''),
    source: order.source === 'admin' ? 'admin' : 'guest',
    status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt ?? null,
    closedAt,
    items: order.items.map(item => ({
      id: String(item.id),
      name: String(item.name),
      price: Math.round(Number(item.price) || 0),
      quantity: Math.round(Number(item.quantity) || 1),
    })),
  };
}

// Однократный перенос данных из старых menu.json и orders.json. Файлы не удаляются, а уходят в архив.
function importLegacyData(store, images, legacyDir, archiveDir) {
  const menuFile = path.join(legacyDir, 'menu.json');
  const ordersFile = path.join(legacyDir, 'orders.json');

  const menu = readJsonFile(menuFile);
  if (menu) {
    if (!store.dishes.count()) store.transaction(() => menu.forEach(item => store.dishes.insert(toDish(item, images))));
    archive(menuFile, archiveDir);
  }

  const orders = readJsonFile(ordersFile);
  if (orders) {
    if (!store.orders.count()) store.transaction(() => orders.forEach(order => store.orders.importLegacy(toOrder(order))));
    archive(ordersFile, archiveDir);
  }
}

module.exports = { importLegacyData };
