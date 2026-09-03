// ─── src/keymap.js ────────────────────────────────────────────────
// Keyboard dispatcher. Owns the keymap (defaults + user overrides
// from chrome.storage.local) and routes pressed keys to actions.
//
// Live-update: subscribes to chrome.storage.onChanged so that saving
// a new keybind in the toolbar popup takes effect immediately — no
// page reload required.

(function () {
  'use strict';

  const RR = window.__reelRotator;
  const S = RR.state;
  const { findActiveVideo } = RR.domUtils;

  // ── Default keymap ────────────────────────────────────────────────────
  // Single letters, lowercase. Stored & compared case-insensitively.
  const DEFAULT_KEYMAP = Object.freeze({
    rotate:    'r',
    rotateCW:  'e',
    focus:     'f',
    prevReel:  'w',
    nextReel:  's',
    react:     'q',
  });

  // Working copy. Hydrated from storage on init; updated live thereafter.
  let keymap = { ...DEFAULT_KEYMAP };

  // ── Action dispatcher ─────────────────────────────────────────────────
  // Maps an action name → the function that performs it.
  // Reads S.focusMode at call time so it's always current.
  const ACTION_HANDLERS = {
    rotate:    () => RR.rotation.handleRotate(-90),
    rotateCW:  () => RR.rotation.handleRotate(90),
    rotateCCW: () => RR.rotation.handleRotate(-90),
    focus:     () => RR.focus.toggle(),
    prevReel:  () => RR.focus.navigate(-1),
    nextReel:  () => RR.focus.navigate(+1),
    react:     () => RR.actions.reactLike(),
  };

  function runAction(action) {
    const handler = ACTION_HANDLERS[action];
    if (handler) handler();
  }

  // ── Storage hydration ─────────────────────────────────────────────────
  function hydrate(callback) {
    try {
      chrome.storage.local.get({ keymap: DEFAULT_KEYMAP }, (res) => {
        const stored = res.keymap || {};
        delete stored.send;
        delete stored.comment;
        if (stored.nextReel === 'a') {
          stored.nextReel = 's';
        }
        try { chrome.storage.local.set({ keymap: stored }); } catch (_) {}
        keymap = { ...DEFAULT_KEYMAP, ...stored };
        for (const k of Object.keys(keymap)) {
          if (!(k in DEFAULT_KEYMAP)) delete keymap[k];
        }
        if (callback) callback();
      });
    } catch (_) {
      // chrome.storage may be unavailable in some contexts (tests, etc.).
      if (callback) callback();
    }
  }

  function setupStorageListener() {
    try {
      chrome.storage.onChanged.addListener((changes) => {
        if (changes.keymap && changes.keymap.newValue) {
          keymap = { ...DEFAULT_KEYMAP, ...changes.keymap.newValue };
        }
      });
    } catch (_) { /* not available; keymap stays at defaults */ }
  }

  // ── Keyboard handler ──────────────────────────────────────────────────
  function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable === true;
  }

  // Hardcoded, non-rebindable shortcuts. These are universal media /
  // navigation controls — keeping them out of the user keymap means they
  // work the same for every user regardless of how they've rebound the
  // rebindable actions.
  //
  // - Space: focus-mode-only pause/resume.
  // - M:     mute toggle on the active video, in BOTH focus mode and the
  //          normal feed (because it's the kind of shortcut a user expects
  //          to work anywhere).
  // - ArrowUp/Down: focus-mode-only reel navigation.
  //
  // Each handler calls preventDefault AND stopImmediatePropagation.
  // Without stopping propagation, Instagram's keydown listener (which
  // maps Space → next reel) would still fire and override our pause.
  // We register on the capture phase in setupKeyboardShortcut so we run
  // first; stopImmediatePropagation then blocks every other listener on
  // the same node (document), so Instagram's bubble-phase handler never
  // gets a chance.
  function handleHardcodedShortcuts(e) {
    // ── M: works in any mode ─────────────────────────────────────────
    if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const video = S.focusMode
        ? S.focusedVideo
        : (S.rotatedVideo || findActiveVideo());
      if (!video) return true;
      // Toggle the user's preference and apply it. Using a preference
      // (not just the current video.muted) means the choice sticks across
      // pause/play cycles and reel changes.
      S.userMuted = !video.muted;
      video.muted = S.userMuted;
      return true;
    }

    // The rest are focus-mode-only.
    if (!S.focusMode) return false;

    // ArrowUp: previous reel.
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopImmediatePropagation();
      RR.focus.navigate(-1);
      return true;
    }
    // ArrowDown: next reel.
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopImmediatePropagation();
      RR.focus.navigate(+1);
      return true;
    }
    // Space: pause / resume the focused video.
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const video = S.focusedVideo;
      if (video) togglePause(video);
      return true;
    }
    return false;
  }

  /**
   * Toggle pause/resume on `video`. Re-asserts userMuted BEFORE play()
   * so Instagram's player can't reset the muted state during the play
   * event chain.
   */
  function togglePause(video) {
    if (!video) return;
    if (video.paused) {
      video.muted = S.userMuted;
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  function setupKeyboardShortcut() {
    // CAPTURE phase on `window` is essential: Instagram attaches its own
    // keydown listeners (Space → next reel, ArrowDown → next reel, etc.)
    // — sometimes on `window`, sometimes on `document`, sometimes on a
    // specific element. Listening on `window` in capture phase puts us at
    // the very top of the event flow; combined with stopImmediatePropagation
    // inside handleHardcodedShortcuts, no other listener ever fires.
    window.addEventListener('keydown', (e) => {
      // Don't fire while the user is typing into Instagram's composer etc.
      if (isTypingTarget(e.target)) return;

      // Ignore key-repeat events: holding Space would otherwise flip-flop
      // pause/play repeatedly. Only the initial keydown matters.
      if (e.repeat) return;

      // Modifier keys: ignore pure modifier presses.
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;

      // Hardcoded shortcuts (M works anywhere; Space/Arrows are focus-mode-only).
      if (handleHardcodedShortcuts(e)) return;

      // Escape is special-cased — it only matters inside focus mode.
      if (e.key === 'Escape') {
        if (S.focusMode) {
          e.preventDefault();
          RR.focus.exit();
        }
        return;
      }

      // Skip keys with modifiers — we only bind plain letters.
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const pressed = e.key.toLowerCase();
      for (const [action, key] of Object.entries(keymap)) {
        if (key && pressed === key.toLowerCase()) {
          e.preventDefault();
          e.stopImmediatePropagation();
          runAction(action);
          return;
        }
      }
    }, true /* capture phase */);
  }

  // ── Expose ────────────────────────────────────────────────────────────
  RR.keymap = {
    DEFAULT_KEYMAP,
    setupKeyboardShortcut,
    hydrate,
    setupStorageListener,
    runAction,
    // For debugging only.
    _getKeymap: () => ({ ...keymap }),
  };
})();
