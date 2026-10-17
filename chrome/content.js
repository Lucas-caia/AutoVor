(() => {
  'use strict';
  let job = null;
  let clicked = false;
  let delivered = false;
  let startedAt = Date.now();
  let claiming = false;
  let attentionSent = false;
  let paused = false;
  let challengeSince = null;
  const { deepQuery, findSlowButton, challengeReason } = globalThis.VBA_DOM;
  let lastDiagnostic = 0;
  async function diagnose(stage, extra = {}) {
    const page = new URL(location.href);
    if (page.searchParams.get('nmm') !== '1' || !page.searchParams.has('file_id')) return;
    if (Date.now() - lastDiagnostic < 4000 && stage !== 'clicked' && stage !== 'claim-error') return;
    lastDiagnostic = Date.now();
    const candidates = deepQuery(document, 'button, a, [role="button"], input[type="button"], input[type="submit"]')
      .filter(element => /slow|download|baixar/i.test(element.textContent || '') || /slow|download/i.test(element.id || ''))
      .slice(0, 25).map(element => {
        const style = getComputedStyle(element);
        return { tag: element.tagName, id: element.id, text: String(element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160), ariaLabel: element.getAttribute('aria-label'), value: element.value, disabled: !!element.disabled, rects: element.getClientRects().length, display: style.display, visibility: style.visibility, opacity: style.opacity };
      });
    const all = deepQuery(document, '*');
    const slowElements = all.filter(element => {
      const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
      return text.length <= 100 && /slow\s+download/i.test(text) && ![...element.children].some(child => /slow\s+download/i.test(child.textContent || ''));
    }).slice(0, 8).map(element => ({ tag: element.tagName, id: element.id, text: (element.textContent || '').trim().slice(0, 100), className: String(element.className || '').slice(0, 160), parentTag: element.parentElement?.tagName, parentId: element.parentElement?.id, parentClass: String(element.parentElement?.className || '').slice(0, 160) }));
    const shadowHosts = all.filter(element => element.shadowRoot).slice(0, 10).map(element => ({ tag: element.tagName, id: element.id }));
    await send({ type: 'diagnostic', report: { stage, candidates, slowElements, shadowHosts, visibility: document.visibilityState, frameCount: document.querySelectorAll('iframe').length, documentReady: document.readyState, ...extra } }).catch(() => {});
  }
  const send = async message => {
    const reply = await chrome.runtime.sendMessage(message);
    if (!reply?.ok) throw new Error(reply?.error || 'Conexão indisponível.');
    return reply.result;
  };
  function initialize(identity) {
    document.dispatchEvent(new CustomEvent('vba:initialize', { detail: identity }));
  }
  function pause() {
    paused = true;
    document.dispatchEvent(new CustomEvent('vba:pause'));
  }
  async function attention() {
    if (attentionSent || !job) return;
    attentionSent = true;
    pause();
    await send({ type: 'attention' }).catch(() => {});
  }
  async function claim() {
    if (claiming) return;
    claiming = true;
    try {
      const result = await send({ type: 'claim' });
      if (!result.active) { await diagnose('not-claimed'); pause(); return; }
      job = result;
      paused = false;
      delivered = delivered || result.delivered;
      initialize(result.identity);
    } catch (err) { await diagnose('claim-error', { error: err.message }); pause(); }
    finally { claiming = false; }
  }
  document.addEventListener('vba:authorized-link', async event => {
    if (!job || paused || delivered || typeof event.detail !== 'string') return;
    try {
      const url = new URL(event.detail);
      const id = job.identity;
      if (url.protocol !== 'nxm:' || url.hostname.toLowerCase() !== id.game || url.pathname !== `/mods/${id.mod}/files/${id.file}`) return;
      const result = await send({ type: 'link', url: event.detail });
      if (result?.active === false) { pause(); return; }
      delivered = true;
    } catch (err) {
      console.warn('Vortex em segundo plano: falha ao encaminhar o link.', err.message);
      await attention();
    }
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'pause') pause();
    if (message.type === 'resume') { attentionSent = false; startedAt = Date.now(); claim(); }
  });
  setInterval(async () => {
    if (!job || paused) { await claim(); return; }
    if (delivered) return;
    const button = findSlowButton(document);
    const challenge = challengeReason(document, button);
    await diagnose(delivered ? 'delivered' : clicked ? 'waiting-link' : button ? 'button-found' : 'button-missing', { challenge });
    if (challenge) {
      challengeSince ??= Date.now();
      // Allow an automatic loading check to finish without prematurely pausing.
      if (challenge === 'login' || Date.now() - challengeSince >= 15000) await attention();
      return;
    }
    challengeSince = null;
    for (const anchor of deepQuery(document, 'a[href^="nxm://"]')) {
      const value = anchor.href;
      const match = new URL(value);
      if (match.hostname.toLowerCase() === job.identity.game && match.pathname === `/mods/${job.identity.mod}/files/${job.identity.file}` && match.searchParams.get('key')) {
        document.dispatchEvent(new CustomEvent('vba:authorized-link', { detail: value }));
        return;
      }
    }
    if (!clicked) {
      if (button) {
        clicked = true;
        button.click();
        await diagnose('clicked');
      }
    }
    if (Date.now() - startedAt > 120000) await attention();
  }, 1500);
  claim();
})();
