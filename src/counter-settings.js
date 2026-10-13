// Shared defaults and validation for the popup and on-page reel counter.
(function () {
  'use strict';

  const DEFAULTS = Object.freeze({ display: 'island', limit: 50 });
  const MAX_LIMIT = 9999;

  function normalize(settings) {
    const limit = Number(settings?.limit);
    return {
      display: ['island', 'punchhole', 'off'].includes(settings?.display)
        ? settings.display : DEFAULTS.display,
      limit: Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT
        ? limit : DEFAULTS.limit,
    };
  }

  window.__reelRotator = window.__reelRotator || {};
  window.__reelRotator.counterSettings = { DEFAULTS, MAX_LIMIT, normalize };
})();
