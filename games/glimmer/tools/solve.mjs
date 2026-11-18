// Finds a clearing route for every level by searching the real simulation, sentinels and all,
// and writes them to src/routes.js (the demo replays them; verify.mjs proves them).
//
//   mise exec -- node games/glimmer/tools/solve.mjs            every level
//   mise exec -- node games/glimmer/tools/solve.mjs 2-3 4-1    just these
//   … --calm   without sentinels (layout check only, writes nothing)
//
// Search: weighted A* over macro inputs (one action held for a tile's worth of steps, or a
// whole dig), one glimmer at a time, then the way out. The estimate is the cost over the static
// level graph (reach.js). A macro in which Wren dies is pruned, so a route found here is one the
// sentinels cannot stop. Legs that strand him are backtracked: the leg before looks for another
// glimmer first.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COLS, U } from '../src/level.js';
import { LEVELS } from '../src/levels.js';
import { encodeRoute, macroLen } from '../src/pilot.js';
import { buildGraph } from '../src/reach.js';
import { colOf, createSim, fromAction, rowOf } from '../src/sim.js';

const ACTIONS = [0, 1, 2, 3, 4, 5, 6];
// tried in turn for each leg: greedy on Wren alone, then with the sentinels in the state
const PLAN = [
  { weight: 2.2, guards: false, budget: 6000 },
  { weight: 1.7, guards: true, budget: 60000 },
  { weight: 1.3, guards: true, budget: 250000 },
];
const OUT = fileURLToPath(new URL('../src/routes.js', import.meta.url));

export function seedOf(id) { return 7 + ([...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 0) % 9973); }

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

function keyOf(s, guards) {
  const h = s.hero;
  let k = h.x + ',' + h.y + ',' + h.dig;
  for (const o of s.holes) k += ';' + o.c + ',' + o.r + (guards ? ',' + (o.ph === 2 ? 9 : Math.floor(o.t / 90)) : '');
  for (const sh of s.shards) if (sh.st !== 1) k += sh.st === 2 ? 'x' : ':' + sh.c + '.' + sh.r;
  if (guards) for (const g of s.guards) k += '|' + colOf(g.x) + ',' + rowOf(g.y) + g.st[0];
  return k;
}
const tileOf = a => Math.max(0, rowOf(a.y)) * COLS + colOf(a.x);

// where the search is headed: the glimmers lying about (or the sentinel carrying one), or the way out
function goals(sim) {
  const s = sim.s, out = [];
  if (!s.left) { for (let c = 0; c < COLS; c++) if (sim.L.t[0][c] === 'H' || sim.L.t[0][c] === '^') out.push(c); return out; }
  s.shards.forEach((k, i) => {
    if (k.st === 0) out.push(k.r * COLS + k.c);
    else if (k.st === 2) { const g = s.guards.find(o => o.carry === i); if (g) out.push(tileOf(g)); }
  });
  return out;
}

function leg(sim, start, G, { budget, weight, guards }, avoid) {
  sim.restore(start);
  const left0 = sim.s.left, graph = left0 ? G.pre : G.post;
  const est = () => {
    const d = graph.field(goals(sim))[tileOf(sim.s.hero)];
    return (d === Infinity ? 80 : d) + (left0 ? 0 : 1);
  };
  const heap = new Heap(), seen = new Set([keyOf(sim.s, guards)]);
  heap.push({ f: est() * weight, g: 0, snap: start, a: -1, up: null });
  let n = 0;
  while (heap.size && n < budget) {
    const node = heap.pop();
    sim.restore(node.snap);
    const h0 = sim.s.hero, busy = h0.dig > 0 || h0.mode === 'fall';
    const x0 = h0.x, y0 = h0.y, holes0 = sim.s.holes.length;
    for (const a of busy ? [0] : ACTIONS) {
      n++;
      sim.restore(node.snap);
      const inp = fromAction(a);
      for (let k = macroLen(a); k > 0; k--) { sim.step(inp); if (sim.s.status !== 'play') break; }
      const s = sim.s, st = s.status;
      if (st === 'dying' || st === 'dead') continue;
      if (a && s.hero.x === x0 && s.hero.y === y0 && s.holes.length <= holes0 && !s.hero.dig) continue; // went nowhere
      const g = node.g + (a === 5 || a === 6 ? 2 : 1) + (a !== node.a ? 0.25 : 0);
      const here = { g, a, up: node };
      if (st === 'clear') return { snap: sim.snapshot(), path: pathOf(here), n };
      if (s.left < left0) {
        const took = s.shards.findIndex((k, i) => k.st === 1 && start.shards[i].st !== 1);
        if (avoid.has(took)) continue;
        const snap = sim.snapshot();
        if (!survives(sim, snap)) continue;
        return { snap, path: pathOf(here), n, took };
      }
      const key = keyOf(s, guards);
      if (seen.has(key)) continue;
      seen.add(key);
      here.snap = sim.snapshot();
      here.f = g + est() * weight;
      heap.push(here);
    }
    node.snap = null;
  }
  return null;
}
// can Wren stay alive for a while from here (not already caught, sealed in, or cornered)?
function survives(sim, snap, depth = 14, budget = 4000) {
  const seen = new Set();
  let n = 0;
  const go = (st, d) => {
    if (d === 0) return true;
    sim.restore(st);
    const h0 = sim.s.hero, busy = h0.dig > 0 || h0.mode === 'fall';
    for (const a of busy ? [0] : [0, 1, 2, 3, 4, 5, 6]) {
      if (++n > budget) return true; // too many ways on to be cornered
      sim.restore(st);
      const inp = fromAction(a);
      for (let k = macroLen(a); k > 0; k--) { sim.step(inp); if (sim.s.status !== 'play') break; }
      if (sim.s.status === 'clear') return true;
      if (sim.s.status !== 'play') continue;
      const key = keyOf(sim.s, true) + '#' + d;
      if (seen.has(key)) continue;
      seen.add(key);
      if (go(sim.snapshot(), d - (a === 5 || a === 6 ? 2 : 1))) return true;
    }
    return false;
  };
  const ok = go(snap, depth);
  sim.restore(snap);
  return ok;
}
function pathOf(node) {
  const out = [];
  for (let p = node; p && p.a >= 0; p = p.up) out.push(p.a);
  return out.reverse();
}

export function solveLevel(def, { seed = seedOf(def.id), log = () => {}, plan = PLAN } = {}) {
  const sim = createSim();
  sim.load(def, { seed });
  const G = { pre: buildGraph(sim.L), post: buildGraph(sim.L, { stair: true }) };
  // one entry per glimmer gathered so far; a leg that cannot go on sends its parent another way
  const stack = [{ snap: sim.snapshot(), path: [], avoid: new Set(), took: -1 }];
  let total = 0, backtracks = 0;
  while (stack.length) {
    const top = stack[stack.length - 1];
    let r = null;
    for (const o of plan) { if ((r = leg(sim, top.snap, G, o, top.avoid))) break; }
    if (r) {
      total += r.n;
      const path = top.path.concat(r.path);
      sim.restore(r.snap);
      if (sim.s.status === 'clear') {
        const steps = path.reduce((t, a) => t + macroLen(a), 0);
        return { seed, path, nodes: total, secs: steps / 60, tally: sim.s.tally, backtracks };
      }
      stack.push({ snap: r.snap, path, avoid: new Set(), took: r.took });
      continue;
    }
    sim.restore(top.snap);
    const h = sim.s.hero;
    log(`  stuck after ${top.path.length} macros at (${h.x / U},${h.y / U}) with ${sim.s.left} left`);
    stack.pop();
    if (!stack.length || ++backtracks > 40) return null;
    stack[stack.length - 1].avoid.add(top.took);
  }
  return null;
}

// ---------- CLI ----------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const calm = process.argv.includes('--calm'), dry = process.argv.includes('--dry') || calm;
  const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
  let routes = {};
  try { routes = JSON.parse(readFileSync(OUT, 'utf8').match(/=\s*(\{[\s\S]*\});/)[1]); } catch { /* first run */ }
  let failed = 0;
  for (const def of LEVELS) {
    if (only.length && !only.includes(def.id)) continue;
    const t0 = Date.now();
    const d = calm ? { ...def, map: def.map.map(r => r.replace(/G/g, '.')) } : def;
    const r = solveLevel(d, { log: m => console.log(m) });
    if (!r) { console.log(`${def.id} ${def.name}: NO ROUTE (${((Date.now() - t0) / 1000).toFixed(1)}s)`); failed++; continue; }
    if (!calm) routes[def.id] = { seed: r.seed, route: encodeRoute(r.path) };
    console.log(`${def.id} ${def.name}: cleared in ${r.secs.toFixed(1)}s of play, ${r.tally.traps} traps, ${r.tally.crushed} crushed, ${r.nodes} nodes, ${r.backtracks} backtracks, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  if (!dry) {
    const body = JSON.stringify(routes, null, 1).replace(/\n\s*/g, ' ');
    writeFileSync(OUT, `// Generated by tools/solve.mjs: a clearing route per level, replayed by the demo. Do not edit.\nexport const ROUTES = ${body};\n`);
  }
  if (failed) { console.log(`${failed} level(s) without a route`); process.exitCode = 1; }
}
