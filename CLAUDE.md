# Nostalgia — rules for working here

DOS-era game remakes, one self-contained HTML file per game version, plus a DOS-style launcher. `README.md` has the
layout, the shared packages' APIs and the game folder contract; this file has the rules behind them.

## Tooling

- Everything runs through mise (Node, pnpm and Kamal are pinned in `mise.toml`): `mise run dev | build | check | test |
  ci | deploy`. `mise run build <page> …` builds single pages (`skyhook-hd`, `spindle`, `index`); `mise exec -- node …`
  for scripts. Vite+ (`vp`) does format, lint, type-check and tests (`vite-plus/test`, not `vitest`).
- `mise run ci` (check + test + build) before presenting a change. The 2 Skyhook warnings in `hd.js` are known; add no
  new ones.
- `dist/` is committed with the sources it was built from. `dist/index.html` is built last, because its "bytes free"
  figure counts every other page (`vite.config.ts`, a 20 MB ST-225 disk): rebuild it whenever a game page changes.

## Originality

Games are in the spirit of an original, never a recreation: no original names, characters, art, level layouts, music
or licensed properties (e.g. no Popeye, spinach, Lode Runner levels). Invent the cast, world, stages and score; keep
the mechanics. `game.json` credits the original in `after` + `year`.

## A game

- Folder `games/<id>/` with `game.json` (`GameMeta`, `packages/game/src/meta.ts`) and one HTML entry per version. The
  build and the launcher discover it; nothing else lists it. Output: `dist/<id>.html`, or `dist/<id>-<key>.html` with
  several versions. New games default to HD only unless asked for a period version (CGA/VGA) too.
- Launcher fit limits: `blurb` ≤ 240 characters, ≤ 4 `facts`, ≤ 6 `controls`. The launcher sorts by `year`; add the
  README games-table row in year order.
- Architecture (see `games/glimmer`, `games/spindle`, `games/brimful`, `games/quarry`):
  - `src/sim.js` — pure, deterministic, no DOM; fixed step; emits events.
  - `src/app.js` — screen flow (title, play, pause, scores); never draws.
  - `src/hd/` (`src/cga/`, `src/vga/`) — renderer `{ draw(app), events(list, sim), destroy() }`.
  - `src/audio.js` (score on `@nostalgia/audio`), `src/pilot.js` (demo autopilot), `src/touch.js`.
  - `tools/solve.mjs` / `tools/verify.mjs` — prove every stage is winnable; keep them passing.
- Skyhook (`src/cga.js`, `src/hd.js`) and Dropzone (`src/game.js`) are older monoliths: focused diffs, keep their shape.

## Shared packages — use them, don't re-roll

- `@nostalgia/game/host` — `host({ demo, play })` starts the page; `?demo=on`, `?sound=off`; postMessage
  `{ nostalgia: 'play' | 'exit' }` with the launcher.
- `@nostalgia/game/runtime` — `listeners()`, `fixedLoop()`, `onAway()`, `fitWide()` / `fitPixels()`, `storage()`,
  `toggleFullscreen()`, `canvasPoint()`.
- `@nostalgia/input` — `createInput` from `game.json`'s `input`; glyphs follow the last device (keyboard, pad, touch).
- `@nostalgia/audio` — `createSynth`; context made on the first user gesture; respects `sound`; `M` toggles. Voices:
  `tone`, `hiss`, `fm`, `notes`, and for richer scores `sub`, `supersaw`, `pulse` and `fm(…, { options })`. Effects:
  `delay`, `distortion`, `compressor`, through `v.insert(…)` or `inserts` on a bus (balance loudness with a compressor).
- `@nostalgia/save` — the autosave (below).
- `@nostalgia/gl` — the 3D games' WebGL2 engine: `createGL` (meshes, instances, glass, shadows, mist, thermal, points;
  `destroy()` keeps the context), mesh parts, height-field chunks; DOM-free `/noise`, `/math`, `/mesh`, `/terrain` for
  sims and tools; `/ui` for the 2D HUD.
- `@nostalgia/rig` — moves made in the rig editor: `parseProject`, `jointsAt`, `sampleMove`, `solvePose`. Its `src/` is
  the editor's runtime, copied by `mise run rig-sync`: change it in the editor (`~/projects/rig-editor`, with its
  tests) and sync, never here.
- A change a game needs in a package goes in the package (with tests), not in a local copy.

## Game rules

- Canvas size comes from `innerWidth`/`innerHeight` (via `fitWide`/`fitPixels`), never from the canvas's
  `clientWidth`; DPR capped at 2, ~2560 px wide.
- The bars a screen of another shape leaves around the game are filled with colours each page declares on `:root`
  (`--backdrop-top`, `--backdrop-bottom`: the game's own top and bottom edges in play); pick them once by looking at
  the game, never derive them from its frames. A page without them shows its plain background.
- Away (blur, hidden tab, background app): `onAway(listen, …)` opens the pause screen (not in the demo). The loop
  and the synth already stop by themselves while the tab is hidden.
- Title: a `quit` action (`Q`/`Esc`, pad East/Select) calls `onExit`; the EXIT entry shows only when `onExit` is set.
  Keyboard, gamepad and touch must reach every menu entry.
- Demo (`?demo=on`): the autopilot plays plausibly (and sometimes loses), input ignored, no audio, no storage reads or
  writes, no title; reduced motion → one still frame. It runs in a launcher iframe, so keep it cheap.
- Audio and music are original, made in code; nothing plays before a user gesture.
- Colour helpers that mix colours must accept their own output (`rgba(…)` as well as `#hex`): parsing `rgba` as hex
  gives NaN, which draws black.

## Autosave (`@nostalgia/save`)

- Checkpoints, not snapshots: save what it takes to begin the current level/tower/round/mission again as it began
  (stage, score, lives, carried state, seed), at that stage's start and at a new game's start. Never a live sim.
- The title offers CONTINUE first and selected, only when `load()` returns a save, with its label (e.g.
  `Tower 3 · 12,400`) and optionally `savedAgo(at)`. NEW GAME starts fresh and overwrites at its first checkpoint.
- `clear()` on game over (after any in-game continue prompt is declined) and when the game is beaten. Quitting or
  closing mid-stage keeps the checkpoint. Demo: `enabled: false`. Bump `version` when the state's shape changes.
- High scores and progress keep their own storage; autosave is separate. Versions of one game save under their own id
  when their states differ (`skyhook-cga`, `skyhook-hd`).

## Testing

- Browsers only headless and muted: `~/.local/share/chrome-headless-shell/chrome-headless-shell --headless
  --mute-audio --force-device-scale-factor=2`. Never open a visible window; only a test of full-screen mode may run
  headed. No sound, ever.
- Start browsers only through `scripts/headless.js` (`launch()` → `page()` / `eval()` / `close()`): it sets the
  flags above and closes the browser however the script ends — error, interrupt, `kill -9` (a watchdog), or after
  `maxLife`. Never spawn the browser by hand. `mise run reap` closes any orphaned ones; run it after a session of
  tests.
- Headless iframes stall `requestAnimationFrame`: launcher-flow harnesses replace it with timers.
- Harness scripts go in the session scratchpad, not the repo. Don't screenshot-verify visuals for the user.
- Verifying a game or a game change, closest first:
  1. `mise run check` / `mise run test`, then `mise run ci`.
  2. Console errors on the built page, with and without `?demo=on&sound=off`.
  3. Frame timing at DPR 2 (demo and play), no freezes.
  4. The game's solver/verify tool; a long simulated demo soak with no exceptions or stuck actors.
  5. A scripted headless session for the feature (e.g. clear a stage → reload → CONTINUE → resumes; game over clears).
  6. Demo leaves `localStorage` byte-identical.
  7. Launcher flow: listed in year order, preview is the demo, Enter runs it, quit returns; no overlap or spill in the
     launcher's detail window across viewport sizes.

## Launcher

- One screen, no page scroll at any viewport: preview + controls side by side, description below; only the
  description scrolls on short screens. Measure layout with headless scripts across viewports and every game, not
  one.

## Parallel agents

- Each agent owns explicit folders (`games/<id>/**` and their `dist/` pages); no edits to `packages/`, `launcher/`,
  `README.md` or `dist/index.html` unless that's the task — report needed package changes instead.
- While others run: no `mise run ci` and no full `mise run build`; use `check`, `test` and `build <pages>`, ignoring
  other agents' folders. No commits from agents.
- A new game is built in its own worktree and branch (`git worktree add ../nostalgia-<id> -b <id>`, then
  `mise install` and `pnpm install` there), so a half-built game stays out of the main tree's launcher, builds and
  commits; its agents work only in that worktree. Merge it to main when the game is done and asked for; package
  changes it needs land on main first and are merged into the branch.

## Commits and deploy

- Commit only when asked, push only when asked. Stage only the files of the change (several agents' work is often in
  the tree at once); check `git show --stat` after.
- Deploy: `mise run deploy` (Kamal, `config/deploy.yml`) → nginx serving `dist/` at https://ogg.ol3h.org on
  `px.kamal`, TLS at Cloudflare. Kamal builds from the committed HEAD, not the working tree. Deploying publishes:
  only when asked.
- iOS: `mise run ios` builds the wrapper in `ios/` (XcodeGen; `project.yml` is the source, the `.xcodeproj` is
  generated) around an offline copy of `dist/` (`scripts/offline.js` inlines the Google Fonts) and runs it on the Duo
  (`IOS_DEVICE`: another UDID; `-- --sim` for the simulator).
