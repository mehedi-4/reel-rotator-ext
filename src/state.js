// ─── src/state.js ────────────────────────────────────────────────
// Single source of truth for the extension's runtime state.
// Every other module reads/writes here instead of declaring its own `let`s.
// Loaded first; exposes the shared namespace `window.__reelRotator`.

(function () {
  'use strict';

  // ── Tuning constants (kept here so they're easy to find) ────────────
  const WHEEL_THRESHOLD = 40;     // deltaY units before wheel triggers navigation
  const NAV_COOLDOWN = 550;       // ms between reel changes
  const WHEEL_RESET_MS = 200;     // forget stale trackpad deltas after this

  // ── The state object ────────────────────────────────────────────────
  // Mutable by reference; nothing else should declare duplicates of these.
  const state = {
    // Rotation
    rotation: 0,                  // 0, ±90, ±180, ±270 (degrees; negative = CCW, positive = CW)
    rotatedVideo: null,           // the currently-rotated <video>

    // Focus mode
    focusMode: false,
    focusBackdrop: null,          // dark blurred backdrop <div>
    focusedVideo: null,           // the video lifted into focus mode
    focusSavedStyles: null,       // snapshot of inline styles + DOM position

    // Focus-mode navigation
    focusNavigating: false,
    wheelAccum: 0,
    wheelResetTimer: null,
    lastNavTime: 0,

    // Overflow patching (rotation)
    overflowMods: [],             // [{ el, orig }, ...]

    // UI cache
    btn: null,                    // #reel-rotate-btn
    degreeBadge: null,            // .degree-badge span inside btn
    scrollContainer: null,        // cached main scroll container

    // User media preference
    userMuted: false,             // user's intended mute state; re-asserted
                                  // after pause/play and reel navigation so
                                  // Instagram's player doesn't override it.
  };

  // ── Helpers ─────────────────────────────────────────────────────────
  function reset() {
    // Clear transient state but keep DOM caches; useful on URL change / page leave.
    state.rotation = 0;
    state.rotatedVideo = null;
    state.focusMode = false;
    state.focusBackdrop = null;
    state.focusedVideo = null;
    state.focusSavedStyles = null;
    state.focusNavigating = false;
    state.wheelAccum = 0;
    state.lastNavTime = 0;
    // Note: userMuted is intentionally NOT reset — it's a persistent preference.
  }

  // ── Expose ──────────────────────────────────────────────────────────
  window.__reelRotator = window.__reelRotator || {};
  window.__reelRotator.state = state;
  window.__reelRotator.constants = {
    WHEEL_THRESHOLD,
    NAV_COOLDOWN,
    WHEEL_RESET_MS,
  };
  window.__reelRotator.reset = reset;
})();
