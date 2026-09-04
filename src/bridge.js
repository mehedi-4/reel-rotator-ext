// ─── src/bridge.js ──────────────────────────────────────────────────
// Runs in the MAIN world (page context) to access React Fiber trees,
// Instagram component props, and page-level resource timing entries.
// Communicates with the extension content script via CustomEvents.

(function () {
  'use strict';

  if (window.__reelBridgeLoaded) return;
  window.__reelBridgeLoaded = true;

  function searchReactForVideoUrl(root, maxDepth = 10) {
    if (!root || typeof root !== 'object') return null;
    const visited = new Set();
    const queue = [{ node: root, d: 0 }];

    while (queue.length > 0) {
      const { node, d } = queue.shift();
      if (!node || typeof node !== 'object' || visited.has(node) || d > maxDepth) continue;
      visited.add(node);

      // Check string match
      if (typeof node === 'string') {
        if (node.startsWith('https://') && (node.includes('.mp4') || node.includes('cdninstagram.com'))) {
          return node;
        }
        continue;
      }

      // Check video_versions array (Instagram GraphQL structure)
      if (Array.isArray(node.video_versions) && node.video_versions.length > 0) {
        const best = node.video_versions.reduce((prev, curr) => {
          return ((curr?.width || 0) > (prev?.width || 0)) ? curr : prev;
        }, node.video_versions[0]);
        if (best && best.url && typeof best.url === 'string' && best.url.startsWith('https://')) {
          return best.url;
        }
      }

      // Check known video url keys
      const candidateKeys = ['videoUrl', 'video_url', 'playbackUrl', 'src', 'progressiveDownloadUrl'];
      for (const ck of candidateKeys) {
        const val = node[ck];
        if (typeof val === 'string' && val.startsWith('https://') && (val.includes('.mp4') || val.includes('cdninstagram.com'))) {
          return val;
        }
      }

      if (d < maxDepth) {
        const priorityKeys = ['memoizedProps', 'props', 'item', 'clip', 'video', 'return', 'stateNode'];
        for (const pk of priorityKeys) {
          if (node[pk] && typeof node[pk] === 'object') {
            queue.push({ node: node[pk], d: d + 1 });
          }
        }
        for (const k in node) {
          if (priorityKeys.includes(k)) continue;
          if (Object.prototype.hasOwnProperty.call(node, k)) {
            const child = node[k];
            if (child && typeof child === 'object' && !visited.has(child)) {
              queue.push({ node: child, d: d + 1 });
            }
          }
        }
      }
    }
    return null;
  }

  function getRecentMp4FromPerformance() {
    try {
      const entries = performance.getEntriesByType('resource');
      for (let i = entries.length - 1; i >= 0; i--) {
        const name = entries[i].name;
        if (typeof name === 'string' && name.includes('cdninstagram.com') && (name.includes('.mp4') || name.includes('/v/t16/'))) {
          return name;
        }
      }
    } catch (_) {}
    return null;
  }

  function resolveVideoFromElement(video) {
    if (!video) return null;

    // Direct progressive src if not blob
    const currentSrc = video.currentSrc || video.src;
    if (currentSrc && currentSrc.startsWith('http') && !currentSrc.startsWith('blob:')) {
      return currentSrc;
    }

    // Walk React fiber / props on video and ancestor containers
    let el = video;
    let depth = 0;
    while (el && depth < 12) {
      for (const k of Object.keys(el)) {
        if (k.startsWith('__reactFiber$') || k.startsWith('__reactProps$') || k.startsWith('__reactInternalInstance$')) {
          const direct = searchReactForVideoUrl(el[k]);
          if (direct) return direct;
        }
      }
      el = el.parentElement;
      depth++;
    }

    // Performance resource timing in the page context
    const perfUrl = getRecentMp4FromPerformance();
    if (perfUrl) return perfUrl;

    return currentSrc || null;
  }

  function extractShortcodeFromValue(val) {
    if (typeof val !== 'string') return null;
    const m = val.match(/\/(?:reels|reel|p)\/([A-Za-z0-9_-]{5,})/i);
    const reserved = ['audio', 'videos', 'tab', 'tagged', 'explore', 'channel'];
    if (m && !reserved.includes(m[1].toLowerCase())) {
      return m[1];
    }
    if (/^[A-Za-z0-9_-]{8,15}$/.test(val) && !reserved.includes(val.toLowerCase())) {
      return val;
    }
    return null;
  }

  function searchReactForPermalink(root, maxDepth = 10) {
    if (!root || typeof root !== 'object') return null;
    const visited = new Set();
    const queue = [{ node: root, d: 0 }];

    while (queue.length > 0) {
      const { node, d } = queue.shift();
      if (!node || typeof node !== 'object' || visited.has(node) || d > maxDepth) continue;
      visited.add(node);

      const candidateKeys = ['code', 'shortcode', 'canonical_url', 'permalink', 'share_url'];
      for (const k of candidateKeys) {
        if (node[k]) {
          const sc = extractShortcodeFromValue(node[k]);
          if (sc) return `https://www.instagram.com/reel/${sc}/`;
        }
      }

      if (d < maxDepth) {
        const priorityKeys = ['memoizedProps', 'props', 'item', 'clip', 'video', 'post', 'media', 'return'];
        for (const pk of priorityKeys) {
          if (node[pk] && typeof node[pk] === 'object') {
            queue.push({ node: node[pk], d: d + 1 });
          }
        }
        for (const k in node) {
          if (priorityKeys.includes(k)) continue;
          if (Object.prototype.hasOwnProperty.call(node, k)) {
            const child = node[k];
            if (child && typeof child === 'object' && !visited.has(child)) {
              queue.push({ node: child, d: d + 1 });
            }
          }
        }
      }
    }
    return null;
  }

  function resolvePermalinkFromElement(video) {
    if (!video) return null;
    let el = video;
    let depth = 0;
    while (el && depth < 12) {
      for (const k of Object.keys(el)) {
        if (k.startsWith('__reactFiber$') || k.startsWith('__reactProps$') || k.startsWith('__reactInternalInstance$')) {
          const direct = searchReactForPermalink(el[k]);
          if (direct) return direct;
        }
      }
      el = el.parentElement;
      depth++;
    }
    return null;
  }

  // Listen for resolution requests from the content script
  window.addEventListener('RR_RESOLVE_VIDEO_REQ', (e) => {
    const reqId = e.detail?.reqId;
    const permalink = e.detail?.permalink;
    let targetShortcode = e.detail?.shortcode || null;
    if (!targetShortcode && permalink) {
      targetShortcode = extractShortcodeFromValue(permalink);
    }

    let targetVideo = null;
    if (targetShortcode) {
      const links = Array.from(document.querySelectorAll(`a[href*="/reel/${targetShortcode}"], a[href*="/p/${targetShortcode}"], a[href*="/reels/${targetShortcode}"]`));
      for (const link of links) {
        if (link.closest('#reel-queue-panel')) continue;
        const container = link.closest('article, [role="article"], div[style*="scroll-snap"]') || link.parentElement;
        if (container) {
          const v = container.querySelector('video');
          if (v) {
            targetVideo = v;
            break;
          }
        }
      }
    }

    if (!targetVideo) {
      const videos = Array.from(document.querySelectorAll('video:not(#reel-queue-video)'));
      for (const v of videos) {
        if (!v.paused && !v.ended && v.readyState > 2) {
          targetVideo = v;
          break;
        }
      }
      if (!targetVideo && videos.length > 0) {
        targetVideo = videos[0];
      }
    }

    const resolvedUrl = resolveVideoFromElement(targetVideo);
    const resolvedPermalink = resolvePermalinkFromElement(targetVideo);

    window.dispatchEvent(new CustomEvent('RR_RESOLVE_VIDEO_RES', {
      detail: {
        reqId,
        url: resolvedUrl,
        permalink: resolvedPermalink,
      }
    }));
  });

  // Listen for queue actions (like, repost)
  window.addEventListener('RR_QUEUE_ACTION_REQ', (e) => {
    const { action, permalink } = e.detail || {};
    let shortcode = null;
    if (permalink) {
      shortcode = extractShortcodeFromValue(permalink);
    }

    if (shortcode) {
      const links = Array.from(document.querySelectorAll(`a[href*="/reel/${shortcode}"], a[href*="/p/${shortcode}"], a[href*="/reels/${shortcode}"]`));
      for (const link of links) {
        if (link.closest('#reel-queue-panel')) continue;
        const root = link.closest('article, [role="article"], div[style*="scroll-snap"]') || link.parentElement;
        if (root) {
          if (action === 'like') {
            const btn = root.querySelector('button[aria-label*="Like" i], button[aria-label*="Unlike" i], svg[aria-label*="Like" i], svg[aria-label*="Unlike" i]');
            if (btn) {
              btn.click();
              return;
            }
          } else if (action === 'repost') {
            const btn = root.querySelector('button[aria-label*="Repost" i], svg[aria-label*="Repost" i]');
            if (btn) {
              btn.click();
              return;
            }
          }
        }
      }
    }
  });

  // Listen for audio toggle requests from content script
  window.addEventListener('RR_TOGGLE_MUTE_REQ', (e) => {
    const { targetMuted, buttonClicked } = e.detail || {};
    if (buttonClicked) return; // already handled by content script click

    const videos = Array.from(document.querySelectorAll('video:not(#reel-queue-video)'));
    let activeVideo = null;
    for (const v of videos) {
      if (!v.paused && !v.ended && v.readyState > 2) {
        activeVideo = v;
        break;
      }
    }
    if (!activeVideo && videos.length > 0) activeVideo = videos[0];
    if (!activeVideo) return;

    // 1. Search for audio button in main-world DOM
    const audioSelectors = [
      'button[aria-label*="audio" i]',
      '[role="button"][aria-label*="audio" i]',
      'button[aria-label*="mute" i]',
      '[role="button"][aria-label*="mute" i]',
      'button[aria-label*="sound" i]',
      '[role="button"][aria-label*="sound" i]',
      'button[aria-label*="volume" i]',
      '[role="button"][aria-label*="volume" i]',
      'svg[aria-label*="audio" i]',
      'svg[aria-label*="mute" i]',
    ].join(', ');

    const vRect = activeVideo.getBoundingClientRect();
    const candidates = Array.from(document.querySelectorAll(audioSelectors));
    let bestBtn = null;
    let bestDist = Infinity;

    for (const el of candidates) {
      if (el.tagName === 'A' || el.closest('a')) continue;
      const clickable = el.closest('button, [role="button"]') || el;
      const r = clickable.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom < vRect.top - 60 || r.top > vRect.bottom + 60) continue;
      const dist = Math.abs(r.top + r.height / 2 - (vRect.top + vRect.height / 2));
      if (dist < bestDist) {
        bestDist = dist;
        bestBtn = clickable;
      }
    }

    if (bestBtn) {
      bestBtn.click();
      return;
    }

    // 2. Main-world React Fiber traversal on activeVideo ancestors for audio toggle props
    let el = activeVideo;
    let depth = 0;
    while (el && depth < 10) {
      for (const k of Object.keys(el)) {
        if (k.startsWith('__reactFiber$')) {
          let fiber = el[k];
          let fDepth = 0;
          while (fiber && fDepth < 15) {
            const props = fiber.memoizedProps;
            if (props) {
              if (typeof props.onToggleAudio === 'function') {
                try { props.onToggleAudio(); return; } catch (_) {}
              }
              if (typeof props.toggleAudio === 'function') {
                try { props.toggleAudio(); return; } catch (_) {}
              }
              if (typeof props.setIsMuted === 'function') {
                try { props.setIsMuted(targetMuted); return; } catch (_) {}
              }
            }
            fiber = fiber.return;
            fDepth++;
          }
        }
      }
      el = el.parentElement;
      depth++;
    }
  });

  // ── Strict Main-World Feed Video Muting ─────────────────────────────
  // Intercepts any play/volumechange/timeupdate on feed videos while the
  // queue is active, guaranteeing 0 ms audio leak even on scroll/restart.

  // 1. Prototype play interception: ensures video is muted before playback starts
  try {
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      if (this.id !== 'reel-queue-video' && document.documentElement?.dataset?.rrQueuePlaying === '1') {
        this.muted = true;
      }
      return origPlay.apply(this, args);
    };
  } catch (_) {}

  // 2. Prototype muted setter interception: prevents feed videos from being unmuted while queue plays
  try {
    const mutedDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');
    if (mutedDesc && mutedDesc.set) {
      const origSetMuted = mutedDesc.set;
      Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
        configurable: true,
        enumerable: true,
        get() {
          return mutedDesc.get.call(this);
        },
        set(val) {
          if (this.id !== 'reel-queue-video' && document.documentElement?.dataset?.rrQueuePlaying === '1') {
            return origSetMuted.call(this, true);
          }
          return origSetMuted.call(this, val);
        }
      });
    }
  } catch (_) {}

  // 3. Capture-phase window event listeners
  function enforceFeedMute(e) {
    if (document.documentElement?.dataset?.rrQueuePlaying !== '1') return;
    const target = e.target;
    if (target && target.tagName === 'VIDEO' && target.id !== 'reel-queue-video') {
      if (!target.muted) {
        target.muted = true;
      }
    }
  }

  window.addEventListener('play', enforceFeedMute, true);
  window.addEventListener('playing', enforceFeedMute, true);
  window.addEventListener('volumechange', enforceFeedMute, true);
  window.addEventListener('timeupdate', enforceFeedMute, true);
  window.addEventListener('seeked', enforceFeedMute, true);
  window.addEventListener('loadedmetadata', enforceFeedMute, true);

  // 4. MutationObserver for dynamically added reels when scrolling
  try {
    const feedObserver = new MutationObserver((mutations) => {
      if (document.documentElement?.dataset?.rrQueuePlaying !== '1') return;
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'VIDEO' && node.id !== 'reel-queue-video') {
            node.muted = true;
          } else if (node.querySelectorAll) {
            const vids = node.querySelectorAll('video:not(#reel-queue-video)');
            for (const v of vids) v.muted = true;
          }
        }
      }
    });

    if (document.documentElement) {
      feedObserver.observe(document.documentElement, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        feedObserver.observe(document.documentElement, { childList: true, subtree: true });
      });
    }
  } catch (_) {}
})();
