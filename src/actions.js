// ─── src/actions.js ───────────────────────────────────────────────
// Instagram-native action triggers (react / like).
//
// Finds the active reel's like button and clicks it. Instagram's own UI
// handles the rest — animations, state, toggle behavior.

(function () {
  'use strict';

  const RR = window.__reelRotator;
  const { findActiveVideo, clickReelButton } = RR.domUtils;

  function getTargetVideo() {
    const S = RR.state;
    if (S.focusMode && S.focusedVideo && document.contains(S.focusedVideo)) {
      return S.focusedVideo;
    }
    if (S.rotatedVideo && document.contains(S.rotatedVideo)) {
      return S.rotatedVideo;
    }
    return findActiveVideo();
  }

  /** Toggle like on the active reel. Native Instagram button is already a toggle. */
  function reactLike() {
    const video = getTargetVideo();
    const clicked = clickReelButton(video, ['Like', 'Unlike']);
    if (!clicked && video) {
      // Fallback: simulate double click on the active video and its overlay wrapper
      try {
        const vRect = video.getBoundingClientRect();
        const cx = vRect.left + vRect.width / 2;
        const cy = vRect.top + vRect.height / 2;
        const dblEvent = new MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: cx,
          clientY: cy,
        });
        video.dispatchEvent(dblEvent);
        if (video.parentElement) {
          video.parentElement.dispatchEvent(dblEvent);
        }
      } catch (_) {}
    }
  }

  // ── Expose ──────────────────────────────────────────────────────────
  RR.actions = {
    reactLike,
  };
})();
