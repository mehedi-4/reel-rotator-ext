# Instagram Reel Rotator 🔄

A Chrome / Brave extension that lets you rotate and focus landscape Instagram Reels on desktop — just like rotating your phone. Also adds keyboard shortcuts for common Reels actions (like, rotate, focus, navigate, mute, pause).

## The Problem

Landscape videos on Instagram Reels look tiny and sideways on desktop. You can't rotate your monitor like you'd rotate your phone.

## Features

- **Rotate any Reel** 90° counter-clockwise (R) or clockwise (E) per press (cycles back to 0° after a full turn).
- **Focus mode** — a dark blurred backdrop with the video centered, fit to the viewport at any rotation.
- **Reel navigation** — W/S keys, arrow keys, mouse wheel, or trackpad (in both focus mode and normal feed). Rotation carries over to the next reel.
- **Media controls** in focus mode — Space pauses, M mutes.
- **Native Instagram actions from the keyboard** — Q likes/unlikes, V reposts the active reel.
- **Customizable shortcuts** — rebind feed controls through the toolbar popup. Changes apply live, no reload.
- **Auto-sizing** — at any rotation, the video fills the viewport while staying fully visible.
- **Daily reel counter** — a compact Dynamic Island pill or circular punchhole shows today's saved reel count and watch time, changing from green through amber to red as you reach a configurable daily limit.
- **Local watching dashboard** — 7-day, 30-day, and all-time graphs show reel counts, watching time, weekday patterns, and daily history. Data stays on your computer.

## Install

### Chrome

1. Download/clone this folder
2. Open `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select this folder
6. Go to [instagram.com/reels](https://instagram.com/reels) — done!

### Brave

Same as Chrome, but use `brave://extensions/` instead of `chrome://extensions/`. If the Reel Rotator icon doesn't appear in your toolbar, click the puzzle-piece / extensions icon and pin it.

> Tip: if rotation doesn't seem to work on Instagram, click the Brave lion icon in the address bar and toggle Shields **Down** for `instagram.com`, then reload.

## Usage

### Keyboard controls

Default controls are listed below. Customize these keys in the extension settings; previously saved bindings continue to work.

| Key | Action |
|-----|--------|
| `R` | Rotate video 90° counter-clockwise |
| `E` | Rotate video 90° clockwise |
| `F` | Focus mode (toggle) |
| `W` | Previous reel (up) |
| `S` | Next reel (down) |
| `Q` | React (like / unlike) the active reel |
| `V` | Repost the active reel |
| `X` | Save the active reel to your Instagram Saved posts |

### Always-on shortcuts (not rebindable)

| Key | Mode | Action |
|-----|------|--------|
| `M` | Anywhere | Mute / unmute the active video |
| `Shift+D` | Anywhere | Download / save the active reel as mp4 |
| `Shift+W` | Anywhere | Volume up 10% (unmutes if muted) |
| `Shift+S` | Anywhere | Volume down 10% — never below 5% |
| `Shift+1` | Anywhere | Playback speed 1× |
| `Shift+2` | Anywhere | Playback speed 1.25× |
| `Shift+3` | Anywhere | Playback speed 1.5× |
| `Shift+4` | Anywhere | Playback speed 2× |
| `Space` | Anywhere | Play / pause active video (prevents Instagram reel advance) |
| `↑` | Focus only | Previous reel |
| `↓` | Focus only | Next reel |
| `Esc` | Focus only | Exit focus mode |
| Click backdrop | Focus only | Exit focus mode |

The user's mute preference is remembered across pause/play and reel changes inside focus mode — unmute with `M` and that preference sticks on the next reel and after a Space pause/resume. Volume and playback-speed preferences behave the same way: once set with `Shift+W`/`Shift+S` or `Shift+1`–`4`, they carry over to the next reel in the feed.

Volume control never touches the mute state on its own — muting is exclusively `M`'s job (raising volume on a muted video unmutes it, though, since that's what "louder" has to mean). `Shift+S` stops at 5% so a quiet reel never drops to inaudible.

### Mouse / trackpad

- **Click ↻ button** (bottom-right) — rotate.
- **Mouse wheel / trackpad** (focus mode) — navigate reels. One gesture = one reel. Rotation carries over.
- **Scroll outside focus mode** — resets rotation.

## Settings

### Reel counter settings

Open the extension popup, choose **Dynamic Island**, **Punchhole**, or **Off**, set a **Daily reel limit** (1–9999; default 50), and click **Save**. Changes apply immediately. The 12px pill displays only today's count and total watch time, such as **12 · 03:45**; the configured limit stays hidden. Both values survive leaving Reels, reloading, and restarting the browser, and reset at **local midnight**. Previous days stay in your history.

The first reel of a session is a starting point; each settled change to another reel counts once, including scrolling back. Pausing and replaying do not add to the count. **Watch time** grows while a visible feed reel plays, including loops and replays of the same reel. It excludes pauses and hidden tabs, and matches today's watching time in the dashboard. Sessions from multiple tabs contribute to the same daily totals; watching time sums their playback time.

The color reaches red at your limit and stays red if you keep scrolling. The limit is a visual reminder; it does not block navigation.

### Local dashboard

Click **Open watching dashboard** in the extension settings. It opens the bundled `dashboard/index.html` page directly, with live history from the extension. No localhost, server, dependency installation, or internet connection is needed for the dashboard. Reload the extension and Instagram tabs after installing this update so recording begins.

The dashboard includes selectable 7-day, 30-day, and all-time ranges, daily reel-count bars, watching-time graphs, weekday averages, summary totals, and a paginated daily-history table. Long histories are grouped by month in the charts; the table keeps exact daily totals. Charts compare historical activity with your **current** daily limit. History starts when this version begins recording; past activity cannot be reconstructed.

The **Help & shortcuts** menu lists all reel, download, volume, playback-speed, focus, and mouse controls. Opened through the extension, it shows your saved custom keys and updates when settings change. The standalone HTML shows the default keys.

For a JSON file on disk, click **Save JSON** in the dashboard and choose where to save `reel-history.json`. In browsers supporting direct file access, the extension remembers your chosen file and updates it whenever activity is saved while file permission remains granted, including with the dashboard closed. The page reads that JSON to render its charts. History also remains in browser storage, so a disconnected file does not lose new activity. If the browser requires file permission again after a restart, click **Reconnect file**. **Open JSON** imports an existing history file, merging records without double-counting.

You can also double-click `dashboard/index.html` and use **Open JSON** to view the chosen history file without opening the extension. This page reloads the file every 15 seconds. The HTML and CSS stay static; the JSON supplies the changing data. Browsers require you to choose a file before a page can access it through the [File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access). When direct file access is unavailable, **Save JSON** downloads a snapshot and **Open JSON** reads an uploaded snapshot instead.

The included `dashboard/history.example.json` is an empty, valid history file. Your actual history begins recording after this update; the dashboard does not invent past activity. The default filename `reel-history.json` is excluded from Git.

Developers can run the focused tests with Node.js 20+ and `npm test`; using the extension or dashboard does not require Node.js.

The settings popup contains keyboard bindings, the counter display, daily limit, and dashboard link. **Save** applies changes immediately. **Reset to defaults** restores keyboard bindings and counter settings, and keeps recorded history.

## Project Structure

```
reel-rotator-ext/
├── manifest.json          # MV3 manifest, declares split content scripts in load order
├── background.js         # Service worker: downloads + durable history and JSON file updates
├── content.js             # Thin orchestrator (~30 lines: init + event wiring)
├── popup.html / .js / .css # Settings popup (opened via toolbar icon)
├── styles.css             # On-page styles (counter, rotate button, focus backdrop, status toast)
├── src/
│   ├── bridge.js          # MAIN-world script: React Fiber extraction and native audio controls
│   ├── state.js           # Single source of truth: rotation/focus/nav state
│   ├── counter-settings.js # Shared counter defaults and settings validation
│   ├── counter.js         # Daily reel count, watch-time capture, and indicator
│   ├── stats-model.js     # Shared daily history, snapshot merging, and date-range aggregation
│   ├── stats-background.js # Serialized storage writes and optional JSON file updates
│   ├── stats-file.js      # JSON validation and the chosen local file handle
│   ├── dom-utils.js       # findActiveVideo, findScrollContainer, clickReelButton
│   ├── rotation.js        # handleRotate, applyRotation, applyRotationInFocus
│   ├── focus.js           # Focus mode + scroll-driven reel navigation
│   ├── actions.js         # reactLike, repost
│   ├── ui.js              # Button creation + observer setup
│   └── keymap.js          # Keyboard dispatcher + storage hydration + live updates
├── dashboard/            # Standalone index.html, charts, styles, and example history JSON
├── tests/                # Counter, persistence, JSON files, model, and dashboard checks
└── icons/                 # 16/48/128px toolbar & store icons
```

Feed controls attach to a shared namespace (`window.__reelRotator`), loaded in dependency order declared in `manifest.json`. The history model is shared as `RRStats` between the counter, service worker, and offline dashboard.

## License

This project is for personal use. Instagram™ is a trademark of Meta Platforms, Inc.; this extension is not affiliated with or endorsed by Instagram.

