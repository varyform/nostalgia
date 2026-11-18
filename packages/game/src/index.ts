/**
 * @nostalgia/game — the games in this repo, as the launcher sees them.
 *
 *   import { games, pageUrl } from '@nostalgia/game';
 *
 *   for (const g of games) …                              // every games/<id>/game.json, oldest original first
 *   iframe.src = pageUrl(g, g.versions[0], { demo: true }); // dev: the source page; build: the compiled file
 *
 * See meta.ts for the folder contract and host.ts for the launcher ⇄ game protocol.
 */
import { pageFile, type GameMeta, type GameVersion } from './meta.ts';

export * from './meta.ts';

const metas = import.meta.glob<Omit<GameMeta, 'id'>>('/games/*/game.json', { eager: true, import: 'default' });

const idOf = (path: string) => path.split('/')[2];

export const games: GameMeta[] = Object.entries(metas)
  .map(([path, meta]) => ({ ...meta, id: idOf(path) }))
  .sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));

/** Where a version is played: its source page in dev, its compiled file (next to the launcher) in a build. */
export function pageUrl(meta: GameMeta, version: GameVersion, { demo = false } = {}): string {
  const page = import.meta.env.DEV ? `/games/${meta.id}/${version.entry}` : pageFile(meta, version);
  return demo ? `${page}?demo=on&sound=off` : page;
}
