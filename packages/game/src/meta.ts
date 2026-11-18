// The contract every game folder fulfils:
//
//   games/<id>/game.json      GameMeta: what the launcher shows and the build compiles
//   games/<id>/<entry>.html   one page per version (+ its sources); started through host()
//                             (host.ts), it runs a demo with ?demo=on, the launcher's preview
//
// Each version compiles to exactly one self-contained file: dist/<id>.html, or
// dist/<id>-<version>.html when a game has several versions.
import type { ActionDef } from '@nostalgia/input';

export interface GameVersion {
  /** Short id, also the build file suffix and the launcher's "/cga" switch. */
  key: string;
  /** Button label in the launcher. */
  label: string;
  /** Page in the game folder that builds this version. */
  entry: string;
  /** Caption over the preview, e.g. "CGA · 320×200 · 4 colours". */
  tag: string;
  /** One line under the version switch. */
  note: string;
}

export interface GameMeta {
  /** Folder name; set from the folder, not read from the file. */
  id: string;
  title: string;
  /** DOS executable name shown in the launcher, e.g. "SKYHOOK.EXE". */
  exe: string;
  /** The original it pays homage to, and its year. */
  after: string;
  year: number;
  genre: string;
  tags: string[];
  blurb: string;
  /** Label/value rows, e.g. ["Missions", "5"]. */
  facts: [string, string][];
  /** The bindings the game itself plays with (passed to createInput). */
  input: { actions: Record<string, ActionDef>; display?: Record<string, ActionDef> };
  /** Which actions the launcher lists, with their labels: [action, label]. */
  controls: [string, string][];
  versions: GameVersion[];
}

/** Compiled file name of a version, relative to dist/. */
export function pageFile(meta: Pick<GameMeta, 'id' | 'versions'>, version: GameVersion): string {
  return meta.versions.length > 1 ? `${meta.id}-${version.key}.html` : `${meta.id}.html`;
}
