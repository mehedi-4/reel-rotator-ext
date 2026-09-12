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

  /**
   * Adjust the volume of the active reel (Shift+W / Shift+S).
   * direction: +1 raises, -1 lowers. Never drops below VOLUME_FLOOR (5%)
   * and never mutes — muting stays exclusively on M. Raising the volume of
   * a muted video unmutes it first via toggleMute so Instagram's React
   * audio state and speaker icon stay in sync.
   */
  function adjustVolume(direction) {
    const video = getTargetVideo();
    if (!video) return;

    const S = RR.state;
    const { VOLUME_STEP: step, VOLUME_FLOOR: floor } = RR.constants;

    if (video.muted) {
      if (direction < 0) {
        // Lowering a muted video does nothing audible; mute is M's job.
        RR.ui?.showStatusToast?.('Muted · Shift+W to unmute');
        return;
      }
      toggleMute();
      if (video.volume < floor) {
        video.volume = floor;
      }
      S.userVolume = video.volume;
      RR.ui?.showStatusToast?.(`🔊 ${Math.round(video.volume * 100)}%`);
      return;
    }

    const target = direction > 0
      ? Math.min(1, Math.round((video.volume + step) * 10) / 10)
      : Math.max(floor, Math.round((video.volume - step) * 10) / 10);

    if (target === video.volume) {
      // Already pinned at 100% (max) or the 5% floor (min).
      RR.ui?.showStatusToast?.(`🔊 ${Math.round(video.volume * 100)}% (${direction > 0 ? 'max' : 'min'})`);
      return;
    }

    video.volume = target;
    S.userVolume = target;
    RR.ui?.showStatusToast?.(`🔊 ${Math.round(target * 100)}%`);
  }

  /**
   * Set the playback speed of the active reel (Shift+1..4 → 1x / 1.25x /
   * 1.5x / 2x). Stored in S.userPlaybackRate and re-asserted on subsequent
   * reels, so the preference survives navigation.
   */
  function setPlaybackRate(rate) {
    const video = getTargetVideo();
    if (!video) return;
    video.playbackRate = rate;
    RR.state.userPlaybackRate = rate;
    RR.ui?.showStatusToast?.(`${rate}× speed`);
  }

  // ── Expose ──────────────────────────────────────────────────────────
  RR.actions = {
    reactLike,
    repost,
    toggleMute,
    adjustVolume,
    setPlaybackRate,
  };
})();
