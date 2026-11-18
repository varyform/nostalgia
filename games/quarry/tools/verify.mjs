// Proves every level can be finished, headless, on the real sim:
//   1. the map: 16 × 11, one start and one den (in a corner), both tunnel, no crate resting
//      over a tunnel at the start, and every gem reachable from the start around the crates;
//   2. with the grubs off, the autopilot clears the level without losing a life;
//   3. with the grubs on, the autopilot plays the level from fresh lives with several seeds
//      (how often it clears is printed: a measure of difficulty, not a pass/fail);
//   4. --demo M: runs the attract loop for M minutes of game time from every level, as the
//      page's demo does, and fails on any exception or a stuck run.
//
//   mise exec -- node games/quarry/tools/verify.mjs [--seeds 6] [--demo 10] [--cycles 2]
import { COLS, LEVELS, ROWS } from '../src/levels.js';
import { createPilot } from '../src/pilot.js';
import { DT, createSim } from '../src/sim.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const seeds = opt('--seeds', 6), demoMin = opt('--demo', 0), cycles = opt('--cycles', 1);
let bad = 0;
const fail = (id, msg) => { bad++; console.log(`  ✗ ${id}: ${msg}`); };

for (let li = 0; li < LEVELS.length; li++) {
  const def = LEVELS[li], id = `${li + 1} ${def.name}`;
  // 1. the map
  if (def.map.length !== ROWS || def.map.some(r => r.length !== COLS)) fail(id, 'map is not 16 × 11');
  const flat = def.map.join('');
  if ((flat.match(/H/g) ?? []).length !== 1 || (flat.match(/S/g) ?? []).length !== 1) fail(id, 'needs one H and one S');
  const si = flat.indexOf('S'), sc = si % COLS, sr = Math.floor(si / COLS);
  if (!((sc === 0 || sc === COLS - 1) && (sr === 0 || sr === ROWS - 1))) fail(id, 'den not in a corner');
  for (let i = 0; i < flat.length - COLS; i++) if (flat[i] === 'c' && '-|+HS'.includes(flat[i + COLS])) fail(id, `crate over a tunnel at ${i % COLS},${Math.floor(i / COLS)}`);
  const seen = new Set([flat.indexOf('H')]), q = [...seen];
  while (q.length) {
    const i = q.pop(), c = i % COLS, r = Math.floor(i / COLS);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr, j = nr * COLS + nc;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS || seen.has(j) || flat[j] === 'c') continue;
      seen.add(j); q.push(j);
    }
  }
  const gems = flat.split('').filter(ch => ch === 'g').length;
  const sealed = flat.split('').map((ch, i) => (ch === 'g' && !seen.has(i) ? i : -1)).filter(i => i >= 0);
  if (sealed.length) fail(id, `sealed gems at ${sealed.map(i => `${i % COLS},${Math.floor(i / COLS)}`).join(' ')}`);

  for (let cyc = 0; cyc < cycles; cyc++) {
    const level = li + cyc * LEVELS.length;
    // 2. grubs off
    {
      const sim = createSim();
      sim.newGame({ level, seed: 7, monsters: false });
      const pilot = createPilot(sim, { seed: 11 });
      let n = 0;
      while (sim.s.status !== 'clear' && sim.s.status !== 'over' && n < 60 * 600) { sim.step(pilot()); sim.events.length = 0; n++; }
      if (sim.s.status !== 'clear') fail(id, `grubs off: ends '${sim.s.status}' after ${(n * DT).toFixed(0)}s with ${sim.s.gems} gems left`);
      else if (sim.s.deaths) fail(id, `grubs off: loses ${sim.s.deaths} life`);
      else if (cyc === 0) console.log(`  ✓ ${id}: ${gems} gems, ${def.map.join('').split('c').length - 1} crates; cleared alone in ${(sim.s.levelT).toFixed(1)}s`);
    }
    // 3. grubs on
    let clears = 0, deaths = 0, secs = 0, byGrubs = 0;
    for (let k = 0; k < seeds; k++) {
      const sim = createSim();
      sim.newGame({ level, seed: 100 + k * 977, lives: 2 });
      const pilot = createPilot(sim, { seed: 5 + k });
      let n = 0, killed = 0;
      while (sim.s.status !== 'over' && sim.s.level === level && n < 60 * 600) {
        sim.step(pilot());
        for (const e of sim.events) if (e.type === 'kill') killed++;
        sim.events.length = 0; n++;
      }
      if (sim.s.level > level) { clears++; secs += n * DT; if (killed >= sim.s.P.total) byGrubs++; }
      deaths += sim.s.deaths;
    }
    console.log(`    level ${level + 1}: grubs on, cleared ${clears}/${seeds}${clears ? ` in ${(secs / clears).toFixed(0)}s avg` : ''} (${byGrubs} by grubs), ${deaths} lives lost`);
  }
}

// 4. the attract loop
if (demoMin) {
  for (let start = 0; start < LEVELS.length; start++) {
    const sim = createSim();
    let seed = 1 + start * 31, levels = 0, games = 1, n = 0, lastProgress = 0, lastScore = -1, maxLevel = start;
    const begin = lv => { sim.newGame({ level: lv, seed, lives: 2 }); return createPilot(sim, { seed: seed++ }); };
    let pilot = begin(start);
    try {
      for (; n < demoMin * 3600; n++) {
        if (sim.s.status === 'over' && sim.s.statusT > 2.5) { games++; pilot = begin(sim.s.level); }
        sim.step(pilot());
        for (const e of sim.events) if (e.type === 'clear') levels++;
        sim.events.length = 0;
        if (sim.s.score !== lastScore || sim.s.status !== 'play') { lastScore = sim.s.score; lastProgress = n; }
        maxLevel = Math.max(maxLevel, sim.s.level);
        if (n - lastProgress > 60 * 90) { fail(`demo from ${start + 1}`, `no progress for 90s at level ${sim.s.level + 1} (gems ${sim.s.gems})`); break; }
      }
      console.log(`  demo from level ${start + 1}: ${demoMin} min, ${levels} levels cleared, ${games} game(s), reached level ${maxLevel + 1}, score ${sim.s.score}`);
    } catch (err) {
      fail(`demo from ${start + 1}`, `threw at ${(n * DT).toFixed(1)}s: ${err.stack}`);
    }
  }
}
console.log(bad ? `${bad} problem(s)` : `all ${LEVELS.length} levels verified`);
process.exit(bad ? 1 : 0);
