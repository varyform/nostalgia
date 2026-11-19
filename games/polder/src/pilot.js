// The autopilot: plays the attract-mode demo (and the verify tool's strong bot). Whenever the
// skimmer stands idle on land it draws up a few dozen cuts: walk the dykes to a spot on the
// shore, run out into the water, along, and back in (or straight across to the far side). The
// sim is deterministic, so each cut is tried out on a copy of it, jellies, crabs, undertow and
// all, and the one that drains the most water a second without being caught is taken.
// `sloppy` (0–1) dawdles between cuts and now and then takes a cut that it saw go wrong.
//
//   const pilot = createPilot(sim, { sloppy: 0.3, seed: 1 });
//   sim.step(pilot());
import { DIRS, LAND, N, SEA, W, H } from './sim.js';

const NONE = { dir: null, press: null };
const LIST = Object.entries(DIRS);
const PERP = { left: ['up', 'down'], right: ['up', 'down'], up: ['left', 'right'], down: ['left', 'right'] };
const OPP = { left: 'right', right: 'left', up: 'down', down: 'up' };
const MAX_WALK = 44;

export function dirOf(a, b) {
  const d = b - a;
  return d === 1 ? 'right' : d === -1 ? 'left' : d === W ? 'down' : d === -W ? 'up' : null;
}

export function createPilot(sim, { sloppy = 0, seed = 7, budget = 44 } = {}) {
  let r = seed | 0 || 1;
  const rnd = () => { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; return (r >>> 0) / 4294967296; };
  let plan = null, idx = 0, serial = -1, wait = 0;
  const dist = new Int16Array(N), par = new Int32Array(N);

  function pilot() {
    if (sim.serial !== serial) { serial = sim.serial; plan = null; }
    if (sim.status !== 'play') { plan = null; return NONE; }
    const p = sim.p;
    if (plan) {
      const cur = p.y * W + p.x;
      while (idx < plan.length && plan[idx] !== cur) idx++;
      if (idx < plan.length - 1) return { dir: dirOf(plan[idx], plan[idx + 1]), press: null };
      plan = null; // there, or knocked off it
    }
    if (p.moving) return NONE;
    if (wait > 0) { wait--; return NONE; }
    const pick = choose();
    if (!pick) { wait = 8 + Math.floor(rnd() * 10); return evade(); }
    plan = pick; idx = 0;
    if (sloppy) wait = Math.floor(rnd() * 30 * sloppy);
    return { dir: dirOf(plan[0], plan[1]), press: null };
  }

  // try a path out on a copy of the sim: does the dyke close, how much drains, how long it takes
  function trial(path, after = 40) {
    const c = sim.clone(), c0 = c.claimed;
    let i = 0;
    for (let s = 0; s < 1400; s++) {
      const cur = c.p.y * W + c.p.x;
      while (i < path.length && path[i] !== cur) i++;
      if (i >= path.length) return { ok: false, at: s, gain: 0 };
      const d = i < path.length - 1 ? dirOf(path[i], path[i + 1]) : null;
      if (d === null && !c.p.moving) {
        const gain = c.claimed - c0;
        // and not caught right after, standing there
        for (let k = 0; k < after; k++) { c.step(NONE); c.events.length = 0; if (c.status !== 'play') break; }
        return { ok: c.status === 'play' || c.status === 'clear', at: s, gain, steps: s, clear: c.status === 'clear' };
      }
      c.step({ dir: d, press: null });
      c.events.length = 0;
      if (c.status === 'dead' || c.status === 'over') return { ok: false, at: s, gain: 0, steps: path.length };
      if (c.status === 'clear') return { ok: true, at: s, gain: c.claimed - c0, steps: s, clear: true };
    }
    return { ok: false, at: 1400, gain: 0 };
  }

  // the land within a walk of the skimmer
  function walkMap(start) {
    const G = sim.grid;
    dist.fill(-1);
    dist[start] = 0;
    const q = [start];
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % W, y = (i / W) | 0;
      if (dist[i] >= MAX_WALK) continue;
      for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (n < 0 || dist[n] >= 0 || G[n] !== LAND) continue;
        dist[n] = dist[i] + 1; par[n] = i; q.push(n);
      }
    }
    return q;
  }
  const walkTo = e => { const out = [e]; while (dist[out[0]] > 0) out.unshift(par[out[0]]); return out; };
  // out from the shore cell e: d for a cells, l for b cells, back against d until land
  function cut(e, d, a, l, b) {
    const G = sim.grid, out = [];
    let x = e % W, y = (e / W) | 0;
    const go = dir => {
      x += DIRS[dir][0]; y += DIRS[dir][1];
      if (x < 0 || y < 0 || x >= W || y >= H) return 'bad';
      const i = y * W + x;
      out.push(i);
      return G[i] === LAND ? 'land' : G[i] === SEA ? 'sea' : 'bad';
    };
    for (const [dir, n] of [[d, a], [l, b], [OPP[d], 90]]) {
      if (!dir) continue;
      for (let k = 0; k < n; k++) {
        const s = go(dir);
        if (s === 'land') return out;
        if (s === 'bad') return null;
      }
    }
    return null;
  }

  function choose() {
    const G = sim.grid, p = sim.p, start = p.y * W + p.x;
    const land = walkMap(start);
    const shore = [];
    for (const i of land) for (const [d, [dx, dy]] of LIST) {
      const x = (i % W) + dx, y = ((i / W) | 0) + dy;
      if (x >= 0 && y >= 0 && x < W && y < H && G[y * W + x] === SEA) shore.push({ e: i, d });
    }
    if (!shore.length) return null;
    // the near shore, and some of the rest
    const picks = shore.slice(0, 12);
    for (let k = 0; k < 10 && shore.length > 12; k++) picks.push(shore[12 + Math.floor(rnd() * (shore.length - 12))]);
    const plans = [];
    for (const { e, d } of picks) {
      const walk = walkTo(e);
      const across = cut(e, d, 90, null, 0);
      if (across && across.length <= 46) plans.push(walk.concat(across));
      for (let k = 0; k < 2; k++) {
        const a = 1 + Math.floor(rnd() ** 1.4 * 18), l = PERP[d][rnd() < 0.5 ? 0 : 1], b = 2 + Math.floor(rnd() * 32);
        const c = cut(e, d, a, l, b);
        if (c && c.length <= 80) plans.push(walk.concat(c));
      }
    }
    let best = null, bestV = -Infinity, risky = null;
    for (const path of plans.slice(0, budget)) {
      const t = trial(path);
      if (!t.ok) { if (t.at > path.length * 2.2 && (!risky || rnd() < 0.5)) risky = path; continue; }
      if (t.gain <= 0) continue;
      const v = t.gain / (t.steps + 45) + (t.clear ? 100 : 0) + rnd() * 0.05;
      if (v > bestV) { bestV = v; best = path; }
    }
    if (sloppy && risky && rnd() < sloppy * 0.18) return risky;
    return best;
  }

  // nothing safe to cut: stay put, or step out of a crab's way
  function evade() {
    const p = sim.p, start = p.y * W + p.x;
    const stay = trial([start], 50);
    if (stay.ok) return NONE;
    for (const [d, [dx, dy]] of LIST) {
      const x = p.x + dx, y = p.y + dy;
      if (x < 0 || y < 0 || x >= W || y >= H || sim.grid[y * W + x] !== LAND) continue;
      const t = trial([start, y * W + x], 50);
      if (t.ok) { plan = [start, y * W + x]; idx = 0; return { dir: d, press: null }; }
    }
    return NONE;
  }

  return pilot;
}
