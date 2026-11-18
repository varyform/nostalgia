# Nostalgia

Remakes of DOS-era games, one HTML file each. Players need no install and no assets: art and sound are made in code.

Game sources and shared modules live here and compile into `dist/`: one self-contained HTML file per game version, with
no external assets. `dist/index.html` is the launcher, a DOS-style menu with live previews of every game.

## Games

| Source           | Game     | In the spirit of       | Compiled                                                   |
| ---------------- | -------- | ---------------------- | ---------------------------------------------------------- |
| `games/skyhook`  | Skyhook  | Striker (1985)         | `dist/skyhook-cga.html` (CGA), `dist/skyhook-hd.html` (HD) |
| `games/dropzone` | Dropzone | Airborne Ranger (1988) | `dist/dropzone.html`                                       |

## Play

Open `dist/index.html` in a desktop or mobile browser (or any game's file directly).

| Key            | Action                  |
| -------------- | ----------------------- |
| `↑` `↓`, `1–9` | Select a game           |
| `←` `→`        | Switch version (CGA/HD) |
| `Enter`        | Run                     |
| `F1`           | Help                    |
| `F2` / `M`     | Sound on/off            |
| `F3` / `C`     | Scanlines on/off        |
| `F10` / `Q`    | Exit to DOS             |

Mouse and touch work too: click a game to select it, double-click or press **Run** to start it. With a gamepad: d-pad
selects, A / ✕ runs, and the key hints turn into the pad's buttons.

## Layout

| Path              | What                                                          |
| ----------------- | ------------------------------------------------------------- |
| `games/<game>/`   | Game sources: one HTML page per version + `src/*.js`          |
| `launcher/`       | Launcher source                                               |
| `packages/input/` | `@nostalgia/input`, the shared input module (below)           |
| `pages.config.js` | Every page: its source entry and the compiled file it becomes |
| `dist/`           | Compiled pages, committed: one HTML file per game version     |

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

## Adding a game

1. Put its sources in `games/<game>/`.
2. Add its pages to `pages.config.js` (source entry → `dist/<game>.html`).
3. Add an entry to `GAMES` in `launcher/src/main.js`: executable name, versions (page + preview scene), controls and
   blurb. Optionally draw a preview in `SCENES`: it gets a 2D context and the time in seconds and draws a 320×200 frame
   (`mode: 'cga'` renders at real resolution and scales up with hard pixels; `'hd'` draws vectors at native resolution).
