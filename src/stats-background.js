// The worker owns durable history writes and the optional JSON file mirror.
(function () {
  'use strict';
  const Model = globalThis.RRStats;
  const File = globalThis.RRStatsFile;
  let writes = Promise.resolve();
  let fileWrites = Promise.resolve();

  function read() {
    return chrome.storage.local.get({ reelStats: Model.emptyStats(), reelCounter: { limit: 50 } });
  }

  function record(snapshots) {
    const result = writes.then(async () => {
      const stored = await read();
      const stats = Model.mergeStats(stored.reelStats, snapshots);
      await chrome.storage.local.set({ reelStats: stats });
      return stats;
    });
    writes = result.catch(() => {});
    return result;
  }

  function mirror() {
    fileWrites = fileWrites.then(async () => {
      try {
        const handle = await File.getHandle();
        if (!handle) return { state: 'unlinked' };
        await writes;
        const stored = await read();
        return await File.write(handle, stored.reelStats, stored.reelCounter?.limit);
      } catch (error) {
        return { state: 'error', error: String(error.message || error) };
      }
    });
    return fileWrites;
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!['RR_STATS_GET', 'RR_STATS_RECORD', 'RR_STATS_IMPORT', 'RR_STATS_FILE_SAVE'].includes(message?.type)) return false;
    if (sender.id !== chrome.runtime.id) return false;
    // File controls and bulk imports are restricted to extension pages.
    if (['RR_STATS_IMPORT', 'RR_STATS_FILE_SAVE'].includes(message.type) &&
        !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
    (async () => {
      try {
        if (message.type === 'RR_STATS_RECORD') {
          const stats = await record([message.snapshot]);
          respond({ ok: true, stats });
          await mirror();
        } else if (message.type === 'RR_STATS_IMPORT') {
          const imported = File.parse(JSON.stringify(message.history));
          const stats = await record(Object.values(imported.stats.sessions));
          respond({ ok: true, stats, file: await mirror() });
        } else {
          const file = message.type === 'RR_STATS_FILE_SAVE' ? await mirror() : null;
          await writes;
          const stored = await read();
          respond({ ok: true, stats: stored.reelStats, file });
        }
      } catch (error) {
        respond({ ok: false, error: String(error.message || error) });
      }
    })();
    return true;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.reelCounter) mirror();
  });
  chrome.runtime.onStartup.addListener(() => { mirror(); });
})();
