// The game's copy of Cinder's moves (src/hd/rig-moves.json) from its rig editor project
// (cinder.rig.json): each move put through the editor's Simplify, for fewer keys, channels and
// digits, within GAME_TOLERANCE of the project's. Run it after editing the project in the editor.
//
//   node games/cinder/tools/rig-pack.mjs     (Node 24: it loads the editor's .ts)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CINDER = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const RIG = process.env.RIG_EDITOR ?? fileURLToPath(new URL('../../../../rig-editor/src', import.meta.url));
// How far a joint may stray from the full moves (m). A figure is ~120 px tall on a phone and
// ~500 on a desktop: 1 cm is a pixel or three.
const GAME_TOLERANCE = 0.01;

export async function pack() {
  const { parseProject, newProject, serialize } = await import(`${RIG}/rig/format.ts`);
  const { simplifyMove } = await import(`${RIG}/editor/simplify.ts`);
  const project = parseProject(JSON.parse(readFileSync(`${CINDER}/cinder.rig.json`, 'utf8')));
  let strays = 0;
  const game = newProject(
    'Cinder',
    project.moves.map(move => {
      const s = simplifyMove(move, project.proportions, GAME_TOLERANCE);
      strays = Math.max(strays, s.error);
      // the editor's own fields stay in the editor
      const out = { ...s.move };
      delete out.folder;
      delete out.simplify;
      return out;
    }),
  );
  game.fps = project.fps;
  game.proportions = project.proportions;
  const out = `${CINDER}/src/hd/rig-moves.json`;
  writeFileSync(out, JSON.stringify(JSON.parse(serialize(game))));
  const keys = game.moves.reduce((n, m) => n + m.keys.length, 0);
  console.log(`game copy: ${game.moves.length} moves, ${keys} keys, within ${(strays * 100).toFixed(1)} cm → ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await pack();
