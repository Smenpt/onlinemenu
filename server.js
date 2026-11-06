const { loadConfig } = require('./src/config');
const { createApp } = require('./src/app');
const { lanUrls } = require('./src/network');

const config = loadConfig({ generateSecrets: true });
if (config.generatedPassword) {
  console.log(`\nСоздан пароль администратора: ${config.adminPassword}`);
  console.log('Он сохранён в файле .env. Там же его можно поменять.\n');
}

const app = createApp(config);

app.server.on('error', error => {
  if (error.code === 'EADDRINUSE') console.error(`Порт ${config.port} уже занят. Закройте другой сервер или укажите PORT в .env.`);
  else console.error('Не удалось запустить сервер:', error.message);
  process.exit(1);
});

app.server.listen(config.port, config.host, () => {
  console.log(`Меню на этом компьютере: http://localhost:${config.port}`);
  for (const url of lanUrls(config.port)) console.log(`Для телефонов в сети:    ${url}`);
  console.log(`Админ-панель:            http://localhost:${config.port}/admin`);
});

function shutdown() {
  app.close().finally(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
