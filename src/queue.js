// ─── src/queue.js ─────────────────────────────────────────────────
// YouTube-style Reels Queue engine for Instagram desktop.
//
// Features:
//   - 'D': Adds active reel to queue and starts playback on the right side.
//   - 'T': Toggles audio focus between the queue player and main feed.
//   - Main feed remains completely scrollable and interactive.
//   - Drag-and-drop & up/down arrow reordering.
//   - Finished reels stay in queue (move to played group at top).
//   - Click to delete (×) or click to switch active playback.
//   - Instagram-native dark theme styling.

(function () {
  'use strict';

  const RR = window.__reelRotator;
  const S = RR.state;
  const { findActiveVideo, findReelContainer } = RR.domUtils;

  // ── Module State ────────────────────────────────────────────────────
  let panelEl = null;
  let toggleBtn = null;
  let videoEl = null;
  let listEl = null;
  let countBadgeEl = null;
  let audioBadgeEl = null;
  let playPauseBtn = null;
  let progressBarEl = null;
  let progressFillEl = null;
  let timeDisplayEl = null;
  let toastEl = null;
  let draggedIndex = null;
  let feedMuteWatcher = null;
  let errorOverlayEl = null;
  let errorTextEl = null;
  let _mediaErrorRetries = 0;

  // ── Helper: Deep Search for Playable Video URL ──────────────────────
  function searchReactForVideoUrl(root, maxDepth = 8) {
    if (!root || typeof root !== 'object') return null;
    const visited = new Set();
    const queue = [{ node: root, d: 0 }];

    while (queue.length > 0) {
      const { node, d } = queue.shift();
      if (!node || typeof node !== 'object' || visited.has(node) || d > maxDepth) continue;
      visited.add(node);

      // Check string
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

      // Check common property names in Instagram React components
      const candidateKeys = ['videoUrl', 'video_url', 'playbackUrl', 'src', 'progressiveDownloadUrl'];
      for (const ck of candidateKeys) {
        const val = node[ck];
        if (typeof val === 'string' && val.startsWith('https://') && (val.includes('.mp4') || val.includes('cdninstagram.com'))) {
          return val;
        }
      }

      // Enqueue child objects
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

  function findRecentMediaUrl() {
    try {
      const resources = performance.getEntriesByType('resource');
      for (let i = resources.length - 1; i >= 0; i--) {
        const name = resources[i].name;
        if (typeof name === 'string' && name.includes('cdninstagram.com') && (name.includes('.mp4') || name.includes('/v/t16/'))) {
          return name;
        }
      }
    } catch (_) {}
    return null;
  }

  function resolvePlayableVideoUrl(video, container) {
    if (!video) return null;

    // 1. Direct src if it is a real progressive MP4 URL (not blob)
    const currentSrc = video.currentSrc || video.src;
    if (currentSrc && currentSrc.startsWith('http') && !currentSrc.startsWith('blob:')) {
      return currentSrc;
    }

    // 2. Child <source> elements
    const sources = video.querySelectorAll('source');
    for (const s of sources) {
      if (s.src && s.src.startsWith('http') && !s.src.startsWith('blob:')) {
        return s.src;
      }
    }

    // 3. React Props & Fiber traversal on video and ancestors
    const elementsToSearch = [video, container, video.parentElement, video.parentElement?.parentElement].filter(Boolean);
    for (const el of elementsToSearch) {
      for (const k of Object.keys(el)) {
        if (k.startsWith('__reactFiber$') || k.startsWith('__reactProps$') || k.startsWith('__reactInternalInstance$')) {
          const directUrl = searchReactForVideoUrl(el[k]);
          if (directUrl) return directUrl;
        }
      }
    }

    // 4. Performance resource timing entries (recent mp4 downloads)
    const resourceUrl = findRecentMediaUrl();
    if (resourceUrl) return resourceUrl;

    // 5. Fallback to currentSrc or src
    return currentSrc || null;
  }

  function requestMainWorldVideoData(timeoutMs = 400, permalink = null) {
    return new Promise((resolve) => {
      const reqId = 'rq-res-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      let timer = null;

      function onResponse(e) {
        if (e.detail?.reqId === reqId) {
          window.removeEventListener('RR_RESOLVE_VIDEO_RES', onResponse);
          clearTimeout(timer);
          resolve({
            url: e.detail?.url || null,
            permalink: e.detail?.permalink || null,
          });
        }
      }

      window.addEventListener('RR_RESOLVE_VIDEO_RES', onResponse);
      window.dispatchEvent(new CustomEvent('RR_RESOLVE_VIDEO_REQ', { detail: { reqId, permalink } }));

      timer = setTimeout(() => {
        window.removeEventListener('RR_RESOLVE_VIDEO_RES', onResponse);
        resolve({ url: null, permalink: null });
      }, timeoutMs);
    });
  }

  // ── Helper: URL Extraction & Normalization ──────────────────────────
  function extractReelShortcode(url) {
    if (!url || typeof url !== 'string') return null;
    const m = url.match(/\/(?:reels|reel|p)\/([A-Za-z0-9_-]{5,})/i);
    const reserved = ['audio', 'videos', 'tab', 'tagged', 'explore', 'channel'];
    if (m && !reserved.includes(m[1].toLowerCase())) {
      return m[1];
    }
    return null;
  }

  function normalizeReelUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const shortcode = extractReelShortcode(url);
    if (shortcode) {
      return `https://www.instagram.com/reel/${shortcode}/`;
    }
    return url;
  }

  function findReelPermalink(container, video) {
    const roots = [
      container,
      video?.closest('article, [role="article"], div[style*="scroll-snap"]'),
      video?.parentElement,
      video?.parentElement?.parentElement,
    ].filter(Boolean);

    for (const root of roots) {
      const links = root.querySelectorAll('a[href]');
      for (const a of links) {
        const href = a.getAttribute('href') || a.href || '';
        const sc = extractReelShortcode(href);
        if (sc) {
          return `https://www.instagram.com/reel/${sc}/`;
        }
      }
    }
    return null;
  }

  // ── Helper: Capture Active Reel Metadata ────────────────────────────
  function getActiveVideoRotation(video) {
    if (S.focusMode && S.focusedVideo && S.rotation) {
      return ((S.rotation % 360) + 360) % 360;
    }
    if (S.rotatedVideo && S.rotatedVideo.id !== 'reel-queue-video' && (S.rotatedVideo === video || document.contains(S.rotatedVideo))) {
      return ((S.rotation % 360) + 360) % 360;
    }
    if (video && video.style && video.style.transform) {
      const match = video.style.transform.match(/rotate\((-?\d+)deg\)/);
      if (match) {
        const deg = parseInt(match[1], 10);
        return ((deg % 360) + 360) % 360;
      }
    }
    const container = findReelContainer(video);
    if (container && container.style && container.style.transform) {
      const match = container.style.transform.match(/rotate\((-?\d+)deg\)/);
      if (match) {
        const deg = parseInt(match[1], 10);
        return ((deg % 360) + 360) % 360;
      }
    }
    if (S.rotation) {
      return ((S.rotation % 360) + 360) % 360;
    }
    return 0;
  }

  function applyQueueVideoRotation(video, degrees) {
    if (!video) return;
    if (S.focusMode && S.focusedVideo === video) {
      RR.focus?.reapplyBaseline?.(video, degrees);
      return;
    }
    const normalized = ((degrees || 0) % 360 + 360) % 360;
    if (normalized === 0) {
      video.style.transform = 'none';
      video.style.transformOrigin = 'center center';
      return;
    }

    const wrap = video.parentElement;
    const wrapWidth = wrap?.clientWidth || 460;
    const wrapHeight = wrap?.clientHeight || 640;

    let scale = 1;
    if (normalized === 90 || normalized === 270) {
      scale = Math.min(wrapWidth / wrapHeight, wrapHeight / wrapWidth);
    }

    video.style.transform = `rotate(${normalized}deg) scale(${scale})`;
    video.style.transformOrigin = 'center center';
    video.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
  }

  function rotateActiveQueueItem(delta = 90) {
    if (S.queueIndex === -1 || !S.queue || !S.queue[S.queueIndex] || !videoEl) return;
    const item = S.queue[S.queueIndex];
    const currentRot = item.rotation || 0;
    const newRot = ((currentRot + delta) % 360 + 360) % 360;
    item.rotation = newRot;

    if (S.focusMode && S.focusedVideo === videoEl) {
      RR.focus?.reapplyBaseline?.(videoEl, newRot);
    } else {
      applyQueueVideoRotation(videoEl, newRot);
    }

    renderPlaylist();
    updateNowPlayingUI();
    showToast(`Queue Video: ${newRot}°`);
  }

  function captureActiveReel(overrideUrl, overridePermalink) {
    const video = findActiveVideo();
    if (!video) return null;

    const container = findReelContainer(video) || video.parentElement;
    const src = overrideUrl || resolvePlayableVideoUrl(video, container);
    if (!src) return null;

    const rotation = getActiveVideoRotation(video);

    // Extract author
    let author = 'Instagram Reel';
    const authorEl = container ? container.querySelector('header a, a[role="link"] span, a[href^="/"] span') : null;
    if (authorEl && authorEl.textContent) {
      author = authorEl.textContent.trim();
    }

    // Extract caption snippet
    let caption = '';
    const captionEl = container ? container.querySelector('h1, span[dir="auto"], [data-testid="post-comment-root"]') : null;
    if (captionEl && captionEl.textContent) {
      caption = captionEl.textContent.trim().slice(0, 75);
    }

    // Extract permalink if available, guaranteeing singular /reel/:shortcode/ format
    let permalink = null;
    if (overridePermalink) {
      permalink = normalizeReelUrl(overridePermalink);
    }
    if (!permalink) {
      permalink = findReelPermalink(container, video);
    }
    if (!permalink) {
      const locSc = extractReelShortcode(window.location.pathname);
      if (locSc) {
        permalink = `https://www.instagram.com/reel/${locSc}/`;
      }
    }
    permalink = normalizeReelUrl(permalink);

    // Extract thumbnail
    let thumbnail = video.poster || null;
    if (!thumbnail) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 284;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        thumbnail = canvas.toDataURL('image/jpeg', 0.8);
      } catch (_) {
        // Fallback: look for an img inside the reel container
        const img = container ? container.querySelector('img[src*="cdninstagram"]') : null;
        if (img && img.src) thumbnail = img.src;
      }
    }

    return {
      id: 'rq-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      src,
      author,
      caption,
      thumbnail,
      permalink,
      rotation: rotation || 0,
      finished: false,
    };
  }

  // ── Toast Notification ──────────────────────────────────────────────
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('visible');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => {
      toastEl.classList.remove('visible');
    }, 2200);
  }

  // ── Open Reel in New Tab (Middle click / scroll wheel) ───────────────
  function openReelInNewTab(url) {
    const targetUrl = normalizeReelUrl(url);
    if (!targetUrl || !extractReelShortcode(targetUrl)) {
      showToast('Reel URL not available');
      return;
    }
    try {
      const win = window.open(targetUrl, '_blank');
      if (win) {
        win.opener = null;
        showToast('Opening reel in new tab ↗');
      } else {
        throw new Error('Popup blocked');
      }
    } catch (_) {
      const a = document.createElement('a');
      a.href = targetUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast('Opening reel in new tab ↗');
    }
  }

  // ── Play / Pause and Mute Coordination ──────────────────────────────
  // Rules:
  // 1. When video from queue is muted, it will be paused.
  // 2. When video from queue is not muted, it will play.
  // 3. When video from queue is playing and sound is not muted, main section
  //    video will still play but stays muted.
  function togglePlayPause() {
    if (!videoEl || !videoEl.src || S.queueIndex === -1) return;
    if (videoEl.paused) {
      // Unmute and play
      hideMediaErrorOverlay();
      S.queueAudioTarget = 'queue';
      videoEl.muted = false;
      applyAudioTarget();
      videoEl.play().catch((err) => {
        if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
          console.info('[Queue] Autoplay policy restricted unmuted play on toggle; playing muted');
          videoEl.muted = true;
          videoEl.play().catch(() => {});
          showToast('Playing muted · Press M or T to unmute');
        } else {
          console.warn('[Queue] Play blocked:', err);
          videoEl.muted = true;
          videoEl.pause();
        }
      });
      showToast('Queue Playing ▶');
    } else {
      // Pause and mute
      videoEl.pause();
      videoEl.muted = true;
      syncQueuePlayingFlag();
      showToast('Queue Paused ⏸');
    }
    updateNowPlayingUI();
  }

  function toggleMute() {
    if (!videoEl || !videoEl.src || S.queueIndex === -1) return;
    if (videoEl.muted) {
      // Unmute and play
      hideMediaErrorOverlay();
      S.queueAudioTarget = 'queue';
      videoEl.muted = false;
      applyAudioTarget();
      videoEl.play().catch((err) => {
        if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
          console.info('[Queue] Unmute blocked by browser policy; click player to enable audio');
          videoEl.muted = true;
          videoEl.play().catch(() => {});
          showToast('Click player to enable audio 🔊');
        }
      });
      showToast('Queue Unmuted & Playing 🔊');
    } else {
      // Mute and pause
      videoEl.muted = true;
      videoEl.pause();
      syncQueuePlayingFlag();
      showToast('Queue Muted & Paused 🔇');
    }
    updateNowPlayingUI();
  }

  // ── Audio Coordination & Strict Feed Mute Enforcement ───────────────
  function isQueuePlaying() {
    if (!videoEl || !videoEl.src || S.queueIndex === -1 || S.queueAudioTarget !== 'queue') {
      return false;
    }
    return !videoEl.paused && !videoEl.muted;
  }

  function muteAllFeedVideos() {
    if (!isQueuePlaying()) return;
    const allVideos = document.querySelectorAll('video');
    for (let i = 0; i < allVideos.length; i++) {
      const v = allVideos[i];
      if (v !== videoEl && !v.muted) {
        v.muted = true;
      }
    }
  }

  let muteWatchdogTimer = null;
  function syncQueuePlayingFlag() {
    const playing = isQueuePlaying();
    document.documentElement.dataset.rrQueuePlaying = playing ? '1' : '0';
    if (playing) {
      muteAllFeedVideos();
      if (!muteWatchdogTimer) {
        muteWatchdogTimer = setInterval(muteAllFeedVideos, 100);
      }
    } else {
      if (muteWatchdogTimer) {
        clearInterval(muteWatchdogTimer);
        muteWatchdogTimer = null;
      }
    }
  }

  function applyAudioTarget() {
    const isQueueAudio = S.queueAudioTarget === 'queue';

    // Queue video
    if (videoEl) {
      videoEl.muted = !isQueueAudio;
    }

    // Main feed video muting / unmuting:
    // If queue is playing with sound, main section video still plays but stays muted
    if (isQueueAudio && isQueuePlaying()) {
      muteAllFeedVideos();
    } else if (!isQueueAudio) {
      const activeFeedVideo = findActiveVideo();
      if (activeFeedVideo) {
        activeFeedVideo.muted = false;
      }
    }

    // Update UI audio badge
    if (audioBadgeEl) {
      audioBadgeEl.innerHTML = isQueueAudio
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg> Audio: Queue (T)`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg> Audio: Feed (T)`;
      audioBadgeEl.classList.toggle('audio-queue', isQueueAudio);
      audioBadgeEl.classList.toggle('audio-feed', !isQueueAudio);
    }

    syncQueuePlayingFlag();
  }

  // "if user presses T queue video will be muted and paused and main section video will be unmuted."
  function toggleAudioFocus() {
    if (S.queueAudioTarget === 'queue') {
      // Switch audio to main feed
      S.queueAudioTarget = 'main';
      if (videoEl) {
        videoEl.muted = true;
        videoEl.pause();
      }
      syncQueuePlayingFlag();
      const activeFeedVideo = findActiveVideo();
      if (activeFeedVideo) {
        activeFeedVideo.muted = false;
      }
      showToast('Audio: Main Feed 🔊 (Queue paused)');
    } else {
      // Switch audio to queue
      S.queueAudioTarget = 'queue';
      if (videoEl && videoEl.src && S.queueIndex !== -1) {
        videoEl.muted = false;
        videoEl.play().catch(() => {});
      }
      applyAudioTarget();
      syncQueuePlayingFlag();
      showToast('Audio: Queue 🔊');
    }

    if (audioBadgeEl) {
      const isQueueAudio = S.queueAudioTarget === 'queue';
      audioBadgeEl.innerHTML = isQueueAudio
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg> Audio: Queue (T)`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg> Audio: Feed (T)`;
      audioBadgeEl.classList.toggle('audio-queue', isQueueAudio);
      audioBadgeEl.classList.toggle('audio-feed', !isQueueAudio);
    }
    updateNowPlayingUI();
  }

  // Monitor feed video events to ensure feed stays muted while queue video is playing with audio
  function setupFeedMuteWatcher() {
    if (feedMuteWatcher) return;
    feedMuteWatcher = true;
    const muteEvents = ['play', 'playing', 'volumechange', 'timeupdate', 'seeked', 'loadedmetadata'];
    for (const evt of muteEvents) {
      document.addEventListener(evt, (e) => {
        const target = e.target;
        if (!target || target.tagName !== 'VIDEO' || target === videoEl) return;

        // When queue video is playing with sound, main section video will still play but stays muted!
        if (isQueuePlaying()) {
          if (!target.muted) target.muted = true;
        }
      }, true);
    }
  }

  // ── Playlist Operations ─────────────────────────────────────────────
  async function addCurrentReel() {
    let resolvedData = null;
    try {
      resolvedData = await requestMainWorldVideoData(350);
    } catch (_) {}

    const item = captureActiveReel(resolvedData?.url, resolvedData?.permalink);
    if (!item) {
      showToast('No active reel detected to enqueue');
      return;
    }

    // Check if already in queue
    const existingIndex = S.queue.findIndex(q => q.src === item.src);
    if (existingIndex !== -1) {
      showToast('Reel already in queue (' + (existingIndex + 1) + '/' + S.queue.length + ')');
      return;
    }

    S.queue.push(item);

    // If queue has no item currently loaded, prepare first item in background without autoplaying
    if (S.queueIndex === -1) {
      S.queueIndex = 0;
      if (videoEl && !videoEl.src) {
        videoEl.src = item.src;
        videoEl.currentTime = 0;
        videoEl.muted = true;
        videoEl.pause();
        applyQueueVideoRotation(videoEl, item.rotation || 0);
      }
    }

    renderPlaylist();
    updateNowPlayingUI();
    showToast('Added to Queue (' + S.queue.length + ')');
  }

  function playIndex(index) {
    if (!S.queue || index < 0 || index >= S.queue.length) return;

    S.queueIndex = index;
    const item = S.queue[index];

    hideMediaErrorOverlay();
    _mediaErrorRetries = 0;

    if (videoEl) {
      if (videoEl.src !== item.src) {
        videoEl.src = item.src;
        videoEl.load();
      }
      videoEl.currentTime = 0;

      if (S.focusMode && S.focusedVideo === videoEl) {
        RR.focus?.reapplyBaseline?.(videoEl, item.rotation || 0);
      } else {
        applyQueueVideoRotation(videoEl, item.rotation || 0);
      }

      // "when video from queue is not muted it will play"
      S.queueAudioTarget = 'queue';
      videoEl.muted = false;
      applyAudioTarget();

      const playPromise = videoEl.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
            console.info('[Queue] Unmuted play restricted by browser autoplay policy, starting muted');
            videoEl.muted = true;
            const mutedPromise = videoEl.play();
            if (mutedPromise !== undefined) {
              mutedPromise.then(() => {
                showToast('Playing muted · Press M or T to unmute');
                updateNowPlayingUI();
                syncQueuePlayingFlag();
              }).catch((mutedErr) => {
                console.warn('[Queue] Muted playback error:', mutedErr);
                updateNowPlayingUI();
                syncQueuePlayingFlag();
              });
            }
          } else {
            console.warn('[Queue] Video playback failed:', err);
            updateNowPlayingUI();
            syncQueuePlayingFlag();
          }
        });
      }
    }

    updateNowPlayingUI();
    renderPlaylist();
    syncQueuePlayingFlag();
  }

  function playNext() {
    if (!S.queue || S.queue.length === 0) return;
    const nextIdx = (S.queueIndex + 1) % S.queue.length;
    playIndex(nextIdx);
    const item = S.queue[nextIdx];
    showToast(`Next (${nextIdx + 1}/${S.queue.length}): @${item.author || 'Reel'}`);
  }

  function playPrev() {
    if (!S.queue || S.queue.length === 0) return;
    const prevIdx = (S.queueIndex - 1 + S.queue.length) % S.queue.length;
    playIndex(prevIdx);
    const item = S.queue[prevIdx];
    showToast(`Prev (${prevIdx + 1}/${S.queue.length}): @${item.author || 'Reel'}`);
  }

  function findContainerForItem(item) {
    if (!item) return null;

    // 1. Try matching shortcode in permalink
    let shortcode = null;
    if (item.permalink) {
      shortcode = extractReelShortcode(item.permalink);
    }

    if (shortcode) {
      const links = document.querySelectorAll(`a[href*="/reel/${shortcode}"], a[href*="/p/${shortcode}"], a[href*="/reels/${shortcode}"]`);
      for (const link of links) {
        if (link.closest('#reel-queue-panel')) continue;
        const container = link.closest('article, [role="article"], div[style*="scroll-snap"]') || link.parentElement;
        if (container) return container;
      }
    }

    // 2. Try matching video src
    if (item.src) {
      const cleanSrc = item.src.split('?')[0];
      const feedVideos = document.querySelectorAll('video:not(#reel-queue-video)');
      for (const v of feedVideos) {
        const vSrc = (v.currentSrc || v.src || '').split('?')[0];
        if (vSrc && (vSrc === cleanSrc || cleanSrc.includes(vSrc) || vSrc.includes(cleanSrc))) {
          return RR.domUtils?.findReelContainer?.(v) || v.parentElement;
        }
      }
    }

    return null;
  }

  function likeActiveQueueItem() {
    if (S.queueIndex === -1 || !S.queue || !S.queue[S.queueIndex]) return;
    const item = S.queue[S.queueIndex];

    const container = findContainerForItem(item);
    let clicked = false;
    if (container) {
      const btn = RR.domUtils?.findLikeButtonInScope?.(container);
      if (btn) {
        clicked = RR.domUtils?.triggerClick?.(btn);
      }
      if (!clicked) {
        const v = container.querySelector('video') || container;
        try {
          const dbl = new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window });
          v.dispatchEvent(dbl);
          clicked = true;
        } catch (_) {}
      }
    }

    try {
      window.dispatchEvent(new CustomEvent('RR_QUEUE_ACTION_REQ', {
        detail: {
          action: 'like',
          permalink: item.permalink,
          src: item.src,
        }
      }));
    } catch (_) {}

    item.liked = !item.liked;
    updateNowPlayingUI();
    renderPlaylist();
    showToast(item.liked ? 'Queue Reel Liked ❤️ (Q)' : 'Queue Reel Unliked 🤍 (Q)');
  }

  function repostActiveQueueItem() {
    if (S.queueIndex === -1 || !S.queue || !S.queue[S.queueIndex]) return;
    const item = S.queue[S.queueIndex];

    const container = findContainerForItem(item);
    let clicked = false;
    if (container) {
      const btn = RR.domUtils?.findRepostButtonInScope?.(container);
      if (btn) {
        clicked = RR.domUtils?.triggerClick?.(btn);
        if (clicked) {
          RR.domUtils?.autoConfirmRepostRemoval?.();
        }
      }
    }

    try {
      window.dispatchEvent(new CustomEvent('RR_QUEUE_ACTION_REQ', {
        detail: {
          action: 'repost',
          permalink: item.permalink,
          src: item.src,
        }
      }));
    } catch (_) {}

    item.reposted = !item.reposted;
    updateNowPlayingUI();
    renderPlaylist();
    showToast(item.reposted ? 'Queue Reel Reposted 🔄 (V)' : 'Queue Repost Removed ↩️ (V)');
  }

  function removeIndex(index) {
    if (index < 0 || index >= S.queue.length) return;

    const wasCurrent = (index === S.queueIndex);
    S.queue.splice(index, 1);

    if (S.queue.length === 0) {
      S.queueIndex = -1;
      if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
      }
    } else if (wasCurrent) {
      // Advance to the next item or wrap around to the first unplayed
      const nextIdx = index < S.queue.length ? index : 0;
      playIndex(nextIdx);
    } else if (index < S.queueIndex) {
      S.queueIndex--;
    }

    renderPlaylist();
    updateNowPlayingUI();
  }

  function moveItem(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= S.queue.length) return;
    if (toIndex < 0 || toIndex >= S.queue.length) return;

    const currentItem = S.queue[S.queueIndex];
    const [moved] = S.queue.splice(fromIndex, 1);
    S.queue.splice(toIndex, 0, moved);

    // Re-synchronize current playing index
    if (currentItem) {
      S.queueIndex = S.queue.indexOf(currentItem);
    }

    renderPlaylist();
  }

  function onVideoEnded() {
    if (S.queueIndex < 0 || S.queueIndex >= S.queue.length) return;

    const finishedItem = S.queue[S.queueIndex];
    finishedItem.finished = true;

    // Requirement: "finished reels will not be deleted from the queue. they will just go up."
    // Move the finished item up: place it at the top of the playlist
    if (S.queueIndex > 0) {
      S.queue.splice(S.queueIndex, 1);
      S.queue.unshift(finishedItem);
    }

    // Now find the next unplayed reel in the queue
    const nextUnplayedIdx = S.queue.findIndex(item => !item.finished);
    if (nextUnplayedIdx !== -1) {
      playIndex(nextUnplayedIdx);
    } else {
      // If all are finished, loop back to the first reel or stay paused at end
      playIndex(0);
    }
  }

  // ── Panel Visibility ────────────────────────────────────────────────
  function openPanel() {
    S.queueVisible = true;
    if (panelEl) panelEl.classList.add('visible');
    if (toggleBtn) toggleBtn.classList.add('panel-open');
    applyAudioTarget();
  }

  function closePanel() {
    S.queueVisible = false;
    if (panelEl) panelEl.classList.remove('visible');
    if (toggleBtn) toggleBtn.classList.remove('panel-open');
  }

  function togglePanel() {
    if (S.queueVisible) {
      closePanel();
      showToast('Queue hidden (G)');
    } else {
      openPanel();
      showToast('Queue unhidden (G)');
    }
  }

  // ── Drag and Drop Reordering ────────────────────────────────────────
  function handleDragStart(e) {
    draggedIndex = parseInt(this.dataset.index, 10);
    e.dataTransfer.effectAllowed = 'move';
    this.classList.add('is-dragging');
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const targetEl = e.currentTarget;
    targetEl.classList.add('drag-over');
  }

  function handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
  }

  function handleDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const targetIndex = parseInt(e.currentTarget.dataset.index, 10);
    if (draggedIndex !== null && !isNaN(targetIndex) && draggedIndex !== targetIndex) {
      moveItem(draggedIndex, targetIndex);
    }
    draggedIndex = null;
  }

  function handleDragEnd() {
    this.classList.remove('is-dragging');
    const all = listEl ? listEl.querySelectorAll('.reel-queue-item') : [];
    all.forEach(el => el.classList.remove('drag-over', 'is-dragging'));
    draggedIndex = null;
  }

  // ── UI Rendering ────────────────────────────────────────────────────
  function formatTime(secs) {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function updateNowPlayingUI() {
    if (!countBadgeEl) return;
    countBadgeEl.textContent = S.queue.length;

    const isPlaying = videoEl && !videoEl.paused && !videoEl.muted && !videoEl.ended;
    if (playPauseBtn) {
      playPauseBtn.innerHTML = isPlaying
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
    }

    const centerPlay = panelEl?.querySelector('#reel-queue-center-play');
    if (centerPlay) {
      centerPlay.classList.toggle('hidden', !!isPlaying || !videoEl?.src);
    }

    const activeItem = (S.queueIndex !== -1 && S.queue) ? S.queue[S.queueIndex] : null;
    const likeBtn = panelEl?.querySelector('#reel-queue-like-btn');
    if (likeBtn) {
      const isLiked = !!activeItem?.liked;
      likeBtn.classList.toggle('active-like', isLiked);
      const svg = likeBtn.querySelector('svg');
      if (svg) {
        svg.setAttribute('fill', isLiked ? '#ff3040' : 'none');
        svg.setAttribute('stroke', isLiked ? '#ff3040' : 'currentColor');
      }
    }

    const repostBtn = panelEl?.querySelector('#reel-queue-repost-btn');
    if (repostBtn) {
      const isReposted = !!activeItem?.reposted;
      repostBtn.classList.toggle('active-repost', isReposted);
      const svg = repostBtn.querySelector('svg');
      if (svg) {
        svg.setAttribute('stroke', isReposted ? '#00f685' : 'currentColor');
      }
    }

    const focusBtn = panelEl?.querySelector('#reel-queue-focus-btn');
    if (focusBtn) {
      const isFocused = S.focusMode && S.focusedVideo === videoEl;
      focusBtn.classList.toggle('active-focus', isFocused);
    }

    if (toggleBtn) {
      const badge = toggleBtn.querySelector('.rq-toggle-badge');
      if (badge) badge.textContent = S.queue.length;
      toggleBtn.style.display = S.queue.length > 0 ? 'flex' : 'none';
    }
  }

  function renderPlaylist() {
    if (!listEl) return;
    listEl.innerHTML = '';

    if (S.queue.length === 0) {
      listEl.innerHTML = `
        <div class="reel-queue-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
          </svg>
          <div class="empty-title">Queue is empty</div>
          <div class="empty-subtitle">Press <kbd>D</kbd> on any reel to add it to the queue</div>
        </div>
      `;
      updateNowPlayingUI();
      return;
    }

    S.queue.forEach((item, index) => {
      const isPlaying = (index === S.queueIndex);
      const isFinished = !!item.finished;

      const card = document.createElement('div');
      card.className = 'reel-queue-item' +
        (isPlaying ? ' is-playing' : '') +
        (isFinished ? ' is-finished' : '');
      card.dataset.index = index;
      card.draggable = true;

      // Drag event listeners
      card.addEventListener('dragstart', handleDragStart);
      card.addEventListener('dragover', handleDragOver);
      card.addEventListener('dragleave', handleDragLeave);
      card.addEventListener('drop', handleDrop);
      card.addEventListener('dragend', handleDragEnd);

      const thumbHtml = item.thumbnail
        ? `<img class="rq-thumb" src="${item.thumbnail}" alt="">`
        : `<div class="rq-thumb rq-thumb-placeholder">
             <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
           </div>`;

      const statusBadge = isPlaying
        ? `<div class="rq-now-playing-badge">
             <span class="rq-eq-bar"></span>
             <span class="rq-eq-bar"></span>
             <span class="rq-eq-bar"></span>
             <span>NOW PLAYING</span>
           </div>`
        : (isFinished ? `<div class="rq-finished-badge">✓ Played</div>` : '');

      const rot = item.rotation ? ((item.rotation % 360) + 360) % 360 : 0;
      let rotBadge = '';
      if (rot === 90) {
        rotBadge = `<span class="rq-rotation-badge" title="Playing at 90° CW rotation">↻ 90°</span>`;
      } else if (rot === 180) {
        rotBadge = `<span class="rq-rotation-badge" title="Playing at 180° rotation">↻ 180°</span>`;
      } else if (rot === 270) {
        rotBadge = `<span class="rq-rotation-badge" title="Playing at 90° CCW rotation">↺ 90°</span>`;
      }

      const likedBadge = item.liked ? `<span title="Liked" style="margin-left:4px;font-size:10px;">❤️</span>` : '';
      const repostedBadge = item.reposted ? `<span title="Reposted" style="margin-left:4px;font-size:10px;">🔄</span>` : '';

      card.innerHTML = `
        <div class="rq-drag-handle" title="Drag to reorder">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="2"></circle><circle cx="15" cy="6" r="2"></circle>
            <circle cx="9" cy="12" r="2"></circle><circle cx="15" cy="12" r="2"></circle>
            <circle cx="9" cy="18" r="2"></circle><circle cx="15" cy="18" r="2"></circle>
          </svg>
        </div>
        <div class="rq-thumb-wrap">
          ${thumbHtml}
        </div>
        <div class="rq-meta">
          <div class="rq-author">@${item.author} ${rotBadge}${likedBadge}${repostedBadge}</div>
          <div class="rq-caption">${item.caption || 'Reel video'}</div>
          ${statusBadge}
        </div>
        <div class="rq-actions">
          <button type="button" class="rq-btn-move up" title="Move up" data-action="up" ${index === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" class="rq-btn-move down" title="Move down" data-action="down" ${index === S.queue.length - 1 ? 'disabled' : ''}>▼</button>
          <button type="button" class="rq-btn-delete" title="Remove from queue" data-action="delete">×</button>
        </div>
      `;

      card.title = 'Click to play · Middle-click (scroll wheel) to open in new tab';

      // Middle-click (mouse scroll wheel click) opens reel in a new tab
      card.addEventListener('mousedown', (e) => {
        if (e.button === 1) {
          e.preventDefault();
        }
      });
      card.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
          openReelInNewTab(item.permalink);
        }
      });

      // Click card to play (except buttons)
      card.addEventListener('click', (e) => {
        if (e.button !== 0) return;
        const actionBtn = e.target.closest('button[data-action]');
        if (actionBtn) {
          e.stopPropagation();
          const action = actionBtn.dataset.action;
          if (action === 'delete') {
            removeIndex(index);
          } else if (action === 'up') {
            moveItem(index, index - 1);
          } else if (action === 'down') {
            moveItem(index, index + 1);
          }
          return;
        }
        playIndex(index);
      });

      listEl.appendChild(card);
    });

    updateNowPlayingUI();
  }

  // ── Media Error Recovery & Overlay ──────────────────────────────────
  function showMediaErrorOverlay(item) {
    if (!errorOverlayEl) return;
    errorOverlayEl.classList.remove('hidden');
    if (errorTextEl) {
      errorTextEl.textContent = item?.author
        ? `Video source expired (@${item.author})`
        : 'Video source expired or unavailable';
    }
  }

  function hideMediaErrorOverlay() {
    if (errorOverlayEl) {
      errorOverlayEl.classList.add('hidden');
    }
  }

  async function retryCurrentQueueVideo() {
    if (S.queueIndex === -1 || !S.queue || !S.queue[S.queueIndex] || !videoEl) return;
    const item = S.queue[S.queueIndex];
    showToast('Refreshing video source...');
    hideMediaErrorOverlay();
    _mediaErrorRetries = 0;

    // 1. Try resolving via bridge with permalink
    try {
      const res = await requestMainWorldVideoData(500, item.permalink);
      if (res?.url && res.url !== videoEl.src) {
        item.src = res.url;
        videoEl.src = res.url;
        videoEl.load();
        videoEl.play().catch(() => {});
        showToast('Video source refreshed ↻');
        return;
      }
    } catch (_) {}

    // 2. Try matching DOM container
    const container = findContainerForItem(item);
    if (container) {
      const v = container.querySelector('video');
      const freshSrc = v?.currentSrc || v?.src;
      if (freshSrc && freshSrc !== videoEl.src && !freshSrc.startsWith('blob:')) {
        item.src = freshSrc;
        videoEl.src = freshSrc;
        videoEl.load();
        videoEl.play().catch(() => {});
        showToast('Video source refreshed ↻');
        return;
      }
    }

    // 3. Try recent media url
    const recent = findRecentMediaUrl();
    if (recent && recent !== videoEl.src) {
      item.src = recent;
      videoEl.src = recent;
      videoEl.load();
      videoEl.play().catch(() => {});
      showToast('Video source refreshed ↻');
      return;
    }

    // 4. Force reload existing src
    videoEl.load();
    videoEl.play().catch((err) => {
      console.warn('[Queue] Retry failed:', err);
      showMediaErrorOverlay(item);
      showToast('Could not refresh source · Open reel in new tab');
    });
  }

  async function handleQueueVideoError() {
    if (S.queueIndex === -1 || !S.queue || !S.queue[S.queueIndex] || !videoEl) return;
    const item = S.queue[S.queueIndex];

    console.warn('[Queue] Video media error encountered:', videoEl.error);

    if (_mediaErrorRetries >= 2) {
      showMediaErrorOverlay(item);
      showToast('Reel source expired · Middle-click to open in new tab');
      return;
    }
    _mediaErrorRetries++;

    // 1. Check if the reel is present in the DOM feed
    const container = findContainerForItem(item);
    if (container) {
      const v = container.querySelector('video');
      const liveSrc = v?.currentSrc || v?.src;
      if (liveSrc && liveSrc !== videoEl.src && !liveSrc.startsWith('blob:')) {
        console.log('[Queue] Recovered video source from DOM feed container');
        item.src = liveSrc;
        videoEl.src = liveSrc;
        videoEl.load();
        videoEl.play().catch(() => {});
        return;
      }
    }

    // 2. Request fresh video data via bridge
    try {
      const res = await requestMainWorldVideoData(400, item.permalink);
      if (res?.url && res.url !== videoEl.src) {
        console.log('[Queue] Recovered video source via bridge');
        item.src = res.url;
        videoEl.src = res.url;
        videoEl.load();
        videoEl.play().catch(() => {});
        return;
      }
    } catch (_) {}

    // 3. Check performance entries
    const fallback = findRecentMediaUrl();
    if (fallback && fallback !== videoEl.src) {
      console.log('[Queue] Recovered with recent media URL:', fallback);
      item.src = fallback;
      videoEl.src = fallback;
      videoEl.load();
      videoEl.play().catch(() => {});
      return;
    }

    showMediaErrorOverlay(item);
    showToast('Reel source expired · Middle-click to open in new tab');
  }

  // ── DOM Construction ────────────────────────────────────────────────
  function buildQueueUI() {
    if (document.getElementById('reel-queue-panel')) return;

    // Floating toggle button (shown when panel is closed and queue has items)
    toggleBtn = document.createElement('button');
    toggleBtn.id = 'reel-queue-toggle-btn';
    toggleBtn.title = 'Open Reels Queue';
    toggleBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="8" y1="6" x2="21" y2="6"></line>
        <line x1="8" y1="12" x2="21" y2="12"></line>
        <line x1="8" y1="18" x2="21" y2="18"></line>
        <line x1="3" y1="6" x2="3.01" y2="6"></line>
        <line x1="3" y1="12" x2="3.01" y2="12"></line>
        <line x1="3" y1="18" x2="3.01" y2="18"></line>
      </svg>
      <span class="rq-toggle-badge">0</span>
    `;
    toggleBtn.addEventListener('click', togglePanel);
    document.body.appendChild(toggleBtn);

    // Main Queue Panel
    panelEl = document.createElement('aside');
    panelEl.id = 'reel-queue-panel';
    panelEl.innerHTML = `
      <header id="reel-queue-header">
        <div class="rq-header-left">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="8" y1="6" x2="21" y2="6"></line>
            <line x1="8" y1="12" x2="21" y2="12"></line>
            <line x1="8" y1="18" x2="21" y2="18"></line>
            <line x1="3" y1="6" x2="3.01" y2="6"></line>
            <line x1="3" y1="12" x2="3.01" y2="12"></line>
            <line x1="3" y1="18" x2="3.01" y2="18"></line>
          </svg>
          <span class="rq-header-title">Queue</span>
          <span id="reel-queue-count" class="rq-count-pill">0</span>
        </div>
        <div class="rq-header-right">
          <button type="button" id="reel-queue-audio-toggle" class="rq-header-btn" title="Toggle audio between Queue and Main Feed (T)">
            Audio: Queue (T)
          </button>
          <button type="button" id="reel-queue-close" class="rq-header-btn rq-btn-icon" title="Minimize queue panel">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </header>

      <div id="reel-queue-player-wrap">
        <video id="reel-queue-video" playsinline preload="auto" crossorigin="anonymous"></video>
        <div id="reel-queue-center-play" class="rq-center-play" title="Play">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20"></polygon></svg>
        </div>
        <div id="reel-queue-error-overlay" class="rq-error-overlay hidden">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ed4956" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span id="reel-queue-error-text" class="rq-error-text">Video source expired or unavailable</span>
          <div class="rq-error-actions">
            <button type="button" id="reel-queue-retry-btn" class="rq-error-btn">Retry</button>
            <button type="button" id="reel-queue-open-btn" class="rq-error-btn rq-error-btn-accent">Open Reel ↗</button>
          </div>
        </div>
        <div id="reel-queue-overlay-controls">
          <button type="button" id="reel-queue-prev-btn" class="rq-ctrl-btn" title="Previous reel (W / ↑)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2.5"></line></svg>
          </button>
          <button type="button" id="reel-queue-play-pause" class="rq-ctrl-btn" title="Play / Pause (Space)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          </button>
          <button type="button" id="reel-queue-next-btn" class="rq-ctrl-btn" title="Next reel (S / ↓)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2.5"></line></svg>
          </button>
          <button type="button" id="reel-queue-rotate-btn" class="rq-ctrl-btn" title="Rotate queue video (E / R)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
          </button>
          <button type="button" id="reel-queue-like-btn" class="rq-ctrl-btn" title="Like active reel (Q)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
          </button>
          <button type="button" id="reel-queue-repost-btn" class="rq-ctrl-btn" title="Repost active reel (V)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 2l4 4-4 4"></path>
              <path d="M3 11v-1a4 4 0 0 1 4-4h14"></path>
              <path d="M7 22l-4-4 4-4"></path>
              <path d="M21 13v1a4 4 0 0 1-4 4H3"></path>
            </svg>
          </button>
          <button type="button" id="reel-queue-focus-btn" class="rq-ctrl-btn" title="Focus mode (F)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="2" width="20" height="20" rx="3"></rect>
              <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path>
            </svg>
          </button>
          <div id="reel-queue-progress-bar">
            <div id="reel-queue-progress-fill"></div>
          </div>
          <span id="reel-queue-time">0:00 / 0:00</span>
        </div>
      </div>

      <div class="rq-section-divider">
        <span>Up Next & History</span>
        <button type="button" id="reel-queue-clear" class="rq-clear-btn" title="Clear all reels in queue">Clear</button>
      </div>

      <div id="reel-queue-list"></div>
    `;

    document.body.appendChild(panelEl);

    // Global toast notification element
    if (!document.getElementById('reel-queue-toast')) {
      toastEl = document.createElement('div');
      toastEl.id = 'reel-queue-toast';
      toastEl.className = 'rq-toast';
      document.body.appendChild(toastEl);
    } else {
      toastEl = document.getElementById('reel-queue-toast');
    }

    // Cache elements
    videoEl = panelEl.querySelector('#reel-queue-video');
    listEl = panelEl.querySelector('#reel-queue-list');
    countBadgeEl = panelEl.querySelector('#reel-queue-count');
    audioBadgeEl = panelEl.querySelector('#reel-queue-audio-toggle');
    playPauseBtn = panelEl.querySelector('#reel-queue-play-pause');
    progressBarEl = panelEl.querySelector('#reel-queue-progress-bar');
    progressFillEl = panelEl.querySelector('#reel-queue-progress-fill');
    timeDisplayEl = panelEl.querySelector('#reel-queue-time');
    errorOverlayEl = panelEl.querySelector('#reel-queue-error-overlay');
    errorTextEl = panelEl.querySelector('#reel-queue-error-text');
    const retryBtn = panelEl.querySelector('#reel-queue-retry-btn');
    const openBtn = panelEl.querySelector('#reel-queue-open-btn');
    const playerWrap = panelEl.querySelector('#reel-queue-player-wrap');

    retryBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      retryCurrentQueueVideo();
    });
    openBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (S.queueIndex !== -1 && S.queue && S.queue[S.queueIndex]) {
        openReelInNewTab(S.queue[S.queueIndex].permalink);
      }
    });

    // Header events
    audioBadgeEl?.addEventListener('click', toggleAudioFocus);
    panelEl.querySelector('#reel-queue-close')?.addEventListener('click', closePanel);
    panelEl.querySelector('#reel-queue-clear')?.addEventListener('click', () => {
      S.queue = [];
      S.queueIndex = -1;
      if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
      }
      renderPlaylist();
      syncQueuePlayingFlag();
      showToast('Queue cleared');
    });

    // Player controls
    panelEl.querySelector('#reel-queue-prev-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      playPrev();
    });
    panelEl.querySelector('#reel-queue-next-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      playNext();
    });
    panelEl.querySelector('#reel-queue-rotate-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      rotateActiveQueueItem(90);
    });
    panelEl.querySelector('#reel-queue-like-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      likeActiveQueueItem();
    });
    panelEl.querySelector('#reel-queue-repost-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      repostActiveQueueItem();
    });
    panelEl.querySelector('#reel-queue-focus-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      RR.focus?.toggle?.(videoEl);
    });

    // Player events
    videoEl?.addEventListener('ended', () => {
      onVideoEnded();
      syncQueuePlayingFlag();
    });
    videoEl?.addEventListener('play', () => {
      if (S.queueAudioTarget === 'queue' && videoEl.muted) {
        videoEl.muted = false;
      }
      applyAudioTarget();
      updateNowPlayingUI();
      syncQueuePlayingFlag();
    });
    videoEl?.addEventListener('playing', () => {
      applyAudioTarget();
      updateNowPlayingUI();
      syncQueuePlayingFlag();
    });
    videoEl?.addEventListener('pause', () => {
      if (!videoEl.muted) {
        videoEl.muted = true;
      }
      updateNowPlayingUI();
      syncQueuePlayingFlag();
    });
    videoEl?.addEventListener('volumechange', () => {
      if (videoEl.muted) {
        if (!videoEl.paused) videoEl.pause();
      } else {
        if (videoEl.paused && videoEl.src && S.queueIndex !== -1) {
          videoEl.play().catch(() => {});
        }
      }
      updateNowPlayingUI();
      syncQueuePlayingFlag();
    });
    videoEl?.addEventListener('loadedmetadata', () => {
      if (S.queueIndex !== -1 && S.queue && S.queue[S.queueIndex]) {
        const itemRot = S.queue[S.queueIndex].rotation || 0;
        if (S.focusMode && S.focusedVideo === videoEl) {
          RR.focus?.reapplyBaseline?.(videoEl, itemRot);
        } else {
          applyQueueVideoRotation(videoEl, itemRot);
        }
      }
    });
    videoEl?.addEventListener('error', () => {
      handleQueueVideoError();
    });
    videoEl?.addEventListener('timeupdate', () => {
      if (!videoEl.duration) return;
      const pct = (videoEl.currentTime / videoEl.duration) * 100;
      if (progressFillEl) progressFillEl.style.width = pct + '%';
      if (timeDisplayEl) {
        timeDisplayEl.textContent = formatTime(videoEl.currentTime) + ' / ' + formatTime(videoEl.duration);
      }
    });

    // Window resize handler to maintain aspect ratio on rotated queue video
    window.addEventListener('resize', () => {
      if (videoEl && S.queueIndex !== -1 && S.queue && S.queue[S.queueIndex]) {
        const itemRot = S.queue[S.queueIndex].rotation || 0;
        if (S.focusMode && S.focusedVideo === videoEl) {
          RR.focus?.reapplyBaseline?.(videoEl, itemRot);
        } else {
          applyQueueVideoRotation(videoEl, itemRot);
        }
      }
    });

    // Middle-click (scroll wheel click) on player wrap opens active reel in new tab
    if (playerWrap) {
      playerWrap.title = 'Click to toggle play/pause · Middle-click (scroll wheel) to open in new tab';
      playerWrap.addEventListener('mousedown', (e) => {
        if (e.button === 1) e.preventDefault();
      });
      playerWrap.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
          if (S.queueIndex !== -1 && S.queue && S.queue[S.queueIndex]) {
            openReelInNewTab(S.queue[S.queueIndex].permalink);
          }
        }
      });
    }

    // Click anywhere on player wrap toggles play/pause with user activation
    playerWrap?.addEventListener('click', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('#reel-queue-overlay-controls')) return;
      togglePlayPause();
    });

    // Play/pause click on controls button
    playPauseBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlayPause();
    });

    // Seekbar click
    progressBarEl?.addEventListener('click', (e) => {
      if (!videoEl || !videoEl.duration) return;
      const rect = progressBarEl.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, clickX / rect.width));
      videoEl.currentTime = pct * videoEl.duration;
    });

    // Setup watcher to keep feed muted when audio target is queue
    setupFeedMuteWatcher();

    renderPlaylist();
  }

  // ── Init ─────────────────────────────────────────────────────────────
  function init() {
    buildQueueUI();
  }

  // ── Expose ───────────────────────────────────────────────────────────
  RR.queue = {
    init,
    addCurrentReel,
    toggleAudioFocus,
    togglePlayPause,
    toggleMute,
    openPanel,
    closePanel,
    togglePanel,
    playIndex,
    playNext,
    playPrev,
    removeIndex,
    moveItem,
    rotateActiveQueueItem,
    applyQueueVideoRotation,
    likeActiveQueueItem,
    repostActiveQueueItem,
    isQueuePlaying,
    getVideoEl: () => videoEl,
    isOpen: () => !!S.queueVisible,
    isHovered: () => !!(panelEl && panelEl.matches(':hover')),
  };
})();
