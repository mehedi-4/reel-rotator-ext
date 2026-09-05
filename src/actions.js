// ─── src/actions.js ───────────────────────────────────────────────
// Instagram-native action triggers (react / like).
//
// Finds the active reel's like button and clicks it. Instagram's own UI
// handles the rest — animations, state, toggle behavior.

(function () {
  'use strict';

  const RR = window.__reelRotator;
  const S = RR.state;
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
    const likeState = RR.domUtils?.getReelActionState?.(video, 'like') || '';
    const wasLiked = likeState.includes('unlike') || likeState.includes('liked');
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
    if (S.focusMode) {
      RR.ui?.showFocusStatus?.(wasLiked ? 'Unliked' : 'Liked');
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
    const repostState = RR.domUtils?.getReelActionState?.(video, 'repost') || '';
    const wasReposted = repostState.includes('reposted') ||
      repostState.includes('undo') || repostState.includes('remove');
    const wasPlaying = video ? (!video.paused && !video.ended) : false;

    // 1. If an Undo toast or Remove confirmation dialog is already open, confirm it immediately
    if (RR.domUtils?.tryConfirmRemoveRepost?.()) {
      if (wasPlaying) restorePlayback(video);
      if (S.focusMode) RR.ui?.showFocusStatus?.('Unreposted');
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
      if (S.focusMode) {
        RR.ui?.showFocusStatus?.(wasReposted ? 'Unreposted' : 'Reposted');
      }
    }
  }

  /**
   * Toggle mute on the active reel by triggering Instagram's real speaker button.
   * Updates Instagram's native React audio state so subsequent reels stay unmuted
   * and the speaker icon in the bottom right corner reflects the correct state.
   */
  function toggleMute() {
    const video = getTargetVideo();
    if (!video) return;

    const S = RR.state;
    // Determine target muted state: toggle from current video.muted
    const currentlyMuted = video.muted;
    const targetMuted = !currentlyMuted;
    S.userMuted = targetMuted;

    // 1. Click Instagram's real audio button
    const btn = RR.domUtils?.findAudioButtonForVideo?.(video);
    let clicked = false;
    if (btn) {
      clicked = RR.domUtils?.triggerClick?.(btn) || false;
    }

    // 2. Immediate feedback on the video element
    video.muted = targetMuted;

    // 3. Dispatch to main-world bridge for fallback if needed
    try {
      window.dispatchEvent(new CustomEvent('RR_TOGGLE_MUTE_REQ', {
        detail: {
          targetMuted,
          buttonClicked: clicked
        }
      }));
    } catch (_) {}

    // 4. Verification re-assert after Instagram's event cycle
    [50, 150, 300].forEach((delay) => {
      setTimeout(() => {
        if (!video || !document.contains(video)) return;
        if (document.documentElement?.dataset?.rrQueuePlaying === '1') {
          video.muted = true;
          return;
        }
        if (video.muted !== S.userMuted) {
          video.muted = S.userMuted;
        }
      }, delay);
    });
  }

  // ── Expose ──────────────────────────────────────────────────────────
  RR.actions = {
    reactLike,
    repost,
    toggleMute,
  };
})();
