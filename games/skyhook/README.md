# Skyhook

A CGA-style helicopter rescue shooter in a single HTML file. It is an original game in the spirit of 1980s DOS side-scrollers such as *Striker* (1985) and the arcade *Scramble*.

320×200, four colours, shown at 4:3. Plain Canvas 2D and Web Audio, no dependencies, no build step.

## Play

Build with `mise run build`, then open `dist/skyhook-cga.html` in any modern browser.

`dist/skyhook-hd.html` is the HD remaster of the same game: 16:9 widescreen with vector art, per-mission themes and parallax, dynamic lighting in the caves and fortress, particle effects, a modern HUD with a route map, and touch controls.

## How to play

- Fly through five missions: hills, mountains, caverns, an occupied city and an iron fortress.
- **Land near agents** to pick them up (up to 4 aboard). Some are locked in prison huts: bomb the hut to free them.
- **Land on outposts** to unload agents, refuel and set a checkpoint.
- **Land at HQ** to finish the mission. Fuel left and a full rescue earn bonuses.
- Fuel burns while you fly. Shoot fuel depots for +25.
- Shoot or bomb through brick walls in the caves.
- The marker under your skids turns cyan when a touchdown is safe.

After mission 5 the tour repeats, harder.

## Controls

| Key | Action |
| --- | --- |
| Arrows / WASD | Fly |
| Space / Z | Fire |
| X / B | Bomb |
| P / Esc | Pause (then R restart, Q quit) |
| M | Sound on/off |
| C | Cycle CGA palettes (CGA version) |
| F / double-click | Fullscreen |

Gamepads work too: left stick or D-pad to fly, A / ✕ to fire, X / □ to bomb, Start to pause. Prompts show the buttons of the pad you're holding.
