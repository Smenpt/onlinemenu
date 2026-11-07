import { api } from '../shared.js';
import { loadCash, initCash } from './cash.js';
import { initMenu, onMenuChange } from './menu.js';
import { initOrders, loadOrders, setDishes, setTableLimit } from './orders.js';
import { refreshStats } from './stats.js';
import { loadQr } from './qr.js';

const LOADERS = { orders: () => loadOrders(), cash: loadCash, qr: loadQr };

function showTab(name) {
  document.querySelectorAll('[data-tab]').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === name));
  document.querySelectorAll('[data-panel]').forEach(panel => {
    panel.hidden = panel.dataset.panel !== name;
  });
  LOADERS[name]?.();
}

document.querySelector('.admin-tabs').addEventListener('click', event => {
  const tab = event.target.closest('[data-tab]');
  if (tab) showTab(tab.dataset.tab);
});

document.querySelector('#logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  location.href = '/login';
});

onMenuChange(setDishes);
initOrders();
initCash();
initMenu();
api('/api/config').then(config => setTableLimit(config.tables)).catch(() => {});
loadOrders();
refreshStats();
