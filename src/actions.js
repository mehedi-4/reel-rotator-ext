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

  /** Keep video playing if it was playing before a dialog or action interrupted it. */
  function restorePlayback(video) {
    if (!video || !document.contains(video)) return;
    [50, 150, 300, 500, 800].forEach((delay) => {
      setTimeout(() => {
        if (video && document.contains(video) && video.paused && !video.ended) {
          video.play().catch(() => {});
        }
      }, delay);
    });
  }

  /** Toggle repost on the active reel. Native Instagram button toggles repost. */
  function repost() {
    const video = getTargetVideo();
    const wasPlaying = video ? (!video.paused && !video.ended) : false;

    // 1. If an Undo toast or Remove confirmation dialog is already open, confirm it immediately
    if (RR.domUtils?.tryConfirmRemoveRepost?.()) {
      if (wasPlaying) restorePlayback(video);
      return;
    }

    // 2. Click the reel's Repost / Reposted / Remove Repost button
    const clicked = clickReelButton(video, ['Repost', 'Reposted', 'Undo Repost', 'Remove Repost']);

    // 3. Watch for a confirmation modal/dialog or undo toast to auto-confirm removal
    if (clicked) {
      RR.domUtils?.autoConfirmRepostRemoval?.(() => {
        if (wasPlaying) restorePlayback(video);
      });
      if (wasPlaying) {
        restorePlayback(video);
      }
    }
  }

  // ── Expose ──────────────────────────────────────────────────────────
  RR.actions = {
    reactLike,
    repost,
  };
})();
