// The game's copy of Netcord's moves (src/rig-moves.json) from its rig editor project
// (netcord.rig.json): each move put through the editor's Simplify, for fewer keys and digits,
// within GAME_TOLERANCE of the project's. Then what the sim needs of them is measured off that
// copy, as the figure will play it, into src/moves.js (its GENERATED block): each move's
// length, contact (the middle of its `active` range) and reach (the range's radius), the
// racket's sweet spot and the hand's grip there, a loop's stride. Run it after editing the
// project in the editor.
//
//   mise exec -- node games/netcord/tools/rig-pack.mjs     (Node 24: it loads the editor's .ts)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NETCORD = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const RIG = process.env.RIG_EDITOR ?? fileURLToPath(new URL('../../../../rig-editor/src', import.meta.url));
// How far a joint may stray from the full moves (m): the racket, half a metre past the hand,
// swings any error in the hand's turn wider, so this is tighter than Cinder's.
const GAME_TOLERANCE = 0.004;
// The rig's y = 0 is the ankles' height; the court is this far below (tools/rig-moves.mjs ANKLE).
const ANKLE = 0.075;

const r3 = v => Math.round(v * 1000) / 1000;

export async function pack() {
  const R = await import(`${RIG}/rig/index.ts`);
  const { simplifyMove } = await import(`${RIG}/editor/simplify.ts`);
  const { racketOf, newRacket, ballOf } = await import(`${NETCORD}/src/moves.js`);
  const project = R.parseProject(JSON.parse(readFileSync(`${NETCORD}/netcord.rig.json`, 'utf8')));
  const props = project.proportions;
  let strays = 0;
  const game = R.newProject(
    'Netcord',
    project.moves.map(move => {
      const s = simplifyMove(move, props, GAME_TOLERANCE);
      strays = Math.max(strays, s.error);
      // the editor's own fields stay in the editor
      const out = { ...s.move };
      delete out.folder;
      delete out.simplify;
      return out;
    }),
  );
  game.fps = project.fps;
  game.proportions = props;
  // Fewer digits: a tenth of a millimetre, a ten-thousandth of a radian.
  const json = JSON.stringify(JSON.parse(R.serialize(game)), (k, v) =>
    typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v,
  );
  writeFileSync(`${NETCORD}/src/rig-moves.json`, json);
  const packed = R.parseProject(JSON.parse(json));

  // --- what the sim reads, measured off the packed moves ---
  const FPS = packed.fps;
  const buf = R.createJointBuffer();
  const rk = newRacket();
  const solveAt = (move, frame) => R.solvePose(R.sampleMove(move, frame), props, buf);
  const body = (p, digits = r3) => ({ f: digits(p[0]), u: digits(p[1] + ANKLE), s: digits(p[2]) });
  const tagged = (move, key) => {
    const t = move.tags.find(t => t.startsWith(`${key}=`));
    return t ? t.slice(key.length + 1).split(',').map(Number) : null;
  };
  const ballAt = (move, frame) => {
    solveAt(move, frame);
    return body(ballOf(buf, [0, 0, 0]));
  };
  // The figure's height standing tall: the head's top over the court.
  R.solvePose({ ...R.REST_POSE, lean: 0, pelvis: { x: 0, y: props.thigh + props.shin - 0.015 } }, props, buf);
  const height = buf[R.Joint.head * 3 + 1] + props.headRadius + ANKLE;
  const entries = [];
  for (const move of packed.moves) {
    const kind = move.loop ? 'loop' : (['swing', 'serve', 'react'].find(k => move.tags.includes(k)) ?? 'react');
    const m = { dur: r3(move.length / FPS), contact: -1, kind };
    if (move.active) {
      const { from, to, radius } = move.active;
      const mid = (from + to) / 2;
      solveAt(move, mid);
      racketOf(buf, rk);
      m.contact = r3(mid / FPS);
      m.window = [r3(from / FPS), r3(to / FPS)];
      m.at = body(rk.head);
      m.hand = body(rk.grip);
      m.reach = r3(radius);
      // the face that meets the ball: the palm's side, or the back's on a backhand
      const n = rk.normal[0] < 0 ? rk.normal.map(v => -v) : rk.normal;
      m.face = n.map(r3);
    }
    if (move.loop) {
      // The planted foot's way and speed: the root travels the other way as fast.
      let vx = 0;
      let vz = 0;
      let n = 0;
      const prev = R.createJointBuffer();
      for (let f = 0; f < move.length; f++) {
        R.solvePose(R.sampleMove(move, (f + move.length - 1) % move.length), props, prev);
        solveAt(move, f);
        for (const ball of [R.Joint.ballNear, R.Joint.ballFar]) {
          const i = ball * 3;
          if (buf[i + 1] > 0.008 || prev[i + 1] > 0.008) continue;
          vx += buf[i] - prev[i];
          vz += buf[i + 2] - prev[i + 2];
          n++;
        }
      }
      const v = n ? Math.hypot(vx, vz) / n : 0;
      m.stride = r3(v * move.length);
      m.dir = v > 1e-4 ? [r3(-vx / n / v), r3(-vz / n / v)] : [0, 0];
    }
    const release = tagged(move, 'release');
    if (release) m.release = { t: r3(release[0] / FPS), at: ballAt(move, release[0]) };
    const ret = tagged(move, 'catch');
    if (ret) m.catch = { t: r3(ret[0] / FPS), at: ballAt(move, ret[0]) };
    const travel = tagged(move, 'travel');
    if (travel) m.travel = { f: travel[0], s: travel[1], from: r3(travel[2] / FPS), to: r3(travel[3] / FPS) };
    entries.push([move.name, m]);
  }
  const lines = entries.map(([name, m]) => `  ${name}: ${JSON.stringify(m).replace(/"(\w+)":/g, '$1: ').replace(/"/g, "'")},`);
  const block = [
    '// GENERATED by tools/rig-pack.mjs — do not edit below this line by hand.',
    `export const FIGURE = { height: ${r3(height)}, ankle: ${ANKLE}, fps: ${FPS} };`,
    'export const MOVES = {',
    ...lines,
    '};',
    '// END GENERATED',
  ].join('\n');
  const file = `${NETCORD}/src/moves.js`;
  const src = readFileSync(file, 'utf8');
  const a = src.indexOf('// GENERATED');
  const b = src.indexOf('// END GENERATED');
  writeFileSync(file, `${src.slice(0, a)}${block}${src.slice(b + '// END GENERATED'.length)}`);
  const keys = game.moves.reduce((n, mv) => n + mv.keys.length, 0);
  console.log(
    `game copy: ${game.moves.length} moves, ${keys} keys, within ${(strays * 100).toFixed(2)} cm → src/rig-moves.json (${(json.length / 1024).toFixed(0)} KB), src/moves.js`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await pack();
