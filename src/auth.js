const crypto = require('node:crypto');
const { HttpError } = require('./http');

const COOKIE = 'sid';
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 5 * 60 * 1000;

const sha256 = value => crypto.createHash('sha256').update(value).digest();
const hex = value => sha256(value).toString('hex');

function createLimiter({ max, windowMs }) {
  const hits = new Map();
  const live = key => {
    const entry = hits.get(key);
    if (entry && entry.resetAt > Date.now()) return entry;
    hits.delete(key);
    return null;
  };
  return {
    isBlocked: key => (live(key)?.count ?? 0) >= max,
    add(key) {
      if (hits.size > 10_000) hits.clear();
      const entry = live(key) ?? { count: 0, resetAt: Date.now() + windowMs };
      entry.count += 1;
      hits.set(key, entry);
    },
    clear: key => hits.delete(key),
  };
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return '';
}

function createAuth(config, store) {
  const failures = createLimiter({ max: MAX_FAILED_LOGINS, windowMs: LOCK_MS });
  const expected = sha256(config.adminPassword);
  const maxAge = config.sessionHours * 3600;
  const cookie = (value, age) => `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}`;

  return {
    isAdmin(req) {
      const token = readCookie(req, COOKIE);
      return Boolean(token) && store.sessions.isValid(hex(token));
    },

    login(password, ip) {
      if (failures.isBlocked(ip)) throw new HttpError(429, 'Слишком много попыток. Подождите 5 минут.');
      const correct = config.adminPassword && crypto.timingSafeEqual(sha256(String(password ?? '')), expected);
      if (!correct) {
        failures.add(ip);
        throw new HttpError(401, 'Неверный пароль.');
      }
      failures.clear(ip);
      const token = crypto.randomBytes(32).toString('base64url');
      store.sessions.add(hex(token), Date.now() + maxAge * 1000);
      return cookie(token, maxAge);
    },

    logout(req) {
      const token = readCookie(req, COOKIE);
      if (token) store.sessions.remove(hex(token));
      return cookie('', 0);
    },
  };
}

module.exports = { createAuth, createLimiter };
