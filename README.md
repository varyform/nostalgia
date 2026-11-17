# Nostalgia

Remakes of DOS-era games, one HTML file each. No install, no build, no assets: art and sound are made in code.

`index.html` is the launcher: a DOS-style menu with live previews of every game.

## Games

| Folder            | Game     | In the spirit of        | Versions                                    |
|-------------------|----------|-------------------------|---------------------------------------------|
| `striker`         | Skyhook  | Striker (1985)          | CGA (`index.html`), HD (`modern.html`)      |
| `airborne-ranger` | Dropzone | Airborne Ranger (1988)  | HD (`dropzone.html`)                        |

Each game folder is its own repository, included here as a git submodule.

## Play

Open `index.html` in a desktop or mobile browser.

| Key            | Action                  |
|----------------|-------------------------|
| `↑` `↓`, `1–9` | Select a game           |
| `←` `→`        | Switch version (CGA/HD) |
| `Enter`        | Run                     |
| `F1`           | Help                    |
| `F2` / `M`     | Sound on/off            |
| `F3` / `C`     | Scanlines on/off        |
| `F10` / `Q`    | Exit to DOS             |

Mouse and touch work too: click a game to select it, double-click or press **Run** to start it.

## Clone

```sh
git clone --recurse-submodules git@github.com:varyform/nostalgia.git
```

Already cloned without them: `git submodule update --init`.

## Adding a game

1. Put the game in its own folder (its own repo), then register it:
   `git submodule add <repo-url> <folder>`.
2. Add an entry to the `GAMES` list at the top of the launcher script in `index.html`:
   folder, executable name, versions (file + preview scene), controls and blurb.
3. Optionally draw a preview: add a function to `SCENES`. It gets a 2D context
   and the time in seconds, and draws a 320×200 frame. `mode: 'cga'` scenes are
   rendered at real resolution and scaled up with hard pixels; `'hd'` scenes are
   drawn as vectors at native resolution.

After committing inside a game's repo, record the new version here with `git add <folder>`.
