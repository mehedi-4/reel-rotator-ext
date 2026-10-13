// ─── popup.js ────────────────────────────────────────────────────
// Settings popup: reel counter preferences and single-letter keybinds.

(function () {
  'use strict';

  // Same constants as src/keymap.js — kept in sync by convention.
  const DEFAULTS = {
    rotate:      'r',
    rotateCW:    'e',
    focus:       'f',
    prevReel:    'w',
    nextReel:    's',
    react:       'q',
    repost:      'v',
    save:        'x',
    addToQueue:  'd',
    toggleAudio: 't',
    toggleQueue: 'g',
  };

  const inputs = Array.from(document.querySelectorAll('input[data-action]'));
  const statusEl = document.getElementById('status');
  const displayInput = document.getElementById('counter-display');
  const limitInput = document.getElementById('reel-limit');
  const counterSettings = window.__reelRotator.counterSettings;

  function showStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.dataset.error = isError ? '1' : '';
  }

  function loadSettings() {
    chrome.storage.local.get({ keymap: DEFAULTS, reelCounter: counterSettings.DEFAULTS }, (res) => {
      const stored = res.keymap || {};
      delete stored.send;
      delete stored.comment;
      if (stored.nextReel === 'a') {
        stored.nextReel = 's';
      }
      if (!stored.toggleQueue) {
        stored.toggleQueue = DEFAULTS.toggleQueue;
      }
      if (!stored.save) {
        stored.save = DEFAULTS.save;
      }
      try { chrome.storage.local.set({ keymap: stored }); } catch (_) {}
      const km = { ...DEFAULTS, ...stored };
      inputs.forEach((inp) => {
        inp.value = (km[inp.dataset.action] || '').toLowerCase();
      });
      const counter = counterSettings.normalize(res.reelCounter);
      displayInput.value = counter.display;
      limitInput.value = counter.limit;
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
    const limit = Number(limitInput.value);
    if (!Number.isInteger(limit) || limit < 1 || limit > counterSettings.MAX_LIMIT) {
      showStatus(`Set a reel limit from 1 to ${counterSettings.MAX_LIMIT}.`, true);
      return;
    }
    const reelCounter = counterSettings.normalize({ display: displayInput.value, limit });
    chrome.storage.local.set({ keymap, reelCounter }, () => {
      if (chrome.runtime.lastError) {
        showStatus('Could not save settings. Please try again.', true);
        return;
      }
      showStatus('Saved! Changes apply instantly.');
    });
  });

  document.getElementById('reset').addEventListener('click', () => {
    chrome.storage.local.set({ keymap: DEFAULTS, reelCounter: counterSettings.DEFAULTS }, () => {
      if (chrome.runtime.lastError) {
        showStatus('Could not reset settings. Please try again.', true);
        return;
      }
      inputs.forEach((inp) => { inp.value = DEFAULTS[inp.dataset.action]; });
      displayInput.value = counterSettings.DEFAULTS.display;
      limitInput.value = counterSettings.DEFAULTS.limit;
      showStatus('Reset to defaults.');
    });
  });

  // Initial load.
  loadSettings();
})();
