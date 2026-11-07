const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const qrcode = require('qrcode-generator');

const { createAuth, createLimiter } = require('./auth');
const { scheduleBackups } = require('./backup');
const { HttpError, send, sendJson, readJson, decodeParam } = require('./http');
const { createImages } = require('./images');
const { importLegacyData } = require('./legacy');
const { publicBaseUrl } = require('./network');
const { createStore } = require('./store');
const { tableToken, isValidTableToken } = require('./tables');
const { parseDish, parseOrder, parseStatus, dayRange, isTable } = require('./validate');

const ORDER_BODY_LIMIT = 64 * 1024;
const LOGIN_BODY_LIMIT = 4 * 1024;
const DISH_BODY_LIMIT = 4 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const PAGES = { '/': 'index.html', '/login': 'login.html', '/admin': 'admin.html' };

function createApp(config) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const uploadsDir = path.join(config.dataDir, 'uploads');
  const store = createStore(path.join(config.dataDir, 'cafe.db'));
  const images = createImages(uploadsDir);
  const auth = createAuth(config, store);
  const orderLimiter = createLimiter({ max: 30, windowMs: 60_000 });

  importLegacyData(store, images, config.legacyDir, path.join(config.backupDir, 'legacy'));
  const backupTimer = config.disableBackups ? null : scheduleBackups(store, config.backupDir, uploadsDir);

  const publicConfig = () => ({ tables: config.tables, requireTableQr: config.requireTableQr });

  function newDishId() {
    return `dish-${crypto.randomUUID()}`;
  }

  function requireOrder(id) {
    const order = store.orders.get(id);
    if (!order) throw new HttpError(404, 'Заказ не найден.');
    return order;
  }

  const routes = [
    // Публичная часть
    ['GET', /^\/api\/menu$/, (req, res) => sendJson(res, 200, store.dishes.list())],
    ['GET', /^\/api\/config$/, (req, res) => sendJson(res, 200, publicConfig())],
    ['GET', /^\/api\/orders\/([^/]+)\/status$/, (req, res, [id]) => {
      const { status } = requireOrder(decodeParam(id));
      sendJson(res, 200, { id: decodeParam(id), status });
    }],
    ['POST', /^\/api\/orders$/, async (req, res) => {
      const ip = req.socket.remoteAddress;
      if (orderLimiter.isBlocked(ip)) throw new HttpError(429, 'Слишком много заказов подряд. Подождите минуту.');
      const data = await readJson(req, ORDER_BODY_LIMIT);
      const order = parseOrder(data, config.tables);
      if (config.requireTableQr && !isValidTableToken(config.tableSecret, order.table, data.tableToken)) {
        throw new HttpError(403, 'Отсканируйте QR-код на вашем столике.');
      }
      orderLimiter.add(ip);
      sendJson(res, 201, store.orders.create({ ...order, source: 'guest' }));
    }],

    // Вход
    ['POST', /^\/api\/login$/, async (req, res) => {
      const data = await readJson(req, LOGIN_BODY_LIMIT);
      const cookie = auth.login(data.password, req.socket.remoteAddress);
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie });
    }],
    ['POST', /^\/api\/logout$/, (req, res) => sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.logout(req) })],

    // Администратор: заказы
    ['GET', /^\/api\/admin\/orders$/, (req, res, params, query) => {
      if (query.has('closedOn')) {
        const { from, to } = dayRange(query.get('closedOn'));
        return sendJson(res, 200, store.orders.closedBetween(from, to));
      }
      sendJson(res, 200, store.orders.active());
    }, { admin: true }],
    ['POST', /^\/api\/admin\/orders$/, async (req, res) => {
      const order = parseOrder(await readJson(req, ORDER_BODY_LIMIT), config.tables);
      sendJson(res, 201, store.orders.create({ ...order, source: 'admin' }));
    }, { admin: true }],
    ['PATCH', /^\/api\/admin\/orders\/([^/]+)$/, async (req, res, [id]) => {
      const status = parseStatus(await readJson(req, LOGIN_BODY_LIMIT));
      const order = store.orders.setStatus(decodeParam(id), status);
      if (!order) throw new HttpError(404, 'Заказ не найден.');
      sendJson(res, 200, order);
    }, { admin: true }],
    ['DELETE', /^\/api\/admin\/orders\/([^/]+)$/, (req, res, [id]) => {
      const order = requireOrder(decodeParam(id));
      if (order.status !== 'closed') throw new HttpError(400, 'Удалять можно только закрытые заказы.');
      store.orders.remove(order.id);
      sendJson(res, 200, order);
    }, { admin: true }],
    ['POST', /^\/api\/admin\/tables\/(\d+)\/close$/, (req, res, [table]) => {
      const result = store.orders.closeTable(Number(table));
      if (!result.closed) throw new HttpError(404, 'У столика нет активного заказа.');
      sendJson(res, 200, result);
    }, { admin: true }],

    // Администратор: меню
    ['POST', /^\/api\/admin\/menu$/, async (req, res) => {
      const data = await readJson(req, DISH_BODY_LIMIT);
      const dish = { ...parseDish(data), id: newDishId() };
      dish.image = images.resolve(data.image);
      store.dishes.insert(dish);
      sendJson(res, 201, dish);
    }, { admin: true }],
    ['PUT', /^\/api\/admin\/menu\/([^/]+)$/, async (req, res, [rawId]) => {
      const id = decodeParam(rawId);
      const data = await readJson(req, DISH_BODY_LIMIT);
      const dish = parseDish(data);
      // Текущая версия читается после получения тела, поэтому чужое изменение не затрётся.
      const current = store.dishes.get(id);
      if (!current) throw new HttpError(404, 'Блюдо не найдено.');
      dish.image = images.resolve(data.image, current.image);
      store.dishes.update(id, dish);
      if (current.image !== dish.image) images.remove(current.image);
      sendJson(res, 200, { ...dish, id });
    }, { admin: true }],
    ['DELETE', /^\/api\/admin\/menu\/([^/]+)$/, (req, res, [rawId]) => {
      const dish = store.dishes.get(decodeParam(rawId));
      if (!dish) throw new HttpError(404, 'Блюдо не найдено.');
      store.dishes.remove(dish.id);
      images.remove(dish.image);
      sendJson(res, 200, { ok: true });
    }, { admin: true }],

    // Администратор: QR-коды
    ['GET', /^\/api\/admin\/qr$/, (req, res) => {
      const base = publicBaseUrl(req, config);
      const tables = Array.from({ length: config.tables }, (_, index) => {
        const table = index + 1;
        return { table, url: `${base}/?table=${table}&t=${tableToken(config.tableSecret, table)}` };
      });
      sendJson(res, 200, { base, tables });
    }, { admin: true }],
    ['GET', /^\/api\/admin\/qr\/(\d+)\.svg$/, (req, res, [raw]) => {
      const table = Number(raw);
      if (!isTable(table, config.tables)) throw new HttpError(404, 'Столик не найден.');
      const url = `${publicBaseUrl(req, config)}/?table=${table}&t=${tableToken(config.tableSecret, table)}`;
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      send(res, 200, qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true }), { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    }, { admin: true }],
  ];

  function checkOrigin(req) {
    if (req.method === 'GET' || req.method === 'HEAD' || !req.headers.origin) return;
    let host = '';
    try {
      host = new URL(req.headers.origin).host;
    } catch {
      // Origin: null и мусор считаются чужими.
    }
    if (host !== req.headers.host) throw new HttpError(403, 'Запрос с другого сайта запрещён.');
  }

  function serveFile(req, res, file, headers = {}) {
    fs.readFile(file, (error, contents) => {
      if (error) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
      send(res, 200, req.method === 'HEAD' ? '' : contents, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        ...headers,
      });
    });
  }

  function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    }
    if (pathname.startsWith('/uploads/')) {
      const file = images.pathOf(pathname);
      if (!file) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return serveFile(req, res, file, { 'Cache-Control': 'public, max-age=31536000, immutable' });
    }

    const clean = pathname.replace(/\.html$/, '');
    const isAdmin = auth.isAdmin(req);
    if ((clean === '/admin') && !isAdmin) return send(res, 302, '', { Location: '/login' });
    if (clean === '/login' && isAdmin) return send(res, 302, '', { Location: '/admin' });

    const relative = PAGES[clean === '/index' ? '/' : clean] || pathname.slice(1);
    const file = path.resolve(config.publicDir, relative);
    if (!file.startsWith(config.publicDir + path.sep)) return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    serveFile(req, res, file);
  }

  async function handle(req, res) {
    const [pathname, search = ''] = req.url.split('?', 2);
    checkOrigin(req);

    if (pathname.startsWith('/api/')) {
      for (const [method, pattern, handler, options] of routes) {
        const match = req.method === method && pattern.exec(pathname);
        if (!match) continue;
        if (options?.admin && !auth.isAdmin(req)) throw new HttpError(401, 'Требуется вход.');
        return handler(req, res, match.slice(1), new URLSearchParams(search));
      }
      throw new HttpError(404, 'Не найдено.');
    }
    serveStatic(req, res, pathname);
  }

  function fail(res, error) {
    if (res.headersSent) return res.destroy();
    if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message, ...error.extra });
    console.error(error);
    sendJson(res, 500, { error: 'Внутренняя ошибка сервера.' });
  }

  const server = http.createServer((req, res) => {
    // Ни один запрос не должен останавливать сервер.
    Promise.resolve().then(() => handle(req, res)).catch(error => fail(res, error));
  });

  return {
    server,
    store,
    close() {
      if (backupTimer) clearInterval(backupTimer);
      return new Promise(resolve => {
        server.close(() => {
          store.close();
          resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}

module.exports = { createApp };
