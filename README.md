# Nostalgia

Remakes of DOS-era games, one HTML file each. Players need no install and no assets: art and sound are made in code.

Game sources and shared modules live here and compile into `dist/`: one self-contained HTML file per game version, with
no external assets. `dist/index.html` is the launcher, a DOS-style menu with live previews of every game.

## Games

| Source           | Game     | In the spirit of          | Compiled                                                   |
| ---------------- | -------- | ------------------------- | ---------------------------------------------------------- |
| `games/keepsake` | Keepsake | Popeye (1982)             | `dist/keepsake.html`                                       |
| `games/brimful`  | Brimful  | Tapper (1983)             | `dist/brimful-cga.html` (CGA), `dist/brimful-hd.html` (HD) |
| `games/glimmer`  | Glimmer  | Lode Runner (1983)        | `dist/glimmer.html`                                        |
| `games/quarry`   | Quarry   | Digger (1983)             | `dist/quarry-cga.html` (CGA), `dist/quarry-hd.html` (HD)   |
| `games/dewdrop`  | Dewdrop  | Nuts & Milk (1984)        | `dist/dewdrop.html`                                        |
| `games/polder`   | Polder   | Xonix (1984)              | `dist/polder.html`                                         |
| `games/skyhook`  | Skyhook  | Striker (1985)            | `dist/skyhook-cga.html` (CGA), `dist/skyhook-hd.html` (HD) |
| `games/spindle`  | Spindle  | Nebulus (1987)            | `dist/spindle.html`                                        |
| `games/dropzone` | Dropzone | Airborne Ranger (1988)    | `dist/dropzone.html`                                       |
| `games/contrail` | Contrail | F29 Retaliator (1989)     | `dist/contrail.html`                                       |
| `games/treeline` | Treeline | LHX Attack Chopper (1990) | `dist/treeline.html`                                       |
| `games/barrage`  | Barrage  | Scorched Earth (1991)     | `dist/barrage.html`                                        |
| `games/triform`  | Triform  | Metal Mutant (1991)       | `dist/triform-vga.html` (VGA), `dist/triform-hd.html` (HD) |
| `games/quintet`  | Quintet  | Color Lines (1992)        | `dist/quintet.html`                                        |

## Play

Open `dist/index.html` in a desktop or mobile browser (or any game's file directly).

| Key            | Action             |
| -------------- | ------------------ |
| `↑` `↓`, `1–9` | Select a game      |
| `←` `→`        | Switch version     |
| `Enter`        | Run                |
| `F1`           | Help               |
| `F2` / `M`     | Sound on/off       |
| `F3` / `C`     | Scanlines on/off   |
| `F4` / `F`     | Full screen on/off |
| `F10` / `Q`    | Exit to DOS        |

Run zooms the game out of its preview. To come back, leave from the game's title screen (Skyhook: `Q` / Select,
Dropzone: `Esc` / B, every other game: `Q` / `Esc` / B) or press the browser's Back button.

Mouse and touch work too: click a game to select it, double-click or press **Run** to start it. With a gamepad: d-pad
selects, A / ✕ runs, and the key hints turn into the pad's buttons.

## Layout

| Path              | What                                                       |
| ----------------- | ---------------------------------------------------------- |
| `games/<game>/`   | A game: `game.json`, one HTML page per version, `src/*.js` |
| `launcher/`       | Launcher source                                            |
| `packages/input/` | `@nostalgia/input`, the shared input module (below)        |
| `packages/audio/` | `@nostalgia/audio`, the shared sound engine (below)        |
| `packages/save/`  | `@nostalgia/save`, the autosave behind CONTINUE (below)    |
| `packages/game/`  | `@nostalgia/game`, the game folder contract (below)        |
| `packages/gl/`    | `@nostalgia/gl`, the WebGL2 engine of the 3D games (below) |
| `dist/`           | Compiled pages, committed: one HTML file per game version  |

## Develop

Tools (Node, pnpm) are pinned in `mise.toml`; tasks run through mise and [Vite+](https://viteplus.dev) (`vp`).

```sh
mise install          # Node + pnpm
mise run dev          # dev server: launcher, every game, and /packages/input/demo.html
mise run build        # compile every page into its game repo (or: mise run build skyhook-hd)
mise run check        # format check, lint, type-check
mise run test         # unit tests
mise run ci           # all of the above
```

Commit `dist/` together with the sources it was built from.

## Deploy

`mise run deploy` (Kamal, `config/deploy.yml`) serves `dist/` with nginx at https://ogg.ol3h.org, from the server
`px.kamal`. Kamal builds the image from the committed HEAD, not the working tree, so build and commit `dist/` first.

## iOS

`mise run ios` builds `ios/` (XcodeGen + xcodebuild) with the current `dist/` inside and runs it on a phone
(`IOS_DEVICE`, a UDID); `mise run ios -- --sim` uses the simulator. One full-screen web view serves the bundled pages
from `nostalgia://localhost/`, offline, with sound through the silent switch.

## Shared input: `@nostalgia/input`

Each game registers its actions with keyboard/mouse and gamepad bindings; the module reads keyboard, mouse buttons and
every connected pad, remembers the device the player used last, and draws the matching key or button (keyboard, Xbox,
PlayStation, Switch, generic pad, touch) in prompts.

```js
import { createInput, drawPrompt } from '@nostalgia/input';

const input = createInput({
  actions: {
    fire: { keys: ['Space', 'KeyZ'], pad: ['South', 'R2'] },
    start: { keys: ['Enter'], pad: ['South', 'Start'], touch: 'Tap' },
  },
  display: { fly: { keys: ['Arrows'], pad: ['LStick'] } },
});

input.update(); // once per fixed step
if (input.pressed('fire')) shoot();
drawPrompt(ctx, input, 'PRESS {start} TO PLAY', 160, 150, { font: '16px sans-serif', align: 'center' });
```

In the DOM, `<input-glyph action="fire"></input-glyph>` renders the same glyph and follows the device. `menuNav()`
makes DOM menus pad-navigable. Pixel-art games pass `style: { pixel: true, … }` so glyphs keep to the palette and use the
game's bitmap font. The full API is documented in `packages/input/src/index.ts`; `/packages/input/demo.html` shows every
glyph.

## Shared audio: `@nostalgia/audio`

Each game's `src/audio.js` holds its score: the tracks, how one 16th step is played, and the effects. The engine makes
the context on the first user gesture, the music and effects buses, a seeded noise buffer, the voices (`tone`, `hiss`,
`fm`, `notes`) and a look-ahead sequencer. Options give pulse-wave duty cycles, a PC-speaker voicing and a music echo.
For richer scores there are `sub` (a punchy, clipped sub bass), `supersaw` (seven detuned saws in stereo), `pulse` (PWM
pulses) and `fm` with an options object (an index envelope), each one note with an ADSR through an enveloped filter
where it has one: `v.supersaw(midi(60), t, dt * 4, 0.08, { cutoff: 2400 })`. Effects go between voices and a bus:
`delay` (a mono echo beside the dry sound), `distortion` (a hard clipper or a wavefolder) and `compressor` (an RMS
AudioWorklet with a soft knee and `makeup: 'auto'`; the browser's compressor where worklets can't run). A score plays
voices into them with `v.insert(ac => [distortion(ac), delay(ac)])` passed as the bus, or puts them on a whole bus with
the synth's `inserts: { music, sfx, master }`: a compressor on `music` evens the tracks out against each other.

```js
import { createSynth, line, midi, span } from '@nostalgia/audio';

const TRACKS = { title: { bpm: 96, lead: line('69 - 72 . 76 - - . 74 . 72 - 71 . . .') } };

export const createAudio = ({ on = true } = {}) =>
  createSynth({
    on,
    seed: 7,
    levels: { master: 0.6, music: 0.32, sfx: 0.7 },
    tracks: TRACKS,
    arrange: v => ({
      // one 16th of a track at context time t
      step(tr, i, t, dt) {
        const n = tr.lead[i % tr.lead.length];
        if (n > 0) v.tone(midi(n), midi(n), t, dt * span(tr.lead, i), 0.08, 'triangle', 'music');
      },
      effects: { jump: t => v.tone(300, 620, t, 0.09, 0.06) }, // audio.sfx('jump')
    }),
  });

audio.unlock(); // from a keydown / pointerdown: makes the context
audio.music('title');
audio.sfx('jump', event);
```

The API is documented in `packages/audio/src/index.ts`; `packages/audio/src/mock.ts` records a run against a fake Web
Audio for tests.

## Autosave: `@nostalgia/save`

Every game keeps one checkpoint and offers CONTINUE on its title while one exists. A checkpoint is what it takes to
begin the current level, tower or round again as it began (stage, score, lives, …), saved when that stage starts and
cleared on game over or when the game is beaten. Quitting mid-stage resumes from the stage's start. Demo mode never
touches it.

```js
import { createAutosave, savedAgo } from '@nostalgia/save';

const autosave = createAutosave('quarry', { enabled: !demo, version: 1 });
autosave.save({ level: 4, score: 12340, lives: 2 }, 'Level 5 · 12,340'); // at each stage's start
const saved = autosave.load(); // { state, label, at } or null → CONTINUE  Level 5 · 12,340  (savedAgo(saved.at))
autosave.clear(); // game over, or the game beaten
```

## 3D: `@nostalgia/gl`

The 3D games (Contrail, Treeline) draw with one small WebGL2 engine: flat-shaded low-poly meshes lit by one sun,
exponential fog into a gradient sky, soft round particles, instanced props (forests of thousands of trees, faded out
by distance, two LODs cross-fading), translucent meshes (rotor discs, glass), ground shadows (a mesh flattened onto the
terrain, or a soft blob), height mist and a thermal view. Its pure helpers — matrices, mesh parts, height-field chunks,
instance data, value noise — import in Node with no DOM, so sims and tools share them.

```js
import { box, builder, createGL, modelOf } from '@nostalgia/gl';
import { fbm } from '@nostalgia/gl/noise'; // DOM-free: also /math, /mesh, /terrain

const R = createGL(canvas, { antialias: !demo, stencil: true }); // null without WebGL2
const B = builder();
box(B, { at: [0, 1, 0] }, [2, 2, 2], '#c8c2b4');
const buf = R.buffer(B.data()); // the mesh is the range [0, B.n]
R.frame(cam, sky); // each frame: clear and sky, then opaque, shadows, translucent, points
R.drawMesh(buf, [0, B.n], modelOf(pos, forward, up));
```

`destroy()` frees only the engine's own objects and keeps the context: the launcher turns a demo into the game on the
same canvas. `@nostalgia/gl/ui` is the 2D HUD helper over the GL canvas. The API is documented in
`packages/gl/src/index.ts`.

## Adding a game

A game is a folder in `games/`; the build and the launcher find it by its `game.json`. Nothing else lists it.

| File           | What                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `game.json`    | Title, executable, original + year, genre, tags, blurb, facts, input bindings, controls the launcher lists, versions |
| `<entry>.html` | One page per version (`versions[].entry`), started through `host()` from `@nostalgia/game/host`                      |

- The game builds its `createInput` from `game.json`'s `input`, so the launcher shows exactly the keys and buttons it
  plays with. `controls` lists `[action, label]` pairs from it.
- Every page has a demo mode, `?demo=on`: an autopilot plays, input is ignored, nothing is saved. `?sound=off` mutes
  it. `host({ demo, play })` starts whichever the URL asks for.
- The launcher previews the selected game as `<iframe src="<page>?demo=on&sound=off">`, scaled down into its preview
  box. Run zooms the frame to full size and posts `play`; the page drops the demo and boots the game in place. Leaving
  from the game's title screen posts `exit`, and the launcher zooms back out (the browser's Back button does too).
- `@nostalgia/game/runtime` has the page plumbing: `listeners()`, the fixed-step `fixedLoop()` (with the still frame
  for reduced motion), `fitWide()` / `fitPixels()` to size the canvas from the window, `storage()` for saved data,
  `toggleFullscreen()` (optionally locking the orientation, with a WebKit-prefixed fallback) and `canvasPoint()`.
- Each version compiles to one file: `dist/<game>.html`, or `dist/<game>-<version>.html` when there are several.
  `mise run build <game>-<version>` builds one.

Types and protocol: `packages/game/src/meta.ts`, `packages/game/src/host.ts`.
