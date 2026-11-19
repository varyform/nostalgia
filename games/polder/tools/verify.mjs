// Headless checks on the real sim and autopilot:
//   1. rules    hand-made cuts: a straight dyke drains exactly the jelly-free side; a jelly that
//               swims into an open dyke breaks it (the dyke goes back to water, a life is lost);
//               running into your own dyke tangles you; the undertow catches a long slow cut on
//               Grey Sound and not a quick one; a pearl drained in pays, a conch slackens the tide;
//   2. resume   a checkpoint taken at a stage's start, resumed in fresh sims, sets the stage up
//               identically and plays on identically;
//   3. clear    the strong autopilot plays every stage at tides 1 and 2 with lives topped up: it
//               must drain each one in time (clear times and deaths are printed);
//   4. soak     the demo's sloppy autopilot plays stage after stage for --minutes of game time:
//               no exceptions, no NaN, jellies stay on the water and crabs on the land, nobody
//               stands stuck, after every closed dyke each stretch of water left has a jelly in
//               it and the drained share adds up, scores only go up.
//
//   mise exec -- node games/polder/tools/verify.mjs [--minutes 30] [--seed 1]
import { createPilot } from '../src/pilot.js';
import { B, DT, H, INNER, LAND, LIFE_EVERY, N, SEA, STAGES, TRAIL, W, createSim, validState } from '../src/sim.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const MINUTES = opt('--minutes', 30), SEED = opt('--seed', 1);
let bad = 0;
const fail = (id, msg) => { if (bad++ < 40) console.log(`  ✗ ${id}: ${msg}`); };
const finite = v => typeof v === 'number' && Number.isFinite(v);
const at = (x, y) => y * W + x;

// a stage set up by hand: the skimmer at (x, y), the given jellies, no crabs, no items
function bench(stage, px, py, jellies) {
  const s = createSim({ seed: 9 });
  s.resume({ stage, loop: 0, score: 0, lives: 3, nextLife: LIFE_EVERY, seed: 9 });
  s.crabs = []; s.items = [];
  s.jellies = jellies.map(([x, y, dx, dy, speed = 0.001]) => ({ x, y, px: x, py: y, k: 0, dx, dy, speed, kind: 'drifter' }));
  Object.assign(s.p, { x: px, y: py, px, py, k: 1, moving: false });
  s.status = 'play'; s.tide = 999;
  s.events.length = 0;
  return s;
}
// steer: a list of [dir, cells]; the last leg runs until the skimmer stops (or something happens)
function drive(s, legs, limit = 2000) {
  const log = [];
  let leg = 0, from = null, moved = 0;
  for (let n = 0; n < limit; n++) {
    const cur = at(s.p.x, s.p.y);
    if (from !== cur) { from = cur; moved++; }
    if (leg < legs.length - 1 && moved > legs[leg][1]) { leg++; moved = 1; }
    s.step({ dir: legs[leg][0], press: null });
    log.push(...s.events); s.events.length = 0;
    if (s.status !== 'play') break;
    if (leg === legs.length - 1 && !s.p.moving && n > 2) break;
  }
  return log;
}
// sea regions with no jelly in them (there must be none between dykes)
function emptySeas(s) {
  const seen = new Uint8Array(N), q = [];
  for (const j of s.jellies) { const i = at(j.x, j.y); if (s.grid[i] === SEA && !seen[i]) { seen[i] = 1; q.push(i); } }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % W, y = (i / W) | 0;
    for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1])
      if (n >= 0 && !seen[n] && s.grid[n] === SEA) { seen[n] = 1; q.push(n); }
  }
  let n = 0;
  for (let i = 0; i < N; i++) if (s.grid[i] === SEA && !seen[i]) n++;
  return n;
}
const countInner = s => { let n = 0; for (let y = B; y < H - B; y++) for (let x = B; x < W - B; x++) if (s.grid[at(x, y)] === LAND) n++; return n; };

// ---------- 1. rules ----------
console.log('rules: hand-made cuts');
{
  // a dyke straight down at x = 10: everything left of it drains, the right stays water
  const s = bench(0, 10, 0, [[40, 20, 1, 1]]);
  const log = drive(s, [['down', 99]]);
  const c = log.find(e => e.type === 'claim');
  const want = (10 - B) * (H - 2 * B) + (H - 2 * B);
  if (!c) fail('straight', 'no claim');
  else if (c.n !== want) fail('straight', `drained ${c.n}, want ${want}`);
  if (countInner(s) !== want || s.claimed !== want) fail('straight', `claimed ${s.claimed}/${countInner(s)}, want ${want}`);
  if (s.grid[at(30, 20)] !== SEA || s.trail.length) fail('straight', 'the jelly side drained or the dyke left open');
  if (s.grid[at(s.p.x, s.p.y)] !== LAND || s.p.y < H - B || s.p.moving) fail('straight', `the skimmer should end up on the far dyke, at ${s.p.x},${s.p.y}`);
  if (emptySeas(s)) fail('straight', 'water with no jelly left');
}
{
  // a jelly right in the dyke's way breaks it
  const s = bench(0, 10, 0, [[10, 12, 1, 1, 0.001]]);
  const log = drive(s, [['down', 99]]);
  const d = log.find(e => e.type === 'death');
  if (!d || d.cause !== 'jelly') fail('jelly', `want a jelly death, got ${d?.cause ?? 'none'}`);
  if (s.lives !== 2) fail('jelly', `lives ${s.lives}`);
  let trail = 0;
  for (let i = 0; i < N; i++) if (s.grid[i] === TRAIL) trail++;
  if (trail || s.claimed !== 0) fail('jelly', 'the broken dyke should be water again');
  for (let k = 0; k < 200; k++) { s.step({}); s.events.length = 0; }
  if (s.status !== 'ready' && s.status !== 'play') fail('jelly', `after the death: ${s.status}`);
  if (s.grid[at(s.p.x, s.p.y)] !== LAND || s.p.y !== 1) fail('jelly', `respawned at ${s.p.x},${s.p.y}`);
}
{
  // a loop back into its own dyke
  const s = bench(0, 20, 0, [[50, 30, 1, 1]]);
  const log = drive(s, [['down', 8], ['right', 4], ['up', 3], ['left', 99]]);
  const d = log.find(e => e.type === 'death');
  if (d?.cause !== 'tangle') fail('tangle', `got ${d?.cause ?? 'nothing'}`);
}
{
  // Grey Sound's undertow: a quick straight cut across escapes it, a long U doesn't
  const q = bench(4, 10, 0, [[50, 30, 1, 1]]);
  const lq = drive(q, [['down', 99]]);
  if (!lq.some(e => e.type === 'claim') || lq.some(e => e.type === 'death')) fail('undertow', 'the quick cut should close');
  const s = bench(4, 4, 0, [[50, 30, 1, 1]]);
  const ls = drive(s, [['down', 34], ['right', 40], ['up', 99]]);
  const d = ls.find(e => e.type === 'death');
  if (d?.cause !== 'undertow') fail('undertow', `the long cut: ${d?.cause ?? 'not caught'}`);
}
{
  // a pearl and a conch on the side that drains
  const s = bench(0, 10, 0, [[40, 20, 1, 1]]);
  s.items = [{ i: at(5, 10), kind: 'pearl' }, { i: at(6, 25), kind: 'conch' }, { i: at(30, 30), kind: 'pearl' }];
  const sc0 = s.score;
  const log = drive(s, [['down', 99]]);
  const c = log.find(e => e.type === 'claim'), p = log.find(e => e.type === 'pearl');
  if (!p || s.score !== sc0 + c.pts + p.pts) fail('pearl', `score ${s.score}`);
  if (!log.some(e => e.type === 'slack') || !(s.slack > 0)) fail('conch', 'no slack water');
  if (s.items.length !== 1) fail('items', `${s.items.length} left, want 1`);
}

// ---------- 2. resume ----------
console.log('resume: checkpoints resumed in fresh sims');
const snap = s => JSON.stringify({ g: Array.from(s.grid), j: s.jellies, c: s.crabs, i: s.items, p: s.p, sc: s.score, l: s.lives, t: s.tide });
for (let stage = 0; stage < STAGES.length; stage++) {
  const st = { stage, loop: stage % 3, score: 1000 * stage, lives: 3, nextLife: LIFE_EVERY, seed: 4242 + stage };
  if (!validState(st)) fail(`resume ${stage}`, 'state not valid');
  const a = createSim({ seed: 1 }), b = createSim({ seed: 2 });
  a.resume(st); b.resume(JSON.parse(JSON.stringify(st)));
  if (snap(a) !== snap(b)) { fail(`resume ${stage}`, 'stage set up differently'); continue; }
  const pa = createPilot(a, { seed: 3 }), pb = createPilot(b, { seed: 3 });
  for (let k = 0; k < 60 * 25; k++) { a.step(pa()); b.step(pb()); a.events.length = b.events.length = 0; }
  if (snap(a) !== snap(b)) fail(`resume ${stage}`, 'played on differently');
}

// ---------- 3. clear ----------
console.log('clear: the strong autopilot drains every stage (seconds, deaths)');
for (const loop of [0, 1]) {
  const row = [];
  for (let stage = 0; stage < STAGES.length; stage++) {
    const s = createSim({ seed: SEED });
    s.resume({ stage, loop, score: 0, lives: 3, nextLife: LIFE_EVERY, seed: SEED * 1000 + stage + loop * 77 });
    const pilot = createPilot(s, { seed: SEED + stage });
    let deaths = 0, n = 0;
    for (; n < 60 * 300; n++) {
      s.step(pilot());
      for (const e of s.events) if (e.type === 'death') deaths++;
      s.events.length = 0;
      if (s.lives < 2) s.lives = 3;
      if (s.status === 'clear') break;
    }
    if (s.status !== 'clear') fail(`clear ${loop + 1}/${stage + 1}`, `not drained in 300 s (${Math.round(s.pct * 100)}%)`);
    row.push(`${stage + 1}:${Math.round(n * DT)}s${deaths ? `/${deaths}✝` : ''}`);
  }
  console.log(`  tide ${loop + 1}  ${row.join('  ')}`);
}

// ---------- 4. soak ----------
console.log(`soak: the demo's autopilot for ${MINUTES} minutes of play`);
{
  let rs = SEED * 7919;
  const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
  let s = null, pilot = null, games = 0, stages = 0, deaths = 0, cuts = 0, overs = 0, maxStage = 0;
  const still = new Map();
  const fresh = () => {
    s = createSim({ seed: Math.floor(rnd() * 1e9) });
    s.resume({ stage: Math.floor(rnd() * STAGES.length), loop: 0, score: 0, lives: 3, nextLife: LIFE_EVERY, seed: Math.floor(rnd() * 1e9) });
    pilot = createPilot(s, { sloppy: 0.35, seed: Math.floor(rnd() * 1e6), budget: 32 });
    games++; still.clear();
  };
  fresh();
  let lastScore = 0;
  const steps = MINUTES * 60 * 60;
  try {
    for (let n = 0; n < steps; n++) {
      s.step(pilot());
      for (const e of s.events) {
        if (e.type === 'death') deaths++;
        if (e.type === 'claim') {
          cuts++;
          if (emptySeas(s)) fail('soak', `water with no jelly after a dyke closed (stage ${s.stage + 1})`);
          if (s.claimed !== countInner(s) || Math.abs(s.pct - s.claimed / INNER) > 1e-9) fail('soak', 'drained share does not add up');
          if (s.trail.length) fail('soak', 'dyke left open after closing');
        }
      }
      s.events.length = 0;
      if (s.score < lastScore) fail('soak', 'score went down');
      lastScore = s.score;
      for (const v of [s.p.x, s.p.y, s.p.k, s.tide, s.score, ...s.jellies.flatMap(j => [j.x, j.y, j.k]), ...s.crabs.flatMap(c => [c.x, c.y, c.k])])
        if (!finite(v)) { fail('soak', 'NaN'); break; }
      if (s.status === 'play') {
        for (const j of s.jellies) if (s.grid[at(j.x, j.y)] !== SEA) fail('soak', `jelly on ${s.grid[at(j.x, j.y)]} at ${j.x},${j.y} (stage ${s.stage + 1})`);
        for (const c of s.crabs) if (s.grid[at(c.x, c.y)] !== LAND) fail('soak', `crab off the land at ${c.x},${c.y}`);
        // nobody stands still for 8 s
        for (const a of [...s.jellies, ...s.crabs]) {
          const key = a, pos = a.x * 1000 + a.y, r = still.get(key);
          if (!r || r.pos !== pos) still.set(key, { pos, t: 0 });
          else if ((r.t += DT) > 8 && !r.told) { r.told = true; fail('soak', `${a.kind ?? 'crab'} stuck at ${a.x},${a.y} (stage ${s.stage + 1})`); }
        }
      }
      if (s.status === 'clear' && s.statusT > 1) { stages++; s.advance(); maxStage = Math.max(maxStage, s.stage + s.loop * 12); still.clear(); }
      if (s.status === 'over') { overs++; fresh(); lastScore = 0; }
    }
  } catch (err) {
    fail('soak', err.stack);
  }
  console.log(`  ${games} games, ${stages} stages drained, ${cuts} dykes, ${deaths} lives lost, ${overs} game overs, furthest stage ${maxStage + 1}`);
}

console.log(bad ? `\n${bad} problem(s)` : '\nall good');
process.exit(bad ? 1 : 0);
