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
    S.btn.title = 'Rotate (R) · Focus (F)';
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
    if (S.rotation !== 0) {
      S.btn.classList.add('rotated');
      S.degreeBadge.textContent = S.rotation + '°';
    } else {
      S.btn.classList.remove('rotated');
    }
  }

  /** Toggle the yellow "focus active" appearance on the rotate button. */
  function setFocusButtonActive(active) {
    if (!S.btn) return;
    S.btn.classList.toggle('focus-active', !!active);
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
  }

  // ── Observers / event wiring ─────────────────────────────────────────
  function setupMutationObserver() {
    if (RR._mutationObserver) RR._mutationObserver.disconnect();

    let debounceTimer = null;
    RR._mutationObserver = new MutationObserver(() => {
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
      }
    }
  }

  function setupScrollReset() {
    const tryAttach = () => {
      const container = findScrollContainer();
      if (!container) return false;

      let scrollTimer = null;
      container.addEventListener('scroll', () => {
        if (S.focusMode) {
          // The underlying feed scrolled. Adopt whatever reel is now active
          // so focus mode follows page-driven changes (auto-advance,
          // external taps, programmatic navigation).
          if (scrollTimer) clearTimeout(scrollTimer);
          scrollTimer = setTimeout(() => RR.focus?.syncToBackground?.(), 100);
          return;
        }
        if (S.rotatedVideo) {
          if (scrollTimer) clearTimeout(scrollTimer);
          scrollTimer = setTimeout(resetIfActive, 100);
        }
      }, { passive: true });
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
      if (e.target.tagName !== 'VIDEO') return;
      if (S.focusMode) {
        // A different video started playing in the feed. Adopt it —
        // focus mode should reflect whatever Instagram considers "current".
        RR.focus?.syncToBackground?.();
        return;
      }
      if (S.rotatedVideo && e.target !== S.rotatedVideo) resetIfActive();
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

    toggleButton(isReelsPage());
  }

  // ── Expose ───────────────────────────────────────────────────────────
  RR.ui = {
    init,
    createButton,
    updateButtonState,
    setFocusButtonActive,
    toggleButton,
    resetIfActive,
  };
})();
