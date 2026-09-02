// ─── src/dom-utils.js ─────────────────────────────────────────────
// DOM lookup helpers shared by every other module.
// No event listeners, no state mutation — just pure read operations
// against Instagram's DOM and a couple of caches stored on `state`.

(function () {
  'use strict';

  const RR = window.__reelRotator;
  const S = RR.state;

  /**
   * Pick the video the user is currently looking at.
   * Strategy:
   *   1. Prefer a video that is actually playing right now.
   *   2. Otherwise pick the one whose center is closest to viewport center.
   *   3. Otherwise any first video on the page.
   */
  function findActiveVideo() {
    const videos = document.querySelectorAll('video');
    if (videos.length === 0) return null;

    // Strategy 1: currently playing
    for (const video of videos) {
      if (!video.paused && !video.ended && video.readyState > 2) {
        return video;
      }
    }

    // Strategy 2: closest to viewport center
    let bestVideo = null;
    let bestScore = Infinity;
    const viewportCenter = window.innerHeight / 2;

    for (const video of videos) {
      const rect = video.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter);
      if (distance < bestScore) {
        bestScore = distance;
        bestVideo = video;
      }
    }

    return bestVideo || videos[0] || null;
  }

  /**
   * Locate the nearest ancestor of `video` that Instagram treats as the
   * "reel container" — large enough to be a reel card, not the whole body.
   * Used to scope overflow patching to the reel rather than the viewport.
   */
  function getVideoContainer(video) {
    let el = video.parentElement;
    while (el && el !== document.body) {
      const rect = el.getBoundingClientRect();
      if (rect.height > window.innerHeight * 0.5 && rect.width > 200) {
        return el;
      }
      el = el.parentElement;
    }
    return video.parentElement;
  }

  /**
   * Cache the main scroll container so we don't re-scan every scroll event.
   * Instagram uses scroll-snap on the reels viewport; we look for that first,
   * then fall back to `<main>`.
   */
  function findScrollContainer() {
    if (S.scrollContainer && document.contains(S.scrollContainer)) {
      return S.scrollContainer;
    }
    const candidates = document.querySelectorAll('div');
    for (const div of candidates) {
      const style = window.getComputedStyle(div);
      if (
        style.scrollSnapType &&
        style.scrollSnapType !== 'none' &&
        div.scrollHeight > div.clientHeight
      ) {
        S.scrollContainer = div;
        return div;
      }
    }
    const main = document.querySelector('main, [role="main"]');
    if (main) {
      S.scrollContainer = main;
      return main;
    }
    return null;
  }

  /**
   * Walk up from `video` to the nearest ancestor that holds Like/Comment/Share
   * buttons. That's the "reel card" Instagram's actions belong to.
   * Returns `null` if nothing was found (e.g. video was lifted to <body>).
   *
   * In focus mode, the video is detached from its reel card and reparented
   * into <body>. The action buttons are NOT descendants of the video in that
   * state — they live in the *original* reel container (saved on
   * `S.focusSavedStyles._origParent`). The caller can pass that in via the
   * optional `origParent` hint so we can find the buttons in either layout.
   */
  function findReelContainer(video, origParent) {
    // Hint from focus mode: the original reel card we lifted the video out of.
    if (origParent && document.contains(origParent)) {
      const markers = '[aria-label*="ike" i], [aria-label*="omment" i], [aria-label*="hare" i], [aria-label*="end" i]';
      if (origParent.querySelector(markers)) return origParent;
    }
    if (!video) return null;
    const markers = '[aria-label*="ike" i], [aria-label*="omment" i], [aria-label*="hare" i], [aria-label*="end" i]';
    let el = video.parentElement;
    while (el && el !== document.body) {
      if (el.querySelector(markers)) return el;
      el = el.parentElement;
    }
    return null;
  }

  /**
   * Click the first matching Instagram action button on the active reel.
   * Tries each label fragment in order — first hit wins.
   * Returns true if a button was clicked, false otherwise.
   *
   * Strategy:
   *   1. If focus-mode is active, scope search to the original reel card
   *      we lifted the video out of (`S.focusSavedStyles._origParent`).
   *      The Like/Comment/Share buttons live there, NOT as descendants
   *      of the lifted video. (BUG FIX: previously fell through to
   *      document-wide search, which would click a button on a
   *      different reel in the underlying feed.)
   *   2. Otherwise walk up from the video to find its reel card.
   *   3. As a last resort — and only outside focus mode — fall back to
   *      document-wide search (single-reel pages, edge cases).
   */
  function clickReelButton(video, labelFragments) {
    const S = RR.state;
    let scope = null;

    if (S.focusMode && S.focusSavedStyles && S.focusSavedStyles._origParent) {
      // In focus mode the lifted video's action buttons live in the
      // *original* reel container we saved on entry. If that's gone
      // (Instagram recycled the node), this returns null and the call
      // fails — we deliberately do NOT fall back to document, because
      // clicking the wrong reel's button would be worse than no-op.
      scope = findReelContainer(video, S.focusSavedStyles._origParent);
    } else {
      scope = findReelContainer(video);
    }
    if (!scope && !S.focusMode) scope = document;

    if (!scope) return false;

    for (const frag of labelFragments) {
      // :not(#reel-rotate-btn) guards against accidentally matching our own UI.
      const selector = `[aria-label*="${frag}" i]:not(#reel-rotate-btn):not([id^="reel-"])`;
      const btn = scope.querySelector(selector);
      if (btn) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  /**
   * True if the current page is a Reels surface (path matches /reels or /reel/).
   */
  function isReelsPage() {
    const path = window.location.pathname;
    return path.includes('/reels') || path.includes('/reel/');
  }

  // ── Expose ──────────────────────────────────────────────────────────
  RR.domUtils = {
    findActiveVideo,
    getVideoContainer,
    findScrollContainer,
    findReelContainer,
    clickReelButton,
    isReelsPage,
  };
})();
