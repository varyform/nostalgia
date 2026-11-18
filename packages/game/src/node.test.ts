import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { discoverPages } from './node.ts';

function repo(games: Record<string, { versions: { key: string; entry: string }[] } | null>) {
  const root = mkdtempSync(join(tmpdir(), 'nostalgia-'));
  for (const [id, meta] of Object.entries(games)) {
    mkdirSync(join(root, 'games', id), { recursive: true });
    if (meta) writeFileSync(join(root, 'games', id, 'game.json'), JSON.stringify(meta));
  }
  return root;
}

describe('discoverPages', () => {
  it('compiles each version to one file, suffixed only when there are several', () => {
    const root = repo({
      solo: { versions: [{ key: 'hd', entry: 'index.html' }] },
      duo: {
        versions: [
          { key: 'cga', entry: 'index.html' },
          { key: 'hd', entry: 'modern.html' },
        ],
      },
      wip: null,
    });
    expect(discoverPages(root)).toEqual({
      index: { entry: 'launcher/index.html', out: 'dist/index.html' },
      'duo-cga': { entry: 'games/duo/index.html', out: 'dist/duo-cga.html' },
      'duo-hd': { entry: 'games/duo/modern.html', out: 'dist/duo-hd.html' },
      solo: { entry: 'games/solo/index.html', out: 'dist/solo.html' },
    });
  });
});
