import { api, esc, fmt, plural } from '../shared.js';

const MAX_SIDE = 1200;
const JPEG_QUALITY = 0.82;
const $ = selector => document.querySelector(selector);

let dishes = [];
let removePhoto = false;
let previewUrl = '';
let changeListener = () => {};

export function onMenuChange(listener) {
  changeListener = listener;
}

// Фото с телефона весит мегабайты, поэтому перед отправкой оно уменьшается в браузере.
async function compressImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Не удалось открыть фото. Попробуйте JPEG или PNG.');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

function renderList() {
  $('#dish-count').textContent = plural(dishes.length, 'блюдо', 'блюда', 'блюд');
  $('#dish-list').innerHTML = dishes.map(dish => `
    <article class="admin-dish">
      <div class="admin-dish-img">
        ${dish.image ? `<img src="${esc(dish.image)}" alt="" loading="lazy">` : esc(dish.emoji)}
      </div>
      <div class="admin-dish-body">
        <h3>${esc(dish.name)}</h3>
        <p>${esc(dish.category)} · ${fmt(dish.price)}<br>${esc(dish.description)}</p>
        <div class="admin-dish-actions">
          <button class="edit-dish" data-edit="${esc(dish.id)}">Редактировать</button>
          <button class="delete-dish" data-delete="${esc(dish.id)}">Удалить</button>
        </div>
      </div>
    </article>`).join('') || '<div class="empty-orders">В меню пока нет блюд.</div>';
}

async function loadMenu() {
  dishes = await api('/api/menu');
  renderList();
  changeListener(dishes);
}

function setPreview(src) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = src.startsWith('blob:') ? src : '';
  $('#image-preview').src = src;
  $('#photo-box').hidden = !src;
}

function resetForm() {
  $('#dish-form').reset();
  $('#dish-id').value = '';
  removePhoto = false;
  setPreview('');
  $('#form-title').textContent = 'Добавить блюдо';
  $('#form-eyebrow').textContent = 'НОВОЕ БЛЮДО';
  $('#cancel-edit').hidden = true;
}

function selectCategory(category) {
  const select = $('#dish-category');
  if (![...select.options].some(option => option.value === category)) select.add(new Option(category, category));
  select.value = category;
}

function fillForm(dish) {
  resetForm();
  $('#dish-id').value = dish.id;
  $('#dish-name').value = dish.name;
  selectCategory(dish.category);
  $('#dish-price').value = dish.price;
  $('#dish-tag').value = dish.tag;
  $('#dish-emoji').value = dish.emoji;
  $('#dish-description').value = dish.description;
  $('#dish-popular').checked = dish.popular;
  setPreview(dish.image);
  $('#form-title').textContent = 'Редактировать блюдо';
  $('#form-eyebrow').textContent = 'ИЗМЕНЕНИЕ БЛЮДА';
  $('#cancel-edit').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showMessage(text) {
  const message = $('#form-message');
  message.textContent = text;
  return message;
}

async function submitForm(event) {
  event.preventDefault();
  const id = $('#dish-id').value;
  const old = dishes.find(dish => dish.id === id);
  const file = $('#dish-image').files[0];
  const button = $('#save-dish');
  button.disabled = true;
  showMessage('Сохраняем…');
  try {
    const image = file ? await compressImage(file) : removePhoto ? '' : old?.image || '';
    const body = {
      name: $('#dish-name').value,
      category: $('#dish-category').value,
      price: Number($('#dish-price').value),
      tag: $('#dish-tag').value,
      emoji: $('#dish-emoji').value,
      description: $('#dish-description').value,
      popular: $('#dish-popular').checked,
      color: old?.color,
      image,
    };
    await api(id ? `/api/admin/menu/${encodeURIComponent(id)}` : '/api/admin/menu', { method: id ? 'PUT' : 'POST', body });
    await loadMenu();
    resetForm();
    showMessage('Сохранено');
    setTimeout(() => showMessage(''), 1800);
  } catch (error) {
    showMessage(error.message);
  } finally {
    button.disabled = false;
  }
}

export function initMenu() {
  $('#dish-form').addEventListener('submit', submitForm);
  $('#cancel-edit').addEventListener('click', resetForm);
  $('#remove-photo').addEventListener('click', () => {
    removePhoto = true;
    $('#dish-image').value = '';
    setPreview('');
  });
  $('#dish-image').addEventListener('change', event => {
    const file = event.target.files[0];
    if (!file) return;
    removePhoto = false;
    setPreview(URL.createObjectURL(file));
  });
  $('#dish-list').addEventListener('click', async event => {
    const edit = event.target.closest('[data-edit]');
    const remove = event.target.closest('[data-delete]');
    if (edit) {
      const dish = dishes.find(item => item.id === edit.dataset.edit);
      if (dish) fillForm(dish);
    }
    if (remove && confirm('Удалить это блюдо из меню?')) {
      try {
        await api(`/api/admin/menu/${encodeURIComponent(remove.dataset.delete)}`, { method: 'DELETE' });
        await loadMenu();
      } catch (error) {
        alert(error.message);
      }
    }
  });
  loadMenu().catch(error => {
    $('#dish-list').innerHTML = `<div class="empty-orders">${esc(error.message)}</div>`;
  });
}
