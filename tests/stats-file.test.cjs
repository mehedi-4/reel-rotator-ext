const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const Model = require('../src/stats-model.js');

function fileApi(indexedDB) {
  const context = vm.createContext({ RRStats: Model, indexedDB });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/stats-file.js'), 'utf8'), context);
  return context.RRStatsFile;
}

function database() {
  const records = new Map();
  const db = {
    createObjectStore() {},
    transaction() {
      const transaction = {};
      transaction.objectStore = () => ({
        get: key => {
          const request = { result: records.get(key) };
          setImmediate(() => transaction.oncomplete());
          return request;
        },
        put: (value, key) => {
          const request = { result: key };
          setImmediate(() => { records.set(key, value); transaction.oncomplete(); });
          return request;
        },
      });
      return transaction;
    },
  };
  return { open: () => {
    const request = { result: db };
    setImmediate(() => { request.onupgradeneeded(); request.onsuccess(); });
    return request;
  } };
}

function history() {
  const now = Date.now();
  const session = Model.createSession('session-a', now);
  Model.addReel(session, now);
  return Model.mergeStats(Model.emptyStats(), [session]);
}

test('the selected JSON file handle survives a dashboard or worker restart', async () => {
  const db = database();
  const first = fileApi(db);
  const handle = { name: 'reel-history.json' };
  assert.equal(await first.getHandle(), null);
  await first.setHandle(handle);
  const restarted = fileApi(db);
  assert.equal(await restarted.getHandle(), handle);
});

test('saved JSON retains history and the daily limit and can be read back by the page', async () => {
  const api = fileApi();
  const stats = history();
  let contents, pending, closed = false;
  const handle = {
    name: 'reel-history.json', queryPermission: async () => 'granted',
    createWritable: async () => ({ write: async text => { pending = text; }, close: async () => { closed = true; contents = pending; } }),
    getFile: async () => ({ text: async () => contents }),
  };
  const result = await api.write(handle, stats, 75);
  assert.equal(result.state, 'saved');
  assert.equal(closed, true);
  const restored = await api.read(handle);
  assert.equal(restored.dailyLimit, 75);
  assert.equal(Model.today(restored.stats).reels, 1);
});

test('missing file permission never opens a writable stream or requests permission in the worker', async () => {
  const api = fileApi();
  const handle = { name: 'reel-history.json', queryPermission: async () => 'prompt',
    createWritable: () => { assert.fail('Cannot write without a grant'); },
    requestPermission: () => { assert.fail('Worker must not request a user gesture'); } };
  assert.equal((await api.write(handle, history(), 50)).state, 'permission');
});

test('a failed file write aborts without committing partial JSON', async () => {
  const api = fileApi();
  let aborted = false;
  const handle = { queryPermission: async () => 'granted', createWritable: async () => ({
    write: async () => { throw new Error('Disk full'); },
    close: async () => { assert.fail('Partial JSON must not be committed'); },
    abort: async () => { aborted = true; },
  }) };
  await assert.rejects(api.write(handle, history(), 50), /Disk full/);
  assert.equal(aborted, true);
});

test('malformed or mismatched imported JSON cannot introduce invalid sessions', () => {
  const api = fileApi();
  for (const value of [{}, { version: 1, sessions: [] }, { ...history(), sessions: { wrong: history().sessions['session-a'] } },
    { version: 1, sessions: { '__proto__': null, bad: { id: 'bad' } } }]) {
    assert.throws(() => api.parse(JSON.stringify(value)));
  }
  assert.equal(api.parse(JSON.stringify({ ...history(), dailyLimit: -5 })).dailyLimit, 50);
});
