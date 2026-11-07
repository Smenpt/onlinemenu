import { STATUS_LABELS, api, dateTime, esc, fmt, matchesDish, orderItemsHtml, plural, timeOnly } from '../shared.js';
import { notify, refreshStats } from './stats.js';

const POLL_MS = 5000;
const STATUS_BUTTONS = [['preparing', 'Готовится'], ['ready', 'Готов'], ['served', 'Выдать']];
const $ = selector => document.querySelector(selector);

let dishes = [];
let lastSnapshot = '';
let knownIds = null;
let freshIds = new Set();
const draft = new Map();

export function setDishes(list) {
  dishes = list;
  renderPicker();
  renderDraft();
}

export function setTableLimit(tables) {
  $('#manual-table').max = tables;
}

function orderBlock(order) {
  const buttons = STATUS_BUTTONS.map(([status, label]) => `
    <button data-order="${esc(order.id)}" data-status="${status}" ${order.status === status ? 'class="current" disabled' : ''}>${label}</button>`).join('');
  return `
    <section class="table-order-block status-line-${esc(order.status)} ${freshIds.has(order.id) ? 'fresh' : ''}">
      <div class="table-order-head">
        <strong>Заказ ${esc(order.id)}</strong>
        <span>${order.source === 'admin' ? 'Администратор' : 'Клиент'} · ${timeOnly(order.createdAt)}</span>
        <b class="order-status status-${esc(order.status)}">${esc(STATUS_LABELS[order.status] || order.status)}</b>
      </div>
      <ul>${orderItemsHtml(order.items)}</ul>
      ${order.note ? `<p class="order-note"><b>Комментарий:</b> ${esc(order.note)}</p>` : ''}
      <div class="order-actions">${buttons}</div>
    </section>`;
}

function renderTables(orders) {
  const tables = new Map();
  for (const order of orders) {
    if (!tables.has(order.table)) tables.set(order.table, []);
    tables.get(order.table).push(order);
  }
  $('#orders').innerHTML = [...tables].sort(([a], [b]) => a - b).map(([table, list]) => `
    <article class="order-card">
      <header>
        <div>
          <span class="eyebrow">СТОЛИК</span>
          <h3>Открыт с ${timeOnly(list[0].createdAt)} · ${plural(list.length, 'заказ', 'заказа', 'заказов')}</h3>
        </div>
        <span class="table-number-badge" aria-label="Столик ${esc(table)}">${esc(table)}</span>
      </header>
      <div class="table-orders">${list.map(orderBlock).join('')}</div>
      <footer>
        <span>${dateTime(list.at(-1).createdAt)} · последний заказ</span>
        <strong>${fmt(list.reduce((sum, order) => sum + order.total, 0))}</strong>
      </footer>
      <div class="order-actions">
        <button class="close-table" data-close-table="${esc(table)}">Закрыть столик</button>
      </div>
    </article>`).join('') || '<div class="empty-orders">Нет открытых столиков.</div>';
}

// Новые заказы подсвечиваются и озвучиваются, даже если открыта другая вкладка.
function detectNew(orders) {
  const ids = new Set(orders.map(order => order.id));
  if (knownIds) {
    const added = orders.filter(order => !knownIds.has(order.id) && order.source === 'guest');
    if (added.length) {
      freshIds = new Set([...freshIds, ...added.map(order => order.id)]);
      setTimeout(() => added.forEach(order => freshIds.delete(order.id)), 20_000);
      notify(added.length === 1 ? `Новый заказ: столик № ${added[0].table}` : `Новых заказов: ${added.length}`);
    }
  }
  knownIds = ids;
  const waiting = orders.filter(order => order.status === 'new').length;
  $('#orders-badge').textContent = waiting;
  $('#orders-badge').hidden = !waiting;
  document.title = waiting ? `(${waiting}) Админ-панель — Листва` : 'Админ-панель — Листва';
}

export async function loadOrders({ force = true } = {}) {
  const alert = $('#orders-alert');
  try {
    const orders = await api('/api/admin/orders');
    alert.hidden = true;
    $('#live-dot').classList.remove('offline');
    $('#live-dot').textContent = 'Онлайн';
    detectNew(orders);
    refreshStats(orders);
    const snapshot = JSON.stringify(orders) + [...freshIds].join();
    // Без изменений не перерисовываем: иначе кнопка под пальцем исчезнет посреди нажатия.
    if (force || snapshot !== lastSnapshot) renderTables(orders);
    lastSnapshot = snapshot;
  } catch (error) {
    alert.textContent = `${error.message} Данные на экране могут быть устаревшими.`;
    alert.hidden = false;
    $('#live-dot').classList.add('offline');
    $('#live-dot').textContent = 'Нет связи';
  }
}

function renderPicker() {
  const query = $('#manual-dish-query').value;
  const found = dishes.filter(dish => matchesDish(dish.name, query));
  $('#manual-dish-list').innerHTML = found.map(dish => `
    <button type="button" class="dish-picker-item" data-pick-dish="${esc(dish.id)}">
      <span>${esc(dish.name)}<small>${esc(dish.category)}</small></span>
      <b>${fmt(dish.price)}</b>
    </button>`).join('') || '<span class="dish-picker-empty">Ничего не найдено</span>';
}

function renderDraft() {
  const lines = [...draft].map(([id, quantity]) => ({ dish: dishes.find(item => item.id === id), quantity })).filter(line => line.dish);
  $('#manual-items').innerHTML = lines.map(({ dish, quantity }) => `
    <div class="manual-item" data-id="${esc(dish.id)}">
      <span>${esc(dish.name)}</span>
      <input type="number" min="1" max="50" value="${quantity}" aria-label="Количество">
      <b>${fmt(dish.price * quantity)}</b>
      <button type="button" aria-label="Убрать блюдо">×</button>
    </div>`).join('');
}

async function submitManualOrder(event) {
  event.preventDefault();
  const message = $('#manual-message');
  if (!draft.size) {
    message.textContent = 'Добавьте блюдо';
    return;
  }
  try {
    await api('/api/admin/orders', {
      method: 'POST',
      body: {
        table: Number($('#manual-table').value),
        note: $('#manual-note').value,
        items: [...draft].map(([id, quantity]) => ({ id, quantity })),
      },
    });
    event.target.reset();
    draft.clear();
    renderDraft();
    renderPicker();
    message.textContent = 'Заказ создан';
    await loadOrders();
  } catch (error) {
    message.textContent = error.message;
  }
}

async function runAction(button, action) {
  button.disabled = true;
  try {
    await action();
    await loadOrders();
  } catch (error) {
    button.disabled = false;
    alert(error.message);
  }
}

export function initOrders() {
  $('#manual-order-form').addEventListener('submit', submitManualOrder);
  $('#manual-dish-query').addEventListener('input', renderPicker);
  // Enter в поиске добавляет первое найденное блюдо, а не отправляет форму.
  $('#manual-dish-query').addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    $('#manual-dish-list [data-pick-dish]')?.click();
  });

  $('#manual-dish-list').addEventListener('click', event => {
    const button = event.target.closest('[data-pick-dish]');
    if (!button) return;
    const id = button.dataset.pickDish;
    draft.set(id, Math.min(50, (draft.get(id) || 0) + 1));
    renderDraft();
    $('#manual-dish-query').value = '';
    renderPicker();
  });

  $('#manual-items').addEventListener('click', event => {
    if (event.target.tagName !== 'BUTTON') return;
    draft.delete(event.target.closest('.manual-item').dataset.id);
    renderDraft();
  });
  $('#manual-items').addEventListener('change', event => {
    const row = event.target.closest('.manual-item');
    const quantity = Math.min(50, Math.max(1, Math.trunc(Number(event.target.value)) || 1));
    draft.set(row.dataset.id, quantity);
    renderDraft();
  });

  $('#orders').addEventListener('click', event => {
    const statusButton = event.target.closest('[data-status]');
    if (statusButton) {
      const { order, status } = statusButton.dataset;
      runAction(statusButton, () => api(`/api/admin/orders/${encodeURIComponent(order)}`, { method: 'PATCH', body: { status } }));
    }
    const closeButton = event.target.closest('[data-close-table]');
    if (closeButton && confirm(`Закрыть столик №${closeButton.dataset.closeTable}? Все его заказы перейдут в кассу.`)) {
      runAction(closeButton, () => api(`/api/admin/tables/${encodeURIComponent(closeButton.dataset.closeTable)}/close`, { method: 'POST' }));
    }
  });

  setInterval(() => loadOrders({ force: false }), POLL_MS);
}
