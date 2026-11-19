// Copies the rig editor's runtime (src/rig, without its tests) into packages/rig/src, which is
// never edited by hand: the editor is where it's made and tested.
//
//   mise run rig-sync            copy it over
//   mise run rig-sync -- --check say whether the copy is behind, and fail if so
//
// The editor is at ../rig-editor, or wherever RIG_EDITOR points.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const from = join(resolve(process.env.RIG_EDITOR ?? join(root, '..', 'rig-editor')), 'src', 'rig');
const to = join(root, 'packages', 'rig', 'src');
const check = process.argv.includes('--check');
if (!existsSync(from)) {
  console.error(`No rig editor at ${from} (set RIG_EDITOR).`);
  process.exit(1);
}
const runtime = dir =>
  existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')) : [];
const theirs = runtime(from);
const changed = [
  ...theirs.filter(
    f => !existsSync(join(to, f)) || readFileSync(join(from, f), 'utf8') !== readFileSync(join(to, f), 'utf8'),
  ),
  ...runtime(to).filter(f => !theirs.includes(f)),
];
if (check) {
  console.log(
    changed.length ? `packages/rig is behind the editor: ${changed.join(', ')}` : 'packages/rig matches the editor.',
  );
  process.exit(changed.length ? 1 : 0);
}
mkdirSync(to, { recursive: true });
for (const f of runtime(to)) if (!theirs.includes(f)) rmSync(join(to, f));
for (const f of theirs) writeFileSync(join(to, f), readFileSync(join(from, f)));
console.log(changed.length ? `Synced ${changed.join(', ')}.` : 'Already in step.');
