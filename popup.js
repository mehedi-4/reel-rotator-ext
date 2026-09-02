// ─── popup.js ────────────────────────────────────────────────────
// Settings popup: load keybinds from chrome.storage.local, let the
// user rebind them, write back. Single-letter inputs only.

(function () {
  'use strict';

  // Same constants as src/keymap.js — kept in sync by convention.
  const DEFAULTS = {
    rotate:   'r',
    focus:    'f',
    prevReel: 'w',
    nextReel: 'a',
    react:    'q',
    send:     's',
    comment:  'c',
  };

  const inputs = Array.from(document.querySelectorAll('input[data-action]'));
  const statusEl = document.getElementById('status');

  function showStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.dataset.error = isError ? '1' : '';
  }

  function loadKeymap() {
    chrome.storage.local.get({ keymap: DEFAULTS }, (res) => {
      const km = { ...DEFAULTS, ...(res.keymap || {}) };
      inputs.forEach((inp) => {
        inp.value = (km[inp.dataset.action] || '').toLowerCase();
      });
    });
  }

  // Force each input to a single lowercase character.
  inputs.forEach((inp) => {
    inp.addEventListener('input', () => {
      const v = inp.value.toLowerCase();
      inp.value = v.length > 0 ? v.slice(-1) : '';
    });
    // Submit on Enter from any field.
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('settings-form').requestSubmit();
      }
    });
  });

  document.getElementById('settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const keymap = {};
    let empty = [];
    inputs.forEach((inp) => {
      const v = inp.value.toLowerCase();
      if (!v) empty.push(inp.dataset.action);
      else keymap[inp.dataset.action] = v;
    });
    if (empty.length) {
      showStatus(`Please set a key for: ${empty.join(', ')}`, true);
      return;
    }
    chrome.storage.local.set({ keymap }, () => {
      showStatus('Saved! Changes apply instantly.');
    });
  });

  document.getElementById('reset').addEventListener('click', () => {
    chrome.storage.local.set({ keymap: DEFAULTS }, () => {
      inputs.forEach((inp) => { inp.value = DEFAULTS[inp.dataset.action]; });
      showStatus('Reset to defaults.');
    });
  });

  // Initial load.
  loadKeymap();
})();
