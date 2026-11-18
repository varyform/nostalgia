/**
 * @nostalgia/game — the games in this repo, as the launcher sees them.
 *
 *   import { games, loadPreview, pageUrl } from '@nostalgia/game';
 *
 *   for (const g of games) …                     // every games/<id>/game.json, oldest original first
 *   const preview = await loadPreview(g.id);     // games/<id>/src/preview.js, loaded on demand
 *   const run = preview(canvas, { version: 'hd', reducedMotion: false });
 *   run.stop();
 *   location.href = pageUrl(g, g.versions[0]);   // dev: the source page; build: the compiled file
 *
 * See meta.ts for the folder contract.
 */
import { pageFile, type GameMeta, type GameVersion, type Preview } from './meta.ts';

export * from './meta.ts';

const metas = import.meta.glob<Omit<GameMeta, 'id'>>('/games/*/game.json', { eager: true, import: 'default' });
const previews = import.meta.glob<Preview>('/games/*/src/preview.js', { import: 'default' });

const idOf = (path: string) => path.split('/')[2];

export const games: GameMeta[] = Object.entries(metas)
  .map(([path, meta]) => ({ ...meta, id: idOf(path) }))
  .sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));

export function loadPreview(id: string): Promise<Preview> | null {
  const load = previews[`/games/${id}/src/preview.js`];
  return load ? load() : null;
}

/** Where a version is played: its source page in dev, its compiled file (next to the launcher) in a build. */
export function pageUrl(meta: GameMeta, version: GameVersion): string {
  return import.meta.env.DEV ? `/games/${meta.id}/${version.entry}` : pageFile(meta, version);
}
