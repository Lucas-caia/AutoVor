(() => {
  'use strict';
  function deepQuery(root, selector) {
    const result = [];
    const visited = new Set();
    function visit(scope) {
      if (!scope || visited.has(scope)) return;
      visited.add(scope);
      result.push(...scope.querySelectorAll(selector));
      for (const element of scope.querySelectorAll('*')) {
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    }
    visit(root);
    return result;
  }
  function isVisible(element) {
    if (!element || element.hidden || !element.getClientRects().length) return false;
    const style = element.ownerDocument?.defaultView?.getComputedStyle(element);
    return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && Number(style.opacity) !== 0);
  }
  function label(element) {
    let text = element.textContent || '';
    if (element.cloneNode) {
      const copy = element.cloneNode(true);
      copy.querySelectorAll('svg, script, style, [aria-hidden="true"], .material-icons, .material-symbols-outlined').forEach(icon => icon.remove());
      text = copy.textContent || text;
    }
    return String(text || element.getAttribute('aria-label') || element.value || '').replace(/\s+/g, ' ').trim();
  }
  function findSlowButton(document) {
    const candidates = deepQuery(document, '#slowDownloadButton, #slow-download-button, #slowDownload, button, a, [role="button"], [onclick], [class*="button" i], [class*="btn" i], input[type="button"], input[type="submit"]');
    return candidates.find(element => {
      const text = label(element);
      return (/^(slow download|download lento|baixar lentamente)$/i.test(text) || ['slowDownloadButton', 'slow-download-button', 'slowDownload'].includes(element.id))
        && !element.disabled && !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true'
        && !element.classList?.contains('disabled') && isVisible(element);
    }) || null;
  }
  function challengeReason(document, slowButton) {
    if (deepQuery(document, 'input[type="password"]').some(isVisible)) return 'login';
    // A normal slow-download button is actionable even if the site keeps a
    // hidden Turnstile field/widget in the DOM. Never interact with the widget.
    if (slowButton) return null;
    if (/just a moment|attention required|verify you are human|verifique que voc[eê] [eé] humano/i.test(document.title || '')) return 'challenge';
    const frames = deepQuery(document, 'iframe[src*="captcha"], iframe[src*="challenges.cloudflare.com"]');
    if (frames.some(frame => {
      if (!isVisible(frame)) return false;
      const rect = frame.getBoundingClientRect();
      return rect.width >= 40 && rect.height >= 30;
    })) return 'challenge';
    return null;
  }
  const helpers = { deepQuery, isVisible, label, findSlowButton, challengeReason };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  else globalThis.VBA_DOM = helpers;
})();
