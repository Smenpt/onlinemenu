const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { before, test } = require('node:test');
const { parseEnv } = require('../src/config');

let shared;

before(async () => {
  shared = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'shared.js')));
});

test('esc обезвреживает разметку', () => {
  assert.equal(shared.esc(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
  assert.equal(shared.esc(null), '');
});

test('plural склоняет числа', () => {
  const dishes = count => shared.plural(count, 'блюдо', 'блюда', 'блюд');
  assert.equal(dishes(0), '0 блюд');
  assert.equal(dishes(1), '1 блюдо');
  assert.equal(dishes(3), '3 блюда');
  assert.equal(dishes(5), '5 блюд');
  assert.equal(dishes(11), '11 блюд');
  assert.equal(dishes(21), '21 блюдо');
  assert.equal(dishes(112), '112 блюд');
});

test('поиск прощает опечатки и не засоряет выдачу', () => {
  assert.equal(shared.matchesDish('Борщ', 'борщ'), true);
  assert.equal(shared.matchesDish('Борщ', 'борш'), true);
  assert.equal(shared.matchesDish('Цыплёнок с травами', 'цыпленок'), true);
  assert.equal(shared.matchesDish('Цыплёнок с травами', 'трав'), true);
  assert.equal(shared.matchesDish('Флэт уайт', 'флет'), true);
  assert.equal(shared.matchesDish('Борщ', ''), true);
  assert.equal(shared.matchesDish('Борщ', 'чай'), false);
  assert.equal(shared.matchesDish('Чизкейк с ягодами', 'х'), false);
});

test('разбор .env понимает BOM, кавычки и комментарии', () => {
  assert.deepEqual(parseEnv('﻿PORT=3000\r\n# комментарий\nADMIN_PASSWORD="a b"\n'), { PORT: '3000', ADMIN_PASSWORD: 'a b' });
});
