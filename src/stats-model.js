// Shared history model for the extension worker, counter, and offline dashboard.
(function (root) {
  'use strict';

  function dayKey(timestamp = Date.now()) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function validDay(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    const date = new Date(`${key}T12:00:00`);
    return Number.isFinite(date.getTime()) && dayKey(date.getTime()) === key;
  }

  function emptyStats() { return { version: 1, sessions: {}, updatedAt: 0 }; }

  function createSession(id, timestamp) {
    return { id, startedAt: timestamp, updatedAt: timestamp, endedAt: null,
      days: { [dayKey(timestamp)]: { reels: 0, watchMs: 0 } } };
  }

  function addReel(session, timestamp) {
    const key = dayKey(timestamp);
    session.days[key] ||= { reels: 0, watchMs: 0 };
    session.days[key].reels += 1;
    session.updatedAt = timestamp;
  }

  function addWatchTime(session, from, to) {
    while (from < to) {
      const key = dayKey(from);
      const nextDay = new Date(from);
      nextDay.setHours(24, 0, 0, 0);
      const end = Math.min(to, nextDay.getTime());
      session.days[key] ||= { reels: 0, watchMs: 0 };
      session.days[key].watchMs += end - from;
      from = end;
    }
    session.updatedAt = Math.max(session.updatedAt, to);
  }

  function validateSession(value) {
    if (!value || typeof value.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.id) ||
        ['constructor', 'prototype'].includes(value.id) ||
        !Number.isSafeInteger(value.startedAt) || value.startedAt < 0 ||
        !Number.isSafeInteger(value.updatedAt) || value.updatedAt < value.startedAt ||
        (value.endedAt !== null && (!Number.isSafeInteger(value.endedAt) || value.endedAt < value.startedAt)) ||
        !value.days || typeof value.days !== 'object' || Array.isArray(value.days)) {
      throw new Error('Invalid session');
    }
    const days = {};
    const entries = Object.entries(value.days);
    if (entries.length === 0 || entries.length > 3660) throw new Error('Invalid session dates');
    for (const [key, totals] of entries) {
      if (!validDay(key) || !totals || !Number.isSafeInteger(totals.reels) || totals.reels < 0 ||
          !Number.isSafeInteger(totals.watchMs) || totals.watchMs < 0) throw new Error('Invalid daily totals');
      days[key] = { reels: totals.reels, watchMs: totals.watchMs };
    }
    return { id: value.id, startedAt: value.startedAt, updatedAt: value.updatedAt, endedAt: value.endedAt, days };
  }

  // Snapshots contain cumulative totals, so retries and out-of-order delivery
  // merge without double-counting. The worker serializes writes across tabs.
  function mergeStats(stored, incoming) {
    const result = { version: 1, sessions: { ...(stored?.sessions || {}) }, updatedAt: stored?.updatedAt || 0 };
    for (const value of incoming) {
      const session = validateSession(value);
      const previous = Object.hasOwn(result.sessions, session.id) ? result.sessions[session.id] : null;
      if (previous) {
        if (previous.startedAt !== session.startedAt) throw new Error('Conflicting session ID');
        const days = { ...previous.days };
        for (const [key, totals] of Object.entries(session.days)) {
          days[key] = { reels: Math.max(days[key]?.reels || 0, totals.reels),
            watchMs: Math.max(days[key]?.watchMs || 0, totals.watchMs) };
        }
        session.days = days;
        session.updatedAt = Math.max(previous.updatedAt, session.updatedAt);
        session.endedAt = previous.endedAt === null && session.endedAt === null ? null
          : Math.max(previous.endedAt || 0, session.endedAt || 0);
      }
      result.sessions[session.id] = session;
      result.updatedAt = Math.max(result.updatedAt, session.updatedAt);
    }
    return result;
  }

  function dailyTotals(stats) {
    const totals = {};
    for (const session of Object.values(stats.sessions || {})) {
      for (const [date, day] of Object.entries(session.days)) {
        totals[date] ||= { date, reels: 0, watchMs: 0, sessions: 0 };
        totals[date].reels += day.reels;
        totals[date].watchMs += day.watchMs;
        totals[date].sessions += 1;
      }
    }
    return totals;
  }

  function today(stats, timestamp = Date.now()) {
    const key = dayKey(timestamp);
    return dailyTotals(stats)[key] || { date: key, reels: 0, watchMs: 0, sessions: 0 };
  }

  function dateBefore(key, days) {
    const date = new Date(`${key}T12:00:00`);
    date.setDate(date.getDate() - days);
    return dayKey(date.getTime());
  }

  function summary(stats, range, end = dayKey()) {
    if (!['7', '30', 'all'].includes(String(range)) || !validDay(end)) throw new Error('Invalid date range');
    const totals = dailyTotals(stats);
    const first = Object.keys(totals).filter(key => key <= end).sort()[0] || end;
    const start = String(range) === 'all' ? first : dateBefore(end, Number(range) - 1);
    const days = [];
    for (let key = start; key <= end; key = dateBefore(key, -1)) {
      days.push(totals[key] || { date: key, reels: 0, watchMs: 0, sessions: 0 });
    }
    const sessions = Object.values(stats.sessions || {}).filter(session =>
      Object.keys(session.days).some(key => key >= start && key <= end));
    const reels = days.reduce((sum, day) => sum + day.reels, 0);
    const watchMs = days.reduce((sum, day) => sum + day.watchMs, 0);
    const weekdays = Array.from({ length: 7 }, (_, weekday) => ({ weekday, reels: 0, watchMs: 0, days: 0 }));
    for (const day of days) {
      const weekday = new Date(`${day.date}T12:00:00`).getDay();
      weekdays[weekday].reels += day.reels;
      weekdays[weekday].watchMs += day.watchMs;
      weekdays[weekday].days += 1;
    }
    return { range: String(range), start, end, days, weekdays,
      totals: { reels, watchMs, sessions: sessions.length, averageReels: reels / days.length,
        averageSessionMs: sessions.length ? watchMs / sessions.length : 0 },
      today: totals[end] || { date: end, reels: 0, watchMs: 0, sessions: 0 }, updatedAt: stats.updatedAt };
  }

  const api = { dayKey, validDay, emptyStats, createSession, addReel, addWatchTime, validateSession,
    mergeStats, dailyTotals, today, summary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RRStats = api;
})(globalThis);
