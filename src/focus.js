// ─── src/focus.js ─────────────────────────────────────────────────
// Theater / focus mode: lifts one video out of Instagram's feed and
// centers it over a dark backdrop. Owns scroll/wheel-based reel
// navigation while in focus mode.
//
// Public surface: focus.toggle(), focus.exit(), focus.navigate(dir),
// focus.setupScroll(), focus.reapplyBaseline(video, [degrees]).
//
// reapplyBaseline is the single source of truth for focus-mode
// positioning — applyFocusStyles, applyRotationInFocus, and the
// rotation-reset path all funnel through it.

(function () {
  'use strict';

  const RR = window.__reelRotator;
  const S = RR.state;
  const {
    WHEEL_THRESHOLD,
    NAV_COOLDOWN,
    WHEEL_RESET_MS,
  } = RR.constants;
  const { findActiveVideo, findScrollContainer } = RR.domUtils;
  const { resetRotation } = RR.rotation;

  // ── Aspect-ratio helper ───────────────────────────────────────────────
  // Returns the natural aspect ratio (width / height) of a <video> element.
  // Tries the media dimensions first, falls back to the rendered rect,
  // and finally to a vertical (9:16) default which is the common case
  // for Reels before metadata loads.
  function getVideoAspect(video) {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      return video.videoWidth / video.videoHeight;
    }
    const rect = video.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return rect.width / rect.height;
    }
    return 9 / 16;
  }

  // ── Layout helper (the single source of truth) ────────────────────────
  // Returns CSS width/height/transform that make the video fill the
  // viewport as much as possible while remaining fully visible.
  //
  // The trap: CSS `width`/`height` define the *pre-rotation* bounding box.
  // When we apply `transform: rotate(θ)`, the on-screen rendered rectangle
  // has its dimensions swapped at 90°/270°. So we must compute the desired
  // on-screen dimensions first, then convert to CSS by swapping back.
  //
  // Example: 9:16 video at 90°.
  //   - Desired on-screen: 1920×1080 (fits 16:9 viewport).
  //   - CSS box (pre-rotation): 1080×1920 — because rotating that box by
  //     90° yields a 1920×1080 on-screen rectangle. Inside it, the 9:16
  //     source fills with object-fit: contain (aspect 1080/1920 = 9/16 ✓).
  function computeFocusLayout(degrees, video) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const aspect = getVideoAspect(video);
    const isRotated = Math.abs(degrees) === 90 || Math.abs(degrees) === 270;

    // Visual aspect of the rotated video content on screen.
    const visualAspect = isRotated ? 1 / aspect : aspect;
    const viewportAspect = vw / vh;

    // Step 1: pick on-screen dimensions that fit the viewport, preserving
    // the visual aspect of the (rotated) content.
    let onScreenW, onScreenH;
    if (visualAspect >= viewportAspect) {
      // Visual content is wider than viewport (relative) — width fills, height derived.
      onScreenW = vw;
      onScreenH = vw / visualAspect;
    } else {
      // Visual content is taller — height fills, width derived.
      onScreenH = vh;
      onScreenW = vh * visualAspect;
    }

    // Step 2: convert on-screen dimensions to CSS box dimensions.
    // For 0°/180° the box dimensions match the on-screen dimensions.
    // For 90°/270° they swap, because rotation swaps the box's axes.
    let cssW, cssH;
    if (isRotated) {
      cssW = onScreenH;
      cssH = onScreenW;
    } else {
      cssW = onScreenW;
      cssH = onScreenH;
    }

    const transform = degrees === 0
      ? 'translate(-50%, -50%)'
      : `translate(-50%, -50%) rotate(${degrees}deg)`;

    return {
      width: cssW + 'px',
      height: cssH + 'px',
      transform,
    };
  }

  /**
   * Re-apply the focus-mode layout to `video`. Optional `degrees` overrides
   * the current `S.rotation` (used during the rotation reset path so we can
   * compute the layout at exactly 0° regardless of state).
   *
   * This is the ONE place that writes focus-mode width/height/transform.
   * Call it from anywhere we want the video to be correctly framed.
   */
  function reapplyBaseline(video, degrees) {
    if (!video) return;
    const deg = degrees !== undefined ? degrees : S.rotation;
    const layout = computeFocusLayout(deg, video);

    video.style.position = 'fixed';
    video.style.top = '50%';
    video.style.left = '50%';
    video.style.transformOrigin = 'center center';
    video.style.transition = 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
    video.style.width = layout.width;
    video.style.height = layout.height;
    video.style.transform = layout.transform;
  }

  /**
   * Capture-phase `play` listener attached ONLY to the currently focused
   * video. Re-asserts the user's mute preference in a microtask so it runs
   * AFTER Instagram's own play listeners.
   *
   * Scoped to a single video (not document-wide) so that muting the focused
   * reel doesn't bleed into background reels that start playing.
   *
   * The listener handle is stored on the video element as `_rrMuteHandler`
   * so we can detach it cleanly when focus moves to a different video.
   */
  function attachMuteEnforcement(video) {
    if (!video) return;
    // Already attached? Don't double-up.
    if (video._rrMuteHandler) return;
    const handler = () => {
      queueMicrotask(() => {
        if (video.isConnected) video.muted = S.userMuted;
      });
    };
    video._rrMuteHandler = handler;
    video.addEventListener('play', handler, true);
  }

  function detachMuteEnforcement(video) {
    if (!video || !video._rrMuteHandler) return;
    video.removeEventListener('play', video._rrMuteHandler, true);
    video._rrMuteHandler = null;
  }

  // ── Focus mode entry/exit ─────────────────────────────────────────────
  function toggleFocusMode() {
    if (S.focusMode) exitFocusMode();
    else enterFocusMode();
  }

  function enterFocusMode() {
    const video = S.rotatedVideo || findActiveVideo();
    if (!video) return;

    S.focusMode = true;

    // Dark blurred backdrop — covers the feed but stays behind the video.
    S.focusBackdrop = document.createElement('div');
    S.focusBackdrop.id = 'reel-focus-backdrop';
    S.focusBackdrop.addEventListener('click', exitFocusMode);
    document.body.appendChild(S.focusBackdrop);

    // Force-trigger the backdrop fade-in on the next frame.
    requestAnimationFrame(() => {
      if (S.focusBackdrop) S.focusBackdrop.classList.add('active');
    });

    applyFocusStyles(video);
    RR.ui?.setFocusButtonActive?.(true);
  }

  /**
   * Lift `video` out of the feed and pin it centered over the backdrop.
   * Saves inline styles + DOM position so we can put everything back later.
   */
  function applyFocusStyles(video) {
    S.focusedVideo = video;

    S.focusSavedStyles = {
      position: video.style.position,
      zIndex: video.style.zIndex,
      top: video.style.top,
      left: video.style.left,
      width: video.style.width,
      height: video.style.height,
      maxWidth: video.style.maxWidth,
      maxHeight: video.style.maxHeight,
      margin: video.style.margin,
      objectFit: video.style.objectFit,
      transform: video.style.transform,
      transition: video.style.transition,
      transformOrigin: video.style.transformOrigin,
      borderRadius: video.style.borderRadius,
      boxShadow: video.style.boxShadow,
      _origParent: video.parentElement,
      _origNextSibling: video.nextSibling,
    };

    // Move video to <body> so it's above the backdrop (escapes stacking contexts).
    document.body.appendChild(video);

    // Static focus-mode chrome — reapplyBaseline handles the dynamic bits.
    video.style.zIndex = '1000001';
    video.style.objectFit = 'contain';
    video.style.margin = '0';
    video.style.maxWidth = 'none';
    video.style.maxHeight = 'none';
    video.style.borderRadius = '12px';
    video.style.boxShadow = '0 20px 50px rgba(0, 0, 0, 0.5)';

    // Apply the user's mute preference up-front. Instagram's player may
    // have set muted=true to satisfy autoplay policy on the new reel;
    // we restore the user's choice immediately.
    video.muted = S.userMuted;

    // Attach a per-video `play` listener that re-asserts muted after
    // Instagram's own handlers run. Scoped to this video only — background
    // reels' mute state is left untouched.
    attachMuteEnforcement(video);

    // Single source of truth for width/height/transform.
    reapplyBaseline(video);
  }

  /**
   * Put the focused video back where we found it. Leaves focusMode/backdrop
   * alone so callers can navigate to the next reel without re-creating them.
   */
  function restoreVideoFromFocus() {
    const video = S.focusedVideo;
    if (!video) return;

    // Detach the per-video play listener before we put the video back.
    // (applyFocusStyles re-attaches on the next video if we're navigating.)
    detachMuteEnforcement(video);

    // Restore inline styles.
    for (const [key, value] of Object.entries(S.focusSavedStyles || {})) {
      if (key.startsWith('_')) continue;
      video.style[key] = value;
    }

    // Put it back in its original slot — but only if that slot still exists.
    // Instagram recycles reel nodes while we hold the video.
    const origParent = S.focusSavedStyles?._origParent;
    const origNext = S.focusSavedStyles?._origNextSibling;
    if (origParent && document.contains(origParent)) {
      if (origNext && origNext.parentElement === origParent) {
        origParent.insertBefore(video, origNext);
      } else {
        origParent.appendChild(video);
      }
    } else if (video.parentElement === document.body) {
      video.remove();
    }

    S.focusedVideo = null;
    S.focusSavedStyles = null;
  }

  function exitFocusMode() {
    // Don't gate on focusedVideo: mid-navigation the video is already back
    // in the feed, but the backdrop still needs tearing down.
    if (!S.focusMode) return;

    const video = S.focusedVideo;

    restoreVideoFromFocus();

    // A reel we rotated by inheritance never went through applyRotation,
    // so its restored transform is empty. Re-apply so the feed matches.
    if (video && video === S.rotatedVideo && S.rotation !== 0 && !video.style.transform) {
      RR.rotation.applyRotation(video, S.rotation);
    }

    // Tear down backdrop with a fade-out.
    if (S.focusBackdrop) {
      S.focusBackdrop.classList.remove('active');
      setTimeout(() => {
        if (S.focusBackdrop && S.focusBackdrop.parentNode) {
          S.focusBackdrop.parentNode.removeChild(S.focusBackdrop);
        }
        S.focusBackdrop = null;
      }, 300);
    }

    S.focusMode = false;
    S.focusNavigating = false;
    S.wheelAccum = 0;

    // Detach the per-video mute listener on whatever focused video remains
    // (restoreVideoFromFocus already does this, but defense in depth).
    if (video) detachMuteEnforcement(video);

    RR.ui?.setFocusButtonActive?.(false);
  }

  // ── Reel navigation (focus mode & normal feed) ─────────────────────────
  // direction: 1 = next reel, -1 = previous reel
  function navigate(direction) {
    if (S.focusMode) {
      if (S.focusNavigating) return;

      const now = Date.now();
      if (now - S.lastNavTime < NAV_COOLDOWN) return;
      S.lastNavTime = now;
      S.focusNavigating = true;

      const prevVideo = S.focusedVideo;
      const keptRotation = S.rotation;

      // Drop the video back into the feed so the page can scroll normally.
      restoreVideoFromFocus();
      if (S.rotatedVideo) resetRotation(S.rotatedVideo);
      else if (prevVideo) {
        prevVideo.style.transform = '';
        prevVideo.style.transformOrigin = '';
        prevVideo.style.objectFit = '';
      }

      const container = findScrollContainer();
      const step = (container ? container.clientHeight : window.innerHeight) * direction;
      if (container) container.scrollBy({ top: step, behavior: 'smooth' });
      else window.scrollBy({ top: step, behavior: 'smooth' });

      waitForNextVideo(prevVideo, (video) => {
        S.focusNavigating = false;
        if (!S.focusMode || !video) return;

        // Re-arm the rotation before focusing: reapplyBaseline uses S.rotation.
        if (keptRotation !== 0) {
          S.rotation = keptRotation;
          S.rotatedVideo = video;
          RR.ui?.updateButtonState?.();
        }

        applyFocusStyles(video);
      });
      return;
    }

    // Non-focus mode navigation
    const now = Date.now();
    if (now - S.lastNavTime < 350) return;
    S.lastNavTime = now;

    scrollFeed(direction);
  }

  function scrollFeed(direction) {
    if (S.rotatedVideo) {
      resetRotation(S.rotatedVideo);
    }

    const container = findScrollContainer();
    const isCustomContainer = container && container !== document.documentElement && container !== document.body;
    const step = (isCustomContainer ? container.clientHeight : window.innerHeight) * direction;

    if (isCustomContainer) {
      container.scrollBy({ top: step, behavior: 'smooth' });
    } else {
      window.scrollBy({ top: step, behavior: 'smooth' });
    }
  }

  /**
   * Poll for the reel that scrolling landed on. Returns the first video
   * that's different from `prevVideo` and has a non-zero rect.
   * If nothing shows up by the deadline, re-focus whatever is on screen.
   */
  function waitForNextVideo(prevVideo, done) {
    const deadline = Date.now() + 1600;

    const poll = () => {
      if (!S.focusMode) { done(null); return; }

      const video = findActiveVideo();
      if (video && video !== prevVideo && document.contains(video)) {
        const rect = video.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          done(video);
          return;
        }
      }

      if (Date.now() > deadline) {
        // End of feed, slow load, etc. — at least re-focus what's on screen.
        done(findActiveVideo());
        return;
      }

      setTimeout(poll, 100);
    };

    setTimeout(poll, 250); // let smooth scroll get going first
  }

  /**
   * Adopt a different reel as the focused one — used when the underlying
   * feed's active reel changes (background-driven navigation: page scroll,
   * auto-advance, or a different video starts playing).
   *
   * Differs from `navigate()`:
   *   - `navigate` drives a scroll and waits for the next reel to appear.
   *   - `refocusOn` adopts whatever the feed has already settled on.
   *
   * No-ops if we're mid-navigation (would race with ourselves), or if the
   * new video is the one we're already focusing.
   */
  function refocusOn(newVideo) {
    if (!S.focusMode) return;
    if (!newVideo || newVideo === S.focusedVideo) return;
    if (S.focusNavigating) return;

    const prevVideo = S.focusedVideo;
    const keptRotation = S.rotation;

    // Put the old focused video back where we found it.
    restoreVideoFromFocus();
    if (S.rotatedVideo) resetRotation(S.rotatedVideo);
    else if (prevVideo) {
      prevVideo.style.transform = '';
      prevVideo.style.transformOrigin = '';
      prevVideo.style.objectFit = '';
    }

    // Re-arm the rotation so the new video inherits it (same logic as navigate()).
    if (keptRotation !== 0) {
      S.rotation = keptRotation;
      S.rotatedVideo = newVideo;
      RR.ui?.updateButtonState?.();
    } else {
      S.rotation = 0;
      S.rotatedVideo = null;
      RR.ui?.updateButtonState?.();
    }

    applyFocusStyles(newVideo);
  }

  /**
   * Detect whether the underlying feed's "active reel" has diverged from
   * the one we're focusing on. If yes, adopt it via refocusOn().
   *
   * Strict gating to avoid surprise switches:
   *   1. The focused video must be paused or ended (otherwise it's still
   *      actively playing and we shouldn't switch).
   *   2. The candidate must be clearly "current" — close to viewport center
   *      AND large enough to be a real reel, not a hover preview.
   *
   * This guards against the case where Instagram plays multiple videos
   * simultaneously (hover-to-play, side previews): we only follow the
   * user's actual current reel, not a passing preview.
   *
   * Called periodically and from event listeners. Cheap when nothing has
   * changed.
   */
  function syncToBackground() {
    if (!S.focusMode || S.focusNavigating) return;
    const focused = S.focusedVideo;
    // Gate 1: focused video must be paused or ended.
    if (focused && !focused.paused && !focused.ended) return;

    const active = findActiveVideo();
    if (!active || active === focused) return;

    // Gate 2: candidate must look like a real reel, not a preview tile.
    // The focused video we lifted is large; we don't want to switch to
    // a small side preview that just happens to be playing.
    const rect = active.getBoundingClientRect();
    if (rect.width < window.innerWidth * 0.5) return;
    if (rect.height < window.innerHeight * 0.5) return;

    refocusOn(active);
  }

  // ── Wheel handler ────────────────────────────────────────────────────
  function handleWheel(e) {
    if (!S.focusMode) return;
    // Stop the page from scrolling underneath us; navigate() moves it by
    // exactly one reel instead.
    e.preventDefault();
    e.stopPropagation();

    if (S.focusNavigating) return;

    S.wheelAccum += e.deltaY;

    // Trackpads fire a long tail of small deltas; forget stale ones so a
    // slow drift never adds up into an unwanted jump.
    if (S.wheelResetTimer) clearTimeout(S.wheelResetTimer);
    S.wheelResetTimer = setTimeout(() => { S.wheelAccum = 0; }, WHEEL_RESET_MS);

    if (Math.abs(S.wheelAccum) >= WHEEL_THRESHOLD) {
      const direction = S.wheelAccum > 0 ? 1 : -1;
      S.wheelAccum = 0;
      navigate(direction);
    }
  }

  function setupScroll() {
    // Capture phase: the backdrop covers the screen, but the focused video
    // sits above it and would otherwise swallow the event.
    document.addEventListener('wheel', handleWheel, {
      capture: true,
      passive: false,
    });

    // Safety net: Instagram occasionally advances reels without firing
    // a play event we can catch (auto-advance on short clips, programmatic
    // mutations). A low-frequency poll catches those cases. syncToBackground
    // itself is conservative — it only switches when the focused video
    // has actually stopped playing, which avoids stealing focus while
    // the user is just pausing or otherwise interacting.
    if (RR._focusSyncTimer) clearInterval(RR._focusSyncTimer);
    RR._focusSyncTimer = setInterval(() => {
      if (S.focusMode && !S.focusNavigating) syncToBackground();
    }, 1000);
  }

  // ── Expose ───────────────────────────────────────────────────────────
  RR.focus = {
    toggle: toggleFocusMode,
    enter: enterFocusMode,
    exit: exitFocusMode,
    navigate,
    setupScroll,
    reapplyBaseline,
    refocusOn,
    syncToBackground,
    attachMuteEnforcement,
    detachMuteEnforcement,
    // Exposed for tests / debugging; not used by other modules.
    _computeFocusLayout: computeFocusLayout,
    _getVideoAspect: getVideoAspect,
  };
})();
