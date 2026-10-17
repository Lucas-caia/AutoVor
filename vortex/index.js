'use strict';

const http = require('http');
const crypto = require('crypto');
const { modIdentity, pageIdentity, sameIdentity, matchingDownload } = require('./core');
const config = require('./config.json');

function createAssistant(api, win, options = config) {
  let enabled = false;
  let lastPoll = 0;
  let current = null;
  let completed = 0;
  let error = null;
  const history = [];
  const shell = win.api?.shell;
  const windowApi = win.api?.window;
  let server;
  let interval;
  let originalOpen;
  const restores = [];

  const queue = () => api.getState()?.session?.nexus?.freeUserDLQueue || [];
  const connected = () => Date.now() - lastPoll < 15000;
  const active = () => enabled && connected();
  const note = message => {
    history.unshift({ time: new Date().toISOString(), message });
    history.splice(15);
  };
  const pause = message => { enabled = false; error = message || null; if (message) note(message); };
  const publicJob = () => current && ({ id: current.id, identity: current.identity, pageUrl: current.pageUrl, state: current.state });
  const status = () => ({ version: '1.1.1', enabled, connected: connected(), completed, error, job: publicJob(), queueHead: modIdentity(queue()[0]), history });

  function synchronize() {
    if (!current || current.state === 'accepted') return;
    const pending = queue();
    const head = modIdentity(pending[0]);
    if (sameIdentity(head, current.identity)) {
      current.input = pending[0];
      return;
    }
    const stillQueued = pending.some(input => sameIdentity(modIdentity(input), current.identity));
    if (!stillQueued && matchingDownload(api.getState(), current.identity)) {
      current.state = 'accepted';
      completed++;
      error = null;
      note('Download confirmado pelo Vortex.');
      return;
    }
    // Resolving a link can remove the queue item just before its download record
    // arrives. Give that record a bounded grace period, never resend the old link.
    if (!stillQueued && current.state === 'delivered' && Date.now() - current.deliveredAt < 20000) return;
    current = null;
    error = null;
    note(head ? 'A fila mudou. Acompanhando a solicitação atual do Vortex.' : 'O Vortex não está mais aguardando este mod.');
  }

  function tick() {
    synchronize();
    if (!enabled) return;
    const pending = queue();
    if (!active()) return;
    if (current && !['accepted'].includes(current.state)) {
      if (Date.now() - current.createdAt > 180000 && current.state !== 'attention') {
        current.state = 'attention';
        pause('A página demorou mais de 3 minutos. Confira login, CAPTCHA ou a mensagem exibida.');
      }
      return;
    }
    // An accepted job stays until Chrome explicitly acknowledges closing its tab.
    if (current) return;
    if (!pending.length) return;
    const input = pending[0];
    const identity = modIdentity(input);
    if (!identity) { pause('O Vortex apresentou um tipo de link não reconhecido.'); return; }
    const button = win.document?.querySelector('#free-user-dl-dialog #download-mod-button');
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
    current = { id: crypto.randomUUID(), identity, input, state: 'opening', createdAt: Date.now(), pageUrl: null };
    try {
      button.click();
      if (current?.state === 'opening') {
        current = null;
      }
    } catch {
      if (current) {
        current.state = 'attention';
        pause('Não foi possível acionar o botão de download do Vortex.');
      }
    }
  }

  function installHooks() {
    if (!shell || typeof shell.openUrl !== 'function' || !windowApi) throw new Error('Esta versão do Vortex não expõe a integração necessária.');
    originalOpen = shell.openUrl;
    const wrapped = function(target, ...args) {
      if (active() && current?.state === 'opening' && pageIdentity(target)) {
        const requested = pageIdentity(target);
        if (sameIdentity(requested, current.identity) && sameIdentity(requested, modIdentity(queue()[0]))) {
          current.pageUrl = String(target);
          current.state = 'page';
          note('Página encaminhada para uma aba em segundo plano.');
        } else {
          current = null;
          note('Aguardando o diálogo atualizar para o mod atual.');
        }
        return;
      }
      return originalOpen.call(this, target, ...args);
    };
    shell.openUrl = wrapped;
    if (shell.openUrl !== wrapped) throw new Error('A integração de navegador está protegida contra alterações nesta versão.');
    restores.push(() => { if (shell.openUrl === wrapped) shell.openUrl = originalOpen; });
    // Only suppress the download dialog's automatic foreground request while armed.
    for (const name of ['show', 'setAlwaysOnTop']) {
      if (typeof windowApi[name] !== 'function') continue;
      const original = windowApi[name];
      const hook = function(...args) {
        if (active() && queue().length && (name === 'show' || args[1] === true)) return Promise.resolve();
        return original.apply(this, args);
      };
      windowApi[name] = hook;
      restores.push(() => { if (windowApi[name] === hook) windowApi[name] = original; });
    }
  }

  function validToken(value) {
    const received = Buffer.from(String(value || ''));
    const expected = Buffer.from(`Bearer ${options.token}`);
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  }

  async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (code, body) => { res.writeHead(code); res.end(JSON.stringify(body)); };
    const origin = req.headers.origin;
    if (req.headers.host !== `127.0.0.1:${options.port}` || (origin && origin !== options.extensionOrigin)) return send(403, { error: 'Origem não autorizada.' });
    if (!validToken(req.headers.authorization)) return send(401, { error: 'Conexão não autorizada.' });
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    const route = req.url;
    if (req.method === 'GET' && route === '/status') { synchronize(); return send(200, status()); }
    if (req.method === 'GET' && route === '/jobs') { lastPoll = Date.now(); tick(); return send(200, status()); }
    if (req.method !== 'POST') return send(404, { error: 'Rota não encontrada.' });
    let body = '';
    try {
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 16384) return send(413, { error: 'Mensagem muito grande.' });
      }
      body = JSON.parse(body || '{}');
    } catch { return send(400, { error: 'Mensagem inválida.' }); }
    synchronize();
    if (route === '/control') {
      if (body.enabled === false) { pause(); note('Automação pausada.'); }
      else if (body.enabled === true) {
        error = null;
        if (current?.state === 'attention') {
          // Resume the same job; never reopen or click the Vortex button twice.
          current.state = current.deliveredAt ? 'delivered' : 'page';
        }
        if (current && current.state !== 'accepted') current.createdAt = Date.now();
        enabled = true;
        note('Automação iniciada.');
      } else return send(400, { error: 'Controle inválido.' });
      return send(200, status());
    }
    if (!current || body.id !== current.id) return send(409, { error: 'Esta tarefa não está mais ativa.' });
    if (route === '/link') {
      if (!enabled) return send(409, { error: 'Automação pausada.' });
      if (!sameIdentity(modIdentity(body.url, true), current.identity)) return send(400, { error: 'O link não corresponde ao mod aguardado ou expirou.' });
      if (current.state === 'accepted' || current.state === 'delivered') return send(200, { ok: true });
      if (current.state !== 'page') return send(409, { error: 'A tarefa não está aguardando um link.' });
      if (!sameIdentity(modIdentity(queue()[0]), current.identity)) return send(409, { error: 'O Vortex agora está aguardando outro mod.' });
      current.state = 'delivered';
      current.deliveredAt = Date.now();
      api.events.emit('start-download-url', body.url);
      note('Link autorizado enviado ao Vortex. Aguardando confirmação.');
      return send(200, { ok: true });
    }
    if (route === '/attention') {
      if (current.state === 'accepted') return send(200, { ok: true });
      current.state = 'attention';
      pause('A página precisa da sua atenção. Abra a aba do mod e confira login, CAPTCHA ou o botão de download.');
      return send(200, { ok: true });
    }
    if (route === '/release') {
      if (current.state !== 'accepted') return send(409, { error: 'O download ainda não foi confirmado.' });
      current = null;
      return send(200, { ok: true });
    }
    return send(404, { error: 'Rota não encontrada.' });
  }

  async function start() {
    installHooks();
    server = http.createServer((req, res) => handler(req, res).catch(() => {
      pause('Falha na conexão local.');
      if (!res.headersSent) res.writeHead(500);
      res.end(JSON.stringify({ error: 'Falha interna.' }));
    }));
    server.headersTimeout = 10000;
    server.requestTimeout = 15000;
    server.on('error', () => pause('Não foi possível abrir a conexão local. Verifique se outra instância está usando a porta.'));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port, '127.0.0.1', resolve); });
    interval = setInterval(tick, 750);
    interval.unref?.();
    note('Pronto. Inicie pela extensão do Chrome.');
  }
  async function stop() {
    enabled = false;
    clearInterval(interval);
    restores.reverse().forEach(restore => restore());
    if (server?.listening) await new Promise(resolve => server.close(resolve));
  }
  return { start, stop, status, tick };
}

function init(context) {
  context.requireVersion('>=2.8.2');
  context.once(async () => {
    if (typeof window === 'undefined') return;
    if (window.__vortexBackgroundAssistant) return;
    const assistant = createAssistant(context.api, window);
    window.__vortexBackgroundAssistant = assistant;
    try {
      await assistant.start();
      window.addEventListener('beforeunload', () => assistant.stop(), { once: true });
      context.api.sendNotification({ id: 'vortex-background-ready', type: 'info', message: 'Assistente pronto. Use a extensão do Chrome para iniciar ou pausar.', displayMS: 8000 });
    } catch (err) {
      await assistant.stop();
      context.api.showErrorNotification('Assistente de downloads indisponível', err, { allowReport: false });
    }
  });
  return true;
}
module.exports = { default: init, createAssistant };
