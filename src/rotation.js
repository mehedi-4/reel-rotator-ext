// ─── src/rotation.js ──────────────────────────────────────────────
// Rotation behavior: handleRotate dispatches to either applyRotation
// (normal feed) or applyRotationInFocus (bug-fixed focus-mode path).
// Owns the overflow-mod stack used to keep the rotated video visible
// when Instagram's ancestors have `overflow: hidden`.

(function () {
  'use strict';

  const RR = window.__reelRotator;
  const S = RR.state;
  const { findActiveVideo, getVideoContainer, findScrollContainer } = RR.domUtils;

  /**
   * Apply rotation in the *normal* feed (video is still inside its reel card).
   * Scales the video at 90°/270° so it fills the container instead of being
   * cropped to the original aspect, and patches ancestor overflow to keep
   * the rotated video visible.
   */
  function applyRotation(video, degrees) {
    const container = getVideoContainer(video);
    const containerRect = container.getBoundingClientRect();

    let scale = 1;
    const absDeg = Math.abs(degrees);
    if (absDeg === 90 || absDeg === 270) {
      scale = containerRect.width / containerRect.height;
    }

    video.style.transform = `rotate(${degrees}deg) scale(${scale})`;
    video.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    video.style.transformOrigin = 'center center';
    video.style.objectFit = 'contain';

    clearOverflowMods();
    const mainScroll = findScrollContainer();
    let el = video.parentElement;
    while (el && el !== document.body) {
      // Don't touch the main scroll container or anything above it.
      if (el === mainScroll) break;
      const computed = window.getComputedStyle(el);
      if (computed.overflow !== 'visible') {
        S.overflowMods.push({ el, orig: el.style.overflow });
        el.style.overflow = 'visible';
      }
      el = el.parentElement;
    }
  }

  /**
   * Apply rotation while focus mode is active.
   *
   * BUG FIX: Previously, pressing R in focus mode called applyRotation(),
   * which is unaware of focus-mode positioning. Because focus mode lifts
   * the video into <body>, getVideoContainer() would resolve to <body>
   * itself — yielding a 16:9 scale that, combined with the loss of the
   * centering translate(-50%, -50%), shot the video off the viewport.
   *
   * This function instead delegates to focus.js for the layout, so the
   * width/height/transform are computed by the same code path that
   * applyFocusStyles uses — single source of truth, no drift.
   */
  function applyRotationInFocus(video, degrees) {
    RR.focus?.reapplyBaseline?.(video, degrees);
  }

  /**
   * Restore inline rotation styles to nothing.
   *
   * BUG FIX: In focus mode, the previous width/height were set for a 90/270
   * rotation (swapped). If we only clear the transform, the video keeps
   * those swapped dimensions and overflows the viewport once it returns
   * to 0° orientation. We must also restore the focus-mode baseline.
   *
   * Outside focus mode: just clear the transform stack — the feed already
   * sizes the video correctly.
   */
  function resetRotation(video) {
    if (!video) return;
    video.style.transform = '';
    video.style.transition = '';
    video.style.transformOrigin = '';
    video.style.objectFit = '';
    clearOverflowMods();
    S.rotation = 0;
    S.rotatedVideo = null;

    if (S.focusMode && S.focusedVideo === video && video.parentElement === document.body) {
      // Re-apply the focus-mode layout at 0° ONLY if the video is currently focused in document.body.
      RR.focus?.reapplyBaseline?.(video);
    } else if (video.parentElement !== document.body) {
      // Ensure no focus-mode or lingering rotation styles remain on feed videos
      video.style.position = '';
      video.style.zIndex = '';
      video.style.top = '';
      video.style.left = '';
      video.style.width = '';
      video.style.height = '';
      video.style.maxWidth = '';
      video.style.maxHeight = '';
      video.style.margin = '';
      video.style.borderRadius = '';
      video.style.boxShadow = '';
    }

    RR.ui?.updateButtonState?.();
  }

  /**
   * Restore overflow on any ancestor we patched during a previous rotation.
   * Idempotent: safe to call multiple times.
   */
  function clearOverflowMods() {
    for (const { el, orig } of S.overflowMods) {
      try {
        if (el && el.isConnected) {
          el.style.overflow = orig;
        }
      } catch (_) { /* element may be gone */ }
    }
    S.overflowMods = [];
  }

  /**
   * Entry point. Cycles rotation by delta (-90° by default for anti-clockwise,
   * +90° for clockwise) per press; wraps to 0° after a full turn.
   * Dispatches to applyRotation or applyRotationInFocus depending on state.
   */
  function handleRotate(delta = -90) {
    const video = findActiveVideo();
    if (!video) return;

    if (S.rotatedVideo && S.rotatedVideo !== video) {
      resetRotation(S.rotatedVideo);
    }

    let nextRotation = S.rotation + delta;
    if (Math.abs(nextRotation) >= 360) {
      nextRotation = 0;
    }
    S.rotation = nextRotation;

    if (S.rotation === 0) {
      resetRotation(video);
      return;
    }

    if (S.focusMode) {
      applyRotationInFocus(video, S.rotation);
    } else {
      applyRotation(video, S.rotation);
    }
    S.rotatedVideo = video;
    RR.ui?.updateButtonState?.();
  }

  // ── Expose ──────────────────────────────────────────────────────────
  RR.rotation = {
    handleRotate,
    handleRotateCW: () => handleRotate(90),
    handleRotateCCW: () => handleRotate(-90),
    applyRotation,
    applyRotationInFocus,
    resetRotation,
    clearOverflowMods,
  };
})();
