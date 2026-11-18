# Nostalgia

Remakes of DOS-era games, one HTML file each. Players need no install and no assets: art and sound are made in code.

Game sources and shared modules live here and compile into `dist/`: one self-contained HTML file per game version, with
no external assets. `dist/index.html` is the launcher, a DOS-style menu with live previews of every game.

## Games

| Source           | Game     | In the spirit of       | Compiled                                                   |
| ---------------- | -------- | ---------------------- | ---------------------------------------------------------- |
| `games/brimful`  | Brimful  | Tapper (1983)          | `dist/brimful-cga.html` (CGA), `dist/brimful-hd.html` (HD) |
| `games/quarry`   | Quarry   | Digger (1983)          | `dist/quarry-cga.html` (CGA), `dist/quarry-hd.html` (HD)   |
| `games/dewdrop`  | Dewdrop  | Nuts & Milk (1984)     | `dist/dewdrop.html`                                        |
| `games/skyhook`  | Skyhook  | Striker (1985)         | `dist/skyhook-cga.html` (CGA), `dist/skyhook-hd.html` (HD) |
| `games/dropzone` | Dropzone | Airborne Ranger (1988) | `dist/dropzone.html`                                       |
| `games/triform`  | Triform  | Metal Mutant (1991)    | `dist/triform-vga.html` (VGA), `dist/triform-hd.html` (HD) |

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
Dropzone: `Esc` / B, Triform, Dewdrop, Quarry and Brimful: `Q` / `Esc` / B) or press the browser's Back button.

Mouse and touch work too: click a game to select it, double-click or press **Run** to start it. With a gamepad: d-pad
selects, A / ✕ runs, and the key hints turn into the pad's buttons.

## Layout

| Path              | What                                                       |
| ----------------- | ---------------------------------------------------------- |
| `games/<game>/`   | A game: `game.json`, one HTML page per version, `src/*.js` |
| `launcher/`       | Launcher source                                            |
| `packages/input/` | `@nostalgia/input`, the shared input module (below)        |
| `packages/game/`  | `@nostalgia/game`, the game folder contract (below)        |
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
- Each version compiles to one file: `dist/<game>.html`, or `dist/<game>-<version>.html` when there are several.
  `mise run build <game>-<version>` builds one.

Types and protocol: `packages/game/src/meta.ts`, `packages/game/src/host.ts`.
