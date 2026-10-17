'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = __dirname;
const configPath = path.join(root, 'vortex', 'config.json');
let config;
let key;
const existingManifest = path.join(root, 'chrome', 'manifest.json');
config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
key = fs.existsSync(existingManifest) ? JSON.parse(fs.readFileSync(existingManifest, 'utf8')).key : null;
if (!key) {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = pair.publicKey.export({ type: 'spki', format: 'der' });
  key = der.toString('base64');
}
const id = crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)));
config = { port: 48927, token: /^[0-9a-f]{64}$/.test(config.token || '') ? config.token : crypto.randomBytes(32).toString('hex'), extensionOrigin: `chrome-extension://${id}` };
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'chrome', 'config.js'), `globalThis.VBA_CONFIG = Object.freeze(${JSON.stringify({ port: config.port, token: config.token })});\n`);
const matches = ['https://www.nexusmods.com/*', 'https://nexusmods.com/*'];
const manifest = {
  manifest_version: 3, name: 'Vortex em segundo plano', version: '1.0.8', minimum_chrome_version: '120',
  description: 'Automates Nexus Mods collection download clicks in Vortex using background Chrome tabs, keeping your mouse free.', key,
  icons: { 16: 'assets/logo.png', 32: 'assets/logo.png', 48: 'assets/logo.png', 128: 'assets/logo.png' },
  permissions: ['storage', 'alarms'],
  host_permissions: [...matches, `http://127.0.0.1:${config.port}/*`],
  background: { service_worker: 'background.js' },
  action: { default_title: 'Vortex em segundo plano', default_popup: 'popup.html', default_icon: { 16: 'assets/logo.png', 32: 'assets/logo.png', 48: 'assets/logo.png', 128: 'assets/logo.png' } },
  content_scripts: [
    { matches, js: ['page-hook.js'], run_at: 'document_start', world: 'MAIN' },
    { matches, js: ['dom.js', 'content.js'], run_at: 'document_start', world: 'ISOLATED' },
  ],
};
fs.writeFileSync(existingManifest, JSON.stringify(manifest, null, 2) + '\n');
console.log('Configuração local e extensão do Chrome preparadas.');
