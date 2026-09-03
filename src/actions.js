// ─── src/actions.js ───────────────────────────────────────────────
// Instagram-native action triggers (react / send / comment).
//
// Each action finds the active reel's matching button via aria-label
// and clicks it. Instagram's own UI handles the rest — animations,
// state, dialogs. This includes the natural toggle behavior of the
// like button: clicking it again un-likes.

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

  /** Open Instagram's native share/send dialog. */
  function openSend() {
    const video = getTargetVideo();
    clickReelButton(video, ['Share', 'Send']);
  }

  /** Open Instagram's native comment composer / panel. */
  function openComment() {
    const video = getTargetVideo();
    clickReelButton(video, ['Comment']);
  }

  // ── Expose ──────────────────────────────────────────────────────────
  RR.actions = {
    reactLike,
    openSend,
    openComment,
  };
})();
