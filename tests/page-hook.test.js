'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
class CustomEvent extends Event { constructor(name, options = {}) { super(name); this.detail = options.detail; } }
const signed = 'nxm://skyrim/mods/42/files/77?key=test&expires=9999999999';
function fixture() {
  const document = new EventTarget();
  const delivered = [], opened = [];
  document.addEventListener('vba:authorized-link', event => delivered.push(event.detail));
  class XHR extends EventTarget {
    readyState = 0; responseType = ''; responseURL = 'https://www.nexusmods.com/Core/Downloads';
    open() {}
    get responseText() { return JSON.stringify({ url: signed, value: 42 }); }
    get response() { return this.responseText; }
  }
  const window = { open(url) { opened.push(url); return {}; }, async fetch() { return new Response(JSON.stringify({ url: signed, value: 42 }), { status: 200 }); } };
  const context = vm.createContext({ window, document, XMLHttpRequest: XHR, URL, Headers, Response, CustomEvent, location: { href: 'https://www.nexusmods.com/skyrim/mods/42?file_id=77&nmm=1' } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../chrome/page-hook.js'), 'utf8'), context);
  return { window, document, XHR, delivered, opened, arm() { document.dispatchEvent(new CustomEvent('vba:initialize', { detail: { game: 'skyrim', mod: '42', file: '77' } })); } };
}
test('does nothing before pairing or after pause and preserves unrelated links', () => {
  const f = fixture();
  f.window.open(signed);
  assert.deepEqual(f.opened, [signed]);
  f.arm();
  f.window.open(signed.replace('/77?', '/78?'));
  assert.equal(f.delivered.length, 0);
  f.window.open(signed);
  assert.deepEqual(f.delivered, [signed]);
  assert.equal(f.opened.length, 2);
  f.document.dispatchEvent(new CustomEvent('vba:pause'));
  f.window.open(signed);
  assert.equal(f.opened.length, 3);
});
test('captures the authorized fetch response, preserves unrelated fields and prevents the external protocol navigation', async () => {
  const f = fixture(); f.arm();
  const response = await f.window.fetch('https://www.nexusmods.com/Core/Downloads');
  assert.deepEqual(await response.json(), { url: '#__vortex_download_forwarded__', value: 42 });
  f.window.open('#__vortex_download_forwarded__');
  assert.equal(f.opened.length, 0, 'Do not create a duplicate tab for the forwarded link.');
  assert.deepEqual(f.delivered, [signed]);
});
test('captures the ordinary XHR response before the page callback', () => {
  const f = fixture(); f.arm();
  const xhr = new f.XHR();
  xhr.open('POST', 'https://www.nexusmods.com/Core/Downloads');
  xhr.readyState = 4;
  xhr.dispatchEvent(new Event('readystatechange'));
  assert.deepEqual(JSON.parse(xhr.responseText), { url: '#__vortex_download_forwarded__', value: 42 });
  assert.deepEqual(f.delivered, [signed]);
});
