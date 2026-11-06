import { api, dateTime, esc, fmt, localDate, orderItemsHtml, plural } from '../shared.js';

const $ = selector => document.querySelector(selector);

function orderCard(order) {
  return `
    <article class="order-card">
      <header>
        <div>
          <span class="eyebrow">СТОЛИК №${esc(order.table)}</span>
          <h3>Заказ ${esc(order.id)}</h3>
        </div>
        <span class="order-status status-closed">Закрыт</span>
      </header>
      <ul>${orderItemsHtml(order.items)}</ul>
      ${order.note ? `<p class="order-note"><b>Комментарий:</b> ${esc(order.note)}</p>` : ''}
      <footer>
        <span>Закрыт: ${dateTime(order.closedAt || order.createdAt)}</span>
        <strong>${fmt(order.total)}</strong>
      </footer>
      <div class="order-actions">
        <button data-reopen="${esc(order.id)}">Вернуть в работу</button>
        <button class="danger" data-remove="${esc(order.id)}">Удалить</button>
      </div>
    </article>`;
}

export async function loadCash() {
  const date = $('#cash-date').value || localDate();
  $('#cash-date').value = date;
  try {
    const orders = await api(`/api/admin/orders?closedOn=${encodeURIComponent(date)}`);
    const total = orders.reduce((sum, order) => sum + order.total, 0);
    $('#cash-summary').textContent = `${plural(orders.length, 'заказ', 'заказа', 'заказов')} · выручка ${fmt(total)}`;
    $('#cash-orders').innerHTML = orders.map(orderCard).join('') || '<div class="empty-orders">За этот день закрытых заказов нет.</div>';
  } catch (error) {
    $('#cash-orders').innerHTML = `<div class="empty-orders">${esc(error.message)}</div>`;
  }
}

export function initCash() {
  $('#cash-date').addEventListener('change', loadCash);
  $('#cash-orders').addEventListener('click', async event => {
    const reopen = event.target.closest('[data-reopen]');
    const remove = event.target.closest('[data-remove]');
    try {
      if (reopen) {
        await api(`/api/admin/orders/${encodeURIComponent(reopen.dataset.reopen)}`, { method: 'PATCH', body: { status: 'served' } });
        await loadCash();
      }
      if (remove && confirm('Удалить заказ из истории? Отменить это нельзя.')) {
        await api(`/api/admin/orders/${encodeURIComponent(remove.dataset.remove)}`, { method: 'DELETE' });
        await loadCash();
      }
    } catch (error) {
      alert(error.message);
    }
  });
}
