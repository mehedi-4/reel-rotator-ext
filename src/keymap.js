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
    rotate:      'r',
    rotateCW:    'e',
    focus:       'f',
    prevReel:    'w',
    nextReel:    's',
    react:       'q',
    repost:      'v',
    addToQueue:  'd',
    toggleAudio: 't',
    toggleQueue: 'g',
  });

  // Working copy. Hydrated from storage on init; updated live thereafter.
  let keymap = { ...DEFAULT_KEYMAP };

  // ── Action dispatcher ─────────────────────────────────────────────────
  // Maps an action name → the function that performs it.
  // Reads S.focusMode at call time so it's always current.
  function isMouseOverQueue() {
    try {
      const panel = document.getElementById('reel-queue-panel');
      return !!(panel && panel.matches(':hover'));
    } catch (_) {
      return false;
    }
  }

  function isQueueActive() {
    if (S.focusMode && S.focusedVideo === RR.queue?.getVideoEl?.()) {
      return true;
    }
    return !!(RR.queue?.isQueuePlaying?.());
  }

  const ACTION_HANDLERS = {
    rotate:      () => {
      if (isQueueActive() || isMouseOverQueue()) {
        RR.queue?.rotateActiveQueueItem?.(-90);
      } else {
        RR.rotation.handleRotate(-90);
      }
    },
    rotateCW:    () => {
      if (isQueueActive() || isMouseOverQueue()) {
        RR.queue?.rotateActiveQueueItem?.(90);
      } else {
        RR.rotation.handleRotate(90);
      }
    },
    rotateCCW:   () => {
      if (isQueueActive() || isMouseOverQueue()) {
        RR.queue?.rotateActiveQueueItem?.(-90);
      } else {
        RR.rotation.handleRotate(-90);
      }
    },
    focus:       () => {
      if (S.focusMode) {
        RR.focus.exit();
      } else if (isQueueActive() || isMouseOverQueue()) {
        RR.focus.toggle(RR.queue?.getVideoEl?.());
      } else {
        RR.focus.toggle();
      }
    },
    prevReel:    () => {
      if (isQueueActive()) {
        RR.queue?.playPrev?.();
      } else {
        RR.focus.navigate(-1);
      }
    },
    nextReel:    () => {
      if (isQueueActive()) {
        RR.queue?.playNext?.();
      } else {
        RR.focus.navigate(+1);
      }
    },
    react:       () => {
      if (isQueueActive()) {
        RR.queue?.likeActiveQueueItem?.();
      } else {
        RR.actions.reactLike();
      }
    },
    repost:      () => {
      if (isQueueActive()) {
        RR.queue?.repostActiveQueueItem?.();
      } else {
        RR.actions.repost();
      }
    },
    addToQueue:  () => RR.queue?.addCurrentReel?.(),
    toggleAudio: () => RR.queue?.toggleAudioFocus?.(),
    toggleQueue: () => RR.queue?.togglePanel?.(),
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
        if (!stored.toggleQueue) {
          stored.toggleQueue = DEFAULT_KEYMAP.toggleQueue;
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
      if ((isQueueActive() || isMouseOverQueue()) && RR.queue?.toggleMute) {
        RR.queue.toggleMute();
        return true;
      }
      RR.actions?.toggleMute?.();
      return true;
    }

    // ── Space: works in ANY mode (normal feed, focus mode, queue dock) ─
    // User requirement: "player will manually play or pause the video by pressing space.
    // right now pressing space goes to next reel in normal mode."
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      e.stopImmediatePropagation();

      if ((isQueueActive() || isMouseOverQueue()) && RR.queue?.togglePlayPause) {
        RR.queue.togglePlayPause();
        return true;
      }

      const video = S.focusMode
        ? S.focusedVideo
        : (S.rotatedVideo || findActiveVideo());
      if (video) togglePause(video);
      return true;
    }

    // Arrow keys when queue is active navigate the queue reels
    if (isQueueActive()) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopImmediatePropagation();
        RR.queue?.playPrev?.();
        return true;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopImmediatePropagation();
        RR.queue?.playNext?.();
        return true;
      }
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
      if (document.documentElement?.dataset?.rrQueuePlaying === '1') {
        video.muted = true;
      } else if (S.userMuted !== null) {
        video.muted = S.userMuted;
      }
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
