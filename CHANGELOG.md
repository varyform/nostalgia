# Changelog

What changed for players, release by release. Play the collection at https://ogg.varyform.info (also
https://ogg.ol3h.org).

## 0.3.0 — 2026-11-24

Two new games, HDR across the collection, and the source is now open under the MIT licence.

### New

- **Netcord**, 3D tennis in the spirit of 4D Sports Tennis (1990): climb the Meridian Tour from wildcard to world
  No. 1 and win the Four Crowns, eight invented events on hard, clay, grass and carpet, with a ball that spins and
  flat-shaded players animated from the rig editor. Behind, side and umpire cameras.
- **Swerve**, top-down football in the spirit of Sensible World of Soccer (1994): take a struggling Second Division
  club in the Halvane League to the title. One kick button, a ball that swerves with aftertouch, the Lantern Cup,
  transfers and a career that never ends.
- **HDR**: on an HDR display every game glows (fire, neon, lamps, muzzle flashes), the period CGA and VGA pages
  too. `L` sets how much, once for the whole collection.
- **Screens of other shapes**: the bars a MacBook or a phone leaves around a game are filled with colours picked
  for each game, instead of black.
- **Open source**: the code is on GitHub under the MIT licence, and the collection is also served at
  https://ogg.varyform.info.

### Fixes

- **Launcher**: starting a game no longer flashes its demo before the title screen.
- **Glimmer**: the lamps' and crystals' glow fades softly into the dark instead of drawing hard-edged discs.
- **Sound**: `?sound=off` (the launcher's muted start) silences the games again; 13 of them played sound anyway.

## 0.2.1 — 2026-11-21

### Fixes

- **Game list on small screens**: on screens up to 860 px wide the game details covered the list, so no game could
  be picked. The list is back above the details.
- **Preview on phones**: a portrait phone showed the demo as a small strip in the middle of the preview; it now
  fills the box. Run zooms the game up to the whole screen and follows a rotation while playing.

## 0.2.0 — 2026-11-21

### New

- **Scorch**, armed racing in the spirit of Death Rally (1996): climb a ladder of twelve outlaw drivers across eight
  tracks on dirt, snow, ice, oil and water. Win cash, buy and upgrade five cars, and fight with guns, mines and
  turbo.
- **Cinder**, a martial-arts climb in the spirit of Karateka (1984): up to the Cinder Keep one masked guard at a
  time across seven scenes, with chained punches and kicks, specials, knockdowns and dodges. Its moves come from the
  rig editor through the new shared `@nostalgia/rig`.
- **Share**: a Share button beside Run copies a direct link to the game's own page (the share sheet on phones).
- **Hidden tab**: every game pauses and goes silent while its tab is hidden or the app is in the background.

### Fixes

- **Spindle**: a sunk tower no longer shows above the water, and Coral Reach's crab has a ledge to be shot from
  instead of blocking the door.
- **Quintet**: UNDO and PAUSE are centred in their buttons.
- **Sound**: a voice at volume 0 plays silently instead of throwing.
- **Server**: the pages are served from nginx 1.30, the stable line, which fixes a security vulnerability in 1.29.

## 0.1.0 — 2026-11-19

The first release: DOS-era games remade as self-contained HTML pages, behind a DOS-style launcher with live
previews. Every game is original in its names, world, art and music, works with keyboard, gamepad and touch, has an
attract-mode demo in the launcher and an autosave behind CONTINUE.

### Games

Keepsake, Brimful (CGA, HD), Glimmer, Quarry (CGA, HD), Dewdrop, Polder, Skyhook (CGA, HD), Spindle, Dropzone,
Contrail, Treeline, Barrage, Triform (VGA, HD) and Quintet.

### New

- **Treeline**: an attack helicopter flown at treetop height through twelve missions in three theatres.
- **Contrail**: a 3D strike jet across twelve sorties over reef islands, desert mesas and snow spires.
- **Polder**: lay dykes across tidal flats to drain them, dodging jellyfish, crabs and the undertow.
- **`@nostalgia/gl`**: a shared WebGL2 engine for the 3D games.
- **Sound engine**: new voices and effects, per-track levels and loops that survive a new audio context; Triform
  HD, Keepsake's theme and Spindle rescored, and new ambient music in Skyhook HD.
- **iOS**: the collection wrapped in an app for real full screen.
