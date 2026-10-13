const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const Model = require('../src/stats-model.js');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this.textContent = '';
    this.hidden = false;
    this.clientWidth = 700;
    this.listeners = {};
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  click() { return this.listeners.click?.(); }
}

function history() {
  const sessions = [];
  for (const [id, daysAgo, reels, watchMs] of [['today', 0, 3, 60000], ['recent', 10, 5, 120000], ['old', 120, 2, 30000]]) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - daysAgo);
    const time = date.getTime();
    const session = Model.createSession(id, time);
    for (let index = 0; index < reels; index++) Model.addReel(session, time);
    Model.addWatchTime(session, time, time + watchMs);
    sessions.push(session);
  }
  return Model.mergeStats(Model.emptyStats(), sessions);
}

function dashboard(stats = history(), { standalone = false, handle = null } = {}) {
  const html = fs.readFileSync(path.join(__dirname, '../dashboard/index.html'), 'utf8');
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, new Element()]));
  const ranges = ['7', '30', 'all'].map(range => {
    const element = new Element('button');
    element.dataset.range = range;
    return element;
  });
  const limitLegend = new Element('span');
  let available = true;
  let linked = handle;
  const storageListeners = [];
  const document = {
    hidden: false,
    getElementById: id => elements[id],
    querySelectorAll: () => ranges,
    querySelector: () => limitLegend,
    createElement: tag => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
    addEventListener() {},
  };
  const window = { addEventListener() {} };
  const chrome = standalone ? undefined : {
    runtime: { id: 'extension-id', sendMessage: async message => {
      if (message.type === 'RR_STATS_IMPORT') stats = Model.mergeStats(stats, Object.values(message.history.sessions));
      let file;
      if (message.type === 'RR_STATS_FILE_SAVE') file = linked ? await context.RRStatsFile.write(linked, stats, 50) : { state: 'unlinked' };
      return { ok: true, stats, file };
    } },
    storage: {
      local: { get: async () => {
        if (!available) throw new Error('Storage unavailable.');
        return { reelStats: stats, reelCounter: { limit: 50 } };
      } },
      onChanged: { addListener: handler => storageListeners.push(handler) },
    },
  };
  const context = vm.createContext({ document, window, chrome, console, RRStats: Model,
    setInterval() {}, setTimeout() {}, clearTimeout() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/stats-file.js'), 'utf8'), context);
  context.RRStatsFile.getHandle = async () => linked;
  context.RRStatsFile.setHandle = async handle => { linked = handle; };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../dashboard/dashboard.js'), 'utf8'), context);
  return { elements, ranges, limitLegend, window, offline: () => { available = false; },
    update: next => { stats = next; storageListeners.forEach(handler => handler({ reelStats: { newValue: next } }, 'local')); } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('7-day, 30-day, and all-time dashboard controls render real totals and matching charts', async () => {
  const env = dashboard();
  await settle();
  assert.equal(env.elements['total-reels'].textContent, '3');
  assert.equal(env.elements['total-time'].textContent, '1m 0s');
  assert.equal(env.elements['history-body'].children.length, 7);
  assert.equal(env.elements['reel-chart'].children[0].children.filter(node => node.tagName === 'rect').length, 7);
  env.ranges[1].click();
  await settle();
  assert.equal(env.elements['total-reels'].textContent, '8');
  assert.equal(env.elements['total-sessions'].textContent, '2');
  assert.equal(env.elements['reel-chart'].children[0].children.filter(node => node.tagName === 'rect').length, 30);
  assert.equal(env.elements['history-body'].children.length, 15);
  env.elements['next-page'].click();
  assert.equal(env.elements['page-caption'].textContent, 'Page 2 of 2');
  env.ranges[2].click();
  await settle();
  assert.equal(env.elements['total-reels'].textContent, '10');
  assert.equal(env.elements['total-sessions'].textContent, '3');
  assert.equal(env.elements['total-time'].textContent, '3m 30s');
  assert.equal(env.limitLegend.hidden, true);
  const bars = env.elements['reel-chart'].children[0].children.filter(node => node.tagName === 'rect');
  assert.ok(bars.length < 12, 'Long histories are grouped into readable monthly bars');
  for (const target of ['reel-chart', 'time-chart', 'weekday-chart']) {
    assert.ok(env.elements[target].children[0].attributes['aria-label']);
    assert.doesNotMatch(JSON.stringify(env.elements[target].children), /NaN/);
  }
});

test('empty dashboards display zero totals and explain how history begins', async () => {
  const env = dashboard(Model.emptyStats());
  await settle();
  assert.equal(env.elements['empty-state'].hidden, false);
  assert.equal(env.elements['total-reels'].textContent, '0');
  assert.equal(env.elements['total-time'].textContent, '0s');
  assert.equal(env.elements['total-sessions'].textContent, '0');
});

test('storage failures preserve displayed data and show recovery guidance', async () => {
  const env = dashboard();
  await settle();
  env.offline();
  env.elements.refresh.click();
  await settle();
  assert.equal(env.elements['total-reels'].textContent, '3');
  assert.equal(env.elements['error-state'].hidden, false);
  assert.match(env.elements['error-state'].textContent, /history is kept in the extension/);
  assert.equal(env.elements.refresh.disabled, false);
});

function jsonHandle(stats = history()) {
  let text = JSON.stringify({ ...stats, dailyLimit: 50 });
  const handle = {
    name: 'reel-history.json', permission: 'granted',
    queryPermission: async () => handle.permission,
    requestPermission: async () => { handle.permission = 'granted'; return 'granted'; },
    getFile: async () => ({ text: async () => text }),
    createWritable: async () => {
      let pending;
      return { write: async value => { pending = value; }, close: async () => { text = pending; } };
    },
    contents: () => JSON.parse(text),
    replace: value => { text = JSON.stringify({ ...value, dailyLimit: 50 }); },
  };
  return handle;
}

test('extension history changes update the dashboard without reloading the page', async () => {
  const env = dashboard(Model.emptyStats());
  await settle();
  env.update(history());
  await settle();
  assert.equal(env.elements['total-reels'].textContent, '3');
  assert.equal(env.elements['empty-state'].hidden, true);
});

test('standalone HTML reads a chosen JSON file and picks up file changes on refresh', async () => {
  const handle = jsonHandle();
  const env = dashboard(undefined, { standalone: true });
  env.window.showOpenFilePicker = async () => [handle];
  await settle();
  assert.equal(env.elements['total-reels'].textContent, '0');
  await env.elements['open-json'].click();
  assert.equal(env.elements['total-reels'].textContent, '3');
  env.ranges[2].click();
  await settle();
  assert.equal(env.elements['total-reels'].textContent, '10');
  handle.replace(Model.emptyStats());
  await env.elements.refresh.click();
  assert.equal(env.elements['total-reels'].textContent, '0');
  assert.match(env.elements['file-hint'].textContent, /every 15 seconds/);
});

test('saving JSON links a file, preserves its history, and updates it as new activity arrives', async () => {
  const session = Model.createSession('file-session', Date.now());
  for (let index = 0; index < 4; index++) Model.addReel(session, Date.now());
  const handle = jsonHandle(Model.mergeStats(Model.emptyStats(), [session]));
  const env = dashboard();
  env.window.showSaveFilePicker = async () => handle;
  await settle();
  await env.elements['save-json'].click();
  assert.equal(Model.today(handle.contents()).reels, 7);
  assert.equal(env.elements['file-name'].textContent, 'reel-history.json');
  const next = Model.createSession('new-session', Date.now());
  Model.addReel(next, Date.now());
  env.update(Model.mergeStats(handle.contents(), [next]));
  await settle();
  assert.equal(Model.today(handle.contents()).reels, 8);
  assert.equal(env.elements['total-reels'].textContent, '8');
});

test('revoked file permission keeps live statistics visible and reconnect resumes JSON updates', async () => {
  const handle = jsonHandle(Model.emptyStats());
  handle.permission = 'prompt';
  const env = dashboard(history(), { handle });
  await settle();
  assert.equal(env.elements['total-reels'].textContent, '3');
  assert.equal(env.elements['reconnect-json'].hidden, false);
  await env.elements['reconnect-json'].click();
  assert.equal(env.elements['reconnect-json'].hidden, true);
  assert.equal(Model.today(handle.contents()).reels, 3);
});

test('standalone file input works without direct file access APIs', async () => {
  const env = dashboard(undefined, { standalone: true });
  await settle();
  await env.elements['json-input'].listeners.change({ target: { files: [{ name: 'history.json', text: async () => JSON.stringify(history()) }] } });
  assert.equal(env.elements['total-reels'].textContent, '3');
  assert.equal(env.elements['file-name'].textContent, 'history.json');
  assert.match(env.elements['file-hint'].textContent, /snapshot/);
});

test('dashboard assets and settings hyperlink work directly from local paths', () => {
  const dir = path.join(__dirname, '../dashboard');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  for (const [, asset] of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
    assert.ok(fs.existsSync(path.resolve(dir, asset)), `Missing asset: ${asset}`);
  }
  const popup = fs.readFileSync(path.join(__dirname, '../popup.html'), 'utf8');
  assert.match(popup, /href="dashboard\/index.html"/);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
  assert.equal(manifest.host_permissions, undefined);
  assert.ok(!manifest.permissions.includes('alarms'));
});
