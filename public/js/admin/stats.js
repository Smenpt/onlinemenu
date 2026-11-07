import { api, fmt, localDate } from '../shared.js';

const $ = selector => document.querySelector(selector);
let audio;
let toastTimer;

function setStat(id, value) {
  const element = $(id);
  if (element.textContent === value) return;
  element.textContent = value;
  element.animate?.([{ opacity: 0.3, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 300 });
}

// Сводка дня: открытые столики и заказы приходят из опроса, выручка — из кассы за сегодня.
export async function refreshStats(activeOrders) {
  try {
    const [active, closed] = await Promise.all([
      activeOrders ?? api('/api/admin/orders'),
      api(`/api/admin/orders?closedOn=${localDate()}`),
    ]);
    const revenue = closed.reduce((sum, order) => sum + order.total, 0);
    setStat('#stat-tables', String(new Set(active.map(order => order.table)).size));
    setStat('#stat-active', String(active.length));
    setStat('#stat-revenue', fmt(revenue));
    setStat('#stat-average', closed.length ? fmt(Math.round(revenue / closed.length)) : '—');
  } catch {
    // Ошибку связи уже показывает вкладка заказов.
  }
}

function chime() {
  try {
    audio ??= new AudioContext();
    const now = audio.currentTime;
    [880, 1320].forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + index * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.18, now + index * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.16 + 0.3);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(now + index * 0.16);
      oscillator.stop(now + index * 0.16 + 0.32);
    });
  } catch {
    // Браузер может запретить звук до первого клика — это не ошибка.
  }
}

export function notify(message) {
  const toast = $('#admin-toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 5000);
  chime();
}
