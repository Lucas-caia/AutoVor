'use strict';
importScripts('config.js');
const CFG = globalThis.VBA_CONFIG;
let running = false;
let brokerStatus = null;
let connectionError = null;

async function request(route, data) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`http://127.0.0.1:${CFG.port}${route}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${CFG.token}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Erro ${response.status}`);
    return result;
  } finally { clearTimeout(timeout); }
}
async function getManaged() { return (await chrome.storage.local.get('managed')).managed || (await chrome.storage.session.get('managed')).managed || {}; }
async function putManaged(managed) { await chrome.storage.local.set({ managed }); await chrome.storage.session.set({ managed }); }
async function closeManaged(id, managed) {
  const entry = managed[id];
  if (!entry) return;
  delete managed[id];
  await putManaged(managed);
  try {
    const tab = await chrome.tabs.get(entry.tabId);
    // Tab IDs can be reused after a browser restart. Only close the exact
    // download page this extension opened, never an unrelated user's tab.
    if (isJobPage(tab.url, { identity: entry.identity })) await chrome.tabs.remove(entry.tabId);
  } catch { /* Already closed. */ }
}
async function badge(text, color) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}
function isJobPage(url, job) {
  try {
    const value = new URL(url);
    const path = new RegExp(`^/${job.identity.game}/mods/${job.identity.mod}/?$`, 'i');
    return value.protocol === 'https:' && ['www.nexusmods.com', 'nexusmods.com'].includes(value.hostname)
      && path.test(value.pathname) && value.searchParams.get('file_id') === job.identity.file && value.searchParams.get('nmm') === '1';
  } catch { return false; }
}
async function notifyManaged(enabled) {
  for (const entry of Object.values(await getManaged())) {
    await chrome.tabs.sendMessage(entry.tabId, { type: enabled ? 'resume' : 'pause' }).catch(() => {});
  }
}
async function diagnostic(report) {
  await chrome.storage.session.set({ diagnostic: report });
}
async function tick() {
  try {
    brokerStatus = await request('/jobs');
    connectionError = null;
    await badge(brokerStatus.error ? '!' : brokerStatus.enabled ? 'ON' : '', brokerStatus.error ? '#d97706' : '#1878ef');
    const job = brokerStatus.job;
    const managed = await getManaged();
    for (const id of Object.keys(managed)) {
      if (id !== job?.id) await closeManaged(id, managed);
    }
    if (!brokerStatus.enabled) { await notifyManaged(false); return; }
    if (!job) return;
    if (job.state === 'page' && job.pageUrl && !managed[job.id]) {
      if (!isJobPage(job.pageUrl, job)) throw new Error('O Vortex forneceu uma página fora do fluxo esperado.');
      const tab = await chrome.tabs.create({ url: job.pageUrl, active: false });
      managed[job.id] = { tabId: tab.id, identity: job.identity, pageUrl: job.pageUrl };
      await putManaged(managed);
    }
    if (job.state === 'accepted') {
      const entry = managed[job.id];
      if (entry) {
        await closeManaged(job.id, managed);
      }
      await request('/release', { id: job.id });
    }
  } catch {
    connectionError = 'Não foi possível conectar ao Vortex. Confira se a extensão do Vortex está instalada e reinicie o aplicativo.';
    await badge('?', '#64748b');
    await notifyManaged(false);
  }
}
async function loop() {
  if (running) return;
  running = true;
  try {
    while (true) {
      await tick();
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } finally { running = false; }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    if (sender.id !== chrome.runtime.id) throw new Error('Origem inválida.');
    const isPanel = sender.url === chrome.runtime.getURL('popup.html');
    if (message.type === 'status' && isPanel) {
      const status = await request('/status');
      return { ...status, connectionError };
    }
    if (message.type === 'control' && isPanel) {
      const result = await request('/control', { enabled: message.enabled });
      brokerStatus = result;
      await notifyManaged(result.enabled);
      return result;
    }
    if (!sender.tab) throw new Error('Mensagem não reconhecida.');
    if (message.type === 'diagnostic') {
      const value = new URL(sender.url || sender.tab.url);
      if (value.protocol !== 'https:' || !['www.nexusmods.com', 'nexusmods.com'].includes(value.hostname)) throw new Error('Página inválida.');
      const expected = (await request('/status')).job;
      if (!expected || !isJobPage(value.href, expected)) return { active: false };
      await diagnostic({ ...message.report, path: value.pathname, file: value.searchParams.get('file_id'), tabId: sender.tab.id, time: new Date().toISOString() });
      return { ok: true };
    }
    const managed = await getManaged();
    const pair = Object.entries(managed).find(([, entry]) => entry.tabId === sender.tab.id);
    if (!pair) return { active: false };
    const [id, entry] = pair;
    if (!isJobPage(sender.url || sender.tab.url, { identity: entry.identity })) return { active: false };
    const status = await request('/status');
    if (!status.enabled || status.job?.id !== id || !['page', 'delivered'].includes(status.job.state)) return { active: false };
    if (message.type === 'claim') return { active: true, id, identity: entry.identity, delivered: status.job.state === 'delivered' };
    if (message.type === 'link') return await request('/link', { id, url: message.url });
    if (message.type === 'attention') return await request('/attention', { id });
    return { active: false };
  })().then(result => respond({ ok: true, result }), err => respond({ ok: false, error: err.message || 'Falha na conexão.' }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  (async () => {
    const managed = await getManaged();
    const pair = Object.entries(managed).find(([, entry]) => entry.tabId === tabId);
    if (!pair) return;
    const [id] = pair;
    delete managed[id];
    await putManaged(managed);
    const status = await request('/status');
    if (status.job?.id !== id) return;
    if (status.job.state === 'accepted') await request('/release', { id });
    else await request('/attention', { id });
  })().catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('vortex-background-wake', { periodInMinutes: 0.5 });
  loop();
});
chrome.runtime.onStartup.addListener(() => loop());
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'vortex-background-wake') loop(); });
loop();
