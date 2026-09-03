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
  /**
   * Check if a video element is currently visible in the viewport.
   */
  function isVideoVisible(video) {
    if (!video || !document.contains(video)) return false;
    const rect = video.getBoundingClientRect();
    if (rect.width < 50 || rect.height < 50) return false;
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false;
    const visibleTop = Math.max(0, rect.top);
    const visibleBottom = Math.min(window.innerHeight, rect.bottom);
    return (visibleBottom - visibleTop) > Math.min(rect.height * 0.25, 100);
  }

  /**
   * Pick the video the user is currently looking at.
   * Filters to visible viewport videos first to avoid picking off-screen reels.
   */
  function findActiveVideo() {
    if (S.focusMode && S.focusedVideo && document.contains(S.focusedVideo)) {
      return S.focusedVideo;
    }
    if (S.rotatedVideo && document.contains(S.rotatedVideo) && isVideoVisible(S.rotatedVideo)) {
      return S.rotatedVideo;
    }
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;

    const visible = videos.filter(isVideoVisible);
    const candidates = visible.length > 0 ? visible : videos;

    // Strategy 1: Visible and currently playing
    for (const video of candidates) {
      if (!video.paused && !video.ended && video.readyState > 2) {
        return video;
      }
    }

    // Strategy 2: Closest to viewport center
    let bestVideo = null;
    let bestScore = Infinity;
    const viewportCenter = window.innerHeight / 2;

    for (const video of candidates) {
      const rect = video.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter);
      if (distance < bestScore) {
        bestScore = distance;
        bestVideo = video;
      }
    }

    return bestVideo || candidates[0] || null;
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
   * the like button. Stops before entering the scroll container so it never
   * leaks into the outer feed.
   */
  function findReelContainer(video, origParent) {
    const likeMarker = [
      'button[aria-label="Like" i]',
      '[role="button"][aria-label="Like" i]',
      'button[aria-label="Unlike" i]',
      '[role="button"][aria-label="Unlike" i]',
      'svg[aria-label="Like" i]',
      'svg[aria-label="Unlike" i]',
      '[aria-label*="repost" i]',
      'svg path[d*="16.792"]',
      'svg path[d*="21.35"]',
      'svg path[d*="3.436"]'
    ].join(', ');

    // 1. In focus mode (or when origParent hint given): walk UP from origParent
    const focusParent = origParent || (S.focusMode && S.focusSavedStyles?._origParent);
    if (focusParent && document.contains(focusParent)) {
      let el = focusParent;
      while (el && el !== document.body && !isScrollable(el)) {
        if (el.querySelector(likeMarker)) return el;
        el = el.parentElement;
      }
    }

    // 2. Walk UP from video.parentElement if video is in the feed (not <body>)
    if (video && video.parentElement && video.parentElement !== document.body && document.contains(video)) {
      let el = video.parentElement;
      while (el && el !== document.body && !isScrollable(el)) {
        if (el.querySelector(likeMarker)) return el;
        el = el.parentElement;
      }
    }

    return null;
  }

  /**
   * Trigger a click on an element, ensuring React synthetic event handlers
   * on button/role="button" ancestors receive the proper pointer/mouse sequence
   * with accurate viewport coordinates.
   */
  function triggerClick(element) {
    if (!element) return false;

    const clickable = element.closest('button, [role="button"]') || element;
    const rect = clickable.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const eventOptions = {
      bubbles: true,
      cancelable: true,
      view: window,
      buttons: 1,
      clientX: cx,
      clientY: cy,
      screenX: cx,
      screenY: cy,
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
   * Find the like button inside a specific DOM subtree.
   */
  function findLikeButtonInScope(scope) {
    if (!scope) return null;

    // Strategy 1: Exact aria-label match on interactive button or SVG
    const exactBtn = scope.querySelector(
      `button[aria-label="Like" i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
      `[role="button"][aria-label="Like" i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
      `button[aria-label="Unlike" i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
      `[role="button"][aria-label="Unlike" i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
      `svg[aria-label="Like" i], ` +
      `svg[aria-label="Unlike" i], ` +
      `[aria-label="Like" i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
      `[aria-label="Unlike" i]:not(#reel-rotate-btn):not([id^="reel-"])`
    );
    if (exactBtn) return exactBtn;

    // Strategy 2: Starts-with match (e.g. "Like this reel", "Unlike this post")
    const prefixBtn = scope.querySelector(
      `button[aria-label^="Like " i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
      `[role="button"][aria-label^="Like " i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
      `button[aria-label^="Unlike " i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
      `[role="button"][aria-label^="Unlike " i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
      `svg[aria-label^="Like " i], ` +
      `svg[aria-label^="Unlike " i]`
    );
    if (prefixBtn) return prefixBtn;

    // Strategy 3: Heart icon SVG path signature (works across all languages)
    const heartPath = scope.querySelector(
      'svg path[d*="16.792"], svg path[d*="M16.792"], svg path[d*="21.35"], svg path[d*="3.436"]'
    );
    if (heartPath) return heartPath;

    // Strategy 4: Fallback substring match, filtering out like counts and attribution
    const candidates = scope.querySelectorAll(
      `[aria-label*="Like" i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
      `[aria-label*="Unlike" i]:not(#reel-rotate-btn):not([id^="reel-"])`
    );
    for (const el of candidates) {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('likes') && !label.includes('unlike')) continue;
      if (label.includes('liked by')) continue;
      if (label.includes('count')) continue;
      return el;
    }

    return null;
  }

  /**
   * Find the like button for a given video.
   * Combines ancestor container lookup with spatial vertical alignment
   * to guarantee the button belonging to the active on-screen reel is selected.
   */
  function findLikeButtonForVideo(video) {
    if (!video) return null;

    // 1. Check inside the resolved reel container
    const container = findReelContainer(video);
    if (container) {
      const btn = findLikeButtonInScope(container);
      if (btn) return btn;
    }

    // 2. Spatial match: find all like buttons on the page and select the one
    // vertically aligned with the active video
    const vRect = video.getBoundingClientRect();
    const likeSelectors = [
      'button[aria-label="Like" i]',
      '[role="button"][aria-label="Like" i]',
      'button[aria-label="Unlike" i]',
      '[role="button"][aria-label="Unlike" i]',
      'svg[aria-label="Like" i]',
      'svg[aria-label="Unlike" i]',
      '[aria-label="Like" i]',
      '[aria-label="Unlike" i]',
      'button[aria-label^="Like " i]',
      '[role="button"][aria-label^="Like " i]',
      'button[aria-label^="Unlike " i]',
      '[role="button"][aria-label^="Unlike " i]',
      'svg path[d*="16.792"]',
      'svg path[d*="21.35"]',
      'svg path[d*="3.436"]'
    ].join(', ');

    const allCandidates = document.querySelectorAll(likeSelectors);
    let bestBtn = null;
    let bestDist = Infinity;

    for (const el of allCandidates) {
      if (el.id === 'reel-rotate-btn' || el.id?.startsWith('reel-')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      // Must be vertically aligned with the active video
      if (r.bottom < vRect.top - 50 || r.top > vRect.bottom + 50) continue;

      const dist = Math.abs(r.top + r.height / 2 - (vRect.top + vRect.height / 2));
      if (dist < bestDist) {
        bestDist = dist;
        bestBtn = el;
      }
    }

    return bestBtn;
  }

  /**
   * Find the repost button inside a specific DOM subtree.
   */
  function findRepostButtonInScope(scope) {
    if (!scope) return null;

    const exactLabels = [
      'Repost',
      'Reposted',
      'Undo Repost',
      'Remove Repost',
      'Remove from Reposts',
      'Republicar',
      'Republicado'
    ];
    for (const label of exactLabels) {
      const btn = scope.querySelector(
        `button[aria-label="${label}" i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
        `[role="button"][aria-label="${label}" i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
        `svg[aria-label="${label}" i], ` +
        `[aria-label="${label}" i]:not(#reel-rotate-btn):not([id^="reel-"])`
      );
      if (btn) return btn;
    }

    const prefixBtn = scope.querySelector(
      `button[aria-label^="Repost" i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
      `[role="button"][aria-label^="Repost" i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
      `[aria-label^="Repost" i]:not(#reel-rotate-btn):not([id^="reel-"])`
    );
    if (prefixBtn) return prefixBtn;

    const fallbackBtn = scope.querySelector(
      `button[aria-label*="repost" i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
      `[role="button"][aria-label*="repost" i]:not(#reel-rotate-btn):not([id^="reel-"]), ` +
      `svg[aria-label*="repost" i], ` +
      `[aria-label*="repost" i]:not(#reel-rotate-btn):not([id^="reel-"])`
    );
    if (fallbackBtn) return fallbackBtn;

    return null;
  }

  /**
   * Find the repost button for a given video.
   * Looks inside the resolved reel container first, then uses spatial vertical alignment.
   */
  function findRepostButtonForVideo(video) {
    if (!video) return null;

    // 1. Check inside the resolved reel container
    const container = findReelContainer(video);
    if (container) {
      const btn = findRepostButtonInScope(container);
      if (btn) return btn;
    }

    // 2. Spatial match: find all repost buttons on the page and select the one
    // vertically aligned with the active video
    const vRect = video.getBoundingClientRect();
    const repostSelectors = [
      'button[aria-label="Repost" i]',
      '[role="button"][aria-label="Repost" i]',
      'button[aria-label="Reposted" i]',
      '[role="button"][aria-label="Reposted" i]',
      'button[aria-label="Undo Repost" i]',
      '[role="button"][aria-label="Undo Repost" i]',
      'button[aria-label="Remove Repost" i]',
      '[role="button"][aria-label="Remove Repost" i]',
      'button[aria-label="Remove from Reposts" i]',
      '[role="button"][aria-label="Remove from Reposts" i]',
      'button[aria-label^="Repost" i]',
      '[role="button"][aria-label^="Repost" i]',
      'button[aria-label*="repost" i]',
      '[role="button"][aria-label*="repost" i]',
      'svg[aria-label*="repost" i]',
      '[aria-label*="repost" i]'
    ].join(', ');

    const allCandidates = document.querySelectorAll(repostSelectors);
    let bestBtn = null;
    let bestDist = Infinity;

    for (const el of allCandidates) {
      if (el.id === 'reel-rotate-btn' || el.id?.startsWith('reel-')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      if (r.bottom < vRect.top - 50 || r.top > vRect.bottom + 50) continue;

      const dist = Math.abs(r.top + r.height / 2 - (vRect.top + vRect.height / 2));
      if (dist < bestDist) {
        bestDist = dist;
        bestBtn = el;
      }
    }

    return bestBtn;
  }

  /**
   * Check for an open confirmation dialog, action menu, or snackbar toast
   * for removing/undoing a repost, and automatically click the confirmation button.
   */
  function tryConfirmRemoveRepost() {
    const confirmPhrases = [
      'remove from repost',
      'remove repost',
      'delete repost',
      'undo repost',
      'deshacer',
      'eliminar republicaci',
      'remover dos republicados',
      'supprimer des republications',
      'aus reposts entfernen',
      'repost löschen'
    ];

    // 1. Search inside open dialogs, menus, and sheets
    const dialogSelectors = [
      '[role="dialog"]',
      '[role="menu"]',
      'div[aria-modal="true"]',
      'div[data-bloks-name]'
    ];

    for (const dSel of dialogSelectors) {
      const dialogs = document.querySelectorAll(dSel);
      for (const dialog of dialogs) {
        const dialogText = (dialog.textContent || '').toLowerCase();
        const hasRepostContext = dialogText.includes('repost') ||
                                 dialogText.includes('republic') ||
                                 dialogText.includes('reshare');

        const buttons = dialog.querySelectorAll('button, [role="button"], [role="menuitem"], a');
        for (const btn of buttons) {
          const text = (btn.textContent || '').trim().toLowerCase();
          const label = (btn.getAttribute('aria-label') || '').toLowerCase();

          // Explicit phrase match
          for (const phrase of confirmPhrases) {
            if (text.includes(phrase) || label.includes(phrase)) {
              return triggerClick(btn);
            }
          }

          // If the dialog mentions repost, match action keywords (ignore Cancel/Dismiss)
          if (hasRepostContext) {
            const isActionVerb = text === 'remove' || text === 'delete' || text === 'undo' ||
                                 label === 'remove' || label === 'delete' || label === 'undo';
            if (isActionVerb) {
              return triggerClick(btn);
            }
          }
        }
      }
    }

    // 2. Check for floating toast or bottom notification banner (e.g. "Reposted ... Undo")
    const alerts = document.querySelectorAll('div[role="alert"], div[aria-live="polite"], div[aria-live="assertive"]');
    for (const alert of alerts) {
      const alertText = (alert.textContent || '').toLowerCase();
      if (alertText.includes('repost') || alertText.includes('republic')) {
        const undoBtn = alert.querySelector('button, [role="button"], a');
        if (undoBtn) {
          const btnText = (undoBtn.textContent || '').toLowerCase();
          if (btnText.includes('undo') || btnText.includes('remove') || btnText.includes('deshacer')) {
            return triggerClick(undoBtn);
          }
        }
      }
    }

    // 3. Fallback: check any visible button on the page with explicit "remove from repost"
    const allButtons = document.querySelectorAll('button, [role="button"], [role="menuitem"]');
    for (const b of allButtons) {
      if (b.id?.startsWith('reel-')) continue;
      const t = (b.textContent || '').toLowerCase();
      for (const phrase of confirmPhrases) {
        if (t.includes(phrase)) {
          return triggerClick(b);
        }
      }
    }

    return false;
  }

  /**
   * Watch for a remove-repost confirmation dialog or toast to appear
   * after clicking the repost button, and automatically confirm it.
   */
  function autoConfirmRepostRemoval(onConfirmed) {
    let attempts = 0;
    const maxAttempts = 20; // 20 * 50ms = 1000ms window
    const timer = setInterval(() => {
      attempts++;
      if (tryConfirmRemoveRepost()) {
        clearInterval(timer);
        if (onConfirmed) onConfirmed();
        return;
      }
      if (attempts >= maxAttempts) {
        clearInterval(timer);
      }
    }, 50);
  }

  /**
   * Click the matching Instagram action button on the active reel.
   * Returns true if a button was clicked, false otherwise.
   */
  function clickReelButton(video, labelFragments) {
    if (!video) return false;

    const isRepost = (labelFragments || []).some(
      f => f.toLowerCase().includes('repost')
    );

    const btn = isRepost ? findRepostButtonForVideo(video) : findLikeButtonForVideo(video);
    if (btn) {
      return triggerClick(btn);
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
    tryConfirmRemoveRepost,
    autoConfirmRepostRemoval,
    isReelsPage,
  };
})();
