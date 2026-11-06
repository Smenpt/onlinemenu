const os = require('node:os');

function lanUrls(port) {
  const urls = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) urls.push(`http://${address.address}:${port}`);
    }
  }
  return urls;
}

// QR-код должен вести на адрес, доступный с телефона, а не на localhost.
function publicBaseUrl(req, config) {
  if (config.publicUrl) return config.publicUrl;
  const host = req.headers.host || '';
  if (host && !/^(localhost|127\.|\[::1\])/i.test(host)) return `http://${host}`;
  const port = host.split(':')[1] || config.port;
  return lanUrls(port)[0] || `http://${host || 'localhost'}`;
}

module.exports = { lanUrls, publicBaseUrl };
