const FORCED_DRAIN_LIMIT = 32 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function sendJson(res, status, body, headers = {}) {
  send(res, status, JSON.stringify(body), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
}

// Тело дочитывается до конца даже при превышении лимита: иначе браузер получит
// обрыв соединения вместо понятного ответа 413.
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const tooLarge = () => new HttpError(413, 'Слишком большой запрос.');

    req.on('data', chunk => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
      else chunks.length = 0;
      if (size > FORCED_DRAIN_LIMIT) {
        finish(reject, tooLarge());
        req.destroy();
      }
    });
    req.on('end', () => (size > limit ? finish(reject, tooLarge()) : finish(resolve, Buffer.concat(chunks))));
    req.on('error', () => finish(reject, new HttpError(400, 'Запрос прерван.')));
    req.on('close', () => finish(reject, new HttpError(400, 'Запрос прерван.')));
  });
}

async function readJson(req, limit) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
    throw new HttpError(415, 'Ожидается JSON.');
  }
  const body = await readBody(req, limit);
  let data;
  try {
    data = JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Некорректный JSON.');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpError(400, 'Некорректные данные.');
  }
  return data;
}

function decodeParam(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, 'Некорректный адрес.');
  }
}

module.exports = { HttpError, send, sendJson, readJson, decodeParam };
