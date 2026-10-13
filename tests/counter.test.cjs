const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.id = '';
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.textContent = '';
    this.isConnected = true;
    this.value = '';
    this.style = { setProperty(name, value) { this[name] = value; } };
  }
  append(...children) {
    this.children.push(...children);
    children.forEach(child => { child.isConnected = true; });
  }
  appendChild(child) { this.append(child); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] || null; }
  closest() { return this.reelScope || null; }
  querySelector() { return null; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  dispatch(type, event = {}) { this.listeners[type]?.({ preventDefault() {}, ...event }); }
}

function video(src, rect = {}) {
  const element = new Element('video');
  element.src = src;
  element.currentSrc = src;
  element.paused = false;
  element.ended = false;
  element.readyState = 4;
  element.rect = { top: 0, bottom: 800, left: 200, right: 650, width: 450, height: 800, ...rect };
  element.getBoundingClientRect = () => element.rect;
  return element;
}

function environment({ stored = {}, pathname = '/reels/', elements = {}, inputs = [], startAt = 0 } = {}) {
  let now = startAt;
  let nextTimer = 0;
  let videos = [];
  const timers = new Map();
  const listeners = {};
  const windowListeners = {};
  const storageListeners = [];
  const writes = [];
  const body = new Element('body');
  const document = {
    body,
    createElement: tag => new Element(tag),
    contains: element => element.isConnected,
    querySelectorAll: selector => selector === 'input[data-action]'
      ? inputs : videos,
    getElementById: id => elements[id] || body.children.find(element => element.id === id),
    addEventListener: (type, listener) => { listeners[type] = listener; },
  };
  const location = { pathname };
  const chrome = {
    runtime: {
      sendMessage(message, callback) {
        const Model = context.RRStats;
        if (message.type === 'RR_STATS_RECORD') {
          const stats = Model.mergeStats(stored.reelStats || Model.emptyStats(), [message.snapshot]);
          chrome.storage.local.set({ reelStats: stats }, () => callback({ ok: true, stats }));
        } else if (message.type === 'RR_STATS_GET') {
          callback({ ok: true, stats: stored.reelStats || Model.emptyStats() });
        }
      },
    },
    storage: {
      local: {
        get(defaults, callback) { callback({ ...defaults, ...stored }); },
        set(update, callback) {
          writes.push(update);
          if (!chrome.runtime.lastError) {
            Object.assign(stored, update);
            storageListeners.forEach(listener => listener(Object.fromEntries(
              Object.entries(update).map(([key, newValue]) => [key, { newValue }])
            ), 'local'));
          }
          callback?.();
        },
      },
      onChanged: { addListener: listener => storageListeners.push(listener) },
    },
  };
  function addTimer(callback, delay, interval = 0) {
    const id = ++nextTimer;
    timers.set(id, { callback, at: now + delay, interval });
    return id;
  }
  const window = { document, location, innerHeight: 800, innerWidth: 1200,
    addEventListener: (type, listener) => { windowListeners[type] = listener; } };
  const context = vm.createContext({
    window, document, chrome, console,
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    },
    setTimeout: (callback, delay) => addTimer(callback, delay),
    setInterval: (callback, delay) => addTimer(callback, delay, delay),
    clearTimeout: id => timers.delete(id),
  });
  function load(file) { vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context); }
  function advance(ms) {
    const end = now + ms;
    while (true) {
      const pending = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!pending) break;
      const [id, timer] = pending;
      now = timer.at;
      if (timer.interval) timer.at += timer.interval;
      else timers.delete(id);
      timer.callback();
    }
    now = end;
  }
  return {
    load, advance, window, document, chrome, location, writes, stored,
    setVideos: value => { videos = value; },
    emit: (type, target) => listeners[type]?.({ target }),
    emitWindow: type => windowListeners[type]?.(),
    changeSettings: (newValue, area = 'local') => storageListeners.forEach(
      listener => listener({ reelCounter: { newValue } }, area)
    ),
  };
}

function counter(stored = {}, options = {}) {
  const env = environment({ stored, ...options });
  ['src/state.js', 'src/counter-settings.js', 'src/stats-model.js', 'src/dom-utils.js', 'src/counter.js'].forEach(env.load);
  const first = video('https://example.test/a.mp4');
  env.setVideos([first]);
  const RR = env.window.__reelRotator;
  RR.counter.init();
  const indicator = env.document.getElementById('reel-counter');
  const [countEl, separatorEl, timeEl] = indicator.children[0].children;
  function settle(next) {
    env.setVideos([next]);
    RR.counter.sample();
    env.advance(180);
  }
  return { ...env, RR, first, indicator, countEl, separatorEl, timeEl, settle };
}

test('first reel, wheel events, pause/resume, and replacement of the same reel do not count', () => {
  const env = counter();
  assert.equal(env.RR.state.reelCount, 0);
  assert.equal(env.indicator.hidden, false);
  for (let i = 0; i < 10; i++) env.emit('scroll');
  env.advance(1000);
  env.first.paused = true;
  env.RR.counter.sample();
  env.first.paused = false;
  env.emit('play', env.first);
  env.advance(1000);
  env.settle(video(env.first.src));
  assert.equal(env.RR.state.reelCount, 0);
});

test('settled next and previous reels each count once, including when paused', () => {
  const env = counter();
  const second = video('https://example.test/b.mp4');
  second.paused = true;
  env.settle(second);
  assert.equal(env.RR.state.reelCount, 1);
  env.advance(2000);
  assert.equal(env.RR.state.reelCount, 1);
  env.settle(env.first);
  assert.equal(env.RR.state.reelCount, 2);
});

test('reused video nodes count new sources; preloaded and transient reels do not count', () => {
  const env = counter();
  env.first.currentSrc = env.first.src = 'https://example.test/b.mp4';
  env.settle(env.first);
  assert.equal(env.RR.state.reelCount, 1);

  env.setVideos([video('https://example.test/offscreen.mp4', { top: 1000, bottom: 1800 })]);
  env.advance(1000);
  assert.equal(env.RR.state.reelCount, 1);
  env.setVideos([video('https://example.test/transient.mp4')]);
  env.RR.counter.sample();
  env.advance(90);
  env.settle(video('https://example.test/c.mp4'));
  assert.equal(env.RR.state.reelCount, 2);
});

test('reel permalinks prevent counting quality changes and distinguish identical media', () => {
  const env = counter();
  const link = new Element('a');
  link.setAttribute('href', '/reel/first/');
  const scope = new Element('article');
  scope.querySelector = () => link;
  env.first.reelScope = scope;
  env.RR.counter.sample();
  env.first.currentSrc = env.first.src = 'https://example.test/a-higher-quality.mp4';
  env.settle(env.first);
  assert.equal(env.RR.state.reelCount, 0);
  link.setAttribute('href', '/reel/second/');
  env.settle(env.first);
  assert.equal(env.RR.state.reelCount, 1);
});

test('focus navigation counts the settled reel and ignores offscreen playback', () => {
  const env = counter();
  const S = env.RR.state;
  S.focusMode = true;
  S.focusedVideo = env.first;
  env.advance(500);
  assert.equal(S.reelCount, 0);
  S.focusNavigating = true;
  const second = video('https://example.test/b.mp4');
  env.setVideos([second]);
  env.advance(1000);
  assert.equal(S.reelCount, 0);
  S.focusNavigating = false;
  S.focusedVideo = second;
  env.settle(second);
  assert.equal(S.reelCount, 1);
  const offscreen = video('https://example.test/offscreen.mp4', { top: 1000, bottom: 1800 });
  env.setVideos([offscreen]);
  S.focusedVideo = offscreen;
  env.emit('play', offscreen);
  env.advance(1000);
  assert.equal(S.reelCount, 1);
});

test('counter changes from green through amber to red and continues beyond the limit', () => {
  const env = counter({ reelCounter: { display: 'island', limit: 2 } });
  assert.equal(env.indicator.style['--rr-counter-color'], 'hsl(120, 78%, 62%)');
  env.settle(video('https://example.test/b.mp4'));
  assert.equal(env.indicator.style['--rr-counter-color'], 'hsl(60, 78%, 62%)');
  env.settle(video('https://example.test/c.mp4'));
  assert.equal(env.indicator.style['--rr-counter-color'], 'hsl(0, 78%, 62%)');
  assert.equal(env.indicator.children.length, 1);
  assert.equal(env.indicator.children[0].children.length, 3);
  assert.equal(env.countEl.textContent, '2');
  assert.equal(env.separatorEl.textContent, '·');
  assert.equal(env.timeEl.textContent, '00:00');
  env.settle(video('https://example.test/d.mp4'));
  assert.equal(env.RR.state.reelCount, 3);
  assert.equal(env.indicator.style['--rr-counter-angle'], '360deg');
  assert.equal(env.countEl.attributes['aria-label'], '3 reels today');
});

test('display and limit changes apply live, retain count, and ignore other storage areas', () => {
  const env = counter();
  env.settle(video('https://example.test/b.mp4'));
  env.changeSettings({ display: 'punchhole', limit: 1 });
  assert.equal(env.indicator.dataset.display, 'punchhole');
  assert.equal(env.indicator.dataset.limitReached, 'true');
  env.changeSettings({ display: 'off', limit: 5 });
  assert.equal(env.indicator.hidden, true);
  env.settle(video('https://example.test/c.mp4'));
  env.changeSettings({ display: 'island', limit: 4 });
  assert.equal(env.RR.state.reelCount, 2);
  assert.equal(env.indicator.hidden, false);
  assert.equal(env.indicator.style['--rr-counter-color'], 'hsl(60, 78%, 62%)');
  env.changeSettings({ display: 'off', limit: 1 }, 'sync');
  assert.equal(env.indicator.hidden, false);
  env.changeSettings({ display: 'unknown', limit: -1 });
  assert.equal(env.indicator.style['--rr-counter-color'], 'hsl(115, 78%, 62%)');
  env.changeSettings(undefined);
  assert.equal(env.indicator.dataset.display, 'island');
});

test('daily count survives leaving Reels and reloading; new sessions start from today’s total', () => {
  const env = counter();
  env.settle(video('https://example.test/b.mp4'));
  env.location.pathname = '/reel/another/';
  env.RR.counter.sample();
  assert.equal(env.RR.state.reelCount, 1);
  env.location.pathname = '/explore/';
  env.RR.counter.sample();
  assert.equal(env.RR.state.reelCount, 1);
  assert.equal(env.indicator.hidden, true);
  env.location.pathname = '/reels/';
  env.settle(video('https://example.test/c.mp4'));
  assert.equal(env.RR.state.reelCount, 1);
  assert.equal(env.indicator.hidden, false);
  assert.equal(counter(env.stored).RR.state.reelCount, 1);
});

test('daily watch clock grows on the same reel, stops while paused, and survives display changes', () => {
  const env = counter();
  assert.equal(env.timeEl.textContent, '00:00');
  assert.equal(env.timeEl.attributes['role'], 'timer');
  assert.equal(env.timeEl.attributes['aria-label'], 'Time watching today');
  assert.equal(env.timeEl.attributes['aria-live'], 'off');
  assert.equal(env.indicator.attributes['aria-live'], undefined);
  env.advance(65000);
  assert.equal(env.timeEl.textContent, '01:05');
  assert.equal(env.RR.state.reelCount, 0);
  env.advance(250);
  env.first.paused = true;
  env.emit('pause', env.first);
  env.advance(5000);
  assert.equal(env.timeEl.textContent, '01:05');
  const savedSession = Object.values(env.stored.reelStats.sessions)[0];
  assert.equal(Object.values(savedSession.days)[0].watchMs, 65250);
  env.settle(video('https://example.test/b.mp4'));
  assert.equal(env.timeEl.textContent, '01:05');
  env.changeSettings({ display: 'off', limit: 50 });
  env.advance(5000);
  env.changeSettings({ display: 'punchhole', limit: 20 });
  assert.equal(env.timeEl.textContent, '01:10');
  assert.equal(env.RR.state.reelCount, 1);
});

test('daily watch clock formats minute and hour boundaries and retains time when leaving Reels', () => {
  const env = counter();
  env.advance(59000);
  assert.equal(env.timeEl.textContent, '00:59');
  env.advance(1000);
  assert.equal(env.timeEl.textContent, '01:00');
  env.advance(3540000);
  assert.equal(env.timeEl.textContent, '1:00:00');
  env.settle(video('https://example.test/b.mp4'));
  env.location.pathname = '/reel/another/';
  env.RR.counter.sample();
  assert.equal(env.timeEl.textContent, '1:00:00');
  env.location.pathname = '/explore/';
  env.RR.counter.sample();
  assert.equal(env.timeEl.textContent, '1:00:00');
  assert.equal(env.RR.state.reelCount, 1);
  env.advance(5000);
  env.location.pathname = '/reels/';
  env.RR.counter.sample();
  env.advance(1500);
  assert.equal(env.timeEl.textContent, '1:00:01');
  assert.equal(counter().timeEl.textContent, '00:00');
});

test('daily count and watch clock reset at local midnight, retaining prior-day history', () => {
  const startAt = new Date(2026, 9, 14, 23, 59, 59).getTime();
  const env = counter({}, { startAt });
  env.settle(video('https://example.test/b.mp4'));
  assert.equal(env.RR.state.reelCount, 1);
  env.advance(820);
  assert.equal(env.RR.state.reelCount, 0);
  assert.equal(env.timeEl.textContent, '00:00');
  env.advance(1000);
  assert.equal(env.timeEl.textContent, '00:01');
  env.settle(video('https://example.test/c.mp4'));
  assert.equal(env.RR.state.reelCount, 1);
  const days = Object.values(env.stored.reelStats.sessions)[0].days;
  assert.equal(days['2026-10-14'].reels, 1);
  assert.equal(days['2026-10-15'].reels, 1);
  assert.equal(days['2026-10-14'].watchMs, 1000);
  assert.equal(days['2026-10-15'].watchMs, 1180);
});

test('refresh saves the final playback interval and restores today’s count and watch time', () => {
  const env = counter();
  env.advance(5700);
  env.settle(video('https://example.test/b.mp4'));
  env.emitWindow('pagehide');
  const refreshed = counter(env.stored, { startAt: 5880 });
  assert.equal(refreshed.timeEl.textContent, '00:05');
  assert.equal(refreshed.RR.state.reelCount, 1);
  refreshed.advance(120);
  refreshed.RR.counter.sample();
  assert.equal(refreshed.timeEl.textContent, '00:06');
  assert.equal(refreshed.RR.state.reelCount, 1);
});

test('watching history excludes hidden tabs and paused playback', () => {
  const env = counter();
  env.advance(5000);
  const watchMs = () => Object.values(env.stored.reelStats.sessions).reduce((total, session) =>
    total + Object.values(session.days).reduce((sum, day) => sum + day.watchMs, 0), 0);
  assert.equal(watchMs(), 5000);
  assert.equal(env.timeEl.textContent, '00:05');
  env.document.hidden = true;
  env.emit('visibilitychange');
  env.advance(5000);
  assert.equal(watchMs(), 5000);
  assert.equal(env.timeEl.textContent, '00:05');
  env.document.hidden = false;
  env.first.paused = true;
  env.emit('visibilitychange');
  env.advance(5000);
  assert.equal(watchMs(), 5000);
  env.first.paused = false;
  env.RR.counter.sample();
  env.advance(5000);
  assert.equal(watchMs(), 10000);
  assert.equal(env.timeEl.textContent, '00:10');
});

function popup(stored = {}) {
  const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  const inputs = [...html.matchAll(/data-action="([^"]+)"/g)].map(([, action]) => {
    const input = new Element('input');
    input.dataset.action = action;
    return input;
  });
  const elements = Object.fromEntries(['status', 'counter-display', 'reel-limit', 'settings-form', 'reset']
    .map(id => [id, new Element()]));
  elements['settings-form'].requestSubmit = () => elements['settings-form'].dispatch('submit');
  const env = environment({ stored, elements, inputs });
  ['src/counter-settings.js', 'popup.js'].forEach(env.load);
  return { ...env, elements, inputs };
}

test('popup restores feed bindings, applies edits live, and resets settings without changing history', () => {
  const stats = { version: 1, sessions: {}, updatedAt: 0 };
  const env = popup({ keymap: { rotate: 'Z', addToQueue: 'd', toggleAudio: 't', toggleQueue: 'g' },
    reelStats: stats, reelCounter: { display: 'punchhole', limit: 20 } });
  ['src/state.js', 'src/dom-utils.js', 'src/keymap.js'].forEach(env.load);
  const keymap = env.window.__reelRotator.keymap;
  keymap.setupStorageListener();
  assert.deepEqual(env.inputs.map(input => input.dataset.action), Object.keys(keymap.DEFAULT_KEYMAP));
  assert.equal(env.inputs.length, 8, 'Only the eight remaining feed controls may be rebound');
  const rotate = env.inputs.find(input => input.dataset.action === 'rotate');
  assert.equal(rotate.value, 'z');
  assert.equal(env.writes.length, 0, 'Opening settings must preserve saved preferences');
  assert.equal(env.elements['counter-display'].value, 'punchhole');
  assert.equal(env.elements['reel-limit'].value, 20);
  rotate.value = 'b';
  env.elements['counter-display'].value = 'off';
  env.elements['reel-limit'].value = '30';
  env.elements['settings-form'].dispatch('submit');
  const saved = env.writes.at(-1);
  assert.equal(saved.keymap.rotate, 'b');
  assert.deepEqual(Object.keys(saved.keymap), Object.keys(keymap.DEFAULT_KEYMAP));
  assert.equal(keymap._getKeymap().rotate, 'b', 'Saved keys must reach the feed dispatcher without reloading');
  assert.equal(saved.reelCounter.display, 'off');
  assert.equal(saved.reelCounter.limit, 30);
  assert.match(env.elements.status.textContent, /Saved/);
  env.elements.reset.dispatch('click');
  assert.equal(env.elements['counter-display'].value, 'island');
  assert.equal(env.elements['reel-limit'].value, 50);
  assert.deepEqual(env.stored.keymap, keymap.DEFAULT_KEYMAP);
  assert.deepEqual(keymap._getKeymap(), keymap.DEFAULT_KEYMAP);
  env.inputs.forEach(input => assert.equal(input.value, keymap.DEFAULT_KEYMAP[input.dataset.action]));
  assert.equal(env.stored.reelStats, stats);
});

test('popup keeps existing feed-key migrations and single-character editing, including Enter to save', () => {
  const env = popup({ keymap: { nextReel: 'A', save: '' } });
  const next = env.inputs.find(input => input.dataset.action === 'nextReel');
  const save = env.inputs.find(input => input.dataset.action === 'save');
  assert.equal(next.value, 's');
  assert.equal(save.value, 'x');
  next.value = 'NB';
  next.dispatch('input');
  assert.equal(next.value, 'b');
  next.dispatch('keydown', { key: 'Enter' });
  assert.equal(env.stored.keymap.nextReel, 'b');
  assert.match(env.elements.status.textContent, /Saved/);
  next.value = '';
  const writesBefore = env.writes.length;
  env.elements['settings-form'].dispatch('submit');
  assert.equal(env.writes.length, writesBefore);
  assert.match(env.elements.status.textContent, /Please set a key for: nextReel/);
});

test('invalid limits and failed storage writes do not report success', () => {
  const env = popup();
  for (const value of ['', '0', '-1', '1.5', '10000', 'bad']) {
    const writesBefore = env.writes.length;
    env.elements['reel-limit'].value = value;
    env.elements['settings-form'].dispatch('submit');
    assert.equal(env.writes.length, writesBefore);
    assert.equal(env.elements.status.dataset.error, '1');
  }
  env.elements['reel-limit'].value = '20';
  env.chrome.runtime.lastError = { message: 'Storage unavailable' };
  env.elements['settings-form'].dispatch('submit');
  assert.match(env.elements.status.textContent, /Could not save/);
});
