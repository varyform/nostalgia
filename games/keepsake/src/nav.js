// Wick's ways round a scene as a graph, for the autopilot and the verify tool. Each floor is cut
// into 40 px cells; edges walk to a neighbour cell, take a stair, drop off a floor's end or ride
// the bouncy awning, each costing the seconds it takes.
//
//   const nav = buildNav(scene);
//   const { dist, time, prev } = nav.paths(nav.node(f, x), danger);   // danger(node) → extra seconds;
//   dist is the priced-up cost, time the seconds the cheapest way takes
import { FLOOR_Y, FLOORS, SCENES, W, floorBelow, mod, segAt, stairLen } from './scenes.js';
import { G, HERO_V, SPRING_T, STAIR_V } from './sim.js';

export const CELL = 40, NC = W / CELL;

export function buildNav(sceneIndex) {
  const sc = SCENES[sceneIndex], N = FLOORS * NC;
  const has = Array.from({ length: N }, () => false);
  for (let f = 0; f < FLOORS; f++) for (let c = 0; c < NC; c++) has[f * NC + c] = segAt(sc, f, (c + 0.5) * CELL) >= 0;
  const edges = Array.from({ length: N }, () => []);
  const walkT = CELL / HERO_V;
  for (let f = 0; f < FLOORS; f++) {
    const fl = sc.floors[f];
    for (let c = 0; c < NC; c++) {
      const id = f * NC + c;
      if (!has[id]) continue;
      for (const dir of [-1, 1]) {
        let nc = c + dir;
        if (nc < 0 || nc >= NC) { if (!fl.wrap) continue; nc = mod(nc, NC); }
        const nid = f * NC + nc;
        if (has[nid]) { edges[id].push({ to: nid, cost: walkT, kind: 'walk', dir }); continue; }
        // off the end of this piece of floor: fall to the first floor below
        const x = (nc + 0.5) * CELL, k = floorBelow(sc, f, x);
        if (k < 0) continue;
        const t = Math.sqrt((2 * (FLOOR_Y[k] - FLOOR_Y[f])) / G);
        edges[id].push({ to: k * NC + nc, cost: walkT + t + 0.05, kind: 'fall', dir });
      }
    }
  }
  sc.stairs.forEach((st, i) => {
    const bot = (st.f + 1) * NC + Math.floor(st.xb / CELL), top = st.f * NC + Math.floor(st.xt / CELL), t = stairLen(st) / STAIR_V + 0.05;
    edges[bot].push({ to: top, cost: t, kind: 'stair', stair: i, x: st.xb, key: 'up' });
    edges[top].push({ to: bot, cost: t, kind: 'stair', stair: i, x: st.xt, key: 'down' });
  });
  const gm = sc.gimmick;
  if (gm.kind === 'spring') {
    const to = segAt(sc, gm.to, gm.x) >= 0 ? gm.to : gm.to + 1, c = Math.floor(gm.x / CELL);
    edges[gm.f * NC + c].push({ to: to * NC + c, cost: SPRING_T + 0.1, kind: 'spring', x: gm.x, key: 'up' });
  }

  const node = (f, x) => {
    let c = Math.max(0, Math.min(NC - 1, Math.floor(mod(x, W) / CELL)));
    if (!has[f * NC + c]) {
      // just past a piece's end (while stepping off it): the nearest cell with floor
      for (let d = 1; d < NC; d++) {
        if (c - d >= 0 && has[f * NC + c - d]) { c -= d; break; }
        if (c + d < NC && has[f * NC + c + d]) { c += d; break; }
      }
    }
    return f * NC + c;
  };
  const fOf = id => Math.floor(id / NC), xOf = id => ((id % NC) + 0.5) * CELL;

  // Dijkstra from one node; danger(id) adds seconds for entering a node (0 = none)
  function paths(from, danger = null) {
    const dist = new Float64Array(N).fill(Infinity), time = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1), pe = Array.from({ length: N }, () => null), done = new Uint8Array(N);
    dist[from] = 0; time[from] = 0;
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < N; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0) break;
      done[u] = 1;
      for (const e of edges[u]) {
        const d = best + e.cost + (danger ? danger(e.to) : 0);
        if (d < dist[e.to]) { dist[e.to] = d; time[e.to] = time[u] + e.cost; prev[e.to] = u; pe[e.to] = e; }
      }
    }
    return { dist, time, prev, pe };
  }
  // the first edge on the way to `to` (null when already there or unreachable)
  function firstEdge(P, from, to) {
    if (to === from || P.prev[to] < 0) return null;
    let v = to;
    while (P.prev[v] !== from) { v = P.prev[v]; if (v < 0) return null; }
    return P.pe[v];
  }
  // seconds from every cell to every other, the plain way (no danger): between[a * N + b]
  let all = null;
  function between(a, b) {
    if (!all) {
      all = new Float32Array(N * N).fill(Infinity);
      for (let i = 0; i < N; i++) if (has[i]) all.set(paths(i).time, i * N);
    }
    return all[a * N + b];
  }
  return { sc, N, has, edges, node, fOf, xOf, paths, firstEdge, between };
}
