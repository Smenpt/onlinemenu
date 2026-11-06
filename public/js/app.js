import { STATUS_LABELS, api, applyColors, esc, fmt, matchesDish, plural, storage } from './shared.js';

const TABLE_TTL_MS = 4 * 60 * 60 * 1000;
const MY_ORDERS_TTL_MS = 8 * 60 * 60 * 1000;
const STATUS_POLL_MS = 15_000;
const POPULAR = 'Популярное';
const ALL = 'Все блюда';

const $ = selector => document.querySelector(selector);

const state = {
  dishes: [],
  config: null,
  loaded: false,
  category: ALL,
  search: '',
  cart: readCart(),
  table: readTable(),
  myOrders: readMyOrders(),
};

function readCart() {
  const raw = storage.get('cafe-cart', {});
  if (typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([, quantity]) => Number.isInteger(quantity) && quantity > 0));
}

// Столик приходит из QR-кода. В браузере он живёт недолго: через день гость уже сидит за другим.
function readTable() {
  const params = new URLSearchParams(location.search);
  const table = Number(params.get('table'));
  const token = params.get('t');
  if (Number.isInteger(table) && table > 0 && token) {
    const scanned = { table, token, at: Date.now() };
    storage.set('cafe-table', scanned);
    return scanned;
  }
  const saved = storage.get('cafe-table', null);
  return saved?.table && saved.token && Date.now() - saved.at < TABLE_TTL_MS ? saved : null;
}

function readMyOrders() {
  const saved = storage.get('cafe-my-orders', []);
  return Array.isArray(saved) ? saved.filter(order => Date.now() - order.at < MY_ORDERS_TTL_MS) : [];
}

let toastTimer;
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 3000);
}

function visibleDishes() {
  if (state.search.trim()) return state.dishes.filter(dish => matchesDish(dish.name, state.search));
  if (state.category === POPULAR) return state.dishes.filter(dish => dish.popular);
  if (state.category === ALL) return state.dishes;
  return state.dishes.filter(dish => dish.category === state.category);
}

function renderCategories() {
  const categories = [ALL, ...new Set(state.dishes.map(dish => dish.category))];
  if (state.dishes.some(dish => dish.popular)) categories.splice(1, 0, POPULAR);
  if (!categories.includes(state.category)) state.category = ALL;
  $('#categories').innerHTML = categories.map(category => `
    <button class="category ${category === state.category ? 'active' : ''}" data-cat="${esc(category)}">${esc(category)}</button>`).join('');
}

function dishCard(dish) {
  const photo = dish.image
    ? `<img class="dish-img" src="${esc(dish.image)}" alt="" loading="lazy">`
    : `<span class="dish-emoji">${esc(dish.emoji)}</span>`;
  return `
    <article class="dish">
      <div class="dish-photo" data-color="${esc(dish.color)}">
        ${photo}
        ${dish.tag ? `<b class="tag">${esc(dish.tag)}</b>` : ''}
      </div>
      <div class="dish-body">
        <h3 class="dish-title">${esc(dish.name)}</h3>
        <p class="dish-desc">${esc(dish.description)}</p>
        <div class="dish-bottom">
          <span class="price">${fmt(dish.price)}</span>
          <button class="add-button" data-add="${esc(dish.id)}">＋ Добавить</button>
        </div>
      </div>
    </article>`;
}

function renderMenu() {
  const found = visibleDishes();
  const searching = Boolean(state.search.trim());
  $('#category-title').textContent = searching ? `Поиск: ${state.search.trim()}` : state.category;
  $('#result-count').textContent = plural(found.length, 'блюдо', 'блюда', 'блюд');

  const grid = $('#menu-grid');
  if (!state.loaded) return;
  if (!found.length) {
    grid.innerHTML = `<p class="menu-empty">${searching ? 'Ничего не найдено. Попробуйте другое название.' : 'В этом разделе пока нет блюд.'}</p>`;
    return;
  }
  grid.innerHTML = found.map(dishCard).join('');
  applyColors(grid);
}

function cartLines() {
  return state.dishes.filter(dish => state.cart[dish.id]).map(dish => ({ dish, quantity: state.cart[dish.id] }));
}

function renderCart() {
  const lines = cartLines();
  $('#cart-count').textContent = lines.reduce((sum, line) => sum + line.quantity, 0);
  const box = $('#cart-items');
  box.innerHTML = lines.length
    ? lines.map(({ dish, quantity }) => `
      <div class="cart-row">
        <div class="cart-emoji" data-color="${esc(dish.color)}">${esc(dish.emoji)}</div>
        <div class="cart-info">
          <strong>${esc(dish.name)}</strong>
          <small>${fmt(dish.price)} × ${quantity} = ${fmt(dish.price * quantity)}</small>
        </div>
        <div class="quantity">
          <button data-minus="${esc(dish.id)}" aria-label="Убрать одну порцию">−</button>
          <b>${quantity}</b>
          <button data-plus="${esc(dish.id)}" aria-label="Добавить ещё порцию">+</button>
        </div>
      </div>`).join('')
    : '<p class="empty-cart">Корзина пока пуста.<br>Добавьте что-нибудь вкусное из меню.</p>';
  applyColors(box);
  $('#cart-total').textContent = fmt(lines.reduce((sum, line) => sum + line.dish.price * line.quantity, 0));
  storage.set('cafe-cart', state.cart);
}

// Блюда, которых больше нет в меню, не должны оставаться в счётчике корзины.
function pruneCart() {
  const known = new Set(state.dishes.map(dish => dish.id));
  for (const id of Object.keys(state.cart)) if (!known.has(id)) delete state.cart[id];
}

function renderTable() {
  $('#table-label').textContent = state.table ? `№ ${state.table.table}` : 'не определён';
  $('#table-hint').hidden = Boolean(state.table);
}

function renderHours() {
  const { openHour, closeHour, isOpen } = state.config;
  const hours = `${openHour}:00–${closeHour}:00`;
  document.querySelectorAll('[data-hours]').forEach(element => {
    element.textContent = hours;
  });
  const badge = $('#open-state');
  badge.hidden = false;
  badge.classList.toggle('closed', !isOpen);
  $('#open-state-text').textContent = isOpen ? `Открыто до ${closeHour}:00` : `Закрыто · откроемся в ${openHour}:00`;
}

function renderMyOrders() {
  const box = $('#order-tracker');
  box.hidden = !state.myOrders.length;
  box.innerHTML = state.myOrders.map(order => `
    <div class="tracker-row">
      <span>Заказ ${esc(order.id)}</span>
      <b class="order-status status-${esc(order.status)}">${esc(STATUS_LABELS[order.status] || order.status)}</b>
    </div>`).join('');
}

async function refreshMyOrders() {
  const updated = await Promise.all(state.myOrders.map(async order => {
    try {
      const { status } = await api(`/api/orders/${encodeURIComponent(order.id)}/status`);
      return status === 'closed' ? null : { ...order, status };
    } catch (error) {
      return error.status === 404 ? null : order;
    }
  }));
  state.myOrders = updated.filter(Boolean);
  storage.set('cafe-my-orders', state.myOrders);
  renderMyOrders();
}

function renderAll() {
  renderCategories();
  renderMenu();
  renderCart();
}

async function loadMenu() {
  $('#menu-grid').innerHTML = '<p class="menu-empty">Загружаем меню…</p>';
  try {
    state.dishes = await api('/api/menu');
    state.loaded = true;
    pruneCart();
    renderAll();
  } catch (error) {
    $('#menu-grid').innerHTML = `<p class="menu-empty">${esc(error.message)} <button class="link-button" id="retry-menu">Повторить</button></p>`;
  }
}

function openCart() {
  $('#overlay').classList.add('show');
  $('#close-cart').focus();
}

function closeCart() {
  $('#overlay').classList.remove('show');
  $('#cart-open').focus();
}

async function checkout() {
  const items = cartLines().map(({ dish, quantity }) => ({ id: dish.id, quantity }));
  if (!items.length) return toast('Добавьте блюда в корзину');
  if (!state.table) return toast('Отсканируйте QR-код на вашем столике');

  const button = $('#checkout');
  button.disabled = true;
  button.firstChild.textContent = 'Отправляем… ';
  try {
    const order = await api('/api/orders', {
      method: 'POST',
      body: { table: state.table.table, tableToken: state.table.token, items, note: $('#order-note').value },
    });
    state.cart = {};
    $('#order-note').value = '';
    state.myOrders.unshift({ id: order.id, status: order.status, at: Date.now() });
    storage.set('cafe-my-orders', state.myOrders);
    renderCart();
    renderMyOrders();
    closeCart();
    toast(`Заказ ${order.id} отправлен на кухню`);
  } catch (error) {
    toast(error.message);
    if (error.status === 409 && error.data?.missing) await loadMenu();
  } finally {
    button.disabled = false;
    button.firstChild.textContent = 'Заказать к столику ';
  }
}

document.addEventListener('click', event => {
  const target = event.target;
  const category = target.closest('[data-cat]');
  if (category) {
    state.category = category.dataset.cat;
    state.search = '';
    $('#menu-search').value = '';
    renderCategories();
    renderMenu();
    return;
  }
  const add = target.closest('[data-add]');
  if (add) {
    state.cart[add.dataset.add] = (state.cart[add.dataset.add] || 0) + 1;
    renderCart();
    toast('Добавлено в корзину');
    return;
  }
  const plus = target.closest('[data-plus]');
  if (plus) {
    state.cart[plus.dataset.plus] += 1;
    renderCart();
    return;
  }
  const minus = target.closest('[data-minus]');
  if (minus) {
    state.cart[minus.dataset.minus] -= 1;
    if (state.cart[minus.dataset.minus] <= 0) delete state.cart[minus.dataset.minus];
    renderCart();
    return;
  }
  if (target.id === 'retry-menu') loadMenu();
});

$('#cart-open').addEventListener('click', openCart);
$('#close-cart').addEventListener('click', closeCart);
$('#overlay').addEventListener('click', event => {
  if (event.target.id === 'overlay') closeCart();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('#overlay').classList.contains('show')) closeCart();
});
$('#checkout').addEventListener('click', checkout);
$('#menu-search').addEventListener('input', event => {
  state.search = event.target.value;
  renderMenu();
});

renderTable();
renderCart();
renderMyOrders();
loadMenu();
api('/api/config').then(config => {
  state.config = config;
  renderHours();
}).catch(() => {});
if (state.myOrders.length) refreshMyOrders();
setInterval(() => {
  if (state.myOrders.length && !document.hidden) refreshMyOrders();
}, STATUS_POLL_MS);
