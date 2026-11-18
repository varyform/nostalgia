// Headless checks on the real sim and autopilot:
//   1. reach    every keepsake can be saved: from the worst place in each scene Wick reaches the
//               bottom floor under any landing point before the slowest-case keepsake (fastest
//               fall, shortest float, any loop) sinks, and the next one after it too;
//   2. clear    the strong autopilot plays every scene at loops 0–2 with lives topped up: it must
//               clear each one (deaths per clear and clear times are printed);
//   3. soak     the demo's sloppy autopilot plays scene after scene for --minutes: no exceptions,
//               no NaN, keepsakes stay on screen, Rumbold never stands stuck nor stays gone.
//
//   mise exec -- node games/keepsake/tools/verify.mjs [--runs 6] [--minutes 30] [--seed 1]
import { buildNav } from '../src/nav.js';
import { createPilot } from '../src/pilot.js';
import { BOTTOM, H, SCENES, W, WATER_Y, FLOOR_Y, params } from '../src/scenes.js';
import { DT, FLOAT_REACH, OUT_T, createSim } from '../src/sim.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const RUNS = opt('--runs', 6), MINUTES = opt('--minutes', 30), SEED = opt('--seed', 1);
let bad = 0;
const fail = (id, msg) => { if (bad++ < 40) console.log(`  ✗ ${id}: ${msg}`); };
const finite = v => typeof v === 'number' && Number.isFinite(v);

// ---------- 1. every keepsake can be reached ----------
console.log('reach: worst-case seconds to the bottom floor under a landing point vs. the time it has');
for (let s = 0; s < SCENES.length; s++) {
  const nav = buildNav(s), sc = SCENES[s];
  // the nearest bottom-floor cell within reach of a keepsake floating at x, for every x
  const under = x => { const ids = []; for (let id = 0; id < nav.N; id++) if (nav.has[id] && nav.fOf(id) === BOTTOM && Math.abs(nav.xOf(id) - x) < FLOAT_REACH - 20) ids.push(id); return ids; };
  let worst = 0, worstAt = '';
  for (let x = 80; x <= W - 80; x += 20) {
    const ids = under(x);
    for (let a = 0; a < nav.N; a++) {
      if (!nav.has[a]) continue;
      const t = Math.min(...ids.map(b => nav.between(a, b)));
      if (t > worst) { worst = t; worstAt = `F${nav.fOf(a)} x${nav.xOf(a)} → x${x}`; }
    }
  }
  // the next keepsake lands at least `gap` later, anywhere: the widest walk along the bottom
  const bottom = []; for (let id = 0; id < nav.N; id++) if (nav.has[id] && nav.fOf(id) === BOTTOM) bottom.push(id);
  let across = 0; for (const a of bottom) for (const b of bottom) across = Math.max(across, nav.between(a, b));
  for (let loop = 0; loop <= 4; loop++) {
    const P = params(s, loop), fall = (WATER_Y - (FLOOR_Y[0] - 110)) / (P.fallV * 1.08);
    const have = fall + P.float, next = P.gap[0] + P.float;
    const ok = worst < have && across < next;
    if (!ok) fail(`reach ${sc.id}/${loop}`, `needs ${worst.toFixed(2)} s (${worstAt}) of ${have.toFixed(2)}, next ${across.toFixed(2)} of ${next.toFixed(2)}`);
    if (loop === 0 || loop === 4) console.log(`  ${ok ? '✓' : '✗'} ${sc.id.padEnd(8)} loop ${loop}: worst ${worst.toFixed(2)} s (${worstAt}) < ${have.toFixed(2)} s; next ${across.toFixed(2)} s < ${next.toFixed(2)} s`);
  }
}

// ---------- shared: watch a running sim for broken state ----------
function watcher(id) {
  let still = 0, lx = 0, ly = 0, gone = 0;
  return sim => {
    const h = sim.hero, b = sim.brute;
    for (const v of [h.x, h.y, b.x, b.y, sim.score]) if (!finite(v)) { fail(id, `non-finite state ${JSON.stringify({ h: [h.x, h.y], b: [b.x, b.y] })}`); return false; }
    for (const k of sim.keeps) if (!finite(k.x) || k.x < -40 || k.x > W + 40 || k.y > WATER_Y + 1) { fail(id, `keepsake off screen at ${k.x | 0},${k.y | 0}`); return false; }
    if (b.mode !== 'out' && b.mode !== 'flung' && (b.x < -160 || b.x > W + 160 || b.y < -200 || b.y > H + 60)) { fail(id, `Rumbold off the playfield at ${b.x | 0},${b.y | 0} (${b.mode})`); return false; }
    if (sim.status === 'play') {
      gone = b.mode === 'out' ? gone + DT : 0;
      if (gone > OUT_T + 1) { fail(id, `Rumbold out for ${gone.toFixed(1)} s`); return false; }
      const busy = b.stun > 0 || b.act || b.mode === 'out' || b.mode === 'flung' || b.mode === 'climb';
      if (!busy && Math.hypot(b.x - lx, b.y - ly) < 1) still += DT; else still = 0;
      if (still > 4) { fail(id, `Rumbold stuck ${still.toFixed(1)} s at F${b.f} x${b.x | 0} (${b.mode})`); return false; }
    } else still = 0;
    lx = b.x; ly = b.y;
    return true;
  };
}

// ---------- 2. the strong autopilot clears every scene ----------
console.log(`clear: strong autopilot, ${RUNS} runs per scene and loop, lives topped up`);
for (let s = 0; s < SCENES.length; s++) {
  for (let loop = 0; loop <= 2; loop++) {
    let clears = 0, deaths = 0;
    const times = [], causes = {};
    for (let r = 0; r < RUNS; r++) {
      const id = `clear ${SCENES[s].id}/${loop}#${r}`;
      const sim = createSim({ seed: SEED * 1000 + s * 100 + loop * 10 + r });
      sim.resume({ scene: s, loop, stage: s, score: 0, lives: 6, nextLife: 1e12 });
      const pilot = createPilot(sim, { seed: SEED + r }), watch = watcher(id);
      let n = 0;
      try {
        while (n < 60 * 60 * 6 && sim.status !== 'clear' && sim.status !== 'over') {
          sim.step(pilot()); n++;
          sim.lives = Math.max(sim.lives, 3); // topped up: this is about clearing, not surviving
          for (const e of sim.events) if (e.type === 'miss') { deaths++; causes[e.cause] = (causes[e.cause] ?? 0) + 1; }
          sim.events.length = 0;
          if (!watch(sim)) break;
        }
      } catch (err) { fail(id, err.stack.split('\n').slice(0, 3).join(' ')); }
      if (sim.status === 'clear') { clears++; times.push(n * DT); } else fail(id, `not cleared in ${(n * DT).toFixed(0)} s (${sim.caught}/${sim.quota})`);
    }
    times.sort((a, b) => a - b);
    console.log(`  ${clears === RUNS ? '✓' : '✗'} ${SCENES[s].id.padEnd(8)} loop ${loop}: ${clears}/${RUNS} cleared, ${(deaths / Math.max(1, clears)).toFixed(1)} deaths per clear, median ${(times[times.length >> 1] ?? 0).toFixed(0)} s ${JSON.stringify(causes)}`);
  }
}

// ---------- 3. the demo's soak ----------
console.log(`soak: the demo's autopilot for ${MINUTES} minutes of play`);
{
  let rs = SEED * 7919;
  const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  const sim = createSim({ seed: SEED });
  let steps = 0, scenes = 0, clears = 0, overs = 0;
  const stats = { caught: 0, lost: 0, deaths: 0, flings: 0, bonks: 0, swings: 0, smashes: 0, birds: 0, powers: 0 };
  const springs = { n: 0 };
  while (steps < MINUTES * 3600) {
    const scene = Math.floor(rnd() * SCENES.length), loop = rnd() < 0.3 ? 1 : 0, id = `soak ${SCENES[scene].id}/${loop} @${(steps / 3600).toFixed(1)}min`;
    sim.reseed((rnd() * 1e9) | 0); sim.newGame(); sim.loadScene(scene, loop);
    const pilot = createPilot(sim, { sloppy: 0.35, seed: (rnd() * 1e6) | 0 }), watch = watcher(id);
    let t = 0;
    try {
      while (t < 90) {
        sim.step(pilot()); steps++; t += DT;
        for (const e of sim.events) if (e.type === 'boing') springs.n++;
        sim.events.length = 0;
        if (!watch(sim)) break;
        if ((sim.status === 'clear' && sim.statusT > 2.6) || (sim.status === 'over' && sim.statusT > 1.5)) break;
      }
    } catch (err) { fail(id, err.stack.split('\n').slice(0, 3).join(' ')); }
    scenes++; if (sim.status === 'clear') clears++; if (sim.status === 'over') overs++;
    for (const k in stats) stats[k] += sim.stats[k];
  }
  console.log(`  ${scenes} demo scenes: ${clears} cleared, ${overs} game overs, the rest cut at 90 s; ${JSON.stringify({ ...stats, springs: springs.n })}`);
  if (!stats.powers || !stats.flings) fail('soak', 'the demo never used the Haymaker');
  if (!stats.bonks && !stats.swings && !springs.n) fail('soak', 'the demo never used a scene trick');
  if (!stats.deaths) fail('soak', 'the demo never loses a life');
}

console.log(bad ? `✗ ${bad} problem(s)` : '✓ all checks passed');
process.exit(bad ? 1 : 0);
