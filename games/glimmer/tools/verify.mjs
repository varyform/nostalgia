// Proves every level can be finished, headless, on the real sim:
//   1. replays each recorded route in src/routes.js (sentinels on) and checks Wren climbs out
//      without losing a life;
//   2. the layout: every glimmer can be reached from the start, and the way out from every
//      glimmer once the rising stair is up;
//   3. a demo soak: plays the attract loop (route after route, as app.js does) for --soak
//      minutes of game time and checks that nothing throws and every level clears;
//   4. with --seeds N, solves every level again with N fresh sentinel seeds, so the clear
//      isn't one lucky roll.
//
//   mise exec -- node games/glimmer/tools/verify.mjs [--seeds 1] [--soak 30] [ids…]
import { COLS, parseLevel } from '../src/level.js';
import { LEVELS } from '../src/levels.js';
import { createPilot } from '../src/pilot.js';
import { buildGraph } from '../src/reach.js';
import { ROUTES } from '../src/routes.js';
import { createSim } from '../src/sim.js';
import { solveLevel } from './solve.mjs';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? +args[i + 1] : d; };
const seeds = opt('--seeds', 0), soak = opt('--soak', 10);
const only = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const list = LEVELS.filter(d => !only.length || only.includes(d.id));
let bad = 0;
const fail = (id, msg) => { bad++; console.log(`  ✗ ${id}: ${msg}`); };

function replay(def, r, sim = createSim()) {
  sim.load(def, { seed: r.seed });
  const pilot = createPilot(r.route);
  let n = 0;
  while (sim.s.status === 'play' && n < 60 * 600) { sim.step(pilot()); n++; }
  while (sim.s.status !== 'play' && sim.s.status !== 'dead' && sim.s.statusT < 200) { sim.step(); n++; }
  return { n, status: sim.s.status, tally: sim.s.tally };
}

for (const def of list) {
  // 1. the route
  const r = ROUTES[def.id];
  if (!r) fail(def.id, 'no recorded route');
  else {
    const { n, status, tally } = replay(def, r);
    if (status !== 'clear') fail(def.id, `route ends in '${status}' after ${(n / 60).toFixed(1)}s`);
    else console.log(`  ✓ ${def.id} ${def.name}: out in ${(n / 60).toFixed(1)}s, ${tally.traps} traps, ${tally.crushed} sealed in`);
  }
  // 2. the layout
  const L = parseLevel(def), R = buildGraph(L).reach(L.start.c, L.start.r);
  for (const k of L.shards) if (!R[k.r * COLS + k.c]) fail(def.id, `glimmer (${k.c},${k.r}) can't be reached`);
  const exits = [];
  for (let c = 0; c < COLS; c++) if (L.t[0][c] === 'H' || L.t[0][c] === '^') exits.push(c);
  const out = buildGraph(L, { stair: true }).field(exits);
  for (const k of L.shards) if (out[k.r * COLS + k.c] === Infinity) fail(def.id, `no way out from glimmer (${k.c},${k.r})`);
  // 4. other seeds
  for (let k = 1; k <= seeds; k++) {
    const seed = 1000 + k * 7919 + def.index * 31 + def.world * 977;
    const res = solveLevel(def, { seed });
    if (!res) fail(def.id, `no clear found with sentinel seed ${seed}`);
    else console.log(`    ${def.id} seed ${seed}: cleared in ${res.secs.toFixed(1)}s`);
  }
}

// 3. the demo loop: the same sim reused level after level, as the attract mode does
if (!only.length && soak > 0) {
  const sim = createSim(), steps = soak * 3600;
  let n = 0, levels = 0, i = 0;
  try {
    while (n < steps) {
      const def = LEVELS[i % LEVELS.length], r = ROUTES[def.id];
      const res = replay(def, r, sim);
      if (res.status !== 'clear') fail(def.id, `demo replay ends in '${res.status}'`);
      n += res.n + 96; levels++; i++;
      sim.events.length = 0;
    }
    console.log(`  ✓ demo soak: ${(n / 3600).toFixed(1)} minutes of play, ${levels} levels, no exceptions`);
  } catch (e) { fail('demo', `throws after ${(n / 3600).toFixed(1)} minutes: ${e.stack}`); }
}
console.log(bad ? `${bad} problem(s)` : `all ${list.length} levels verified`);
process.exit(bad ? 1 : 0);
