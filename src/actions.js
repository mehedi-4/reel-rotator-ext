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
      // Fallback: simulate double click on the active video
      try {
        const dblEvent = new MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
          view: window,
        });
        video.dispatchEvent(dblEvent);
      } catch (_) {}
    }
  }

  // ── Expose ──────────────────────────────────────────────────────────
  RR.actions = {
    reactLike,
  };
})();
