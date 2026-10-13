// ─── src/ui.js ────────────────────────────────────────────────────
// Owns the on-page rotate button + all the event wiring that detects
// when the user has navigated away or onto a new reel.
//
// init() is the single entry point — it calls setupKeyboardShortcut,
// setupMutationObserver, setupUrlChangeDetection, setupScrollReset,
// setupVideoPlayReset, setupFocusScroll in dependency order.

(function () {
  'use strict';

  const RR = window.__reelRotator;
  const S = RR.state;
  const { findScrollContainer, findActiveVideo, isReelsPage } = RR.domUtils;

  // ── Rotate button ────────────────────────────────────────────────────
  function createButton() {
    if (document.getElementById('reel-rotate-btn')) {
      S.btn = document.getElementById('reel-rotate-btn');
      S.degreeBadge = S.btn.querySelector('.degree-badge');
      return;
    }

    S.btn = document.createElement('button');
    S.btn.id = 'reel-rotate-btn';
    S.btn.title = 'Rotate CCW (R) · CW (E) · Focus (F)';
    S.btn.innerHTML = '↻';

    S.degreeBadge = document.createElement('span');
    S.degreeBadge.className = 'degree-badge';
    S.degreeBadge.textContent = '90°';
    S.btn.appendChild(S.degreeBadge);

    S.btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      RR.rotation.handleRotate();
    });

    document.body.appendChild(S.btn);
  }

  /** Update the visual state of the rotate button based on current rotation. */
  function updateButtonState() {
    if (!S.btn) return;
    const activeRot = S.rotation;
    if (activeRot !== 0) {
      S.btn.classList.add('rotated');
      S.degreeBadge.textContent = activeRot + '°';
    } else {
      S.btn.classList.remove('rotated');
    }
  }

  /** Toggle the yellow "focus active" appearance on the rotate button. */
  function setFocusButtonActive(active) {
    if (!S.btn) return;
    S.btn.classList.toggle('focus-active', !!active);
  }

  function showFocusStatus(message) {
    if (!S.focusMode || !message) return;

    let status = document.getElementById('reel-focus-action-status');
    if (!status) {
      status = document.createElement('div');
      status.id = 'reel-focus-action-status';
      document.body.appendChild(status);
    }

    status.textContent = message;
    status.classList.remove('visible');
    requestAnimationFrame(() => status.classList.add('visible'));

    if (status._hideTimer) clearTimeout(status._hideTimer);
    status._hideTimer = setTimeout(() => {
      status.classList.remove('visible');
    }, 1200);
  }

  /**
   * Mode-agnostic feedback toast for volume / playback-rate shortcuts.
   * In focus mode the focused video (z-index 1000001) and backdrop sit
   * ABOVE the regular toast (z-index 999999), so we switch to the focus
   * status overlay there. Otherwise use the regular status toast.
   */
  function showStatusToast(message) {
    if (!message) return;
    if (S.focusMode) {
      showFocusStatus(message);
      return;
    }

    let toast = document.getElementById('reel-status-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'reel-status-toast';
      toast.className = 'rr-status-toast';
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.remove('visible');
    requestAnimationFrame(() => toast.classList.add('visible'));

    if (toast._timer) clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('visible');
    }, 2200);
  }

  function toggleButton(show) {
    if (!S.btn) return;
    if (show) S.btn.classList.add('visible');
    else {
      S.btn.classList.remove('visible');
      resetIfActive();
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────
  /** Central cleanup: exit focus mode and reset any active rotation. */
  function resetIfActive() {
    if (S.focusMode) RR.focus.exit();
    if (S.rotatedVideo) RR.rotation.resetRotation(S.rotatedVideo);
    document.getElementById('reel-focus-action-status')?.remove();
  }

  // ── Observers / event wiring ─────────────────────────────────────────
  function setupMutationObserver() {
    if (RR._mutationObserver) RR._mutationObserver.disconnect();

    let debounceTimer = null;
    RR._mutationObserver = new MutationObserver(() => {
      RR.counter?.schedule();
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => toggleButton(isReelsPage()), 300);
    });

    RR._mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function setupUrlChangeDetection() {
    let lastUrl = window.location.href;

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      handleUrlChange();
    };
    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      handleUrlChange();
    };
    window.addEventListener('popstate', handleUrlChange);

    function handleUrlChange() {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        resetIfActive();
        toggleButton(isReelsPage());
        RR.counter?.sample();
      }
    }
  }

  function setupScrollReset() {
    let scrollTimer = null;

    const onScroll = () => {
      if (S.focusMode) {
        // The underlying feed scrolled. Adopt whatever reel is now active
        // so focus mode follows page-driven changes (auto-advance,
        // external taps, programmatic navigation).
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => RR.focus?.syncToBackground?.(), 100);
        return;
      }
      if (S.rotatedVideo) {
        // Immediately reset rotated feed reel and clear overflow mods on scroll
        // so that unclipped overflow and rotated transform do not bleed over newly scrolled reels
        resetIfActive();
      }
    };

    // Attach to window and document with capture phase to catch scrolls on ANY element
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });

    // Also attach to wheel for immediate response when feed scroll initiates
    window.addEventListener('wheel', (e) => {
      if (!S.focusMode && S.rotatedVideo && Math.abs(e.deltaY) > 5) {
        resetIfActive();
      }
    }, { capture: true, passive: true });

    const tryAttach = () => {
      const container = findScrollContainer();
      if (!container) return false;
      container.addEventListener('scroll', onScroll, { passive: true });
      return true;
    };

    if (!tryAttach()) {
      const retryInterval = setInterval(() => {
        if (tryAttach()) clearInterval(retryInterval);
      }, 1000);
      setTimeout(() => clearInterval(retryInterval), 30000);
    }
  }

  function setupVideoPlayReset() {
    // Capture phase so we catch the play event before Instagram does.
    document.addEventListener('play', (e) => {
      const vid = e.target;
      if (vid.tagName !== 'VIDEO') return;

      if (S.focusMode) {
        // A different video started playing in the feed. Adopt it immediately.
        if (vid !== S.focusedVideo) {
          RR.focus?.refocusOn?.(vid);
        }
      } else if (S.rotatedVideo && vid !== S.rotatedVideo) {
        resetIfActive();
      }

      // Ensure newly playing reels use the user's audio preference.
      if (S.userMuted !== null) {
        if (S.userMuted === false) {
          if (vid.muted) {
            vid.muted = false;
          }
        } else if (S.userMuted === true) {
          if (!vid.muted) {
            vid.muted = true;
          }
        }
      }

      // Re-assert volume preference (Shift+W / Shift+S) on newly playing
      // feed reels.
      if (S.userVolume !== null) {
        vid.volume = S.userVolume;
      }

      // Re-assert playback speed preference (Shift+1..4) on newly playing
      // reels.
      if (S.userPlaybackRate !== null) {
        try { vid.playbackRate = S.userPlaybackRate; } catch (_) {}
      }
    }, true);

    // Keep S.userMuted in sync if the user manually toggles audio using Instagram's on-screen button
    document.addEventListener('volumechange', (e) => {
      const vid = e.target;
      if (vid.tagName !== 'VIDEO') return;
      S.userMuted = vid.muted;
    }, true);
  }

  // ── Init ─────────────────────────────────────────────────────────────
  function init() {
    createButton();
    setupMutationObserver();
    RR.keymap.setupKeyboardShortcut();
    setupUrlChangeDetection();
    setupScrollReset();
    setupVideoPlayReset();
    RR.focus.setupScroll();
    RR.counter.init();

    toggleButton(isReelsPage());
  }

  // ── Expose ───────────────────────────────────────────────────────────
  RR.ui = {
    init,
    createButton,
    updateButtonState,
    setFocusButtonActive,
    showFocusStatus,
    showStatusToast,
    toggleButton,
    resetIfActive,
  };
})();
