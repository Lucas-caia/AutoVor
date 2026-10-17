// Runs in the page world. Dormant until the isolated script claims a managed tab.
(() => {
  'use strict';
  let target = null;
  const forwarded = '#__vortex_download_forwarded__';
  const seen = new Set();
  const normalize = value => String(value).replace(/&amp;/g, '&');
  function matches(value) {
    if (!target || typeof value !== 'string') return false;
    try {
      const url = new URL(normalize(value));
      return url.protocol === 'nxm:' && url.hostname.toLowerCase() === target.game
        && url.pathname === `/mods/${target.mod}/files/${target.file}`
        && !!url.searchParams.get('key') && !!url.searchParams.get('expires');
    } catch { return false; }
  }
  function deliver(value) {
    value = normalize(value);
    if (!matches(value)) return false;
    if (!seen.has(value)) {
      seen.add(value);
      document.dispatchEvent(new CustomEvent('vba:authorized-link', { detail: value }));
    }
    return true;
  }
  function sanitize(value) {
    if (typeof value === 'string') return deliver(value) ? forwarded : value;
    if (Array.isArray(value)) return value.map(sanitize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item)]));
    return value;
  }
  function sanitizeText(text) {
    if (!target || typeof text !== 'string' || !text.includes('nxm:')) return null;
    try {
      const original = JSON.parse(text);
      const before = seen.size;
      const cleaned = sanitize(original);
      return seen.size > before || JSON.stringify(cleaned) !== JSON.stringify(original) ? JSON.stringify(cleaned) : null;
    } catch { return null; }
  }
  function sameSite(value) {
    try { return ['www.nexusmods.com', 'nexusmods.com'].includes(new URL(value, location.href).hostname); } catch { return false; }
  }
  document.addEventListener('vba:initialize', event => { target = event.detail; });
  document.addEventListener('vba:pause', () => { target = null; });
  document.addEventListener('click', event => {
    if (!target) return;
    const anchor = event.composedPath?.().find(element => element.matches?.('a[href]')) || event.target?.closest?.('a[href]');
    if (anchor && deliver(anchor.href)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);

  const originalOpen = window.open;
  window.open = function(url, ...args) {
    if (target && url === forwarded) return null;
    if (deliver(url)) return null;
    return originalOpen.call(this, url, ...args);
  };

  // Preserve the ordinary website request and wait. Only intercept the signed
  // nxm link it returns for this exact Vortex task, preventing a foreground prompt.
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(...args) {
    if (!this.__vbaObserved) {
      this.__vbaObserved = true;
      this.addEventListener('readystatechange', () => {
        if (!target || this.readyState !== 4 || !sameSite(this.responseURL || args[1])) return;
        try {
          if (this.responseType === 'json') {
            const original = this.response;
            const cleaned = sanitize(original);
            if (JSON.stringify(original) !== JSON.stringify(cleaned)) Object.defineProperty(this, 'response', { configurable: true, value: cleaned });
          } else if (!this.responseType || this.responseType === 'text') {
            const cleaned = sanitizeText(this.responseText);
            if (cleaned !== null) {
              Object.defineProperty(this, 'responseText', { configurable: true, value: cleaned });
              Object.defineProperty(this, 'response', { configurable: true, value: cleaned });
            }
          }
        } catch { /* Leave unsupported responses unchanged. */ }
      }, true);
    }
    return originalXhrOpen.apply(this, args);
  };

  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    if (!target || !sameSite(response.url || String(args[0]))) return response;
    try {
      const cleaned = sanitizeText(await response.clone().text());
      if (cleaned === null) return response;
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      return new Response(cleaned, { status: response.status, statusText: response.statusText, headers });
    } catch { return response; }
  };
})();
