const { HttpError } = require('./http');

const MAX_ITEMS = 50;
const MAX_QUANTITY = 50;
const MAX_PRICE = 10_000_000;
const MAX_NOTE = 500;
const STATUSES = ['new', 'preparing', 'ready', 'served', 'closed'];

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function isTable(value, tables) {
  return Number.isInteger(value) && value >= 1 && value <= tables;
}

function parseDish(data) {
  const name = text(data.name, 80);
  const category = text(data.category, 40);
  const price = data.price === null || data.price === '' ? NaN : Number(data.price);
  if (!name || !category) throw new HttpError(400, 'Заполните название и категорию.');
  if (!Number.isInteger(price) || price < 0 || price > MAX_PRICE) throw new HttpError(400, 'Цена должна быть целым числом от 0.');
  return {
    name,
    category,
    price,
    description: text(data.description, 500),
    emoji: text(data.emoji, 16) || '🍽️',
    color: /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : '#e9eee4',
    tag: text(data.tag, 30),
    popular: data.popular === true,
  };
}

function parseOrderItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS) {
    throw new HttpError(400, 'Добавьте блюда в заказ.');
  }
  return items.map(item => {
    const id = text(item?.id, 100);
    const quantity = item?.quantity;
    if (!id || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new HttpError(400, `Количество каждого блюда: от 1 до ${MAX_QUANTITY}.`);
    }
    return { id, quantity };
  });
}

function parseOrder(data, tables) {
  if (!isTable(data.table, tables)) throw new HttpError(400, `Укажите столик от 1 до ${tables}.`);
  return { table: data.table, items: parseOrderItems(data.items), note: text(data.note, MAX_NOTE) };
}

function parseStatus(data) {
  if (!STATUSES.includes(data.status)) throw new HttpError(400, 'Недопустимый статус.');
  return data.status;
}

// Границы дня считаются в часовом поясе сервера, то есть самого кафе.
function dayRange(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) throw new HttpError(400, 'Укажите дату.');
  const [year, month, day] = match.slice(1).map(Number);
  const from = new Date(year, month - 1, day);
  if (from.getMonth() !== month - 1) throw new HttpError(400, 'Укажите дату.');
  const to = new Date(year, month - 1, day + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

module.exports = { parseDish, parseOrder, parseStatus, dayRange, isTable, STATUSES };
