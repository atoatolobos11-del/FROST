# ❄️ Frost Breakout

A neon-frost reimagining of the classic **Breakout** arcade game, built with
**HTML5 Canvas + CSS3 + Vanilla JavaScript**. No frameworks, no build step, no
dependencies.

> *A futuristic frozen arcade machine at the edge of the arctic.*

![no build step](https://img.shields.io/badge/build-none-57e6ff) ![no dependencies](https://img.shields.io/badge/deps-0-9d7cff) ![license](https://img.shields.io/badge/license-MIT-ffd479)

---

## ▶ Play

**Option 1 — just open it.** Double-click `index.html` (or drag it into a
browser). Everything works: gameplay, effects, and sound via the built-in
synth. The only difference is that browsers refuse to `fetch()` local files
over `file://`, so the game skips the optional WAV samples and uses its
synthesised voices instead.

**Option 2 — serve it (recommended).** Gives you the authored WAV samples:

```bash
cd frost-breakout
node tools/serve.mjs          # -> http://localhost:8080
node tools/serve.mjs 3000     # or pick your own port
```

No install needed — `tools/serve.mjs` is a dependency-free static server that
binds all interfaces and prints both the localhost and LAN URLs. `npx serve .`
or `python -m http.server 8000` work just as well.

### 📱 Playing on your phone

Keep the server running and, with the phone on the **same Wi-Fi network**,
open the printed LAN URL (e.g. `http://192.168.1.20:8080`).

- The server must stay open — closing the terminal stops it.
- If the page won't load, the port is likely blocked by the firewall; allow
  Node.js through on your network profile.
- Phones block "insecure" mixed content, so use `http://`, not `https://`.
- On-screen controls appear automatically at phone widths; drag anywhere on
  the arena to move the paddle, tap to launch.

## 🎮 Controls

| Action                | Keyboard                        | Touch / Mouse                    |
| --------------------- | ------------------------------- | -------------------------------- |
| Move paddle           | `←` `→` or `A` `D`              | drag anywhere on the arena       |
| Launch / confirm      | `Space` / `Enter`                | tap the arena, or the ❄️ button  |
| Pause / resume        | `P` or `Esc`                    | ❚❚ button                        |
| Restart               | `R`                             | ↻ button                         |
| Mute / unmute         | `M` (choice is remembered)      | 🔊 button                        |
| Fullscreen            | `F`                             | ⛶ button                         |
| Quit to menu          | —                               | red Quit button on pause / end screens |
| Frost Arcade          | —                               | 🏪 button opens the game selector |

On phones and tablets an on-screen control bar appears automatically.

## 🕹️ Frost Arcade (`games/shell.html`)

The same project also ships a mini arcade with **5 extra games** sharing one
audio/particle/storage engine (`games/shared/`):

| Game | Controls |
| ---- | -------- |
| 🏓 Frost Pong | `W`/`S` + `↑`/`↓`, drag each half on touch, `1`/`2` toggle AI |
| 🐍 Frost Snake | arrows / swipe, `Space` or tap to start |
| ☄️ Frost Asteroids | arrows/`WASD` + `Space`, or touch to steer + autofire |
| 🎱 Frost Pinball | `←`/`→` or `A`/`D` flippers, `Space` plunger, touch halves |
| 🏀 Frost Hoops | `←`/`→` move, `↑` jump, `Space` shoot/steal, touch pad |

Open `games/shell.html` (or the 🏪 button in-game) for the selector; the 🏠
button returns to it at any time.

## ✨ Features

**Gameplay**

- 8 hand-tuned levels, each with its own silhouette (shelf → pyramid → tides →
  fortress → diamond core → aurora cross → cathedral → finale)
- 5 block types: glacier (1 hit), frost (2), pack ice (3), ember (2, violet
  cracks), bedrock (indestructible) — all with procedural crack generation
- Ball speed, drop rates and brick toughness scale per level
- 5 power-ups: ❄️ Multi Ball · 🧊 Wide Paddle · ⚡ Frost Dash · 💎 Bonus Score ·
  🛡️ Frost Shield (absorbs one fall)
- Combo multiplier (up to ×5) for chaining blocks without touching the paddle
- 3 lives, per-level clear bonus, persistent best score in `localStorage`
- Game states: start screen → playing → pause → level clear → victory / game over

**Presentation**

- Dark arctic palette with breathing aurora, starfield, hex frost lattice and
  distant ice ridges
- Parallax snow, drifting background crystals, arena icicles that shimmer,
  pulsing frost corners and cold floor mist
- Frost-shaded paddle with travelling energy line, end-cap glow and frost spikes
- Fireball with burning core, flame licks, ember sparks and additive fire trail
- Translucent blocks with glowing edges, animated sheen sweep and hit flashes
- Shatter bursts: crystal shards, sparks, mist, expanding rings, glints,
  floating score text
- Screen shake, colour flashes, camera-ready CRT/scanline overlay
- Fully responsive, DPI-aware rendering (`devicePixelRatio` up to 2.5×)

**Audio**

- 10 procedurally synthesised effects (WebAudio) *and* optional WAV samples in
  `assets/sounds/` — the engine prefers samples, falls back to synthesis
- Mute/unmute button, persisted choice, master gain through a compressor

## 📁 Project structure

```
frost-breakout/
├── index.html              # markup + HUD + overlay screens
├── style.css               # tokens, layout, panels, responsive rules
├── extras.css              # settings/levels/stats/achievements/howto/toasts
├── script.js               # engine: audio, entities, physics, renderer, input
├── extras.js               # meta systems: settings, stats, achievements, modes, share
├── editor.html             # visual level editor → saves to localStorage
├── manifest.webmanifest    # PWA install metadata
├── sw.js                   # offline-first service worker
├── assets/icons/           # generated PWA icons (192/512/maskable)
├── games/
│   ├── shell.html          # Frost Arcade selector + search/favs/recent/bests
│   ├── shared/             # FrostShared (audio/particles/storage/input),
│   │                       # gameshell loader, arcade.css
│   ├── frost-pong/         # 2P/AI pong module
│   ├── frost-snake/        # snake module
│   ├── frost-asteroids/    # asteroids module
│   ├── frost-pinball/      # pinball module
│   └── frost-hoops/        # flick basketball shootout
├── tools/
│   ├── serve.mjs            # dependency-free local static server
│   └── generate-sounds.mjs  # dependency-free WAV generator
└── assets/
    ├── sounds/             # 10 generated .wav effects (+ README)
    └── images/             # intentionally empty — everything is drawn (+ README)
```

## 🆕 Meta systems (`extras.js` + `editor.html` + PWA)

- **Settings** (⚙ in HUD + menu): difficulty Chill/Normal/Blizzard, volume slider,
  toggles for screen shake / particles / flashes. Stored in
  `frost-breakout:settings`, applied live to `Sound` + renderer.
- **Stats**: per-level bests, per-mode bests (classic/daily/endless/custom),
  total runs/bricks/power-ups/wins/best combo. Stored in `frost-breakout:meta`.
- **Level select + Continue**: progressive unlock (maxLevel), autosave run to
  `frost-breakout:run` on every level load, Continue button on menu.
- **How to Play**: in-menu 5-step manual overlay.
- **PWA**: `manifest.webmanifest` + `sw.js` offline cache + generated icons.
  Install via browser menu; works offline after first load.
- **Achievements**: 14 trophies (`frost-breakout:ach`) with toast popups,
  driven by `fb:brick/powerup/level/levelclear/victory/shield` events from `script.js`.
- **Daily / Endless / Custom**: mode buttons on menu. Daily seed = YYYYMMDD,
  Endless generates `ENDLESS n` stages, Custom plays `frost-breakout:custom`
  built in `editor.html` (`index.html?play=custom`).
- **Share**: Web Share API → clipboard fallback + PNG snapshot download of canvas.
- **Arcade hub**: search, All/Favorites/Recent filters, ★ favorites in
  `frost-arcade:favs`, recent in `frost-arcade:recent`, unified bests
  (breakout merges `frost-breakout:best` + arcade best), deep link `?game=pong`.
- **Level editor**: paint 11-13×5-9 grids, 5 brick types + eraser, sample/fill/clear,
  export/import JSON, Save + Play.

Core hooks in `script.js`: `Sound.setVolume/getVolume`, `difficultyMult()`,
`fxOn()/guardedShake()`, `window` events `fb:*`, `saveRun/loadRun/clearRun`,
`startMode()/continueRun()`, endless/custom level builders.

## 🧩 How `script.js` is organised

| Section | Responsibility |
| ------- | -------------- |
| 00 · Utilities | math helpers, seeded PRNG, rounded-rect paths |
| 01 · Renderer bootstrap | logical resolution, DPR scaling, cached glow sprites |
| 02 · Audio engine | WebAudio synth + optional WAV loader + mute |
| 03 · Game data | brick types, power-ups, 8 level blueprints, layout masks |
| 04 · Entities | `Ball`, `Paddle`, `Brick`, `PowerUp`, particle emitters |
| 05 · World | state machine, level generation, scoring |
| 06 · Simulation | sub-stepped ball physics, collision resolution, rules |
| 07 · Rendering | background → arena → entities → effects → prompts |
| 08 · Input | keyboard, pointer, on-screen touch controls |
| 09 · UI glue | HUD sync, overlays, game loop, boot |

A few implementation notes:

- **Tunnelling-proof physics** — each ball is integrated in sub-steps capped at
  `radius × 0.72`, so nothing squeezes through thin geometry at high speed.
- **Resolution independence** — the game always simulates in a fixed
  `960 × 640` space; the canvas is only scaled for display, so layouts are
  identical on a 4K monitor and a phone.
- **Cheap glow** — radial gradients are pre-rendered into cached sprite canvases
  and composited with `lighter`, instead of paying for `shadowBlur` per frame.
- **Static backdrop cache** — the gradient/stars/lattice/ridges are painted once
  per resize into an offscreen canvas; only snow and aurora redraw per frame.

## ✏️ Tweaking

Everything fun lives at the top of `script.js`:

```js
const W = 960, H = 640;              // logical resolution
const PLAY = { x: 30, y: 34, w: 900, h: 572 };
const START_LIVES = 3;
const MAX_BALLS = 9;

const LEVELS = [                      // name, layout mask, rows, ball speed, drop chance
  { name: 'GLACIER SHELF',   pattern: 'solid',     rows: 5, speed: 330, drop: 0.085 },
  ...
];
```

Add a level by appending an entry plus a matching mask in `PATTERNS`.

## 📄 License

MIT — free to use in a portfolio, fork, or remix. Attribution appreciated.