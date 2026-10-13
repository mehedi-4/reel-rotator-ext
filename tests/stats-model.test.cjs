const assert = require('node:assert/strict');
const { test } = require('node:test');
const Model = require('../src/stats-model.js');

const start = new Date(2026, 9, 14, 23, 59, 59).getTime();
function session(id = 'session-a') { return Model.createSession(id, start); }

test('watching intervals and reel counts are assigned to the correct local day across midnight', () => {
  const value = session();
  Model.addReel(value, start);
  Model.addWatchTime(value, start, start + 2000);
  Model.addReel(value, start + 2000);
  assert.deepEqual(value.days['2026-10-14'], { reels: 1, watchMs: 1000 });
  assert.deepEqual(value.days['2026-10-15'], { reels: 1, watchMs: 1000 });
});

test('duplicate and out-of-order cumulative snapshots never double-count or lose totals', () => {
  const early = session();
  Model.addReel(early, start);
  const later = JSON.parse(JSON.stringify(early));
  Model.addReel(later, start);
  Model.addWatchTime(later, start, start + 2000);
  later.endedAt = start + 2000;
  let stats = Model.mergeStats(Model.emptyStats(), [later]);
  stats = Model.mergeStats(stats, [early, later, early]);
  assert.equal(Model.today(stats, start).reels, 2);
  assert.equal(stats.sessions[early.id].endedAt, start + 2000);
  assert.equal(Model.today(stats, start + 2000).watchMs, 1000);
});

test('concurrent sessions aggregate into a daily total and preserve prior dates', () => {
  const a = session('session-a'), b = session('session-b');
  Model.addReel(a, start);
  Model.addReel(b, start);
  const stats = Model.mergeStats(Model.emptyStats(), [a, b]);
  assert.equal(Model.today(stats, start).reels, 2);
  assert.equal(Model.today(stats, start).sessions, 2);
  assert.equal(Model.today(stats, start + 2000).reels, 0);
  assert.equal(Model.dailyTotals(stats)['2026-10-14'].reels, 2);
});

test('7-day and 30-day ranges include quiet days and count spanning sessions once', () => {
  const a = session();
  Model.addWatchTime(a, start, start + 2000);
  Model.addReel(a, start + 2000);
  const stats = Model.mergeStats(Model.emptyStats(), [a]);
  for (const range of ['7', '30']) {
    const report = Model.summary(stats, range, '2026-10-15');
    assert.equal(report.days.length, Number(range));
    assert.equal(report.totals.sessions, 1);
    assert.equal(report.totals.reels, 1);
    assert.equal(report.totals.watchMs, 2000);
    assert.equal(report.today.reels, 1);
    assert.equal(report.weekdays.reduce((sum, day) => sum + day.days, 0), Number(range));
  }
});

test('all-time history begins at the earliest recorded day and includes older activity', () => {
  const a = session();
  Model.addReel(a, start);
  const stats = Model.mergeStats(Model.emptyStats(), [a]);
  const report = Model.summary(stats, 'all', '2026-11-14');
  assert.equal(report.start, '2026-10-14');
  assert.equal(report.days.length, 32);
  assert.equal(report.totals.reels, 1);
  assert.equal(Model.summary(stats, '7', '2026-11-14').totals.reels, 0);
});

test('empty history produces an honest zero state for each range', () => {
  for (const range of ['7', '30', 'all']) {
    const report = Model.summary(Model.emptyStats(), range, '2026-10-14');
    assert.equal(report.totals.reels, 0);
    assert.equal(report.totals.watchMs, 0);
    assert.equal(report.totals.sessions, 0);
    assert.equal(report.totals.averageSessionMs, 0);
  }
});

test('invalid snapshots, dates, negative totals, and conflicting IDs cannot overwrite history', () => {
  const value = session();
  for (const bad of [null, { ...value, id: '__proto__' }, { ...value, days: { '2026-02-30': { reels: 1, watchMs: 0 } } },
    { ...value, days: { '2026-10-14': { reels: -1, watchMs: 0 } } }]) {
    assert.throws(() => Model.mergeStats(Model.emptyStats(), [bad]));
  }
  const stats = Model.mergeStats(Model.emptyStats(), [value]);
  assert.throws(() => Model.mergeStats(stats, [{ ...value, startedAt: start - 1 }]));
  assert.throws(() => Model.summary(stats, 'bad'));
});
