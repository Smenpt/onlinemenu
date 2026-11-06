import { api, esc } from '../shared.js';

const $ = selector => document.querySelector(selector);

export async function loadQr() {
  try {
    const { base, tables } = await api('/api/admin/qr');
    $('#qr-base').textContent = base;
    $('#qr-warning').hidden = !/\/\/(localhost|127\.)/.test(base);
    $('#qr-list').innerHTML = tables.map(({ table, url }) => `
      <figure class="qr-tile">
        <img src="/api/admin/qr/${table}.svg" alt="QR-код столика ${table}" loading="lazy">
        <figcaption>Столик №${table}</figcaption>
        <a href="${esc(url)}" target="_blank" rel="noopener">Открыть ссылку</a>
      </figure>`).join('');
  } catch (error) {
    $('#qr-list').innerHTML = `<div class="empty-orders">${esc(error.message)}</div>`;
  }
}

document.querySelector('#qr-print').addEventListener('click', () => window.print());
