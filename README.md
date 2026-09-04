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
- **Customizable shortcuts** — rebind any letter through a toolbar popup. Changes apply live, no reload.
- **Auto-sizing** — at any rotation, the video fills the viewport while staying fully visible.

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

### Rebindable shortcuts

Click the **Reel Rotator** icon in your toolbar to customize. Defaults:

| Key | Action |
|-----|--------|
| `R` | Rotate video 90° counter-clockwise |
| `E` | Rotate video 90° clockwise |
| `F` | Focus mode (toggle) |
| `W` | Previous reel (up) |
| `S` | Next reel (down) |
| `Q` | React (like / unlike) the active reel |
| `V` | Repost the active reel |
| `D` | Add active reel to Queue (plays in right dock) |
| `T` | Toggle audio focus (Queue vs Main Feed) |
| `G` | Hide / unhide Queue section |

### Always-on shortcuts (not rebindable)

| Key | Mode | Action |
|-----|------|--------|
| `M` | Anywhere | Mute / unmute the active video (or queue if hovering over dock) |
| `Space` | Anywhere | Play / pause active video (prevents Instagram reel advance) |
| `↑` | Focus only | Previous reel |
| `↓` | Focus only | Next reel |
| `Esc` | Focus only | Exit focus mode |
| Click backdrop | Focus only | Exit focus mode |

The user's mute preference is remembered across pause/play and reel changes inside focus mode — unmute with `M` and that preference sticks on the next reel and after a Space pause/resume.

### Mouse / trackpad

- **Click ↻ button** (bottom-right) — rotate.
- **Mouse wheel / trackpad** (focus mode) — navigate reels. One gesture = one reel. Rotation carries over.
- **Scroll outside focus mode** — resets rotation.

## Customizing Shortcuts

Click the **Reel Rotator** icon in your Chrome / Brave toolbar to open the Settings popup. Each rebindable shortcut has a letter input; changes apply **instantly** on the Instagram tab — no reload. Use **Reset to defaults** to restore the original bindings.

## Project Structure

```
reel-rotator-ext/
├── manifest.json          # MV3 manifest, declares split content scripts in load order
├── content.js             # Thin orchestrator (~30 lines: init + event wiring)
├── popup.html / .js / .css # Settings popup (opened via toolbar icon)
├── styles.css             # On-page styles (rotate button, focus backdrop, queue dock)
├── src/
│   ├── bridge.js          # MAIN-world script: React Fiber extraction & feed mute enforcement
│   ├── state.js           # Single source of truth: rotation/focus/nav/queue state
│   ├── dom-utils.js       # findActiveVideo, findScrollContainer, clickReelButton
│   ├── rotation.js        # handleRotate, applyRotation, applyRotationInFocus
│   ├── focus.js           # Focus mode + scroll-driven reel navigation
│   ├── actions.js         # reactLike, repost
│   ├── queue.js           # YouTube-style persistent Reels queue, drag & drop, playlist
│   ├── ui.js              # Button creation + observer setup
│   └── keymap.js          # Keyboard dispatcher + storage hydration + live updates
└── icons/                 # 16/48/128px toolbar & store icons
```

Every module attaches itself to a single shared namespace (`window.__reelRotator`), loaded in dependency order declared in `manifest.json`. This keeps each file focused on one responsibility while sharing state without leaking globals into the page.

### Features & Key Fixes in this build

- **Reels Queue Dock (D)**: YouTube-style right side panel to enqueue reels, drag-and-drop reordering, delete, and autoplay next.
- **Scroll Wheel Click (Middle Click)**: Middle-clicking any reel in the queue playlist or the queue player opens that reel directly in a new tab.
- **Playback Coordination**: When a reel in the main feed starts playing (scroll, click, or loop), the queue video automatically pauses.
- **Rotation Memory in Queue**: When adding a rotated reel to the queue (`D`), it remembers its exact rotation and plays at that rotation in the queue.
- **Queue Player Proportions**: Expanded video height in the queue (up to 72vh / 640px) with compact, space-efficient playlist items below.
- **Strict Continuous Feed Muting**: While the queue video plays audio, feed videos stay strictly muted even across scrolling and video loops. Toggle audio focus anytime with `T`.

## License

This project is for personal use. Instagram™ is a trademark of Meta Platforms, Inc.; this extension is not affiliated with or endorsed by Instagram.

