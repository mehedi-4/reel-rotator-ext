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
    if (S.focusMode && S.focusedVideo && document.contains(S.focusedVideo)) {
      return S.focusedVideo;
    }
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
   * Helper to check if an element is genuinely scrollable vertically.
   */
  function isScrollable(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.scrollHeight <= el.clientHeight + 10) return false;
    try {
      const style = window.getComputedStyle(el);
      const oy = style.overflowY;
      return oy === 'auto' || oy === 'scroll';
    } catch (_) {
      return false;
    }
  }

  /**
   * Find the true vertical scroll container for Instagram Reels.
   * Walks up from the active video to guarantee we find the exact container
   * that owns the reel's scroll stream, rather than guessing or picking <main>.
   */
  function findScrollContainer() {
    if (S.scrollContainer && document.contains(S.scrollContainer) && isScrollable(S.scrollContainer)) {
      return S.scrollContainer;
    }

    // 1. Walk UP from the active video or original parent (in focus mode)
    const seed = (S.focusMode && S.focusSavedStyles?._origParent) ||
                 (S.focusMode ? S.focusedVideo : null) ||
                 S.rotatedVideo ||
                 findActiveVideo() ||
                 document.querySelector('video');

    if (seed) {
      let el = seed.nodeType === 1 && seed.tagName === 'VIDEO' ? seed.parentElement : seed;
      while (el && el !== document.body && el !== document.documentElement) {
        if (isScrollable(el)) {
          S.scrollContainer = el;
          return el;
        }
        el = el.parentElement;
      }
    }

    // 2. Check main and its children/descendants
    const main = document.querySelector('main, [role="main"]');
    if (main) {
      if (isScrollable(main)) {
        S.scrollContainer = main;
        return main;
      }
      const scrollableInsideMain = main.querySelectorAll('div');
      for (const div of scrollableInsideMain) {
        if (isScrollable(div)) {
          S.scrollContainer = div;
          return div;
        }
      }
    }

    // 3. Check any div with scrollSnapType or scrollable overflow
    const candidates = document.querySelectorAll('[style*="scroll-snap"], [style*="overflow"], div');
    for (const div of candidates) {
      if (isScrollable(div)) {
        S.scrollContainer = div;
        return div;
      }
    }

    // 4. Default to document.scrollingElement
    if (document.scrollingElement && document.scrollingElement.scrollHeight > window.innerHeight + 10) {
      return document.scrollingElement;
    }

    return null;
  }

  /**
   * Walk up from `video` or `origParent` to the nearest ancestor that holds
   * Like/Comment/Share buttons. That's the "reel card" Instagram's actions belong to.
   */
  function findReelContainer(video, origParent) {
    const markers = [
      '[aria-label*="ike" i]',
      '[aria-label*="omment" i]',
      '[aria-label*="hare" i]',
      '[aria-label*="end" i]',
      'svg path[d*="16.792"]',
      'svg path[d*="21.35"]',
      'svg path[d*="3.436"]'
    ].join(', ');

    // 1. In focus mode (or when origParent hint given): walk UP from origParent
    const focusParent = origParent || (S.focusMode && S.focusSavedStyles?._origParent);
    if (focusParent && document.contains(focusParent)) {
      let el = focusParent;
      while (el && el !== document.body) {
        if (el.querySelector(markers)) return el;
        el = el.parentElement;
      }
    }

    // 2. Walk UP from video.parentElement if video is in the feed (not <body>)
    if (video && video.parentElement && video.parentElement !== document.body && document.contains(video)) {
      let el = video.parentElement;
      while (el && el !== document.body) {
        if (el.querySelector(markers)) return el;
        el = el.parentElement;
      }
    }

    // 3. Fallback: find the visible reel card closest to viewport center
    const articles = document.querySelectorAll('article, [role="article"], section');
    const viewportCenter = window.innerHeight / 2;
    let bestArticle = null;
    let bestDist = Infinity;
    for (const art of articles) {
      if (!art.querySelector(markers)) continue;
      const rect = art.getBoundingClientRect();
      if (rect.height < 200 || rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const dist = Math.abs(rect.top + rect.height / 2 - viewportCenter);
      if (dist < bestDist) {
        bestDist = dist;
        bestArticle = art;
      }
    }
    if (bestArticle) return bestArticle;

    return null;
  }

  /**
   * Trigger a click on an element, ensuring React synthetic event handlers
   * on button/role="button" ancestors receive the proper pointer/mouse sequence.
   */
  function triggerClick(element) {
    if (!element) return false;

    const clickable = element.closest('button, [role="button"]') || element;
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      view: window,
      buttons: 1,
    };

    try { clickable.dispatchEvent(new PointerEvent('pointerdown', eventOptions)); } catch (_) {}
    try { clickable.dispatchEvent(new MouseEvent('mousedown', eventOptions)); } catch (_) {}
    try { clickable.dispatchEvent(new PointerEvent('pointerup', eventOptions)); } catch (_) {}
    try { clickable.dispatchEvent(new MouseEvent('mouseup', eventOptions)); } catch (_) {}

    try {
      clickable.click();
    } catch (_) {
      try { element.click(); } catch (_) {}
    }

    return true;
  }

  /**
   * Click the matching Instagram action button on the active reel.
   * Tries exact matches first, then prefix matches, then heart SVG paths,
   * then filtered substring matches.
   * Returns true if a button was clicked, false otherwise.
   */
  function clickReelButton(video, labelFragments) {
    const S = RR.state;
    let scope = null;

    if (S.focusMode && S.focusSavedStyles && S.focusSavedStyles._origParent) {
      scope = findReelContainer(video, S.focusSavedStyles._origParent);
    } else {
      scope = findReelContainer(video);
    }
    if (!scope) scope = document;

    const isLikeAction = labelFragments.some(
      f => f.toLowerCase() === 'like' || f.toLowerCase() === 'unlike'
    );

    // Strategy 1: Exact aria-label match on button or SVG (avoids matching like counts)
    for (const frag of labelFragments) {
      const exactBtn = scope.querySelector(
        `button[aria-label="${frag}" i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
        `[role="button"][aria-label="${frag}" i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
        `svg[aria-label="${frag}" i], ` +
        `[aria-label="${frag}" i]:not(#reel-rotate-btn):not([id^="reel-"])`
      );
      if (exactBtn) {
        return triggerClick(exactBtn);
      }
    }

    // Strategy 2: Starts-with match (e.g. "Like this reel", "Unlike this post")
    for (const frag of labelFragments) {
      const prefixBtn = scope.querySelector(
        `button[aria-label^="${frag} " i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
        `[role="button"][aria-label^="${frag} " i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
        `svg[aria-label^="${frag} " i], ` +
        `[aria-label^="${frag} " i]:not(#reel-rotate-btn):not([id^="reel-"])`
      );
      if (prefixBtn) {
        return triggerClick(prefixBtn);
      }
    }

    // Strategy 3: For like/unlike, locate by Instagram's heart icon SVG path signature.
    // Works reliably across all localized languages.
    if (isLikeAction) {
      const heartPath = scope.querySelector(
        'svg path[d*="16.792"], svg path[d*="M16.792"], svg path[d*="21.35"], svg path[d*="3.436"]'
      );
      if (heartPath) {
        return triggerClick(heartPath);
      }
    }

    // Strategy 4: Fallback substring match, filtering out like counts and attribution
    for (const frag of labelFragments) {
      const candidates = scope.querySelectorAll(
        `[aria-label*="${frag}" i]:not(#reel-rotate-btn):not([id^="reel-"])`
      );
      for (const el of candidates) {
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        if (label.includes('likes') && !label.includes('unlike')) continue;
        if (label.includes('liked by')) continue;
        if (label.includes('count')) continue;
        return triggerClick(el);
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
    triggerClick,
    clickReelButton,
    isReelsPage,
  };
})();
