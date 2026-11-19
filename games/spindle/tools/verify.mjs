// Proves every tower can be climbed, headless, on the real sim:
//   1. the crown door can be reached from the start (the move graph of solve.mjs's reach());
//   2. every crab has a level ledge beside its door, to bubble it off from;
//      no soft locks: from every cell Clink can get to, the crown door can still be reached,
//      so he can't strand himself (being knocked off counts as a way to get somewhere);
//   3. replays each recorded route in src/routes.js, every enemy and squall on, and checks it
//      reaches the crown door in time without a knock, a splash or a lost life, then plays the
//      sinking, the Kite Run after it and the start of the next tower;
//   4. with --seeds N, solves every tower again with N fresh squall seeds, so the climb isn't
//      one lucky roll;
//   5. with --soak M, runs the attract demo's loop for M simulated minutes (routes, kite pilot,
//      tower after tower) and fails on any exception.
//
//   mise exec -- node games/spindle/tools/verify.mjs [--seeds 2] [--soak 30] [towers…, 1-based]
import { createRoutePilot } from '../src/pilot.js';
import { ROUTES } from '../src/routes.js';
import { COLS, DT, K, createSim } from '../src/sim.js';
import { TOWERS } from '../src/towers.js';
import { GOAL, reach, solveTower } from './solve.mjs';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? +args[i + 1] : 0; };
const seeds = opt('--seeds'), soak = opt('--soak');
const only = args.filter((a, i) => !a.startsWith('--') && !['--seeds', '--soak'].includes(args[i - 1])).map(n => +n - 1);
let bad = 0;
const fail = (i, msg) => { bad++; console.log(`  ✗ ${i + 1} ${TOWERS[i].name}: ${msg}`); };
const cell = v => `(${v % COLS},${Math.floor(v / COLS)})`;

for (let i = 0; i < TOWERS.length; i++) {
  if (only.length && !only.includes(i)) continue;
  // 1, 2: the move graph
  const R = reach(i);
  const stuck = [...R.live].filter(v => !R.dist.has(v));
  if (!R.dist.has([...R.live][0])) fail(i, 'the crown door cannot be reached');
  if (stuck.length) fail(i, `stuck on ${stuck.map(cell).join(' ')}`);
  // a crab on its door needs a ledge level with it, to stand on and bubble it off from: from a
  // step below, a shot only grazes it and Clink can't get up without landing on it
  const T = createSim().towers[i], level = [K.LEDGE, K.SLIP];
  for (const f of T.spawns) if (f.k === 'crab' && ![1, -1].some(d => level.includes(T.at((f.c + d + COLS) % COLS, f.r))))
    fail(i, `the crab at ${cell(f.c + COLS * f.r)} has no level ledge beside it`);
  // 3: the route
  const r = ROUTES[i];
  if (!r) { fail(i, 'no recorded route'); continue; }
  const sim = createSim();
  sim.newGame({ tower: i, seed: r.seed });
  const pilot = createRoutePilot(sim, r.route), seen = new Set();
  let n = 0, climb = 0;
  while (n < 60 * 600) {
    sim.step(pilot()); n++;
    for (const e of sim.events) seen.add(e.type);
    sim.events.length = 0;
    if (sim.s.status === 'play') climb++;
    if (sim.s.status === 'sink' && !seen.has('sinkstart')) seen.add('sinkstart');
    if (seen.has('tower') || sim.s.status === 'over') break;
  }
  const t = TOWERS[i];
  if (seen.has('hit') || seen.has('splash') || seen.has('timeup')) fail(i, `route is knocked, splashes or times out (${[...seen].filter(x => ['hit', 'splash', 'timeup'].includes(x)).join(', ')})`);
  else if (!seen.has('crown')) fail(i, `route never reaches the crown door (${(climb / 60).toFixed(1)}s)`);
  else if (!seen.has('tower') || sim.s.tower !== (i + 1) % TOWERS.length) fail(i, 'the sinking and the Kite Run do not lead on to the next tower');
  else console.log(`  ✓ ${i + 1} ${t.name}: crown in ${(climb / 60).toFixed(1)}s of ${t.time}s, ${R.live.size} cells, no strands, ${t.map.length} rows`);
  // 4: other squall seeds
  for (let k = 1; k <= seeds; k++) {
    const seed = 5000 + k * 7919 + i * 31;
    const res = solveTower(i, { seed, graph: R });
    if (!res) fail(i, `no route found with seed ${seed}`);
    else console.log(`    seed ${seed}: crown in ${res.secs.toFixed(1)}s`);
  }
}

// 5: the attract loop
if (soak) {
  const sim = createSim();
  let tower = 0, towersDone = 0, steps = 0, pilot;
  const load = i => { const r = ROUTES[i]; sim.newGame({ tower: i, seed: r.seed }); pilot = createRoutePilot(sim, r.route); };
  load(0);
  try {
    for (; steps < soak * 60 * 60; steps++) {
      sim.step(pilot());
      const next = sim.events.some(e => e.type === 'tower');
      sim.events.length = 0;
      const s = sim.s;
      if (next || s.status === 'over' || (pilot.done() && s.status === 'play')) {
        if (next) towersDone++;
        else { bad++; console.log(`  ✗ soak: tower ${tower + 1} ended in '${s.status}'`); }
        tower = (tower + 1) % TOWERS.length;
        load(tower);
      }
    }
    console.log(`  ✓ soak: ${soak} simulated minutes, ${towersDone} towers climbed and sunk, no exceptions (${(steps * DT / 60).toFixed(1)} min)`);
  } catch (e) { bad++; console.log(`  ✗ soak threw after ${(steps * DT).toFixed(1)}s: ${e.stack}`); }
}
void GOAL;
console.log(bad ? `${bad} problem(s)` : 'all verified');
process.exit(bad ? 1 : 0);
