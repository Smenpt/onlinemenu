import { api } from './shared.js';

const form = document.querySelector('#login-form');
const message = document.querySelector('#login-message');

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  message.textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: { password: document.querySelector('#password').value } });
    location.href = '/admin';
  } catch (error) {
    message.textContent = error.message;
    button.disabled = false;
  }
});
