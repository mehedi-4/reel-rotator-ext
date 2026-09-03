# Instagram Reel Rotator 🔄

A Chrome / Brave extension that lets you rotate and focus landscape Instagram Reels on desktop — just like rotating your phone. Also adds keyboard shortcuts for common Reels actions (like, rotate, focus, navigate, mute, pause).

## The Problem

Landscape videos on Instagram Reels look tiny and sideways on desktop. You can't rotate your monitor like you'd rotate your phone.

## Features

- **Rotate any Reel** 90° counter-clockwise (R) or clockwise (E) per press (cycles back to 0° after a full turn).
- **Focus mode** — a dark blurred backdrop with the video centered, fit to the viewport at any rotation.
- **Reel navigation** — W/S keys, arrow keys, mouse wheel, or trackpad (in both focus mode and normal feed). Rotation carries over to the next reel.
- **Media controls** in focus mode — Space pauses, M mutes.
- **Native Instagram like from the keyboard** — Q likes/unlikes the active reel.
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

### Always-on shortcuts (not rebindable)

| Key | Mode | Action |
|-----|------|--------|
| `M` | Anywhere | Mute / unmute the active video |
| `Space` | Focus only | Pause / resume |
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
├── styles.css             # On-page styles (rotate button, focus backdrop)
├── src/
│   ├── state.js           # Single source of truth: rotation/focus/nav state
│   ├── dom-utils.js       # findActiveVideo, findScrollContainer, clickReelButton
│   ├── rotation.js        # handleRotate, applyRotation, applyRotationInFocus
│   ├── focus.js           # Focus mode + scroll-driven reel navigation
│   ├── actions.js         # reactLike, openSend, openComment
│   ├── ui.js              # Button creation + observer setup
│   └── keymap.js          # Keyboard dispatcher + storage hydration + live updates
└── icons/                 # 16/48/128px toolbar & store icons
```

Every module attaches itself to a single shared namespace (`window.__reelRotator`), loaded in dependency order declared in `manifest.json`. This keeps each file focused on one responsibility while sharing state without leaking globals into the page.

### Key bug fixes in this build

- **Rotation in focus mode** no longer overflows the viewport. A new `applyRotationInFocus` reuses the focus-mode layout (fixed centering + swapped dimensions at 90°/270°).
- **4th rotation press** correctly wraps to 0° without leaving the video at swapped dimensions.
- **Like/Send/Comment in focus mode** find the buttons in the original reel container (`S.focusSavedStyles._origParent`), not in the lifted video's ancestors.
- **Pause/play in focus mode** uses capture-phase keydown with `stopImmediatePropagation` so Instagram's "Space = next reel" doesn't override.
- **Mute stickiness** — `userMuted` preference is re-asserted after pause/play and reel navigation via a per-video capture-phase `play` listener (scoped to the focused video only, so background reels aren't affected).

## License

This project is for personal use. Instagram™ is a trademark of Meta Platforms, Inc.; this extension is not affiliated with or endorsed by Instagram.

