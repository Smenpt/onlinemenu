const crypto = require('node:crypto');

// Подпись в QR-коде: без неё гость не может отправить заказ на чужой столик,
// просто поменяв номер в адресе.
function tableToken(secret, table) {
  return crypto.createHmac('sha256', secret).update(`table:${table}`).digest('hex').slice(0, 16);
}

function isValidTableToken(secret, table, token) {
  const expected = Buffer.from(tableToken(secret, table));
  const actual = Buffer.from(String(token ?? ''));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = { tableToken, isValidTableToken };
