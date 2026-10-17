'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { createAssistant } = require('../vortex');
const { modIdentity, pageIdentity, sameIdentity, matchingDownload } = require('../vortex/core');

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function fixture() {
  const input = 'nxm://skyrimspecialedition/mods/42/files/77';
  const page = 'https://www.nexusmods.com/skyrimspecialedition/mods/42?tab=files&file_id=77&nmm=1';
  const state = { session: { nexus: { freeUserDLQueue: [input] } }, persistent: { downloads: { files: {} } } };
  const calls = { click: 0, opened: [], shown: 0, links: [] };
  const events = new EventEmitter();
  events.on('start-download-url', url => calls.links.push(url));
  const win = { api: { shell: { openUrl(url) { calls.opened.push(url); } }, window: { async show() { calls.shown++; }, async setAlwaysOnTop() {} } }, document: { querySelector(selector) {
    assert.equal(selector, '#free-user-dl-dialog #download-mod-button');
    return { disabled: false, getAttribute() { return null; }, click() {
      calls.click++;
      const id = modIdentity(state.session.nexus.freeUserDLQueue[0]);
      win.api.shell.openUrl(calls.overridePage || `https://www.nexusmods.com/${id.game}/mods/${id.mod}?tab=files&file_id=${id.file}&nmm=1`);
    } };
  } } };
  return { input, page, state, calls, win, api: { getState: () => state, events } };
}

test('identifies the exact game/mod/file and rejects unrelated or unsigned links', () => {
  assert.equal(pageIdentity('https://evil.example/skyrim/mods/42?file_id=77&nmm=1'), null);
  assert.equal(pageIdentity('https://www.nexusmods.com/skyrim/mods/42?file_id=77'), null);
  assert.equal(modIdentity('nxm://skyrim/mods/42/files/77', true), null);
  assert.equal(modIdentity('nxm://skyrim/mods/42/files/77?key=a&expires=1', true), null);
  assert.equal(sameIdentity(modIdentity('nxm://skyrim/mods/42/files/77'), modIdentity('nxm://skyrim/mods/42/files/78')), false);
  assert.equal(sameIdentity(modIdentity('nxm://skyrim/mods/42/files/77'), pageIdentity('https://www.nexusmods.com/skyrim/mods/42?file_id=77&nmm=1')), true);
});

test('handles Vortex internal game names by matching the original nxm URL', () => {
  const state = { persistent: { downloads: { files: { a: { state: 'started', game: ['skyrimse'], urls: ['nxm://skyrimspecialedition/mods/42/files/77'], modInfo: { nexus: { ids: { modId: 42, fileId: 77 } } } } } } } };
  assert.equal(matchingDownload(state, { game: 'skyrimspecialedition', mod: '42', file: '77' }), true);
  assert.equal(matchingDownload(state, { game: 'fallout4', mod: '42', file: '77' }), false);
});

test('local broker authenticates requests, clicks once, preserves normal links and waits for download confirmation', async () => {
  const f = fixture();
  const options = { port: await freePort(), token: 'test-only-secret', extensionOrigin: 'chrome-extension://test-extension' };
  const assistant = createAssistant(f.api, f.win, options);
  await assistant.start();
  const call = async (route, body, extra = {}) => {
    const response = await fetch(`http://127.0.0.1:${options.port}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${options.token}`, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { code: response.status, value: await response.json() };
  };
  try {
    assert.equal((await call('/status', undefined, { Authorization: 'Bearer incorrect' })).code, 401);
    assert.equal((await call('/status', undefined, { Origin: 'https://evil.example' })).code, 403);
    await call('/control', { enabled: true });
    assistant.tick();
    assert.equal(f.calls.click, 0, 'Must wait for the Chrome worker heartbeat.');
    const response = await call('/jobs');
    const job = response.value.job;
    assert.equal(job.state, 'page');
    assert.equal(job.pageUrl, f.page);
    assert.equal(f.calls.opened.length, 0, 'No foreground browser opening.');
    await call('/jobs'); assistant.tick();
    assert.equal(f.calls.click, 1, 'Do not click the same queue item twice.');
    await f.win.api.window.show(1);
    assert.equal(f.calls.shown, 0, 'Do not steal focus while the queue is active.');
    f.win.api.shell.openUrl('https://www.nexusmods.com/premium');
    assert.deepEqual(f.calls.opened, ['https://www.nexusmods.com/premium']);
    const signed = `nxm://skyrimspecialedition/mods/42/files/77?key=test&expires=${Math.floor(Date.now()/1000)+300}`;
    assert.equal((await call('/link', { id: job.id, url: signed.replace('/77?', '/78?') })).code, 400);
    assert.equal((await call('/link', { id: job.id, url: signed })).code, 200);
    await call('/link', { id: job.id, url: signed });
    assert.equal(f.calls.links.length, 1);
    assert.equal((await call('/release', { id: job.id })).code, 409);
    assistant.tick();
    assert.equal(assistant.status().job.state, 'delivered');
    f.state.session.nexus.freeUserDLQueue = [];
    f.state.persistent.downloads.files.new = { state: 'started', game: ['skyrimse'], urls: [signed], modInfo: { nexus: { ids: { modId: 42, fileId: 77 } } } };
    assistant.tick();
    assert.equal(assistant.status().job.state, 'accepted');
    assert.equal(assistant.status().completed, 1);
    assert.equal((await call('/release', { id: job.id })).code, 200);
    await call('/control', { enabled: false });
    await f.win.api.window.show(1);
    assert.equal(f.calls.shown, 1);
  } finally { await assistant.stop(); }
  f.win.api.shell.openUrl('https://example.com');
  assert.equal(f.calls.opened.at(-1), 'https://example.com', 'Hooks must be restored when stopped.');
});

test('pauses for a page requiring attention and does not silently skip the mod', async () => {
  const f = fixture();
  const options = { port: await freePort(), token: 'test-only-secret', extensionOrigin: 'chrome-extension://test-extension' };
  const assistant = createAssistant(f.api, f.win, options);
  await assistant.start();
  async function call(route, body) {
    const r = await fetch(`http://127.0.0.1:${options.port}${route}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${options.token}` }, body: body ? JSON.stringify(body) : undefined });
    return r.json();
  }
  try {
    await call('/control', { enabled: true });
    const { job } = await call('/jobs');
    await call('/attention', { id: job.id });
    assert.equal(assistant.status().enabled, false);
    assert.equal(assistant.status().job.state, 'attention');
    assert.deepEqual(f.state.session.nexus.freeUserDLQueue, [f.input]);
    assert.equal(f.calls.links.length, 0);
  } finally { await assistant.stop(); }
});

async function queueScenario(run) {
  const f = fixture();
  const options = { port: await freePort(), token: 'test-only-secret', extensionOrigin: 'chrome-extension://test-extension' };
  const assistant = createAssistant(f.api, f.win, options);
  await assistant.start();
  const call = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${options.port}${route}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${options.token}` }, body: body ? JSON.stringify(body) : undefined });
    return { code: response.status, value: await response.json() };
  };
  try {
    await call('/control', { enabled: true });
    const first = (await call('/jobs')).value.job;
    await run({ ...f, assistant, call, first, next: 'nxm://skyrimspecialedition/mods/43/files/78' });
  } finally { await assistant.stop(); }
}

test('resuming after Vortex changes its request never revives the old job', () => queueScenario(async f => {
  await f.call('/control', { enabled: false });
  f.state.session.nexus.freeUserDLQueue = [f.next];
  assert.equal((await f.call('/status')).value.job, null);
  await f.call('/control', { enabled: true });
  const second = (await f.call('/jobs')).value.job;
  assert.equal(second.identity.mod, '43');
  assert.equal(second.identity.file, '78');
  assert.notEqual(second.id, f.first.id);
  const stale = `nxm://skyrimspecialedition/mods/42/files/77?key=test&expires=${Math.floor(Date.now()/1000)+300}`;
  assert.equal((await f.call('/link', { id: f.first.id, url: stale })).code, 409);
  assert.equal(f.calls.links.length, 0);
}));

test('recognizes a download completed through the native handler and advances to the next queue item', () => queueScenario(async f => {
  f.state.session.nexus.freeUserDLQueue = [f.next];
  f.state.persistent.downloads.files.done = { state: 'started', game: ['skyrimspecialedition'], modInfo: { nexus: { ids: { modId: 42, fileId: 77 } } } };
  const accepted = (await f.call('/status')).value;
  assert.equal(accepted.job.state, 'accepted');
  assert.equal(accepted.completed, 1);
  await f.call('/status');
  assert.equal(f.assistant.status().completed, 1);
  await f.call('/release', { id: f.first.id });
  assert.equal((await f.call('/jobs')).value.job.identity.mod, '43');
}));

test('rejects an old link when the Vortex queue changes between opening the page and submitting its link', () => queueScenario(async f => {
  f.state.session.nexus.freeUserDLQueue = [f.next];
  const stale = `nxm://skyrimspecialedition/mods/42/files/77?key=test&expires=${Math.floor(Date.now()/1000)+300}`;
  assert.equal((await f.call('/link', { id: f.first.id, url: stale })).code, 409);
  assert.equal(f.calls.links.length, 0);
  assert.equal((await f.call('/jobs')).value.job.identity.mod, '43');
}));

test('waits for the rendered Vortex dialog to catch up instead of opening its stale page', () => queueScenario(async f => {
  f.state.session.nexus.freeUserDLQueue = [f.next];
  f.calls.overridePage = f.page;
  assert.equal((await f.call('/jobs')).value.job, null);
  assert.equal(f.calls.opened.length, 0);
  f.calls.overridePage = null;
  assert.equal((await f.call('/jobs')).value.job.identity.mod, '43');
}));
