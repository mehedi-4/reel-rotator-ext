const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatchEvent(event) { this.listeners.get(event.type)?.forEach(listener => listener(event)); }
}
class Element extends Events {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.dataset = {};
    this.attributes = {};
    this.classes = new Set();
    this.classList = {
      add: name => this.classes.add(name), remove: name => this.classes.delete(name),
      toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name),
    };
    this.rect = { width: 450, height: 800, left: 200, right: 650, top: 0, bottom: 800 };
    this.clientHeight = 800;
    this.scrollHeight = 800;
    this.textContent = '';
  }
  get parentNode() { return this.parentElement; }
  get isConnected() { return this.tagName === 'HTML' || !!this.parentElement?.isConnected; }
  get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  appendChild(child) { child.remove(); this.children.push(child); child.parentElement = this; return child; }
  insertBefore(child, next) { child.remove(); this.children.splice(this.children.indexOf(next), 0, child); child.parentElement = this; }
  remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] || null; }
  getBoundingClientRect() { return this.rect; }
  matches(selector) {
    if (selector === '[data-rr-focus-scope]') return this.dataset.rrFocusScope === '1';
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.className === selector.slice(1);
    return selector.split(', ').some(tag => tag.toUpperCase() === this.tagName);
  }
  querySelectorAll(selector) {
    if (selector === ':scope > video') return this.children.filter(child => child.tagName === 'VIDEO');
    const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    return selector === '*' ? descendants : descendants.filter(child => child.matches(selector));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    for (let element = this; element; element = element.parentElement) {
      if (element.matches(selector)) return element;
    }
    return null;
  }
  scrollBy(options) { this.scrolls ||= []; this.scrolls.push(options); }
}

function browser({ stored = {}, bridge = true } = {}) {
  const document = new Events();
  const html = new Element('html'), head = new Element('head'), body = new Element('body');
  html.append(head, body);
  const main = new Element('main'), article = new Element('article'), video = new Element('video');
  body.append(main); main.append(article); article.append(video);
  main.scrollHeight = 2400;
  main.style.overflowY = 'auto';
  Object.assign(video, { src: 'https://cdninstagram.com/feed.mp4', currentSrc: 'https://cdninstagram.com/feed.mp4',
    videoWidth: 450, videoHeight: 800, readyState: 4, paused: false, ended: false, muted: false, volume: .5, playbackRate: 1,
    play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } });
  Object.assign(document, { head, body, documentElement: html, scrollingElement: html, readyState: 'complete', hidden: false,
    contains: element => element?.isConnected,
    createElement: tag => new Element(tag),
    querySelectorAll: selector => html.querySelectorAll(selector),
    querySelector: selector => html.querySelector(selector),
    getElementById: id => html.querySelector(`#${id}`),
  });
  const window = new Events();
  Object.assign(window, { document, innerWidth: 1200, innerHeight: 800,
    location: { pathname: '/reels/', href: 'https://www.instagram.com/reels/' },
    getComputedStyle: element => ({ overflow: element.style.overflow || 'visible', overflowY: element.style.overflowY || 'visible' }),
    scrollBy: options => main.scrollBy(options),
  });
  let nextTimer = 0;
  const timers = new Map(), downloads = [], storageListeners = [];
  const chrome = {
    runtime: {
      getURL: asset => `chrome-extension://extension-id/${asset}`,
      sendMessage(message, callback) {
        if (message.type === 'RR_DOWNLOAD') { downloads.push(message); callback({ ok: true }); }
        else if (message.type === 'RR_STATS_GET') callback({ ok: true, stats: stored.reelStats || context.RRStats.emptyStats() });
        else if (message.type === 'RR_STATS_RECORD') {
          const stats = context.RRStats.mergeStats(stored.reelStats || context.RRStats.emptyStats(), [message.snapshot]);
          chrome.storage.local.set({ reelStats: stats }, () => callback({ ok: true, stats }));
        }
      },
    },
    storage: {
      local: {
        get: (defaults, callback) => callback({ ...defaults, ...stored }),
        set: (update, callback) => {
          Object.assign(stored, update);
          storageListeners.forEach(listener => listener(Object.fromEntries(Object.entries(update).map(([key, newValue]) => [key, { newValue }])), 'local'));
          callback?.();
        },
      },
      onChanged: { addListener: listener => storageListeners.push(listener) },
    },
  };
  class MediaElement { play() {} }
  const originalPlay = MediaElement.prototype.play;
  const context = vm.createContext({ window, document, chrome, console, queueMicrotask,
    HTMLMediaElement: MediaElement,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    history: { pushState() {}, replaceState() {} },
    performance: { getEntriesByType: () => [] },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: callback => callback(),
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: () => ++nextTimer, clearInterval() {},
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  for (const entry of manifest.content_scripts) {
    if (entry.world === 'MAIN' && !bridge) continue;
    for (const script of entry.js) vm.runInContext(fs.readFileSync(path.join(root, script), 'utf8'), context, { filename: script });
  }
  function press(key, extra = {}) {
    const event = { type: 'keydown', key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      target: body, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...extra };
    window.dispatchEvent(event);
    return event;
  }
  return { RR: window.__reelRotator, window, document, main, article, video, stored, downloads, press,
    originalPlay, MediaElement,
    fireTimeout: delay => {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `Missing ${delay}ms timeout`);
      timers.delete(entry[0]); entry[1].callback();
    },
  };
}

test('extension boots without a queue and ignores its removed bindings, including legacy saved mappings', () => {
  const env = browser({ stored: { keymap: { rotate: 'z', addToQueue: 'h', toggleAudio: 't', toggleQueue: 'g' } } });
  assert.equal(env.RR.queue, undefined);
  assert.equal(env.RR.state.queue, undefined);
  assert.ok(env.document.getElementById('reel-counter'));
  assert.ok(env.document.getElementById('reel-rotate-btn'));
  assert.equal(env.document.getElementById('reel-queue-panel'), null);
  assert.equal(env.MediaElement.prototype.play, env.originalPlay, 'Bridge must not intercept feed playback');
  for (const key of ['d', 't', 'g', 'h']) assert.equal(env.press(key).prevented, undefined);
  env.press('z');
  assert.equal(env.RR.state.rotation, -90);
  assert.equal(Object.keys(env.stored.keymap).length, 8);
  env.RR.keymap.runAction('addToQueue');
  assert.equal(env.document.getElementById('reel-queue-panel'), null);
});

test('feed rotation, navigation, pause, mute, volume, and speed work after queue removal', () => {
  const env = browser();
  env.press('r');
  assert.equal(env.RR.state.rotation, -90);
  env.press('e');
  assert.equal(env.RR.state.rotation, 0);
  env.press(' ');
  assert.equal(env.video.paused, true);
  env.RR.state.userMuted = false;
  env.press(' ');
  assert.equal(env.video.paused, false);
  assert.equal(env.video.muted, false);
  env.press('m');
  assert.equal(env.video.muted, true);
  env.press('m');
  assert.equal(env.video.muted, false);
  env.press('W', { code: 'KeyW', shiftKey: true });
  assert.equal(env.video.volume, .6);
  env.press('!', { code: 'Digit1', shiftKey: true });
  assert.equal(env.video.playbackRate, 1);
  env.press('$', { code: 'Digit4', shiftKey: true });
  assert.equal(env.video.playbackRate, 2);
  env.press('s');
  assert.equal(env.main.scrolls.at(-1).top, 800);
  const toast = env.document.getElementById('reel-status-toast');
  assert.ok(toast);
  assert.match(toast.textContent, /2× speed/);
});

test('focus can rotate the feed reel and restore its parent and styles on exit', () => {
  const env = browser();
  env.video.style.width = '420px';
  env.press('f');
  assert.equal(env.RR.state.focusMode, true);
  assert.equal(env.video.parentElement, env.document.body);
  assert.equal(env.article.dataset.rrFocusScope, '1');
  env.press('r');
  assert.match(env.video.style.transform, /translate.*rotate\(-90deg\)/);
  env.press('Escape');
  assert.equal(env.RR.state.focusMode, false);
  assert.equal(env.video.parentElement, env.article);
  assert.equal(env.video.style.width, '420px');
  assert.equal(env.article.dataset.rrFocusScope, undefined);
  assert.equal(env.video._rrMuteHandler, null);
});

test('focus rotation continues through full turns in either direction with correct sizing and orientation', () => {
  for (const [key, direction] of [['e', 1], ['r', -1]]) {
    const env = browser();
    env.press('f');
    const angle = () => Number(env.video.style.transform.match(/rotate\((-?\d+)deg\)/)?.[1] || 0);
    const originalSize = [env.video.style.width, env.video.style.height];
    assert.equal(angle(), 0);
    for (let turn = 1; turn <= 8; turn++) {
      env.press(key);
      assert.equal(angle(), direction * turn * 90, 'Each press must animate another 90° in the requested direction');
      assert.equal(env.RR.state.rotation, direction * (turn % 4) * 90 || 0);
      assert.match(env.video.style.transform, /^translate\(-50%, -50%\) rotate\(/);
      if (turn % 4 === 0) {
        assert.deepEqual([env.video.style.width, env.video.style.height], originalSize);
        assert.equal(env.RR.state.rotatedVideo, null);
      } else if (turn % 2 === 1) {
        assert.notEqual(env.video.style.width, originalSize[0]);
      }
      env.RR.focus.reapplyBaseline(env.video);
      assert.equal(angle(), direction * turn * 90, 'Reapplying layout must retain the continuous animation angle');
    }
    env.press(direction === 1 ? 'r' : 'e');
    assert.equal(angle(), direction * 630, 'Changing direction after a full turn must reverse by only 90°');
    env.press('Escape');
    assert.equal(env.video.parentElement, env.article);
    env.press('f');
    assert.equal(angle(), direction === 1 ? -90 : 90, 'A new focus visit starts from the current feed orientation');
  }
});

test('streaming downloads resolve through the bridge while the feed reel is focused', async () => {
  const env = browser();
  const url = 'https://cdninstagram.com/resolved-feed.mp4';
  env.video.src = env.video.currentSrc = 'blob:https://www.instagram.com/stream';
  env.article.__reactProps$test = { video_versions: [{ url, width: 1080 }] };
  env.RR.focus.enter();
  assert.equal(await env.RR.actions.downloadActiveVideo(), true);
  assert.equal(env.downloads.length, 1);
  assert.equal(env.downloads[0].url, url);
  assert.match(env.downloads[0].filename, /^instagram-reel-video-.*\.mp4$/);
  assert.equal(env.window.listeners.get('RR_RESOLVE_VIDEO_RES').size, 0);
});

test('missing bridge responses time out without a download and release the response listener', async () => {
  const env = browser({ bridge: false });
  env.video.src = env.video.currentSrc = 'blob:https://www.instagram.com/stream';
  const pending = env.RR.actions.downloadActiveVideo();
  env.window.dispatchEvent({ type: 'RR_RESOLVE_VIDEO_RES', detail: { reqId: 'unrelated-request', url: 'https://cdninstagram.com/wrong.mp4' } });
  assert.equal(env.downloads.length, 0);
  env.fireTimeout(600);
  assert.equal(await pending, false);
  assert.equal(env.window.listeners.get('RR_RESOLVE_VIDEO_RES').size, 0);
  assert.equal(env.downloads.length, 0);
});
