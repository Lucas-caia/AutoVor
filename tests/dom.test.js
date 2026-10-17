'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findSlowButton, challengeReason } = require('../chrome/dom');
function element(text, options = {}) {
  return {
    textContent: text, disabled: false, hidden: false,
    getAttribute(name) { return options[name] || null; }, hasAttribute() { return false; },
    classList: { contains() { return false; } },
    getClientRects() { return options.hidden ? [] : [{}]; },
    getBoundingClientRect() { return { width: options.width || 300, height: options.height || 70 }; },
    ownerDocument: { defaultView: { getComputedStyle() { return { display: 'block', visibility: options.visibility || 'visible', opacity: '1' }; } } },
  };
}
test('recognizes a slow-download link with an icon and multiline text without depending on CSS classes', () => {
  const slow = element('  \n Slow   download \n ');
  const premium = element('Fast download - free trial');
  const hidden = element('Slow download', { hidden: true });
  assert.equal(findSlowButton({ querySelectorAll() { return [premium, hidden, slow]; } }), slow);
});
test('hidden anti-bot fields and invisible widgets do not pause an ordinary download page', () => {
  const slow = element('Slow download');
  const doc = { title: 'Mod files', querySelectorAll(selector) {
    return selector.includes('iframe') ? [element('', { hidden: true })] : [];
  } };
  assert.equal(challengeReason(doc, slow), null);
  assert.equal(challengeReason(doc, null), null);
});
test('includes the slow-download element by ID even when it is not a button or anchor', () => {
  const slow = { ...element('Slow download'), id: 'slowDownloadButton' };
  const doc = { querySelectorAll(selector) {
    if (selector === '*') return [slow];
    assert.ok(selector.includes('#slowDownloadButton'));
    return [slow];
  } };
  assert.equal(findSlowButton(doc), slow);
});
test('finds the download button inside nested open Nexus web components', () => {
  const slow = element('Slow download');
  const innerRoot = { querySelectorAll(selector) { return selector === '*' ? [slow] : [slow]; } };
  const innerHost = { shadowRoot: innerRoot };
  const outerRoot = { querySelectorAll(selector) { return selector === '*' ? [innerHost] : []; } };
  const outerHost = { shadowRoot: outerRoot };
  const doc = { querySelectorAll(selector) { return selector === '*' ? [outerHost] : []; } };
  assert.equal(findSlowButton(doc), slow);
});
test('a visible challenge or login is still detected without clicking it', () => {
  assert.equal(challengeReason({ title: 'Just a moment…', querySelectorAll() { return []; } }, null), 'challenge');
  assert.equal(challengeReason({ title: 'Mod files', querySelectorAll(selector) { return selector.includes('password') ? [element('')] : []; } }, null), 'login');
  const doc = { title: 'Mod files', querySelectorAll(selector) { return selector.includes('iframe') ? [element('')] : []; } };
  assert.equal(challengeReason(doc, null), 'challenge');
});
