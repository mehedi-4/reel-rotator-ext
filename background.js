// ─── background.js ─────────────────────────────────────────────────
// Service worker: performs downloads on behalf of the content script.
//
// Why here and not in the page? cdninstagram.com URLs are cross-origin
// from instagram.com — a page-context fetch() is CORS-blocked and the
// anchor `download` attribute is ignored cross-origin. The downloads
// API has no such restriction (it's how Chrome's own "Download video"
// context-menu item works).

importScripts('src/stats-model.js', 'src/stats-file.js', 'src/stats-background.js');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'RR_DOWNLOAD') return false;

  (async () => {
    try {
      // Grab a filename the browser accepts (no slashes, sane length).
      const safe = String(msg.filename || 'instagram-reel.mp4')
        .replace(/[\/\\]+/g, '_')
        .slice(0, 120);
      const downloadId = await chrome.downloads.download({
        url: msg.url,
        filename: safe,
        saveAs: false,
      });
      sendResponse({ ok: true, downloadId });
    } catch (err) {
      sendResponse({ ok: false, error: String(err && err.message || err) });
    }
  })();

  return true; // async sendResponse
});
