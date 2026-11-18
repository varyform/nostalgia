// Finds a climbing route for every tower by searching the real simulation, enemies, squalls
// and all, and writes them to src/routes.js (the demo replays them; verify.mjs proves them).
//
//   mise exec -- node games/spindle/tools/solve.mjs          every tower
//   mise exec -- node games/spindle/tools/solve.mjs 3 5      just these (1-based)
//
// 1. reach(): a breadth-first search of the real physics with the enemies taken out, joining
//    the cell (column, row) Clink is in before and after each macro (one input held for MACRO
//    steps). Walking back from the crown door over that graph gives every cell its distance
//    to the top, the search's guide, and shows which cells could strand him.
// 2. solveTower(): weighted best-first search over macros on the full simulation. A macro in
//    which he is knocked, falls in the sea or runs out of time is pruned, so a route found here
//    is one the enemies cannot stop.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MACRO, encodeRoute } from '../src/pilot.js';
import { COLS, HALF, K, P, adiff, colOf, createSim, fromBits } from '../src/sim.js';
import { TOWERS } from '../src/towers.js';

const MOVE = [0, 1, 2, 4, 8, 16, 17, 18];
const FIRE = [32, 33, 34];
const IDLE = fromBits(0);
const INPUT = Array.from({ length: 64 }, (_, b) => fromBits(b));
const OUT = fileURLToPath(new URL('../src/routes.js', import.meta.url));
// tried in turn: greedy first, then wider, then time-aware (waiting out an enemy)
const PLAN = process.env.QUICK ? [{ weight: 3, budget: 60000 }] : [
  { weight: 3, budget: 60000 },
  { weight: 2, budget: 150000 },
  { weight: 2, timeBucket: 1, budget: 300000 },
  { weight: 1.4, timeBucket: 0.5, budget: 800000 },
];

export const seedOf = i => 101 + i * 7919;
export const GOAL = -1;
const T0 = i => { const t = createSim().towers[i]; return t.start.c + COLS * t.start.r; };

export function startTower(sim, i, seed, { calm = false } = {}) {
  if (calm) sim.towers[i] = { ...sim.towers[i], spawns: [], squall: 0 };
  sim.newGame({ tower: i, seed });
  while (sim.s.status === 'ready') sim.step(IDLE);
  sim.events.length = 0;
}
export const cellOf = s => colOf(s.hero.th) + COLS * Math.max(-1, Math.floor(s.hero.y + 0.02));

function keyOf(sim, tb = 0) {
  const s = sim.s, h = s.hero;
  const air = !h.ground;
  let k = `${Math.round(h.th * (air ? 8 : 5)) % (COLS * (air ? 8 : 5))},${Math.round(h.y * (air ? 8 : 4))},${h.ground ? 1 : 0}${h.state[0]},${Math.round(h.vy)},${Math.round(h.vth * 2)},${h.upLock ? 1 : 0}${h.coyote > 0 ? 1 : 0}${s.prevJump ? 1 : 0}`;
  if (h.state === 'door') k += ',d' + Math.round(h.doorT * 10);
  for (const l of s.lifts) k += ',' + Math.round(l.y * 2) + (l.v > 0 ? 'u' : l.v < 0 ? 'd' : '');
  if (sim.T.hasBlink) k += ',b' + Math.floor((s.t % 3.2) / 0.2);
  const cr = Object.keys(s.crumb);
  if (cr.length) k += ',c' + cr.map(x => x + (s.crumb[x].gone ? 'g' + Math.ceil(s.crumb[x].t / 2) : 'c' + Math.ceil(s.crumb[x].t / 0.2))).join('.');
  if (tb) k += ',t' + Math.floor(s.t / tb);
  return k;
}
function prep(sim) { sim.T.hasBlink ??= sim.T.cell.includes(K.BLINK); }

// one macro; returns 'ok', 'goal' or 'dead'
function macro(sim, a) {
  sim.events.length = 0;
  const inp = INPUT[a];
  for (let k = 0; k < MACRO; k++) {
    sim.step(inp);
    if (sim.s.status !== 'play') break;
  }
  if (sim.s.status === 'sink') return 'goal';
  if (sim.s.status !== 'play' || sim.events.some(e => e.type === 'hit')) return 'dead';
  return 'ok';
}

/** where Clink can get to with the enemies out: a graph of the cells he can stand on. From
 *  every one (at three spots across it, and at four moments of the blinking ledges' cycle) it
 *  tries each move: walk off either way, jump straight up or either way (steering on or
 *  letting go), a doorway, a lift ride, being knocked off. An edge joins the cell to the one
 *  he comes to rest in; the crown door is GOAL. Each cell's distance to it guides the search. */
export function reach(i) {
  const sim = createSim();
  startTower(sim, i, 1, { calm: true });
  prep(sim);
  const T = sim.T, base = sim.snapshot();
  const nodes = [];
  for (let r = 0; r < T.rows + 1; r++) for (let c = 0; c < COLS; c++) {
    const k = T.at(c, r);
    if ([K.LEDGE, K.SLIP, K.CRUMB, K.BLINK, K.DOOR, K.EXIT].includes(k) || (k !== K.BLOCK && T.at(c, r - 1) === K.BLOCK)) nodes.push({ c, r, lift: -1 });
  }
  T.lifts.forEach((L, li) => { for (let r = L.r0; r <= L.r1; r++) nodes.push({ c: L.c, r, lift: li }); });
  const MOVES = [
    [[1, 90]], [[2, 90]], [[16, 1], [0, 150]], [[17, 1], [1, 150]], [[18, 1], [2, 150]], [[17, 1], [0, 150]], [[18, 1], [0, 150]],
    [[4, 1], [0, 150]], [[4, 2], [0, 150]], [[8, 2], [0, 150]], [[4, 600]], [[8, 600]], [[1, 8], [17, 1], [1, 150]], [[2, 8], [18, 1], [2, 150]],
    'k-', 'k+',
  ];
  const phases = T.hasBlink ? [0, 0.8, 1.6, 2.4] : [0];
  const edges = new Map(), rest = new Set();
  let goal = false, tries = 0;
  for (const nd of nodes) {
    const from = nd.c + COLS * nd.r;
    for (const ph of phases) for (const off of [0.5, 0.18, 0.82]) {
      sim.restore(base);
      const s = sim.s, h = s.hero;
      s.t = ph;
      Object.assign(h, { th: nd.c + off, y: nd.r, ground: true, state: 'stand', lift: nd.lift, vth: 0, vy: 0 });
      if (nd.lift >= 0) s.lifts[nd.lift].y = nd.r;
      if (sim.standCell() !== from) continue;
      // no standing half inside a block
      if ([-0.3, 0.3].some(dx => { const c = colOf(h.th + dx); return T.at(c, nd.r) === K.BLOCK || T.at(c, nd.r + 1) === K.BLOCK; })) continue;
      rest.add(from);
      const start = sim.snapshot();
      for (const mv of MOVES) {
        tries++;
        sim.restore(start);
        let to = null, dead = false;
        if (typeof mv === 'string') {
          sim.knock(mv === 'k-' ? -1 : 1);
          for (let k = 0; k < 300 && sim.s.status === 'play' && !sim.s.hero.ground; k++) sim.step(IDLE);
          dead = sim.s.status !== 'play';
          to = sim.s.hero.ground ? sim.s.hero.th : null;
          if (!dead) { sim.s.hero.state = 'stand'; to = sim.standCell(); }
        } else {
          let left = false;
          run: for (const [bits, n] of mv) for (let k = 0; k < n; k++) {
            sim.step(INPUT[bits]);
            if (sim.s.status === 'sink') { to = GOAL; break run; }
            if (sim.s.status !== 'play') { dead = true; break run; }
            const c = sim.standCell();
            if (c === null) { left = true; continue; }
            if (c !== from || (left && bits === 0)) { to = c; if (c !== from) break run; }
          }
          if (to === null && !dead) to = sim.standCell();
        }
        if (dead || to === null || to === from) continue;
        if (to === GOAL) goal = true;
        let e = edges.get(from);
        if (!e) edges.set(from, (e = new Set()));
        e.add(to);
      }
    }
  }
  const back = new Map();
  for (const [a, set] of edges) for (const b of set) { if (!back.has(b)) back.set(b, []); back.get(b).push(a); }
  const dist = new Map([[GOAL, 0]]), bq = [GOAL];
  for (let h = 0; h < bq.length; h++) for (const a of back.get(bq[h]) ?? []) if (!dist.has(a)) { dist.set(a, dist.get(bq[h]) + 1); bq.push(a); }
  // the cells he can actually get to from the start
  const startCell = T.start.c + COLS * T.start.r, live = new Set([startCell]), fq = [startCell];
  for (let h = 0; h < fq.length; h++) for (const b of edges.get(fq[h]) ?? []) if (b !== GOAL && !live.has(b)) { live.add(b); fq.push(b); }
  return { edges, rest, live, dist, goal, tries, nodes: nodes.length };
}

// a small binary heap on f
function heap() {
  const a = [];
  return {
    get size() { return a.length; },
    push(x) { a.push(x); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } },
    pop() {
      const top = a[0], last = a.pop();
      if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
      return top;
    },
  };
}

/** a route up tower i with every enemy on, or null */
export function solveTower(i, { seed = seedOf(i), graph = reach(i), plan = PLAN, log = () => {} } = {}) {
  const { dist, edges } = graph;
  const shooty = TOWERS[i].map.some(l => /[ujc]/.test(l));
  const acts = shooty ? [...MOVE, ...FIRE] : MOVE;
  const far = Math.max(...dist.values()) + 10;
  // estimated macros to the top: from the hero to a next cell, then that cell's cost to go
  // (Dijkstra back from the crown door over the graph, an edge costing about what it takes)
  const T = createSim().towers[i];
  const isDoorEdge = (a, b) => b !== GOAL && T.at(a % COLS, Math.floor(a / COLS)) === K.DOOR && Math.floor(a / COLS) === Math.floor(b / COLS) && ((b % COLS) - (a % COLS) + COLS) % COLS === HALF;
  const travel = (th, y, a, b) => {
    if (b === GOAL) return Math.abs(adiff(th, (a % COLS) + 0.5)) * 3.3 + 1;
    if (isDoorEdge(a, b)) return Math.abs(adiff(th, (a % COLS) + 0.5)) * 3.3 + 11;
    return Math.max(1, Math.abs(adiff(th, (b % COLS) + 0.5)) * 3.3 + Math.abs(y - Math.floor(b / COLS)) * 3.3);
  };
  const costTo = new Map([[GOAL, 0]]), back = new Map();
  for (const [a, set] of edges) for (const b of set) { if (!back.has(b)) back.set(b, []); back.get(b).push(a); }
  const pq = heap();
  pq.push({ f: 0, c: GOAL });
  while (pq.size) {
    const { f, c } = pq.pop();
    if (f > costTo.get(c)) continue;
    for (const a of back.get(c) ?? []) {
      const w = f + travel((a % COLS) + 0.5, Math.floor(a / COLS), a, c);
      if (w < (costTo.get(a) ?? Infinity)) { costTo.set(a, w); pq.push({ f: w, c: a }); }
    }
  }
  const hcost = (sim, origin) => {
    if (!costTo.has(origin)) return far * 10;
    const h = sim.s.hero;
    if (h.state === 'door') return (P.door - h.doorT) * 10 + Math.min(...[...edges.get(origin)].filter(b => isDoorEdge(origin, b)).map(b => costTo.get(b) ?? far * 10));
    let best = Infinity;
    for (const b of edges.get(origin) ?? []) { const c = costTo.get(b); if (c !== undefined) best = Math.min(best, travel(h.th, h.y, origin, b) + c); }
    return best;
  };
  for (const { weight, budget, timeBucket = 0 } of plan) {
    const sim = createSim();
    startTower(sim, i, seed);
    prep(sim);
    const par = [-1], act = [0], open = heap(), seen = new Set([keyOf(sim, timeBucket)]);
    open.push({ f: 0, g: 0, id: 0, snap: sim.snapshot(), origin: sim.standCell() });
    let n = 0, found = -1, best = { d: far };
    while (open.size && n < budget && found < 0) {
      const cur = open.pop();
      for (const a of acts) {
        n++;
        sim.restore(cur.snap);
        const r = macro(sim, a);
        if (r === 'dead') continue;
        const id = par.length;
        par.push(cur.id); act.push(a);
        if (r === 'goal') { found = id; break; }
        const key = keyOf(sim, timeBucket);
        if (seen.has(key)) continue;
        seen.add(key);
        const sc = sim.standCell(), origin = sc ?? cur.origin, d = dist.get(origin) ?? far, hc = hcost(sim, origin);
        if (d < best.d) best = { d, th: sim.s.hero.th, y: sim.s.hero.y, t: sim.s.t };
        open.push({ f: cur.g + 1 + weight * hc, g: cur.g + 1, id, snap: sim.snapshot(), origin });
      }
    }
    if (found >= 0) {
      const macros = [];
      for (let id = found; id > 0; id = par[id]) macros.push(act[id]);
      macros.reverse();
      return { seed, macros, route: encodeRoute(macros), secs: (macros.length * MACRO) / 60, tries: n };
    }
    log(`    no route with weight ${weight}${timeBucket ? ` and ${timeBucket}s buckets` : ''} in ${n} tries (got to ${best.th?.toFixed(2)},${best.y} at ${best.t?.toFixed(1)}s, ${best.d} from the top)`);
  }
  return null;
}

// ---------- the command line ----------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const only = process.argv.slice(2).map(n => +n - 1);
  let routes = {};
  try { routes = (await import('../src/routes.js')).ROUTES; } catch { /* first run */ }
  for (let i = 0; i < TOWERS.length; i++) {
    if (only.length && !only.includes(i)) continue;
    const t0 = Date.now(), R = reach(i);
    console.log(`${i + 1} ${TOWERS[i].name}: ${R.nodes} cells, ${R.live.size} reachable, ${R.tries} moves tried, crown ${R.dist.has(T0(i)) ? 'reachable' : 'NOT reachable'}`);
    if (!R.dist.has(T0(i))) continue;
    const res = solveTower(i, { graph: R, log: console.log });
    if (!res) { console.log('  ✗ no route'); continue; }
    routes[i] = { seed: res.seed, route: res.route };
    console.log(`  ✓ ${res.secs.toFixed(1)}s of ${TOWERS[i].time}s, ${res.tries} tries, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  writeFileSync(OUT, `// Generated by tools/solve.mjs: a climbing route per tower, replayed by the demo. Do not edit.\nexport const ROUTES = ${JSON.stringify(routes)};\n`);
}
