// Headless checks on the real sim and autopilot (no browser):
//   1. win    the strong autopilot flies every mission over --seeds seeds: each mission must be
//             won at least --need times (win rate, time, hull and fuel left, why it lost);
//   2. soak   the demo's sloppy autopilot flies mission after mission for --minutes of game
//             time: no exceptions, no NaN, nothing under the ground or off the map, no aircraft
//             stuck, and the bullet, rocket, missile and decoy lists stay bounded.
//
//   mise exec -- node games/treeline/tools/verify.mjs [--seeds 4] [--need 3] [--minutes 30] [--only 0,5]
import { MISSIONS } from '../src/missions.js';
import { createPilot } from '../src/pilot.js';
import { SKID, createSim } from '../src/sim.js';
import { HALF } from '../src/world.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SEEDS = +opt('--seeds', 4), NEED = +opt('--need', 3), MINUTES = +opt('--minutes', 30);
const ONLY = opt('--only', null)?.split(',').map(Number) ?? null;
const LIMIT = 1200; // seconds a mission may take
let bad = 0;
const fail = msg => { if (bad++ < 40) console.log(`  ✗ ${msg}`); };
const finite = v => (Array.isArray(v) ? v.every(Number.isFinite) : Number.isFinite(v));

// ---------- 1. every mission can be won ----------
if (SEEDS > 0) {
  console.log(`win: the autopilot flies each mission over ${SEEDS} seeds (needs ${NEED})`);
  for (let mi = 0; mi < MISSIONS.length; mi++) {
    if (ONLY && !ONLY.includes(mi)) continue;
    const res = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const sim = createSim({ seed: seed * 101 });
      sim.load(mi);
      const pilot = createPilot(sim, { sloppy: 0, seed: seed * 7 });
      let ev = 0;
      while (sim.t < LIMIT && sim.status === 'fly' && !(sim.complete && sim.completeT > 1)) {
        sim.step(pilot());
        ev += sim.events.length;
        sim.events.length = 0;
      }
      const o = sim.objectives();
      res.push({ won: sim.complete, t: sim.t, hp: sim.player.hp, fuel: sim.player.fuel, why: sim.complete ? '' : `${sim.reason || 'timeout'} (${o.done}/${o.total}, ${pilot.info().job} ${pilot.info().target ?? ''})` });
    }
    const wins = res.filter(r => r.won);
    const avg = k => (wins.reduce((s, r) => s + r[k], 0) / Math.max(1, wins.length)).toFixed(0);
    const why = res.filter(r => !r.won).map(r => r.why).join('; ');
    console.log(`  ${String(mi + 1).padStart(2)} ${MISSIONS[mi].name.padEnd(16)} ${wins.length}/${SEEDS}  ${wins.length ? `${avg('t')} s  hull ${avg('hp')}  fuel ${avg('fuel')}%` : ''}${why ? '  lost: ' + why : ''}`);
    if (wins.length < NEED) fail(`${MISSIONS[mi].name}: won ${wins.length} of ${SEEDS}, needs ${NEED}`);
  }
}

// ---------- 2. the demo soak ----------
if (MINUTES > 0) {
  console.log(`soak: ${MINUTES} minutes of the sloppy autopilot`);
  const steps = MINUTES * 60 * 60;
  let k = 0, runs = 0, wins = 0, losses = 0, seed = 11, maxLists = 0;
  while (k < steps && bad < 40) {
    const sim = createSim({ seed: seed++ });
    const mi = seed % MISSIONS.length;
    sim.load(mi, { airborne: seed % 2 === 0 });
    const pilot = createPilot(sim, { sloppy: 0.25 + (seed % 5) * 0.07, seed });
    runs++;
    const still = new Map();
    try {
      while (k < steps && sim.t < 300 && !(sim.complete && sim.completeT > 8) && !(sim.status !== 'fly' && sim.statusT > 4)) {
        sim.step(pilot());
        sim.events.length = 0;
        k++;
        if (k % 30) continue;
        const W = sim.world;
        for (const a of sim.actors) {
          if (!finite(a.pos) || !finite(a.f) || !finite(a.hp)) { fail(`${MISSIONS[mi].name} t=${sim.t.toFixed(1)}: ${a.kind} has NaN`); break; }
          if (!a.alive) continue;
          if (Math.abs(a.pos[0]) > HALF + 600 || Math.abs(a.pos[2]) > HALF + 600) fail(`${MISSIONS[mi].name} t=${sim.t.toFixed(1)}: ${a.kind} off the map`);
          if (a.air && a.pos[1] < W.heightAt(a.pos[0], a.pos[2]) + (a.kind === 'stiletto' ? 0 : SKID) - 0.5) fail(`${MISSIONS[mi].name} t=${sim.t.toFixed(1)}: ${a.kind} under the ground`);
          if (a.air && a.kind !== 'player') {
            const last = still.get(a);
            if (a.kind === 'stiletto' && last && Math.hypot(a.pos[0] - last[0], a.pos[2] - last[2]) < 1) fail(`${MISSIONS[mi].name}: ${a.kind} stuck`);
            still.set(a, [...a.pos]);
          }
        }
        const n = sim.bullets.length + sim.rockets.length + sim.missiles.length + sim.decoys.length;
        maxLists = Math.max(maxLists, n);
        if (n > 1500) fail(`${MISSIONS[mi].name}: ${n} projectiles`);
      }
    } catch (e) {
      fail(`${MISSIONS[mi].name} seed ${seed - 1} t=${sim.t.toFixed(1)}: ${e.stack}`);
    }
    if (sim.complete) wins++; else if (sim.status !== 'fly') losses++;
  }
  console.log(`  ${runs} missions, ${wins} won, ${losses} lost, ${(k / 3600).toFixed(0)} min, at most ${maxLists} projectiles in flight`);
}

console.log(bad ? `FAILED: ${bad} problem${bad > 1 ? 's' : ''}` : 'ok');
process.exit(bad ? 1 : 0);
