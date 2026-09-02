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

  /** Toggle like on the active reel. Native Instagram button is already a toggle. */
  function reactLike() {
    const video = findActiveVideo();
    if (!video) return;
    // Try "Like" first; if the reel is already liked the aria-label flips to
    // "Unlike" — both match, but matching is case-insensitive substring so we
    // pass a list and let clickReelButton take the first hit.
    clickReelButton(video, ['Like', 'Unlike']);
  }

  /** Open Instagram's native share/send dialog. */
  function openSend() {
    const video = findActiveVideo();
    if (!video) return;
    // "Share" is the older label; newer Instagram builds use "Send".
    clickReelButton(video, ['Share', 'Send']);
  }

  /** Open Instagram's native comment composer / panel. */
  function openComment() {
    const video = findActiveVideo();
    if (!video) return;
    clickReelButton(video, ['Comment']);
  }

  // ── Expose ──────────────────────────────────────────────────────────
  RR.actions = {
    reactLike,
    openSend,
    openComment,
  };
})();
