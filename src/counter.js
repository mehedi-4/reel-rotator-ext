// Count settled feed reel changes, independent of the navigation input used.
(function () {
  'use strict';

  const RR = window.__reelRotator;
  const S = RR.state;
  const Model = globalThis.RRStats;
  const { DEFAULTS, normalize } = RR.counterSettings;
  const SETTLE_MS = 180;
  let settings = { ...DEFAULTS };
  let indicator = null;
  let countEl = null;
  let timeEl = null;
  let lastReel = null;
  let candidate = null;
  let sampleTimer = null;
  let sessionActive = false;
  let dailyWatchMs = 0;
  let renderedState = '';
  let cachedStats = Model.emptyStats();
  let currentSession = null;
  let lastSampleAt = null;
  let wasWatching = false;
  let dirty = false;
  let lastFlushAt = 0;
  const pending = new Map();

  function createIndicator() {
    indicator = document.createElement('div');
    indicator.id = 'reel-counter';
    indicator.hidden = true;
    indicator.setAttribute('role', 'group');
    indicator.setAttribute('aria-label', "Today's reel count and watch time");

    const readout = document.createElement('div');
    readout.className = 'rr-counter-readout';
    countEl = document.createElement('span');
    countEl.className = 'rr-counter-count';
    countEl.setAttribute('role', 'status');
    countEl.setAttribute('aria-live', 'polite');
    countEl.setAttribute('aria-atomic', 'true');
    const separator = document.createElement('span');
    separator.className = 'rr-counter-separator';
    separator.textContent = '·';
    separator.setAttribute('aria-hidden', 'true');
    timeEl = document.createElement('span');
    timeEl.className = 'rr-counter-time';
    timeEl.setAttribute('role', 'timer');
    timeEl.setAttribute('aria-label', 'Time watching today');
    timeEl.setAttribute('aria-live', 'off');
    readout.append(countEl, separator, timeEl);
    indicator.appendChild(readout);
    document.body.appendChild(indicator);
  }

  function formatWatchTime(seconds) {
    const minutes = String(Math.floor(seconds / 60) % 60).padStart(2, '0');
    const remainder = String(seconds % 60).padStart(2, '0');
    const hours = Math.floor(seconds / 3600);
    return hours ? `${hours}:${minutes}:${remainder}` : `${minutes}:${remainder}`;
  }

  function render() {
    if (!indicator) return;
    // Instagram can replace page chrome during navigation.
    if (!indicator.isConnected) document.body.appendChild(indicator);
    const elapsed = Math.max(0, Math.floor(dailyWatchMs / 1000));
    const viewState = `${sessionActive}:${settings.display}:${settings.limit}:${S.reelCount}:${elapsed}`;
    if (viewState === renderedState) return;
    renderedState = viewState;
    indicator.hidden = !sessionActive || settings.display === 'off';
    indicator.dataset.display = settings.display;
    const progress = Math.min(S.reelCount / settings.limit, 1);
    const reached = S.reelCount >= settings.limit;
    indicator.dataset.limitReached = String(reached);
    indicator.style.setProperty('--rr-counter-color', `hsl(${Math.round(120 * (1 - progress))}, 78%, 62%)`);
    indicator.style.setProperty('--rr-counter-angle', `${progress * 360}deg`);

    // Only announce reel changes; the clock should not announce every second.
    const countText = String(S.reelCount);
    if (countEl.textContent !== countText) {
      countEl.textContent = countText;
      countEl.setAttribute('aria-label', `${S.reelCount} reels today`);
    }
    timeEl.textContent = formatWatchTime(elapsed);
  }

  function activeReel() {
    if (S.focusNavigating) return null;
    const video = RR.domUtils.findActiveVideo();
    if (!video || video.id === 'reel-queue-video' || !document.contains(video)) return null;

    const rect = video.getBoundingClientRect();
    const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    if (rect.width < 50 || rect.height < 50 || rect.right <= 0 || rect.left >= window.innerWidth ||
        visibleHeight < Math.min(rect.height, window.innerHeight) * 0.5) return null;

    // A permalink survives stream quality changes and refreshed media URLs.
    // Fall back to the source for feed cards without a permalink. This also
    // detects Instagram reusing a <video> element for a new reel.
    const scope = RR.domUtils.findReelContainer(video);
    const href = scope?.querySelector('a[href*="/reel/"], a[href*="/reels/"]')?.getAttribute('href');
    const shortcode = href?.match(/\/(?:reel|reels)\/([A-Za-z0-9_-]+)/)?.[1];
    const source = video.currentSrc || video.src || video.querySelector('source')?.src;
    return source ? { shortcode, source, video } : null;
  }

  function sameReel(a, b) {
    if (!a || !b) return false;
    if (a.shortcode && b.shortcode) return a.shortcode === b.shortcode;
    return a.source === b.source;
  }

  function updateDailyTotals() {
    const snapshots = [...pending.values()];
    if (currentSession) snapshots.push(currentSession);
    const stats = Model.mergeStats(cachedStats, snapshots);
    const totals = Model.today(stats);
    S.reelCount = totals.reels;
    dailyWatchMs = totals.watchMs;
  }

  function adoptStats(stats) {
    if (stats?.version !== 1 || !stats.sessions) return;
    cachedStats = Model.mergeStats(cachedStats, Object.values(stats.sessions));
    updateDailyTotals();
    render();
  }

  function sendSnapshot(snapshot) {
    try {
      chrome.runtime.sendMessage({ type: 'RR_STATS_RECORD', snapshot }, response => {
        if (chrome.runtime.lastError || !response?.ok) return;
        adoptStats(response.stats);
        if (pending.get(snapshot.id) === snapshot) pending.delete(snapshot.id);
      });
    } catch (_) { /* Retry pending snapshots on the next heartbeat. */ }
  }

  function flush(force = false) {
    const now = Date.now();
    if (!force && now - lastFlushAt < 5000) return;
    lastFlushAt = now;
    if (currentSession && dirty) {
      const snapshot = JSON.parse(JSON.stringify(currentSession));
      pending.set(snapshot.id, snapshot);
      dirty = false;
    }
    for (const snapshot of pending.values()) sendSnapshot(snapshot);
  }

  function finishSession(now) {
    if (currentSession) {
      currentSession.endedAt = now;
      currentSession.updatedAt = now;
      dirty = true;
      flush(true);
    }
    currentSession = null;
    sessionActive = false;
    lastReel = null;
    candidate = null;
    wasWatching = false;
  }

  function sample() {
    const now = Date.now();
    if (currentSession && wasWatching && lastSampleAt !== null && now > lastSampleAt) {
      // Cap stalled callbacks so a suspended/background tab cannot add hours.
      Model.addWatchTime(currentSession, Math.max(lastSampleAt, now - 1500), now);
      dirty = true;
    }
    lastSampleAt = now;
    if (!RR.domUtils.isReelsPage()) {
      if (sessionActive) finishSession(now);
      flush();
      updateDailyTotals();
      render();
      return;
    }

    if (!sessionActive) {
      const id = globalThis.crypto?.randomUUID?.() || `${now.toString(36)}-${Math.random().toString(36).slice(2)}`;
      currentSession = Model.createSession(id, now);
      dirty = true;
      flush(true);
    }
    sessionActive = true;
    const reel = document.hidden === true ? null : activeReel();
    wasWatching = !!reel && !reel.video.paused && !reel.video.ended && reel.video.readyState > 2;
    if (!reel) {
      candidate = null;
      flush();
      updateDailyTotals();
      render();
      return;
    }

    // The first reel is the starting point: zero reels scrolled so far.
    if (!lastReel) {
      lastReel = reel;
    } else if (sameReel(reel, lastReel)) {
      lastReel = reel;
      candidate = null;
    } else if (!candidate || !sameReel(reel, candidate)) {
      candidate = { ...reel, since: Date.now() };
      schedule();
    } else if (Date.now() - candidate.since >= SETTLE_MS) {
      Model.addReel(currentSession, now);
      dirty = true;
      flush(true);
      lastReel = reel;
      candidate = null;
    }
    flush();
    updateDailyTotals();
    render();
  }

  function schedule() {
    clearTimeout(sampleTimer);
    sampleTimer = setTimeout(sample, SETTLE_MS);
  }

  function applySettings(stored) {
    settings = normalize(stored);
    render();
  }

  function init() {
    createIndicator();
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.reelCounter) applySettings(changes.reelCounter.newValue);
        if (area === 'local' && changes.reelStats) adoptStats(changes.reelStats.newValue);
      });
      chrome.storage.local.get({ reelCounter: DEFAULTS, reelStats: Model.emptyStats() }, (res) => {
        applySettings(res.reelCounter);
        adoptStats(res.reelStats);
      });
      chrome.runtime.sendMessage({ type: 'RR_STATS_GET' }, response => {
        if (!chrome.runtime.lastError && response?.ok) adoptStats(response.stats);
      });
    } catch (_) { /* The counter still works with defaults without storage. */ }

    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    // Capture the final playback interval immediately when play/pause changes.
    for (const type of ['play', 'pause', 'ended']) {
      document.addEventListener(type, (event) => {
        if (event.target.tagName === 'VIDEO' && event.target.id !== 'reel-queue-video') sample();
      }, true);
    }
    document.addEventListener('loadeddata', schedule, true);
    document.addEventListener('visibilitychange', sample);
    window.addEventListener('popstate', sample);
    window.addEventListener('pageshow', sample);
    window.addEventListener('pagehide', () => {
      sample();
      finishSession(Date.now());
    });
    // Also covers reused video nodes, auto-advance, and MAIN-world URL changes.
    setInterval(sample, 500);
    sample();
  }

  RR.counter = { init, sample, schedule };
})();
