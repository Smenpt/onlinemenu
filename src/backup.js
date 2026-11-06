const fs = require('node:fs');
const path = require('node:path');

const KEEP_DAYS = 14;
const INTERVAL_MS = 60 * 60 * 1000;

function localDate(date = new Date()) {
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function runBackup(store, backupDir, uploadsDir) {
  fs.mkdirSync(backupDir, { recursive: true });
  const target = path.join(backupDir, `cafe-${localDate()}.db`);
  const temp = `${target}.tmp`;
  fs.rmSync(temp, { force: true });
  store.backupTo(temp);
  fs.renameSync(temp, target);

  fs.cpSync(uploadsDir, path.join(backupDir, 'uploads'), { recursive: true, force: false });

  const copies = fs.readdirSync(backupDir).filter(name => /^cafe-\d{4}-\d{2}-\d{2}\.db$/.test(name)).sort();
  for (const name of copies.slice(0, -KEEP_DAYS)) fs.rmSync(path.join(backupDir, name));
  return target;
}

function scheduleBackups(store, backupDir, uploadsDir) {
  const run = () => {
    try {
      runBackup(store, backupDir, uploadsDir);
    } catch (error) {
      console.error('Не удалось сделать резервную копию:', error.message);
    }
  };
  run();
  const timer = setInterval(run, INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { runBackup, scheduleBackups, localDate };
