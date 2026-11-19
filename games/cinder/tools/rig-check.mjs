// How far the rig editor's moves (src/hd/rig-poses.js) draw each fighter from the hand-made poses
// (src/hd/poses.js) they were made from, through the game's own skeleton (rig.js solve): the
// hands, head and feet, per move. The feet differ on purpose where a heel lifts (tools/rig-moves.mjs).
//
//   node games/cinder/tools/rig-check.mjs
import { poseFor } from '../src/hd/poses.js';
import { rigPoseFor } from '../src/hd/rig-poses.js';
import { solve } from '../src/hd/rig.js';
import { MOVES } from '../src/moves.js';

const KINDS = ['hero', 'footman', 'brawler', 'adept', 'regent'];
const fighter = o => ({ x: 0, phase: 0, stance: 'guard', arm: 0, chain: 0, ...o });
const cases = [];
for (const kind of KINDS) {
  for (let i = 0; i < 12; i++) cases.push([kind, 'idle', fighter({ move: 'idle' }), { t: i / 4 }]);
  for (let i = 0; i < 12; i++) cases.push([kind, 'walk', fighter({ move: 'walk', phase: i / 12 }), { t: 0 }]);
  for (const id of ['punchHigh', 'punchMid', 'punchLow', 'kickHigh', 'kickMid', 'kickLow', 'hit', 'ko', ...(kind === 'regent' ? ['palm'] : [])]) {
    for (const arm of id.startsWith('punch') ? [0, 1] : [0]) {
      const D = MOVES[id].dur;
      for (let i = 0; i <= 12; i++) cases.push([kind, `${id}${arm ? ' (lead)' : ''}`, fighter({ move: id, moveT: (D * i) / 12, arm }), { t: 0, hitH: 'mid' }]);
    }
  }
  for (const id of ['block', 'blockLow', 'duck']) cases.push([kind, id, fighter({ move: id }), { t: 0 }]);
}
for (let i = 0; i < 12; i++) cases.push(['hero', 'run', fighter({ move: 'run', stance: 'run', phase: i / 12 }), { t: 0 }]);

const parts = { hands: J => [J.la.w, J.ra.w], head: J => [J.C], feet: J => [J.ll.a, J.rl.a] };
const worst = new Map();
let missing = 0;
for (const [kind, label, f, ctx] of cases) {
  const rig = rigPoseFor(f, kind, ctx);
  if (!rig) { missing++; continue; }
  const a = solve(poseFor(f, kind, ctx)), b = solve(rig);
  const key = `${kind} ${label}`;
  const w = worst.get(key) ?? { hands: 0, head: 0, feet: 0 };
  for (const [part, of] of Object.entries(parts)) {
    of(a).forEach((p, i) => { w[part] = Math.max(w[part], Math.hypot(p[0] - of(b)[i][0], p[1] - of(b)[i][1])); });
  }
  worst.set(key, w);
}
const cm = v => (v * 100).toFixed(1).padStart(5);
const rows = [...worst].sort((x, y) => Math.max(y[1].hands, y[1].head) - Math.max(x[1].hands, x[1].head));
console.log('move'.padEnd(28), 'hands  head  feet (cm, worst frame)');
for (const [key, w] of rows.slice(0, 14)) console.log(key.padEnd(28), cm(w.hands), cm(w.head), cm(w.feet));
console.log(`${worst.size} moves compared, ${missing} cases left to poses.js`);
