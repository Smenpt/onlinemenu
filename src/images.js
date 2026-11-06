const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { HttpError } = require('./http');

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const UPLOAD_PATH = /^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/;

function sniffExtension(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function createImages(uploadsDir) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const fileOf = url => path.join(uploadsDir, path.basename(url));

  function saveDataUrl(dataUrl) {
    const match = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=]+)$/i.exec(dataUrl);
    if (!match) throw new HttpError(400, 'Некорректное изображение.');
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'Фото слишком большое: максимум 2 МБ.');
    const extension = sniffExtension(bytes);
    if (!extension) throw new HttpError(400, 'Поддерживаются только JPEG, PNG и WebP.');
    const name = `${crypto.randomBytes(16).toString('hex')}.${extension}`;
    fs.writeFileSync(path.join(uploadsDir, name), bytes);
    return `/uploads/${name}`;
  }

  return {
    // Возвращает итоговый адрес фото. Чужой путь сюда не пройдёт: допустим только текущий файл блюда.
    resolve(value, current = '') {
      const image = String(value ?? '');
      if (!image) return '';
      if (image === current) return current;
      if (image.startsWith('data:')) return saveDataUrl(image);
      throw new HttpError(400, 'Некорректное изображение.');
    },
    remove(url) {
      if (UPLOAD_PATH.test(url)) fs.rmSync(fileOf(url), { force: true });
    },
    pathOf: url => (UPLOAD_PATH.test(url) ? fileOf(url) : null),
  };
}

module.exports = { createImages };
