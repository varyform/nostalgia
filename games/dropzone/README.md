# Dropzone

A top-down solo paratrooper game in a single HTML file. Jump from a transport plane, drop your supply pods, sneak or fight your way to the objective, then reach the helicopter before the extraction window closes.

No build step, no dependencies, no assets: terrain, sprites and sound are all generated in code.

## Play

Build with `mise run build`, then open `dist/dropzone.html` in a desktop browser (Chrome, Firefox, Safari, Edge). Play with keyboard and mouse, or a gamepad: left stick moves, right stick aims, R2 fires, R1 throws a grenade, Start pauses. Prompts show the buttons of the pad you're holding.

## How a mission goes

1. **Flight.** The plane flies north. Steer it, drop up to three supply pods, and jump. Past the red flak line you're thrown out automatically.
2. **Canopy.** Steer your parachute down. Land away from patrols.
3. **Ground.** Work north through forest, tall grass, a river and enemy outposts. Avoid vision cones, bunkers and minefields.
4. **Extraction.** Complete the objective, then board the helicopter at the green LZ before the timer runs out.

## Operations

| Code  | Name          | Conditions | Objective                     |
|-------|---------------|------------|-------------------------------|
| OP-01 | Glass Ear     | Dusk       | Destroy the radar array       |
| OP-02 | Paper Lantern | Night      | Steal the codebook            |
| OP-03 | Dry Thunder   | Arid       | Destroy three fuel tanks      |

Difficulty: Recruit, Veteran or Elite. Best scores are saved in the browser.

## Controls

| Key                | Action                              |
|--------------------|-------------------------------------|
| `A` / `D`          | Steer the plane (flight)            |
| `Q`                | Drop a supply pod (flight)          |
| `Space`            | Jump (flight)                       |
| `W` `A` `S` `D`    | Move / steer canopy                 |
| `Shift`            | Sprint (noisy)                      |
| Mouse / `LMB`      | Aim / fire                          |
| `R`                | Reload                              |
| `C`                | Crouch                              |
| `Z`                | Go prone                            |
| `G` / `RMB`        | Throw grenade                       |
| `F`                | Place a 5-second demolition charge  |
| `H`                | Use medkit                          |
| `E` (hold)         | Interact                            |
| `Tab` (hold)       | Full map                            |
| `Esc` / `P`        | Pause                               |
| `M`                | Mute                                |

## Tips

- Crouching and going prone make you slower but much harder to see. Tall grass and tree cover hide you further.
- An enemy's ring fills as they notice you: `?` means searching, `!` means they've spotted you.
- Gunfire and explosions draw enemies; bodies get found.
- Bunkers shrug off rifle fire. Use grenades or a charge.
- Warning signs mark minefields. Crouch or crawl to spot mines.
- Supply pods contain 3 magazines, 2 grenades, 1 charge and 1 medkit each.

## Tech

Plain HTML, CSS and JavaScript on a 2D canvas:

- seeded procedural world (noise terrain, river, road, forests, camps) rendered into cached chunks
- spatial grid for collision, line of sight and cover
- enemy state machine (patrol, search, alert) with awareness, hearing and body discovery
- particle effects, persistent scorch decals, dynamic lights and night darkness
- Web Audio synthesized sound effects
