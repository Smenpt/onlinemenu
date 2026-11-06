const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function parseEnv(text) {
  const values = {};
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

function readEnvFile(file) {
  try {
    return parseEnv(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function intFrom(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

// Секреты создаются при первом запуске и остаются только в .env.
function ensureSecrets(env, file) {
  const added = {};
  if (!env.ADMIN_PASSWORD) added.ADMIN_PASSWORD = crypto.randomBytes(9).toString('base64url');
  if (!env.TABLE_SECRET) added.TABLE_SECRET = crypto.randomBytes(32).toString('hex');
  if (Object.keys(added).length) {
    const lines = Object.entries(added).map(([key, value]) => `${key}=${value}`).join('\n');
    fs.appendFileSync(file, `${lines}\n`, 'utf8');
  }
  return added;
}

function loadConfig({ generateSecrets = false } = {}) {
  const envFile = path.join(ROOT, '.env');
  const env = { ...readEnvFile(envFile), ...process.env };
  const added = generateSecrets ? ensureSecrets(env, envFile) : {};
  const merged = { ...env, ...added };
  const dataDir = merged.DATA_DIR ? path.resolve(merged.DATA_DIR) : path.join(ROOT, 'data');

  return {
    port: intFrom(merged.PORT, 3000, 0, 65535),
    host: merged.HOST || '0.0.0.0',
    dataDir,
    backupDir: merged.BACKUP_DIR ? path.resolve(merged.BACKUP_DIR) : path.join(ROOT, 'backups'),
    legacyDir: ROOT,
    publicDir: path.join(ROOT, 'public'),
    tables: intFrom(merged.TABLES, 20, 1, 500),
    openHour: intFrom(merged.OPEN_HOUR, 10, 0, 23),
    closeHour: intFrom(merged.CLOSE_HOUR, 23, 1, 24),
    publicUrl: (merged.PUBLIC_URL || '').replace(/\/+$/, ''),
    sessionHours: intFrom(merged.SESSION_HOURS, 12, 1, 720),
    adminPassword: merged.ADMIN_PASSWORD || '',
    tableSecret: merged.TABLE_SECRET || '',
    generatedPassword: Boolean(added.ADMIN_PASSWORD),
  };
}

module.exports = { loadConfig, parseEnv };
