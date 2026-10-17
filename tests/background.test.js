'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('Chrome opens an inactive tab, closes only its managed tab after acceptance and rejects unrelated senders', async () => {
  const calls = { created: [], removed: [], released: 0 };
  let managed = {};
  let localManaged = {};
  let messageHandler;
  const job = { id: 'job-1', identity: { game: 'skyrim', mod: '42', file: '77' }, pageUrl: 'https://www.nexusmods.com/skyrim/mods/42?file_id=77&nmm=1', state: 'page' };
  const status = { enabled: true, job, completed: 0 };
  const chrome = {
    storage: { local: { async get() { return { managed: structuredClone(localManaged) }; }, async set(value) { localManaged = structuredClone(value.managed); } }, session: { async get() { return { managed: structuredClone(managed) }; }, async set(value) { managed = structuredClone(value.managed); } } },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
    tabs: { async get() { return { id: 500, url: job.pageUrl }; }, async create(value) { calls.created.push(value); return { id: 500 }; }, async remove(id) { calls.removed.push(id); }, async sendMessage() {}, onRemoved: { addListener() {} } },
    runtime: { id: 'own-extension', getURL(name) { return `chrome-extension://own-extension/${name}`; }, onMessage: { addListener(fn) { messageHandler = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
    alarms: { create() {}, onAlarm: { addListener() {} } },
  };
  const context = vm.createContext({
    chrome, URL, AbortController, importScripts() {}, VBA_CONFIG: { port: 48927, token: 'test-only' },
    setTimeout(fn, delay) { if (delay === 2000) return 0; return setTimeout(fn, delay); }, clearTimeout,
    async fetch(url) {
      if (url.endsWith('/release')) { calls.released++; return new Response(JSON.stringify({ ok: true })); }
      return new Response(JSON.stringify(status));
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../chrome/background.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].active, false);
  assert.equal(calls.removed.length, 0);
  await vm.runInContext('tick()', context);
  assert.equal(calls.created.length, 1, 'Do not open the same job twice.');
  const reply = await new Promise(resolve => messageHandler({ type: 'claim' }, { id: 'other-extension', tab: { id: 500 }, url: job.pageUrl }, resolve));
  assert.equal(reply.ok, false);
  const oldPage = job.pageUrl;
  const oldIdentity = { ...job.identity };
  job.id = 'job-2'; job.identity = { game: 'skyrim', mod: '43', file: '78' };
  job.pageUrl = 'https://www.nexusmods.com/skyrim/mods/43?file_id=78&nmm=1';
  chrome.tabs.get = async () => ({ id: 500, url: oldPage });
  await vm.runInContext('tick()', context);
  assert.deepEqual(calls.removed, [500], 'Close the old managed page when the Vortex job changes.');
  assert.equal(calls.created.length, 2);
  assert.equal(calls.created[1].url, job.pageUrl);
  chrome.tabs.get = async () => ({ id: 500, url: job.pageUrl });
  job.state = 'accepted';
  await vm.runInContext('tick()', context);
  assert.deepEqual(calls.removed, [500, 500]);
  assert.equal(calls.released, 1);
  assert.deepEqual(managed, {});
});
