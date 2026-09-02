# Instagram Reel Rotator 🔄

A Chrome extension that lets you rotate and focus landscape Instagram Reels on desktop — just like rotating your phone.

## The Problem

Landscape videos on Instagram Reels look tiny and sideways on desktop. You can't rotate your monitor like you'd rotate your phone.

## Install

1. Download/clone this folder
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select this folder
6. Go to [instagram.com/reels](https://instagram.com/reels) — done!

## Usage

| Key | Action |
|-----|--------|
| `R` | Rotate video 90° counter-clockwise |
| `F` | Focus mode — video goes fullscreen with dark backdrop |
| `Esc`,  `F` | Exit focus mode |
| `W` | Previous reel — **while in focus mode** *(rebindable)* |
| `A` | Next reel — **while in focus mode** *(rebindable)* |
| `Q` | React (like / unlike) the active reel |
| `S` | Open Instagram's share dialog |
| `C` | Open comments |

### Focus-mode-only shortcuts (default, not rebindable)

These always work the same way inside focus mode and don't appear in Settings:

| Key | Action |
|-----|--------|
| `↑` | Previous reel |
| `↓` | Next reel |
| `Space` | Pause / resume |
| `Esc` | Exit focus mode |

### Always-on shortcuts (default, not rebindable)

| Key | Action |
|-----|--------|
| `M` | Mute / unmute the active video — works in **both** focus mode and the normal feed |

The user's mute preference is remembered across pause/play and reel changes — so if you unmute with `M`, that preference sticks on the next reel and after a Space pause/resume.

You can also click the ↻ button at the bottom-right, or click the dark backdrop to exit focus mode.

In focus mode you can also scroll with the **mouse wheel or trackpad** to move between reels — you stay in focus mode instead of being kicked out. One scroll gesture moves one reel, and your rotation carries over to the next one.

Outside focus mode, scrolling to the next reel resets rotation automatically.

The video is automatically sized to **fill the viewport** as much as possible while remaining fully visible — at any rotation, no black bars, no overflow.

## Customizing Shortcuts

Click the **Reel Rotator** icon in your Chrome toolbar to open Settings. Each shortcut can be rebound to a different letter; changes apply instantly on the Instagram tab — no reload needed. Use **Reset to defaults** to restore the original bindings.

Default rebindable bindings:

| Action | Default |
|---|---|
| Rotate | R |
| Focus mode | F |
| Previous reel (focus) | W |
| Next reel (focus) | A |
| React (like) | Q |
| Send | S |
| Comment | C |

## Project Structure

```
reel-rotator-ext/
├── manifest.json          # MV3 manifest, declares split content scripts
├── content.js             # Thin orchestrator (init + event wiring)
├── popup.html / .js / .css # Settings popup (opened via toolbar icon)
├── styles.css             # On-page styles (rotate button, focus backdrop)
├── src/
│   ├── state.js           # Single source of truth: rotation/focus/nav state
│   ├── dom-utils.js       # findActiveVideo, findScrollContainer, clickReelButton
│   ├── rotation.js        # handleRotate, applyRotation, applyRotationInFocus
│   ├── focus.js           # Focus mode + scroll-driven reel navigation
│   ├── actions.js         # reactLike, openSend, openComment
│   ├── ui.js              # Button creation + observer setup
│   └── keymap.js          # Keyboard dispatcher, storage hydration, live updates
└── icons/                 # 16/48/128px toolbar & store icons
```

Every module attaches itself to a single shared namespace (`window.__reelRotator`), loaded in dependency order declared in `manifest.json`. This keeps each file focused on one responsibility while sharing state without globals leaking.
