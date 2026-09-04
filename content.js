// ─── content.js ───────────────────────────────────────────────────
// Thin orchestrator. The actual work lives in `src/` modules; each
// attaches itself to `window.__reelRotator` when it loads.
//
// Module load order is declared in manifest.json — by the time this
// file runs, every module is already on the namespace.

(function () {
  'use strict';

  const RR = window.__reelRotator;
  if (!RR) {
    // Shouldn't happen given manifest load order, but bail loudly if it does.
    console.error('[Reel Rotator] namespace missing — module load order is broken');
    return;
  }

  function ensureBridgeLoaded() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('src/bridge.js');
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (_) {}
  }

  function bootstrap() {
    ensureBridgeLoaded();
    RR.keymap.setupStorageListener();
    RR.keymap.hydrate(() => RR.ui.init());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
