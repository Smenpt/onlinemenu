export const fmt = value => `${new Intl.NumberFormat('ru-RU').format(value)} ₸`;

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ESCAPES[char]);

export function plural(count, one, few, many) {
  const tens = Math.abs(count) % 100;
  const units = tens % 10;
  if (tens > 10 && tens < 20) return `${count} ${many}`;
  if (units === 1) return `${count} ${one}`;
  if (units >= 2 && units <= 4) return `${count} ${few}`;
  return `${count} ${many}`;
}

export function normalizeSearch(value) {
  return String(value || '')
    .toLocaleLowerCase('ru')
    .replaceAll('ё', 'е')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}

// Поиск прощает опечатки: «борш» найдёт «Борщ».
export function matchesDish(name, query) {
  const target = normalizeSearch(name);
  const search = normalizeSearch(query);
  if (!search) return true;
  if (target.replaceAll(' ', '').includes(search.replaceAll(' ', ''))) return true;
  if (search.length < 3) return false;
  const allowed = Math.max(1, Math.floor(search.length * 0.3));
  return target.split(' ').some(word => editDistance(word.slice(0, search.length + allowed), search) <= allowed);
}

export const storage = {
  get(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Приватный режим или переполненное хранилище: работаем без сохранения.
    }
  },
};

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api(url, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером.');
  }
  const data = await response.json().catch(() => null);
  if (response.ok) return data;
  if (response.status === 401 && location.pathname.startsWith('/admin')) location.href = '/login';
  throw new ApiError(response.status, data?.error || 'Ошибка сервера.', data);
}

export function localDate(date = new Date()) {
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const dateTime = value => new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
export const timeOnly = value => new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export const STATUS_LABELS = { new: 'Новый', preparing: 'Готовится', ready: 'Готов', served: 'Выдан', closed: 'Закрыт' };

export function orderItemsHtml(items) {
  return items.map(item => `
    <li>
      <span>${esc(item.name)} <b>× ${esc(item.quantity)}</b></span>
      <strong>${fmt(item.price * item.quantity)}</strong>
    </li>`).join('');
}

// CSP запрещает атрибут style, поэтому цвет выставляется из кода.
export function applyColors(root) {
  root.querySelectorAll('[data-color]').forEach(element => {
    element.style.backgroundColor = element.dataset.color;
  });
}
