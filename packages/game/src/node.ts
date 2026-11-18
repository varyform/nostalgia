// Build-side discovery: every page the repo compiles, found from the game folders.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pageFile, type GameMeta } from './meta.ts';

export interface Page {
  /** Source HTML, relative to the repo root. */
  entry: string;
  /** Compiled single file, relative to the repo root. */
  out: string;
}

/** launcher + one page per game version, keyed by the compiled file name without .html. */
export function discoverPages(root: string): Record<string, Page> {
  const pages: Record<string, Page> = { index: { entry: 'launcher/index.html', out: 'dist/index.html' } };
  const dir = join(root, 'games');
  for (const id of readdirSync(dir).sort()) {
    const file = join(dir, id, 'game.json');
    if (!existsSync(file)) continue;
    const meta = { ...(JSON.parse(readFileSync(file, 'utf8')) as Omit<GameMeta, 'id'>), id };
    for (const v of meta.versions) {
      const out = pageFile(meta, v);
      pages[out.replace(/\.html$/, '')] = { entry: `games/${id}/${v.entry}`, out: `dist/${out}` };
    }
  }
  return pages;
}
