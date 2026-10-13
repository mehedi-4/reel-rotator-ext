// A selected file handle is shared by the dashboard and extension worker.
// The worker writes JSON only after the dashboard has obtained permission.
(function (root) {
  'use strict';
  const Model = root.RRStats;
  let database;

  function openDatabase() {
    database ||= new Promise((resolve, reject) => {
      const request = indexedDB.open('reel-history-files', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return database;
  }

  async function handleStore(mode, operation) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('files', mode);
      const request = operation(transaction.objectStore('files'));
      transaction.oncomplete = () => resolve(request.result || null);
      transaction.onabort = transaction.onerror = () => reject(transaction.error || request.error);
    });
  }

  function dailyLimit(value) {
    return Number.isInteger(value) && value >= 1 && value <= 9999 ? value : 50;
  }

  function parse(text) {
    const value = JSON.parse(text);
    if (value?.version !== 1 || !value.sessions || typeof value.sessions !== 'object' || Array.isArray(value.sessions)) {
      throw new Error('Choose a Reel Rotator history JSON file.');
    }
    for (const [id, session] of Object.entries(value.sessions)) {
      if (id !== session?.id) throw new Error('Invalid history session ID.');
    }
    return { stats: Model.mergeStats(Model.emptyStats(), Object.values(value.sessions)), dailyLimit: dailyLimit(value.dailyLimit) };
  }

  function stringify(stats, limit) {
    return JSON.stringify({ ...stats, dailyLimit: dailyLimit(limit) }, null, 2) + '\n';
  }

  async function read(handle) {
    const file = await handle.getFile();
    return parse(await file.text());
  }

  async function write(handle, stats, limit) {
    if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      return { state: 'permission', name: handle.name };
    }
    const writable = await handle.createWritable();
    try {
      await writable.write(stringify(stats, limit));
      await writable.close();
    } catch (error) {
      await writable.abort?.().catch(() => {});
      throw error;
    }
    return { state: 'saved', name: handle.name };
  }

  root.RRStatsFile = {
    getHandle: () => handleStore('readonly', store => store.get('history')),
    setHandle: handle => handleStore('readwrite', store => store.put(handle, 'history')),
    dailyLimit, parse, stringify, read, write,
  };
})(globalThis);
