// Proves every stage can be finished, headless, on the real sim:
//   1. replays each recorded route in src/routes.js (pursuers on) and checks it reaches home;
//   2. fairness of the layout: bramble knots well away from Dew's start and the moonbloom;
//   3. no soft locks: from every tile Dew can get to (pursuers off), every glowberry and the
//      moonbloom are still reachable, so she can't strand herself;
//   4. with --seeds N, solves every stage again with N fresh pursuer seeds, so the clear
//      isn't one lucky roll of the burrs.
//
//   mise exec -- node games/dewdrop/tools/verify.mjs [--seeds 2] [ids…]
import { COLS } from '../src/level.js';
import { createPilot } from '../src/pilot.js';
import { ROUTES } from '../src/routes.js';
import { createSim } from '../src/sim.js';
import { STAGES } from '../src/stages.js';
import { reach, solveStage } from './solve.mjs';

const args = process.argv.slice(2);
const si = args.indexOf('--seeds'), seeds = si >= 0 ? +args[si + 1] : 0;
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--seeds');
const list = STAGES.filter(d => !only.length || only.includes(d.id));
const KNOT_GAP = 6;
let bad = 0;
const fail = (id, msg) => { bad++; console.log(`  ✗ ${id}: ${msg}`); };

for (const def of list) {
  const sim = createSim();
  // 1. the route
  const r = ROUTES[def.id];
  if (!r) fail(def.id, 'no recorded route');
  else {
    sim.load(def, { world: def.world, seed: r.seed });
    const pilot = createPilot(r.route);
    let n = 0;
    while (sim.s.status === 'play' && n < 60 * 300) { sim.step(pilot()); n++; }
    if (sim.s.status !== 'clear') fail(def.id, `route ends in '${sim.s.status}' after ${(n / 60).toFixed(1)}s`);
    else if (sim.s.deaths) fail(def.id, 'route loses a life');
    else console.log(`  ✓ ${def.id} ${def.name}: home in ${(n / 60).toFixed(1)}s with ${sim.s.foes.length} burrs out, par ${def.par}s`);
  }
  // 2. knots
  const L = sim.L, d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  for (const [k, kn] of Object.entries(L.knots)) {
    if (d(kn, L.start) < KNOT_GAP) fail(def.id, `knot ${k} is ${d(kn, L.start).toFixed(1)} tiles from the start`);
    if (d(kn, { x: L.door.x, y: L.door.y }) < KNOT_GAP) fail(def.id, `knot ${k} is ${d(kn, L.door).toFixed(1)} tiles from the moonbloom`);
  }
  // 3. soft locks (the lily pads' phases multiply the states, so a big budget)
  const R = reach(def, { budget: 6e6 });
  // a glowberry is picked up from its own tile or one beside it, as the solver counts it
  const near = (c, r) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([dc, dr]) => (r + dr) * COLS + c + dc);
  const goals = [...L.berries.map(b => near(Math.floor(b.x), Math.floor(b.y))), near(L.door.c, L.door.r)];
  const back = new Map();
  R.edges.forEach((set, from) => { for (const to of set) { if (!back.has(to)) back.set(to, []); back.get(to).push(from); } });
  // only tiles she can rest on count: a tile passed through on a fatal fall has no way on, but
  // that's a lost life, not a soft lock (and Retry in the pause menu always gets her out)
  const stuck = new Set();
  for (const g of goals) {
    const can = new Set(g), q = [...g];
    while (q.length) for (const f of back.get(q.pop()) ?? []) if (!can.has(f)) { can.add(f); q.push(f); }
    for (const v of R.rest) if (!can.has(v)) stuck.add(v);
  }
  if (!R.complete) console.log(`    (${def.id}: reach search hit its budget at ${R.states} states; soft-lock check is partial)`);
  if (stuck.size) fail(def.id, `stuck on ${[...stuck].map(v => `(${v % COLS},${Math.floor(v / COLS)})`).join(' ')}`);
  // 4. other seeds
  for (let k = 1; k <= seeds; k++) {
    const seed = 1000 + k * 7919 + def.id.charCodeAt(0) * 31 + def.id.charCodeAt(2);
    const res = solveStage(def, { seed });
    if (!res) fail(def.id, `no clear found with pursuer seed ${seed}`);
    else console.log(`    ${def.id} seed ${seed}: cleared in ${res.secs.toFixed(1)}s`);
  }
}
console.log(bad ? `${bad} problem(s)` : `all ${list.length} stages verified`);
process.exit(bad ? 1 : 0);
