// Finds a clearing route for every stage by searching the real simulation, prickles and all,
// and writes them to src/routes.js (the demo replays them; verify.mjs proves them).
//
//   mise exec -- node games/dewdrop/tools/solve.mjs            every stage
//   mise exec -- node games/dewdrop/tools/solve.mjs 2-3 4-1    just these
//
// Search: weighted A* over macro inputs (one input held for MACRO steps), one glowberry at a
// time, then the moonbloom. Nodes are deduplicated on a coarse key of Dew's position, speed
// and mode (plus the lily pads' phase where they move). A step where Dew dies is pruned, so a
// route found here is a route the prickles cannot stop.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COLS, ROWS } from '../src/level.js';
import { MACRO, encodeRoute } from '../src/pilot.js';
import { STAGES } from '../src/stages.js';
import { createSim } from '../src/sim.js';

const ACTIONS = [0, 1, 2, 16, 17, 18, 4, 8];
// tried in turn for each leg: greedy first, then wider, then time-aware (waiting out a prickle)
const PLAN = [
  { weight: 2, budget: 150000 },
  { weight: 1.3, budget: 400000 },
  { weight: 1.6, timeBucket: 1, budget: 600000 },
  { weight: 1.1, timeBucket: 0.5, budget: 1200000 },
];
const OUT = fileURLToPath(new URL('../src/routes.js', import.meta.url));

export function seedOf(id) { return 7 + [...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 0) % 9973; }

// Where Dew can get to, as a graph of tiles: a breadth-first search of the real physics with
// no prickles, joining the tile her centre is in before and after each macro.
const cellOf = sim => { const p = sim.s.p; return Math.floor(p.y + p.h / 2) * COLS + Math.floor(p.x + p.w / 2); };
export function reach(def, { budget = 500000 } = {}) {
  const sim = createSim();
  sim.load({ ...def, waves: [] }, { world: def.world, seed: 1 });
  const edges = Array.from({ length: COLS * ROWS }, () => new Set());
  const seen = new Set([keyOf(sim, 0, true)]), q = [sim.snapshot()], visited = new Set([cellOf(sim)]), rest = new Set([cellOf(sim)]);
  let n = 0;
  while (q.length && n < budget) {
    const cur = q.shift();
    sim.restore(cur);
    const from = cellOf(sim);
    for (const a of ACTIONS) {
      n++;
      sim.restore(cur);
      const input = { left: !!(a & 1), right: !!(a & 2), up: !!(a & 4), down: !!(a & 8), jump: !!(a & 16) };
      for (let k = 0; k < MACRO; k++) { sim.step(input); if (sim.s.status !== 'play') break; }
      if (sim.s.status !== 'play') continue;
      const to = cellOf(sim);
      if (to !== from) edges[from].add(to);
      visited.add(to);
      if (sim.s.p.mode !== 'air') rest.add(to);
      const key = keyOf(sim, 0, true);
      if (seen.has(key)) continue;
      seen.add(key);
      q.push(sim.snapshot());
    }
  }
  return { edges, visited, rest, states: seen.size, complete: q.length === 0 };
}
// macros-to-go from every tile to the nearest goal tile, backwards over the reach graph
function field(R, goals) {
  const back = R.back ?? (R.back = (() => {
    const b = Array.from({ length: COLS * ROWS }, () => []);
    R.edges.forEach((set, i) => { for (const j of set) b[j].push(i); });
    return b;
  })());
  const d = new Float64Array(COLS * ROWS).fill(Infinity), q = [];
  for (const [c, r] of goals) for (const [dc, dr] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const i = (r + dr) * COLS + c + dc;
    if (c + dc >= 0 && c + dc < COLS && r + dr >= 0 && r + dr < ROWS && d[i] > (dc || dr ? 1 : 0)) { d[i] = dc || dr ? 1 : 0; q.push(i); }
  }
  q.sort((a, b) => d[a] - d[b]);
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    for (const j of back[i]) if (d[j] > d[i] + 1) { d[j] = d[i] + 1; q.push(j); }
  }
  return d;
}

class Heap {
  constructor() { this.a = []; }
  push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

function keyOf(sim, timeBucket, noLeaves = false) {
  const s = sim.s, p = s.p, L = sim.L;
  const vx = p.vx > 2 ? 2 : p.vx < -2 ? 0 : 1, vy = p.vy < -3 ? 0 : p.vy > 3 ? 2 : 1;
  const mode = p.mode === 'ground' ? 0 : p.mode === 'air' ? 1 : p.mode === 'climb' ? 2 : 3;
  let k = `${Math.round(p.x * 4)},${Math.round(p.y * 4)},${vx}${vy}${mode}${p.hold ? 1 : 0}`;
  if (L.movers.length) k += ',' + L.movers.map(m => Math.floor(((s.t / m.period + m.phase) % 1) * 8)).join('');
  // only the leaves near her matter for where she can go next
  if (L.crumbles.length && !noLeaves) {
    const cx = p.x + p.w / 2, cy = p.y + p.h;
    k += ',' + L.crumbles.map((c, i) => (Math.abs(c.c + 0.5 - cx) < 3 && Math.abs(c.r - cy) < 3 ? s.cr[i].st : '')).join('');
  }
  if (timeBucket) k += ',' + Math.floor(s.t / timeBucket);
  return k;
}

// one leg: from `start` (a snapshot) until a new berry is taken (or, with none left, home)
function leg(sim, start, R, { budget = 120000, weight = 1.4, timeBucket = 0, avoid = new Set() } = {}) {
  sim.restore(start);
  const L = sim.L, left0 = sim.berriesLeft();
  const goals = left0 ? L.berries.filter((b, i) => !sim.s.taken[i] && !avoid.has(i)).map(b => [Math.floor(b.x), Math.floor(b.y)]) : [[L.door.c, L.door.r]];
  if (!goals.length) return null;
  const d = field(R, goals);
  const h = () => { const v = d[cellOf(sim)]; return (v === Infinity ? 200 : v) * MACRO * 0.8; };
  const heap = new Heap(), seen = new Set();
  heap.push({ f: h() * weight, g: 0, snap: start, path: [], last: -1 });
  seen.add(keyOf(sim, timeBucket));
  let n = 0;
  while (heap.size && n < budget) {
    const node = heap.pop();
    for (const a of ACTIONS) {
      n++;
      sim.restore(node.snap);
      const input = { left: !!(a & 1), right: !!(a & 2), up: !!(a & 4), down: !!(a & 8), jump: !!(a & 16) };
      let dead = false;
      for (let k = 0; k < MACRO; k++) { sim.step(input); if (sim.s.status !== 'play') break; }
      const st = sim.s.status;
      if (st === 'dying' || st === 'over') dead = true;
      if (dead) continue;
      const path = node.path.concat(a);
      if (st === 'clear') return { snap: sim.snapshot(), path, n };
      const left = sim.berriesLeft();
      if (left < left0) {
        const took = sim.s.taken.findIndex((t, i) => t && !start.taken[i]);
        const snap = sim.snapshot();
        if (!avoid.has(took) && viable(sim, snap)) return { snap, path, n, took };
        continue;
      }
      const key = keyOf(sim, timeBucket);
      if (seen.has(key)) continue;
      seen.add(key);
      const g = node.g + MACRO + (a !== node.last ? 2.5 : 0) + (a & 16 ? 1.5 : 0);
      heap.push({ f: g + h() * weight, g, snap: sim.snapshot(), path, last: a });
    }
  }
  return null;
}

// can she still come to rest from here (not already falling to her doom)?
function viable(sim, snap) {
  const q = [snap], seen = new Set();
  for (let n = 0; q.length && n < 600; ) {
    const cur = q.shift();
    for (const a of ACTIONS) {
      n++;
      sim.restore(cur);
      const input = { left: !!(a & 1), right: !!(a & 2), up: !!(a & 4), down: !!(a & 8), jump: !!(a & 16) };
      for (let k = 0; k < MACRO; k++) { sim.step(input); if (sim.s.status !== 'play') break; }
      if (sim.s.status === 'clear') return true;
      if (sim.s.status !== 'play') continue;
      if (sim.s.p.mode !== 'air') { sim.restore(snap); return true; }
      const key = keyOf(sim, 0);
      if (!seen.has(key)) { seen.add(key); q.push(sim.snapshot()); }
    }
  }
  sim.restore(snap);
  return false;
}

export { leg, keyOf };
export function solveStage(def, { seed = seedOf(def.id), log = () => {} } = {}) {
  const sim = createSim();
  sim.load(def, { world: def.world, seed });
  const R = reach(def);
  // one entry per berry taken so far; a leg that cannot go on sends its parent after another berry
  const stack = [{ snap: sim.snapshot(), path: [], avoid: new Set(), took: -1 }];
  let total = 0, backtracks = 0;
  while (stack.length) {
    const top = stack[stack.length - 1];
    let r = null;
    for (const o of PLAN) { if ((r = leg(sim, top.snap, R, { ...o, avoid: top.avoid }))) break; }
    if (r) {
      total += r.n;
      const path = top.path.concat(r.path);
      sim.restore(r.snap);
      if (sim.s.status === 'clear') return { seed, path, nodes: total, secs: (path.length * MACRO) / 60, tally: sim.s.tally, backtracks };
      stack.push({ snap: r.snap, path, avoid: new Set(), took: r.took });
      continue;
    }
    sim.restore(top.snap);
    const left = sim.L.berries.filter((b, i) => !sim.s.taken[i]).map(b => `(${b.x - 0.5},${b.y - 0.5})`).join(' ');
    const p = sim.s.p;
    log(`  stuck after ${top.path.length} macros at (${(p.x + p.w / 2).toFixed(1)},${(p.y + p.h).toFixed(1)}) ${p.mode}, left: ${left || 'home'}`);
    if (process.env.DEBUG) writeFileSync('/tmp/dw-stuck.json', JSON.stringify({ id: def.id, path: top.path }));
    stack.pop();
    if (!stack.length || ++backtracks > 8) return null;
    stack[stack.length - 1].avoid.add(top.took);
  }
  return null;
}

// ---------- CLI ----------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const calm = process.argv.includes('--calm'), dry = process.argv.includes('--dry');
  const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
  let routes = {};
  try { routes = JSON.parse(readFileSync(OUT, 'utf8').match(/=\s*(\{[\s\S]*\});/)[1]); } catch { /* first run */ }
  let failed = 0;
  for (const def of STAGES) {
    if (only.length && !only.includes(def.id)) continue;
    const t0 = Date.now();
    const r = solveStage(calm ? { ...def, waves: [] } : def, { log: m => console.log(m) });
    if (!r) { console.log(`${def.id} ${def.name}: NO ROUTE`); failed++; continue; }
    routes[def.id] = { seed: r.seed, route: encodeRoute(r.path) };
    console.log(`${def.id} ${def.name}: cleared in ${r.secs.toFixed(1)}s of play, ${r.nodes} nodes, ${r.backtracks} backtracks, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  const body = JSON.stringify(routes, null, 1).replace(/\n\s*/g, ' ');
  if (!dry && !calm) writeFileSync(OUT, `// Generated by tools/solve.mjs: a clearing route per stage, replayed by the demo. Do not edit.\nexport const ROUTES = ${body};\n`);
  if (failed) { console.log(`${failed} stage(s) without a route`); process.exitCode = 1; }
}
