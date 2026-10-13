// Settings popup: daily reel counter preferences and single-letter keybinds.
(function () {
  'use strict';

  // Same defaults as src/keymap.js; queue-player actions are not available.
  const DEFAULT_KEYMAP = Object.freeze({
    rotate:   'r',
    rotateCW: 'e',
    focus:    'f',
    prevReel: 'w',
    nextReel: 's',
    react:    'q',
    repost:   'v',
    save:     'x',
  });

  const inputs = Array.from(document.querySelectorAll('input[data-action]'));
  const statusEl = document.getElementById('status');
  const displayInput = document.getElementById('counter-display');
  const limitInput = document.getElementById('reel-limit');
  const counterSettings = window.__reelRotator.counterSettings;

  function showStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.dataset.error = isError ? '1' : '';
  }

  function showSettings(value) {
    const settings = counterSettings.normalize(value);
    displayInput.value = settings.display;
    limitInput.value = settings.limit;
  }

  function showKeymap(stored) {
    const keymap = { ...DEFAULT_KEYMAP };
    for (const action of Object.keys(DEFAULT_KEYMAP)) {
      if (typeof stored?.[action] === 'string') keymap[action] = stored[action].toLowerCase();
    }
    // Match the existing feed-keymap migrations.
    if (keymap.nextReel === 'a') keymap.nextReel = DEFAULT_KEYMAP.nextReel;
    if (!keymap.save) keymap.save = DEFAULT_KEYMAP.save;
    inputs.forEach(input => { input.value = keymap[input.dataset.action]; });
  }

  chrome.storage.local.get({ keymap: DEFAULT_KEYMAP, reelCounter: counterSettings.DEFAULTS }, result => {
    showKeymap(result.keymap);
    showSettings(result.reelCounter);
  });

  inputs.forEach(input => {
    input.addEventListener('input', () => {
      input.value = input.value.toLowerCase().slice(-1);
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        document.getElementById('settings-form').requestSubmit();
      }
    });
  });

  document.getElementById('settings-form').addEventListener('submit', event => {
    event.preventDefault();
    const keymap = {};
    const empty = [];
    inputs.forEach(input => {
      const key = input.value.toLowerCase();
      if (!key) empty.push(input.dataset.action);
      else keymap[input.dataset.action] = key;
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
    chrome.storage.local.set({ keymap: DEFAULT_KEYMAP, reelCounter: counterSettings.DEFAULTS }, () => {
      if (chrome.runtime.lastError) {
        showStatus('Could not reset settings. Please try again.', true);
        return;
      }
      showKeymap(DEFAULT_KEYMAP);
      showSettings(counterSettings.DEFAULTS);
      showStatus('Reset to defaults.');
    });
  });
})();
