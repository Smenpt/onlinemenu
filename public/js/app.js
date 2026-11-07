import { STATUS_LABELS, api, applyColors, esc, fmt, matchesDish, plural, storage } from './shared.js';

const TABLE_TTL_MS = 4 * 60 * 60 * 1000;
const MY_ORDERS_TTL_MS = 8 * 60 * 60 * 1000;
const STATUS_POLL_MS = 8000;
const POPULAR = 'Популярное';
const ALL = 'Все блюда';
const STEPS = ['new', 'preparing', 'ready', 'served'];
const STEP_LABELS = { new: 'Принят', preparing: 'Готовится', ready: 'Готов', served: 'Подан' };

const $ = selector => document.querySelector(selector);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  dishes: [],
  config: { tables: 20, requireTableQr: true },
  loaded: false,
  category: ALL,
  search: '',
  cart: readCart(),
  table: readTable(),
  myOrders: readMyOrders(),
  pendingCheckout: false,
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
  return saved?.table && Date.now() - saved.at < TABLE_TTL_MS ? saved : null;
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
  toastTimer = setTimeout(() => element.classList.remove('show'), 2600);
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

function photoHtml(dish) {
  return dish.image
    ? `<img class="dish-img" src="${esc(dish.image)}" alt="${esc(dish.name)}" loading="lazy">`
    : `<span class="dish-emoji" aria-hidden="true">${esc(dish.emoji)}</span>`;
}

function stepperHtml(id, quantity, large = false) {
  if (!quantity) return `<button class="add-button ${large ? 'large' : ''}" data-add="${esc(id)}"><span aria-hidden="true">+</span> Добавить</button>`;
  return `
    <div class="stepper ${large ? 'large' : ''}">
      <button data-minus="${esc(id)}" aria-label="Убрать одну порцию">−</button>
      <b>${quantity}</b>
      <button data-plus="${esc(id)}" aria-label="Добавить ещё порцию">+</button>
    </div>`;
}

function dishCard(dish, index) {
  return `
    <article class="dish" data-open="${esc(dish.id)}" data-delay="${Math.min(index, 8)}">
      <div class="dish-photo" data-color="${esc(dish.color)}">
        ${photoHtml(dish)}
        ${dish.tag ? `<b class="tag">${esc(dish.tag)}</b>` : ''}
      </div>
      <div class="dish-body">
        <span class="dish-category">${esc(dish.category)}</span>
        <h3 class="dish-title">${esc(dish.name)}</h3>
        <p class="dish-desc">${esc(dish.description)}</p>
        <div class="dish-bottom">
          <span class="price">${fmt(dish.price)}</span>
          <span class="dish-action" data-action="${esc(dish.id)}">${stepperHtml(dish.id, state.cart[dish.id])}</span>
        </div>
      </div>
    </article>`;
}

function featuredCard(dish) {
  return `
    <article class="feature" data-open="${esc(dish.id)}">
      <div class="feature-photo" data-color="${esc(dish.color)}">${photoHtml(dish)}</div>
      <div class="feature-body">
        <h3>${esc(dish.name)}</h3>
        <span class="price">${fmt(dish.price)}</span>
      </div>
    </article>`;
}

function renderFeatured() {
  const popular = state.dishes.filter(dish => dish.popular);
  const list = popular.length >= 3 ? popular : [...popular, ...state.dishes.filter(dish => !dish.popular)].slice(0, 6);
  $('#featured').hidden = !list.length;
  const row = $('#featured-row');
  row.innerHTML = list.map(featuredCard).join('');
  applyColors(row);
}

function revealCards(root) {
  root.querySelectorAll('.dish').forEach(card => {
    card.style.setProperty('--delay', `${Number(card.dataset.delay) * 45}ms`);
  });
}

function renderMenu() {
  const found = visibleDishes();
  const searching = Boolean(state.search.trim());
  $('#category-title').textContent = searching ? `Поиск: ${state.search.trim()}` : state.category;
  $('#result-count').textContent = plural(found.length, 'блюдо', 'блюда', 'блюд');

  const grid = $('#menu-grid');
  if (!state.loaded) return;
  if (!found.length) {
    grid.innerHTML = `<p class="menu-empty">${searching ? 'Ничего не нашли. Попробуйте другое название.' : 'В этом разделе пока нет блюд.'}</p>`;
    return;
  }
  grid.innerHTML = found.map(dishCard).join('');
  applyColors(grid);
  revealCards(grid);
}

function cartLines() {
  return state.dishes.filter(dish => state.cart[dish.id]).map(dish => ({ dish, quantity: state.cart[dish.id] }));
}

function bump(element) {
  if (reducedMotion) return;
  element.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
}

function renderCart() {
  const lines = cartLines();
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = lines.reduce((sum, line) => sum + line.dish.price * line.quantity, 0);

  $('#cart-count').textContent = count;
  $('#cart-bar-count').textContent = count;
  $('#cart-bar-total').textContent = fmt(total);
  $('#cart-bar').hidden = !count;
  document.body.classList.toggle('has-cart', count > 0);

  const box = $('#cart-items');
  box.innerHTML = lines.length
    ? lines.map(({ dish, quantity }) => `
      <div class="cart-row">
        <div class="cart-emoji" data-color="${esc(dish.color)}">${dish.image ? `<img src="${esc(dish.image)}" alt="">` : esc(dish.emoji)}</div>
        <div class="cart-info">
          <strong>${esc(dish.name)}</strong>
          <small>${fmt(dish.price * quantity)}</small>
        </div>
        ${stepperHtml(dish.id, quantity)}
      </div>`).join('')
    : `<div class="empty-cart"><span aria-hidden="true">🍽️</span><p>Корзина пока пуста.<br>Добавьте что-нибудь вкусное.</p></div>`;
  applyColors(box);
  $('#cart-total').textContent = fmt(total);
  storage.set('cafe-cart', state.cart);
}

// Обновляем только кнопку, а не всю сетку: иначе карточки мигали бы при каждом нажатии.
function refreshSteppers(id) {
  const quantity = state.cart[id];
  document.querySelectorAll('[data-action]').forEach(slot => {
    if (slot.dataset.action === id) slot.innerHTML = stepperHtml(id, quantity, slot.classList.contains('sheet-action'));
  });
}

function changeQuantity(id, delta) {
  const next = (state.cart[id] || 0) + delta;
  if (next > 0) state.cart[id] = Math.min(next, 50);
  else delete state.cart[id];
  renderCart();
  refreshSteppers(id);
  bump($('#cart-count'));
  if (!$('#cart-bar').hidden) bump($('#cart-bar-count'));
}

function flyToCart(source, id) {
  if (reducedMotion) return;
  const dish = state.dishes.find(item => item.id === id);
  const target = $('#cart-bar').hidden ? $('#cart-open') : $('#cart-bar');
  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const flyer = document.createElement('span');
  flyer.className = 'flyer';
  flyer.textContent = dish?.emoji || '🍽️';
  flyer.style.left = `${from.left + from.width / 2}px`;
  flyer.style.top = `${from.top}px`;
  document.body.append(flyer);
  const dx = to.left + to.width / 2 - from.left - from.width / 2;
  const dy = to.top + to.height / 2 - from.top;
  flyer.animate([
    { transform: 'translate(-50%, -50%) scale(1.2)', opacity: 1 },
    { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - 60}px)) scale(1)`, opacity: 1, offset: 0.55 },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.3)`, opacity: 0.2 },
  ], { duration: 620, easing: 'cubic-bezier(.3,.7,.4,1)' }).finished.finally(() => flyer.remove());
}

// Блюда, которых больше нет в меню, не должны оставаться в счётчике корзины.
function pruneCart() {
  const known = new Set(state.dishes.map(dish => dish.id));
  for (const id of Object.keys(state.cart)) if (!known.has(id)) delete state.cart[id];
}

function renderTable() {
  const { table } = state;
  const canPick = !state.config.requireTableQr;
  $('#table-label').textContent = table ? `№ ${table.table}` : '—';
  $('#table-pill').classList.toggle('empty', !table);
  $('#table-pill').disabled = !canPick;
  $('#hero-table').hidden = !canPick;
  $('#hero-table').textContent = table ? `Столик № ${table.table}` : 'Выбрать столик';
  $('#table-hint').hidden = canPick || Boolean(table);
}

function openTablePicker() {
  const selected = state.table?.table;
  $('#table-picker').innerHTML = Array.from({ length: state.config.tables }, (_, index) => {
    const number = index + 1;
    return `<button class="table-number ${number === selected ? 'selected' : ''}" data-table="${number}">${number}</button>`;
  }).join('');
  $('#table-sheet').showModal();
}

function trackerRow(order) {
  const current = STEPS.indexOf(order.status);
  const steps = STEPS.map((step, index) => `
    <li class="${index < current ? 'done' : index === current ? 'current' : ''}"><i></i><span>${STEP_LABELS[step]}</span></li>`).join('');
  return `
    <article class="tracker-row">
      <header>
        <div><span class="eyebrow">ВАШ ЗАКАЗ</span><strong>${esc(order.id)}</strong></div>
        <b class="order-status status-${esc(order.status)}">${esc(STATUS_LABELS[order.status] || order.status)}</b>
      </header>
      <ol class="tracker-steps" data-progress="${Math.max(current, 0)}">${steps}</ol>
    </article>`;
}

function renderMyOrders() {
  const box = $('#order-tracker');
  box.hidden = !state.myOrders.length;
  box.innerHTML = state.myOrders.map(trackerRow).join('');
}

async function refreshMyOrders() {
  const before = JSON.stringify(state.myOrders.map(order => order.status));
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
  if (JSON.stringify(state.myOrders.map(order => order.status)) !== before) renderMyOrders();
}

function openDish(id) {
  const dish = state.dishes.find(item => item.id === id);
  if (!dish) return;
  const body = $('#dish-sheet-body');
  body.innerHTML = `
    <button class="icon-button sheet-close" data-close-dialog aria-label="Закрыть">×</button>
    <div class="sheet-photo" data-color="${esc(dish.color)}">${photoHtml(dish)}</div>
    <div class="sheet-body">
      <span class="dish-category">${esc(dish.category)}${dish.tag ? ` · ${esc(dish.tag)}` : ''}</span>
      <h2>${esc(dish.name)}</h2>
      <p>${esc(dish.description)}</p>
      <div class="dish-bottom">
        <span class="price">${fmt(dish.price)}</span>
        <span class="dish-action sheet-action" data-action="${esc(dish.id)}">${stepperHtml(dish.id, state.cart[dish.id], true)}</span>
      </div>
    </div>`;
  applyColors(body);
  $('#dish-sheet').showModal();
}

function renderAll() {
  renderCategories();
  renderFeatured();
  renderMenu();
  renderCart();
}

async function loadMenu() {
  $('#menu-grid').innerHTML = Array.from({ length: 6 }, () => '<div class="dish-skeleton"></div>').join('');
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
  document.body.classList.add('locked');
  $('#close-cart').focus();
}

function closeCart() {
  $('#overlay').classList.remove('show');
  document.body.classList.remove('locked');
  $('#cart-open').focus({ preventScroll: true });
}

function launchConfetti() {
  const box = $('#confetti');
  box.textContent = '';
  if (reducedMotion) return;
  const colors = ['#e8b04a', '#7fc29b', '#e0764f', '#f4f0e6', '#5f9b66'];
  for (let index = 0; index < 36; index++) {
    const piece = document.createElement('i');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.backgroundColor = colors[index % colors.length];
    box.append(piece);
    piece.animate([
      { transform: 'translateY(-20px) rotate(0deg)', opacity: 1 },
      { transform: `translateY(420px) rotate(${360 + Math.random() * 540}deg)`, opacity: 0 },
    ], { duration: 1100 + Math.random() * 900, delay: Math.random() * 250, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'both' });
  }
}

function showSuccess(order) {
  $('#success-text').textContent = `Заказ ${order.id} для столика № ${order.table} принят. Статус будет обновляться на этой странице.`;
  $('#success-sheet').showModal();
  launchConfetti();
}

async function checkout() {
  const items = cartLines().map(({ dish, quantity }) => ({ id: dish.id, quantity }));
  if (!items.length) return toast('Добавьте блюда в корзину');
  if (!state.table) {
    if (state.config.requireTableQr) return toast('Отсканируйте QR-код на вашем столике');
    state.pendingCheckout = true;
    return openTablePicker();
  }

  const button = $('#checkout');
  const label = $('#checkout-label');
  button.disabled = true;
  label.textContent = 'Отправляем…';
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
    renderMenu();
    renderMyOrders();
    closeCart();
    showSuccess(order);
  } catch (error) {
    toast(error.message);
    if (error.status === 409 && error.data?.missing) await loadMenu();
  } finally {
    button.disabled = false;
    label.textContent = 'Заказать к столику';
  }
}

document.addEventListener('click', event => {
  const target = event.target;

  const add = target.closest('[data-add]');
  if (add) {
    flyToCart(add, add.dataset.add);
    changeQuantity(add.dataset.add, 1);
    return;
  }
  const plus = target.closest('[data-plus]');
  if (plus) return changeQuantity(plus.dataset.plus, 1);
  const minus = target.closest('[data-minus]');
  if (minus) return changeQuantity(minus.dataset.minus, -1);

  if (target.closest('[data-close-dialog]')) {
    target.closest('dialog').close();
    return;
  }
  const table = target.closest('[data-table]');
  if (table) {
    state.table = { table: Number(table.dataset.table), token: '', at: Date.now() };
    storage.set('cafe-table', state.table);
    renderTable();
    $('#table-sheet').close();
    if (state.pendingCheckout) {
      state.pendingCheckout = false;
      checkout();
    } else {
      toast(`Столик № ${state.table.table}`);
    }
    return;
  }
  const category = target.closest('[data-cat]');
  if (category) {
    state.category = category.dataset.cat;
    state.search = '';
    $('#menu-search').value = '';
    renderCategories();
    renderMenu();
    category.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    return;
  }
  if (target.id === 'retry-menu') return loadMenu();

  const card = target.closest('[data-open]');
  if (card) openDish(card.dataset.open);
});

// Клик по затемнённому фону закрывает окно.
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    state.pendingCheckout = false;
  });
});

$('#cart-open').addEventListener('click', openCart);
$('#cart-bar').addEventListener('click', openCart);
$('#close-cart').addEventListener('click', closeCart);
$('#overlay').addEventListener('click', event => {
  if (event.target.id === 'overlay') closeCart();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('#overlay').classList.contains('show')) closeCart();
});
$('#checkout').addEventListener('click', checkout);
$('#table-pill').addEventListener('click', openTablePicker);
$('#hero-table').addEventListener('click', openTablePicker);
$('#menu-search').addEventListener('input', event => {
  state.search = event.target.value;
  renderMenu();
});
addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', scrollY > 24), { passive: true });

renderTable();
renderCart();
renderMyOrders();
loadMenu();
api('/api/config').then(config => {
  state.config = config;
  renderTable();
}).catch(() => {});
if (state.myOrders.length) refreshMyOrders();
setInterval(() => {
  if (state.myOrders.length && !document.hidden) refreshMyOrders();
}, STATUS_POLL_MS);
// Гость вернулся на вкладку: показываем свежий статус сразу, не дожидаясь следующего опроса.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.myOrders.length) refreshMyOrders();
});
