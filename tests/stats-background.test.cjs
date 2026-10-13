const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const Model = require('../src/stats-model.js');

const time = new Date(2026, 9, 14, 12).getTime();
function snapshot(id) {
  const session = Model.createSession(id, time);
  Model.addReel(session, time);
  return session;
}
function worker(stored = {}, writeFile = async () => ({ state: 'saved', name: 'history.json' })) {
  const handlers = {}, storageListeners = [];
  const chrome = {
    runtime: { id: 'extension-id', getURL: path => `chrome-extension://extension-id/${path}`,
      onMessage: { addListener: listener => { handlers.message = listener; } },
      onStartup: { addListener: listener => { handlers.startup = listener; } },
    },
    storage: {
      local: {
        get: async defaults => JSON.parse(JSON.stringify({ ...defaults, ...stored })),
        set: async update => {
          // Interleave concurrent tabs to exercise the worker's write queue.
          await new Promise(resolve => setImmediate(resolve));
          Object.assign(stored, JSON.parse(JSON.stringify(update)));
          storageListeners.forEach(listener => listener(Object.fromEntries(
            Object.entries(update).map(([key, newValue]) => [key, { newValue }])
          ), 'local'));
        },
      },
      onChanged: { addListener: listener => storageListeners.push(listener) },
    },
  };
  const context = vm.createContext({ chrome, RRStats: Model, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/stats-file.js'), 'utf8'), context);
  context.RRStatsFile.getHandle = async () => ({ name: 'history.json' });
  context.RRStatsFile.write = writeFile;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/stats-background.js'), 'utf8'), context);
  function dispatch(message) {
    return new Promise(resolve => {
      assert.equal(handlers.message(message, { id: chrome.runtime.id, url: chrome.runtime.getURL('dashboard/index.html') }, resolve), true);
    });
  }
  return { stored, dispatch, handlers, chrome };
}

test('history survives a worker restart even if the JSON file is unavailable', async () => {
  const stored = {};
  const first = worker(stored, async () => { throw new Error('File disconnected'); });
  const result = await first.dispatch({ type: 'RR_STATS_RECORD', snapshot: snapshot('session-a') });
  assert.equal(result.ok, true);
  const saved = await first.dispatch({ type: 'RR_STATS_FILE_SAVE' });
  assert.equal(saved.file.state, 'error');
  const restarted = worker(stored);
  const recovered = await restarted.dispatch({ type: 'RR_STATS_GET' });
  assert.equal(Model.today(recovered.stats, time).reels, 1);
});

test('simultaneous tabs and duplicate snapshots retain every daily count', async () => {
  const env = worker();
  const a = snapshot('session-a'), b = snapshot('session-b');
  await Promise.all([env.dispatch({ type: 'RR_STATS_RECORD', snapshot: a }),
    env.dispatch({ type: 'RR_STATS_RECORD', snapshot: b }), env.dispatch({ type: 'RR_STATS_RECORD', snapshot: a })]);
  assert.equal(Model.today(env.stored.reelStats, time).reels, 2);
});

test('imported JSON history merges with existing records without double-counting', async () => {
  const env = worker();
  await env.dispatch({ type: 'RR_STATS_RECORD', snapshot: snapshot('session-a') });
  const history = Model.mergeStats(Model.emptyStats(), [snapshot('session-a'), snapshot('older-session')]);
  await env.dispatch({ type: 'RR_STATS_IMPORT', history });
  await env.dispatch({ type: 'RR_STATS_IMPORT', history });
  assert.equal(Model.today(env.stored.reelStats, time).reels, 2);
  const invalid = await env.dispatch({ type: 'RR_STATS_IMPORT', history: { version: 1, sessions: { broken: {} } } });
  assert.equal(invalid.ok, false);
  assert.equal(Model.today(env.stored.reelStats, time).reels, 2);
});

test('records arriving during a file write are saved afterward without concurrent writers', async () => {
  let persisted, release, began;
  const started = new Promise(resolve => { began = resolve; });
  let first = true, active = 0, maxActive = 0;
  const env = worker({}, async (_, stats, limit) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (first) { first = false; began(); await new Promise(resolve => { release = resolve; }); }
    assert.equal(limit, 50);
    persisted = stats;
    active -= 1;
    return { state: 'saved' };
  });
  await env.dispatch({ type: 'RR_STATS_RECORD', snapshot: snapshot('session-a') });
  await started;
  await env.dispatch({ type: 'RR_STATS_RECORD', snapshot: snapshot('session-b') });
  release();
  const result = await env.dispatch({ type: 'RR_STATS_FILE_SAVE' });
  assert.equal(result.file.state, 'saved');
  assert.equal(Model.today(persisted, time).reels, 2);
  assert.equal(maxActive, 1);
});

test('revoked file permissions preserve extension history and allow retry', async () => {
  let allowed = false, persisted;
  const env = worker({}, async (_, stats) => {
    if (!allowed) return { state: 'permission' };
    persisted = stats;
    return { state: 'saved' };
  });
  await env.dispatch({ type: 'RR_STATS_RECORD', snapshot: snapshot('session-a') });
  assert.equal((await env.dispatch({ type: 'RR_STATS_FILE_SAVE' })).file.state, 'permission');
  allowed = true;
  await env.dispatch({ type: 'RR_STATS_FILE_SAVE' });
  assert.equal(Model.today(persisted, time).reels, 1);
});

test('foreign extensions and Instagram cannot use bulk import or file controls', () => {
  const env = worker();
  assert.equal(env.handlers.message({ type: 'RR_STATS_RECORD', snapshot: snapshot('session-a') }, { id: 'foreign-extension' }, () => {}), false);
  assert.equal(env.handlers.message({ type: 'RR_STATS_FILE_SAVE' }, { id: env.chrome.runtime.id, url: 'https://www.instagram.com/reels/' }, () => {}), false);
});
