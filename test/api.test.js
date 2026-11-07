const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { afterEach, beforeEach, describe, test } = require('node:test');

const { createApp } = require('../src/app');
const { runBackup, localDate } = require('../src/backup');
const { tableToken } = require('../src/tables');

const SECRET = 'test-secret';
const PASSWORD = 'correct-password';
const ROOT = path.resolve(__dirname, '..');
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64')}`;
const SEED_MENU = [
  { id: 'soup', name: 'Суп', category: 'Первое', price: 1000, popular: false },
  { id: 'tea', name: 'Чай', category: 'Напитки', price: 500, popular: true },
];

let dir;
let app;
let base;
let port;
let cookie;

function makeConfig(overrides = {}) {
  return {
    port: 0,
    host: '127.0.0.1',
    dataDir: path.join(dir, 'data'),
    backupDir: path.join(dir, 'backups'),
    legacyDir: path.join(dir, 'legacy'),
    publicDir: path.join(ROOT, 'public'),
    tables: 20,
    requireTableQr: true,
    publicUrl: '',
    sessionHours: 12,
    adminPassword: PASSWORD,
    tableSecret: SECRET,
    disableBackups: true,
    ...overrides,
  };
}

async function boot(overrides) {
  app = createApp(makeConfig(overrides));
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  port = app.server.address().port;
  base = `http://127.0.0.1:${port}`;
}

function call(url, { method = 'GET', body, headers = {}, raw } = {}) {
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  return fetch(base + url, {
    method,
    redirect: 'manual',
    headers: { ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: payload,
  });
}

const admin = (url, options = {}) => call(url, { ...options, headers: { Cookie: cookie, ...options.headers } });

function rawRequest(text) {
  return new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(text));
    let data = '';
    socket.on('data', chunk => { data += chunk; });
    socket.on('close', () => resolve(data));
    socket.on('error', () => resolve(data));
    setTimeout(() => socket.destroy(), 500);
  });
}

async function isAlive() {
  return (await call('/api/menu')).status === 200;
}

const guestOrder = (extra = {}) => ({
  table: 5,
  tableToken: tableToken(SECRET, 5),
  items: [{ id: 'soup', quantity: 2 }],
  ...extra,
});

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cafe-test-'));
  fs.mkdirSync(path.join(dir, 'legacy'));
  fs.writeFileSync(path.join(dir, 'legacy', 'menu.json'), JSON.stringify(SEED_MENU));
  await boot();
  const login = await call('/api/login', { method: 'POST', body: { password: PASSWORD } });
  cookie = login.headers.get('set-cookie').split(';')[0];
});

afterEach(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('устойчивость', () => {
  for (const [name, request] of [
    ['двойной слэш', 'GET // HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'],
    ['битый Host', 'GET / HTTP/1.1\r\nHost: [\r\nConnection: close\r\n\r\n'],
    ['% в заказе', 'DELETE /api/orders/% HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'],
    ['% в заказе админа', 'PATCH /api/admin/orders/%E0 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'],
    ['% в статусе', 'GET /api/orders/%E0/status HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'],
    ['% в меню', 'DELETE /api/admin/menu/% HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'],
  ]) {
    test(`сервер переживает: ${name}`, async () => {
      await rawRequest(request);
      assert.equal(await isAlive(), true);
    });
  }

  test('% в адресе у администратора даёт 400, а не падение', async () => {
    assert.equal((await admin('/api/admin/menu/%E0', { method: 'DELETE' })).status, 400);
  });

  test('обход каталога не отдаёт файлы проекта', async () => {
    const response = await rawRequest('GET /..%2f..%2fserver.js HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    assert.match(response, /^HTTP\/1\.1 404/);
    const dotted = await rawRequest('GET /../server.js HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    assert.match(dotted, /^HTTP\/1\.1 403/);
  });

  test('слишком большой запрос получает 413, а не обрыв', async () => {
    const response = await admin('/api/admin/menu', { method: 'POST', body: { name: 'x', category: 'y', price: 1, image: `data:image/jpeg;base64,${'A'.repeat(5_000_000)}` } });
    assert.equal(response.status, 413);
  });

  test('кириллица на границе блоков данных не портится', async () => {
    const body = Buffer.from(JSON.stringify(guestOrder({ note: 'я' })));
    const middle = body.indexOf(Buffer.from('я')) + 1;
    const head = `POST /api/orders HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`;
    const response = await new Promise(resolve => {
      const socket = net.connect(port, '127.0.0.1', async () => {
        socket.write(Buffer.concat([Buffer.from(head), body.subarray(0, middle)]));
        await new Promise(wait => setTimeout(wait, 50));
        socket.write(body.subarray(middle));
      });
      let data = '';
      socket.setEncoding('utf8');
      socket.on('data', chunk => { data += chunk; });
      socket.on('close', () => resolve(data));
    });
    assert.match(response, /"note":"я"/);
  });

  test('PUT не воскрешает блюдо, удалённое пока шла загрузка', async () => {
    const body = JSON.stringify({ name: 'Новый суп', category: 'Первое', price: 1 });
    await new Promise(resolve => {
      const socket = net.connect(port, '127.0.0.1', async () => {
        socket.write(`PUT /api/admin/menu/soup HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nCookie: ${cookie}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n`);
        await new Promise(wait => setTimeout(wait, 50));
        await admin('/api/admin/menu/tea', { method: 'DELETE' });
        socket.write(body);
      });
      socket.on('data', () => {});
      socket.on('close', resolve);
    });
    const menu = await (await call('/api/menu')).json();
    assert.deepEqual(menu.map(dish => dish.id), ['soup']);
    assert.equal(menu[0].name, 'Новый суп');
  });
});

describe('доступ', () => {
  test('без входа администраторские адреса закрыты', async () => {
    for (const [method, url] of [
      ['GET', '/api/admin/orders'],
      ['POST', '/api/admin/tables/1/close'],
      ['DELETE', '/api/admin/menu/soup'],
      ['GET', '/api/admin/qr'],
      ['GET', '/api/admin/qr/1.svg'],
    ]) {
      assert.equal((await call(url, { method })).status, 401, url);
    }
    assert.equal((await call('/api/admin/menu', { method: 'POST', body: {} })).status, 401);
  });

  test('страница админки уводит на вход', async () => {
    for (const url of ['/admin', '/admin.html']) {
      const response = await call(url);
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), '/login');
    }
    assert.equal((await admin('/admin')).status, 200);
  });

  test('неверный пароль отклоняется, после пяти попыток вход блокируется', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal((await call('/api/login', { method: 'POST', body: { password: 'no' } })).status, 401);
    }
    assert.equal((await call('/api/login', { method: 'POST', body: { password: PASSWORD } })).status, 429);
  });

  test('выход отключает сессию', async () => {
    await admin('/api/logout', { method: 'POST' });
    assert.equal((await admin('/api/admin/orders')).status, 401);
  });

  test('запросы с чужого сайта и не-JSON отклоняются', async () => {
    assert.equal((await admin('/api/admin/orders', { method: 'POST', body: {}, headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await admin('/api/admin/menu', { method: 'POST', raw: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await call('/api/orders', { method: 'POST', raw: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  });

  test('CORS не разрешён, защитные заголовки есть', async () => {
    const response = await call('/api/menu');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  });

  test('гость видит только статус своего заказа', async () => {
    const order = await (await call('/api/orders', { method: 'POST', body: guestOrder({ note: 'секрет' }) })).json();
    const status = await (await call(`/api/orders/${order.id}/status`)).json();
    assert.deepEqual(status, { id: order.id, status: 'new' });
  });
});

describe('заказы', () => {
  test('цена и название берутся из меню, а не от клиента', async () => {
    const response = await call('/api/orders', {
      method: 'POST',
      body: guestOrder({ source: 'admin', total: 1, items: [{ id: 'soup', name: 'Подделка', price: 0, quantity: 2 }] }),
    });
    assert.equal(response.status, 201);
    const order = await response.json();
    assert.equal(order.total, 2000);
    assert.equal(order.items[0].name, 'Суп');
    assert.equal(order.source, 'guest');
  });

  test('несуществующее блюдо отклоняется и называется в ответе', async () => {
    const response = await call('/api/orders', { method: 'POST', body: guestOrder({ items: [{ id: 'ghost', quantity: 1 }] }) });
    assert.equal(response.status, 409);
    assert.deepEqual((await response.json()).missing, ['ghost']);
  });

  test('некорректное количество отклоняется', async () => {
    for (const raw of [
      JSON.stringify(guestOrder()).replace('"quantity":2', '"quantity":1e999'),
      JSON.stringify(guestOrder()).replace('"quantity":2', '"quantity":1.5'),
      JSON.stringify(guestOrder()).replace('"quantity":2', '"quantity":0'),
      JSON.stringify(guestOrder()).replace('"quantity":2', '"quantity":51'),
    ]) {
      assert.equal((await call('/api/orders', { method: 'POST', raw })).status, 400, raw);
    }
  });

  test('заказ требует подпись столика', async () => {
    const forged = guestOrder({ tableToken: tableToken(SECRET, 6) });
    assert.equal((await call('/api/orders', { method: 'POST', body: forged })).status, 403);
    assert.equal((await call('/api/orders', { method: 'POST', body: guestOrder({ tableToken: undefined }) })).status, 403);
    assert.equal((await call('/api/orders', { method: 'POST', body: guestOrder({ table: 99999 }) })).status, 400);
  });

  test('в демо-режиме заказ проходит без QR-кода, но столик проверяется', async () => {
    await app.close();
    await boot({ requireTableQr: false });
    assert.equal((await (await call('/api/config')).json()).requireTableQr, false);
    assert.equal((await call('/api/orders', { method: 'POST', body: guestOrder({ tableToken: undefined }) })).status, 201);
    assert.equal((await call('/api/orders', { method: 'POST', body: guestOrder({ table: 99 }) })).status, 400);
  });

  test('заказ принимается в любое время суток', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 7, 3, 30) });
    assert.equal((await call('/api/orders', { method: 'POST', body: guestOrder() })).status, 201);
  });

  test('одинаковые блюда объединяются в одну строку', async () => {
    const response = await admin('/api/admin/orders', { method: 'POST', body: { table: 3, items: [{ id: 'soup', quantity: 1 }, { id: 'soup', quantity: 2 }] } });
    const order = await response.json();
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0].quantity, 3);
    assert.equal(order.source, 'admin');
  });

  test('номера заказов уникальны и не подбираются подряд', async () => {
    const ids = new Set();
    for (let index = 0; index < 20; index++) {
      const order = await (await admin('/api/admin/orders', { method: 'POST', body: { table: 1, items: [{ id: 'tea', quantity: 1 }] } })).json();
      assert.match(order.id, /^A[2-9A-HJ-NP-Z]{7}$/);
      ids.add(order.id);
    }
    assert.equal(ids.size, 20);
  });

  test('жизненный цикл: статус, закрытие столика, возврат, удаление', async () => {
    const order = await (await call('/api/orders', { method: 'POST', body: guestOrder({ note: 'без лука' }) })).json();
    const updated = await (await admin(`/api/admin/orders/${order.id}`, { method: 'PATCH', body: { status: 'preparing' } })).json();
    assert.equal(updated.status, 'preparing');

    const active = await (await admin('/api/admin/orders')).json();
    assert.equal(active[0].note, 'без лука');

    assert.equal((await admin(`/api/admin/orders/${order.id}`, { method: 'DELETE' })).status, 400);
    assert.equal((await admin('/api/admin/tables/5/close', { method: 'POST' })).status, 200);
    assert.equal((await admin('/api/admin/tables/5/close', { method: 'POST' })).status, 404);

    const today = localDate();
    const closed = await (await admin(`/api/admin/orders?closedOn=${today}`)).json();
    assert.equal(closed.length, 1);
    assert.ok(closed[0].closedAt);

    const reopened = await (await admin(`/api/admin/orders/${order.id}`, { method: 'PATCH', body: { status: 'served' } })).json();
    assert.equal(reopened.closedAt, undefined);
    await admin(`/api/admin/orders/${order.id}`, { method: 'PATCH', body: { status: 'closed' } });
    assert.equal((await admin(`/api/admin/orders/${order.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await call(`/api/orders/${order.id}/status`)).status, 404);
  });

  test('открытые заказы идут от старых к новым', async () => {
    const first = await (await admin('/api/admin/orders', { method: 'POST', body: { table: 2, items: [{ id: 'tea', quantity: 1 }] } })).json();
    await new Promise(wait => setTimeout(wait, 5));
    const second = await (await admin('/api/admin/orders', { method: 'POST', body: { table: 2, items: [{ id: 'tea', quantity: 1 }] } })).json();
    const active = await (await admin('/api/admin/orders')).json();
    assert.deepEqual(active.map(order => order.id), [first.id, second.id]);
  });

  test('касса считает день по дате закрытия', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await admin('/api/admin/orders', { method: 'POST', body: { table: 7, items: [{ id: 'tea', quantity: 1 }] } });
    await admin('/api/admin/tables/7/close', { method: 'POST' });
    assert.equal((await (await admin(`/api/admin/orders?closedOn=${localDate()}`)).json()).length, 1);
    assert.equal((await (await admin(`/api/admin/orders?closedOn=${localDate(yesterday)}`)).json()).length, 0);
    assert.equal((await admin('/api/admin/orders?closedOn=2026-13-45')).status, 400);
  });
});

describe('меню', () => {
  test('данные блюда проверяются', async () => {
    for (const body of [
      { name: 'x', category: 'y', price: -1 },
      { name: 'x', category: 'y', price: null },
      { name: 'x', category: 'y', price: 1.5 },
      { name: '', category: 'y', price: 1 },
    ]) {
      assert.equal((await admin('/api/admin/menu', { method: 'POST', body })).status, 400, JSON.stringify(body));
    }
  });

  test('цвет с разметкой заменяется на стандартный', async () => {
    const dish = await (await admin('/api/admin/menu', { method: 'POST', body: { name: 'x', category: 'y', price: 1, color: 'red"><script>' } })).json();
    assert.equal(dish.color, '#e9eee4');
  });

  test('фото сохраняется файлом, заменяется и удаляется с диска', async () => {
    const created = await (await admin('/api/admin/menu', { method: 'POST', body: { name: 'x', category: 'y', price: 1, image: JPEG } })).json();
    assert.match(created.image, /^\/uploads\/[a-f0-9]{32}\.jpg$/);
    const served = await call(created.image);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'image/jpeg');

    const file = path.join(dir, 'data', 'uploads', path.basename(created.image));
    assert.equal(fs.existsSync(file), true);
    const cleared = await (await admin(`/api/admin/menu/${created.id}`, { method: 'PUT', body: { name: 'x', category: 'y', price: 1, image: '' } })).json();
    assert.equal(cleared.image, '');
    assert.equal(fs.existsSync(file), false);
  });

  test('подделка изображения и чужой путь не принимаются', async () => {
    const fake = `data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;
    assert.equal((await admin('/api/admin/menu', { method: 'POST', body: { name: 'x', category: 'y', price: 1, image: fake } })).status, 400);
    assert.equal((await admin('/api/admin/menu', { method: 'POST', body: { name: 'x', category: 'y', price: 1, image: "x');alert(1)//" } })).status, 400);
  });
});

describe('QR-коды', () => {
  test('ссылки содержат подпись и ведут не на localhost', async () => {
    await app.close();
    await boot({ publicUrl: 'http://192.168.1.50:3000' });
    const login = await call('/api/login', { method: 'POST', body: { password: PASSWORD } });
    cookie = login.headers.get('set-cookie').split(';')[0];
    const { tables } = await (await admin('/api/admin/qr')).json();
    assert.equal(tables.length, 20);
    assert.equal(tables[4].url, `http://192.168.1.50:3000/?table=5&t=${tableToken(SECRET, 5)}`);
    const svg = await admin('/api/admin/qr/5.svg');
    assert.equal(svg.headers.get('content-type'), 'image/svg+xml');
    assert.match(await svg.text(), /<svg/);
    assert.equal((await admin('/api/admin/qr/21.svg')).status, 404);
  });
});

describe('данные', () => {
  test('старые файлы переносятся в базу и уходят в архив', async () => {
    await app.close();
    const legacy = path.join(dir, 'legacy');
    fs.writeFileSync(path.join(legacy, 'menu.json'), JSON.stringify(SEED_MENU));
    fs.writeFileSync(path.join(legacy, 'orders.json'), `﻿${JSON.stringify([
      { id: 'A1', table: 2, items: [{ id: 'gone', name: 'Старое', price: 100, quantity: 2 }], total: 200, note: 'x', status: 'closed', createdAt: '2026-11-06T06:00:00.000Z', updatedAt: '2026-11-06T07:00:00.000Z' },
    ])}`);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cafe-test-'));
    await boot({ legacyDir: legacy });
    const login = await call('/api/login', { method: 'POST', body: { password: PASSWORD } });
    cookie = login.headers.get('set-cookie').split(';')[0];

    assert.equal((await (await call('/api/menu')).json()).length, 2);
    const closed = await (await admin(`/api/admin/orders?closedOn=${localDate(new Date('2026-11-06T07:00:00.000Z'))}`)).json();
    assert.equal(closed[0].source, 'guest');
    assert.equal(closed[0].closedAt, '2026-11-06T07:00:00.000Z');
    assert.equal(fs.existsSync(path.join(legacy, 'orders.json')), false);
    assert.equal(fs.readdirSync(path.join(dir, 'backups', 'legacy')).length, 2);
  });

  test('повреждённый старый файл останавливает запуск и остаётся на месте', async () => {
    await app.close();
    const legacy = path.join(dir, 'legacy');
    const broken = path.join(legacy, 'orders.json');
    fs.writeFileSync(broken, '[{"id":');
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'cafe-test-'));
    assert.throws(() => createApp(makeConfig({ dataDir: path.join(fresh, 'data'), backupDir: path.join(fresh, 'backups'), legacyDir: legacy })), /orders\.json/);
    assert.equal(fs.readFileSync(broken, 'utf8'), '[{"id":');
    fs.rmSync(broken);
    await boot({ dataDir: path.join(fresh, 'data2'), backupDir: path.join(fresh, 'backups2'), legacyDir: legacy });
  });

  test('заказ с ошибкой не оставляет следов в базе', async () => {
    await call('/api/orders', { method: 'POST', body: guestOrder({ items: [{ id: 'soup', quantity: 1 }, { id: 'ghost', quantity: 1 }] }) });
    assert.equal(app.store.orders.count(), 0);
  });

  test('резервная копия создаётся и открывается', async () => {
    await call('/api/orders', { method: 'POST', body: guestOrder() });
    const backupDir = path.join(dir, 'b');
    const file = runBackup(app.store, backupDir, path.join(dir, 'data', 'uploads'));
    const again = runBackup(app.store, backupDir, path.join(dir, 'data', 'uploads'));
    assert.equal(file, again);
    const { DatabaseSync } = require('node:sqlite');
    const copy = new DatabaseSync(file);
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 1);
    copy.close();
  });
});
