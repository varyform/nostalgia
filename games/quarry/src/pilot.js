// The autopilot: plays the real simulation for the demo (and for tools/verify.mjs). It reads
// `sim.s` like a player reads the screen and hands back one input per step.
//
// At every crossing it plans on the cell grid (Dijkstra): tunnels are cheap, soil a little
// dearer, cells near a grub dear, a crate or the drop under a loose one off limits. It heads
// for the cheapest gem (gold, the lamp and, under the lamp, the grubs pull harder), shoots
// down any tunnel with a grub in it, and turns tail when a grub gets close.
//
//   const pilot = createPilot(sim, { seed: 3, grubs: true });
//   sim.step(pilot());
import { COLS, DOWN, DX, DY, ROWS, U } from './sim.js';

const N = COLS * ROWS;
const STEP = [1, COLS, -1, -COLS];

export function createPilot(sim, { seed = 1, skill = 1 } = {}) {
  let a = seed | 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const cost = new Float64Array(N), prev = new Int16Array(N), done = new Uint8Array(N);
  const banned = new Map(); // cell → until (s.t): somewhere we got stuck
  let plan = -1, lastX = -1, lastY = -1, still = 0, turnTo = -1, wander = 0, wanderDir = -1;

  function blockedCells(s) {
    const out = new Uint8Array(N);
    for (const c of s.crates) {
      const col = Math.round(c.x / U), row = Math.floor(c.y / U);
      out[row * COLS + col] = 1;
      if (c.y % U) out[(row + 1) * COLS + col] = 1;
      if (c.x % U) out[row * COLS + Math.ceil(c.x / U)] = 1;
      // the drop under a crate that is coming down
      if (c.state === 'wobble' || c.state === 'fall') {
        for (let r = row + 1; r < ROWS; r++) {
          out[r * COLS + col] = 1;
          if (!s.cell[r * COLS + col]) break;
        }
      }
    }
    for (const [i, until] of banned) { if (until < s.t) banned.delete(i); else out[i] = 1; }
    return out;
  }
  // cells directly under a resting crate: never go down out of one (the crate would follow)
  function underCrate(s) {
    const out = new Uint8Array(N);
    for (const c of s.crates) if (c.state === 'rest' && c.y < (ROWS - 1) * U && !(c.x % U)) out[(c.y / U + 1) * COLS + c.x / U] = 1;
    return out;
  }
  function danger(s) {
    const out = new Float64Array(N);
    if (s.frenzy > 0.6) return out;
    for (const m of s.mons) {
      const mc = Math.round(m.x / U), mr = Math.round(m.y / U);
      for (let r = Math.max(0, mr - 3); r <= Math.min(ROWS - 1, mr + 3); r++)
        for (let c = Math.max(0, mc - 3); c <= Math.min(COLS - 1, mc + 3); c++) {
          const d = Math.abs(c - mc) + Math.abs(r - mr);
          if (d <= 3) out[r * COLS + c] += (4 - d) * (m.state === 'emerge' ? 2 : 7);
        }
    }
    return out;
  }
  const open = (s, i, d) => {
    if (d === 0) return s.hA[i] + s.hB[i] >= U;
    if (d === 2) return s.hA[i - 1] + s.hB[i - 1] >= U;
    if (d === 1) return s.vA[i] + s.vB[i] >= U;
    return s.vA[i - COLS] + s.vB[i - COLS] >= U;
  };
  function dijkstra(s, from) {
    const blocked = blockedCells(s), hang = underCrate(s), risk = danger(s);
    cost.fill(Infinity); prev.fill(-1); done.fill(0);
    cost[from] = 0;
    for (;;) {
      let i = -1, best = Infinity;
      for (let k = 0; k < N; k++) if (!done[k] && cost[k] < best) { best = cost[k]; i = k; }
      if (i < 0) break;
      done[i] = 1;
      const c = i % COLS, r = (i / COLS) | 0;
      for (let d = 0; d < 4; d++) {
        const nc = c + DX[d], nr = r + DY[d];
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        const j = i + STEP[d];
        if (blocked[j] || done[j]) continue;
        if (d === DOWN && hang[i]) continue;
        const v = best + (open(s, i, d) ? 1 : 1.25) + risk[j];
        if (v < cost[j]) { cost[j] = v; prev[j] = i; }
      }
    }
    return blocked;
  }
  function firstStep(from, to) {
    let j = to;
    while (prev[j] >= 0 && prev[j] !== from) j = prev[j];
    if (prev[j] !== from) return -1;
    for (let d = 0; d < 4; d++) if (from + STEP[d] === j) return d;
    return -1;
  }
  // targets: gems, gold, the lamp, grubs under the lamp
  function choose(s, from) {
    let best = -1, bestV = Infinity;
    const offer = (i, bias) => { const v = cost[i] + bias; if (v < bestV) { bestV = v; best = i; } };
    for (let i = 0; i < N; i++) if (s.gem[i]) offer(i, 0);
    for (const gd of s.gold) offer(Math.round(gd.y / U) * COLS + Math.round(gd.x / U), -5 + gd.t * 0.6);
    if (s.bonus.state === 'shown' && s.mons.length) offer(Math.round(s.bonus.y / U) * COLS + Math.round(s.bonus.x / U), -4 - s.mons.length * 2);
    if (s.frenzy > 1) for (const m of s.mons) offer(Math.round(m.y / U) * COLS + Math.round(m.x / U), -12);
    if (best === from) return -1;
    return best;
  }
  // a grub down a straight dug run from (x, y) in direction d, within range?
  function grubDown(s, x, y, d, range = 7 * U) {
    for (let k = 0; k < range; k++) {
      for (const m of s.mons) if (Math.abs(m.x - x) < 11 && Math.abs(m.y - y) < 11) return true;
      x += DX[d]; y += DY[d];
      if (x < 0 || y < 0 || x > (COLS - 1) * U || y > (ROWS - 1) * U || !sim.dugAt(x, y) || sim.crateAt(x, y)) return false;
    }
    return false;
  }
  function nearestGrub(s, h) {
    let best = null, bd = Infinity;
    for (const m of s.mons) {
      if (m.state === 'emerge') continue;
      const d = Math.abs(m.x - h.x) + Math.abs(m.y - h.y);
      if (d < bd) { bd = d; best = m; }
    }
    return { m: best, d: bd };
  }

  return function pilot() {
    const s = sim.s, h = s.hero;
    if (s.status !== 'play') { plan = -1; return { dir: -1, fire: false }; }
    const node = h.x % U === 0 && h.y % U === 0;
    // stuck behind something: ban the cell we were heading into for a while
    if (h.x === lastX && h.y === lastY) still++; else still = 0;
    lastX = h.x; lastY = h.y;
    if (still > 20 && plan >= 0) { banned.set(plan, s.t + 3); still = 0; plan = -1; wander = 0.5; wanderDir = Math.floor(rnd() * 4); }

    // shoot: straight ahead now, or turn on a crossing to face a grub
    let fire = false;
    if (s.reload <= 0 && !s.shot && s.frenzy <= 0 && s.mons.length) {
      if (grubDown(s, h.x, h.y, h.face)) fire = rnd() < 0.9 * skill;
      else if (node && turnTo < 0) for (let d = 0; d < 4; d++) if (d !== h.face && grubDown(s, h.x, h.y, d, 5 * U)) { turnTo = d; break; }
    }
    if (turnTo >= 0) { const d = turnTo; turnTo = -1; if (!fire) return { dir: d, fire: false }; }

    if (wander > 0) { wander -= 1 / 60; if (node) wanderDir = rnd() < 0.5 ? wanderDir : Math.floor(rnd() * 4); return { dir: wanderDir, fire }; }

    // between crossings, keep going (or back off from a grub coming the other way)
    if (!node) {
      const { m, d } = nearestGrub(s, h);
      if (m && d < 2 * U && s.frenzy <= 0) {
        const ahead = DX[h.dir] * (m.x - h.x) + DY[h.dir] * (m.y - h.y) > 0;
        if (ahead) return { dir: h.dir ^ 2, fire };
      }
      return { dir: h.dir, fire };
    }
    const from = (h.y / U) * COLS + h.x / U;
    dijkstra(s, from);
    const goal = choose(s, from);
    plan = -1;
    let dir = goal >= 0 ? firstStep(from, goal) : -1;
    // nothing worth having in reach: step to the safest neighbour
    if (dir < 0) {
      let bv = Infinity;
      for (let d = 0; d < 4; d++) {
        const nc = (from % COLS) + DX[d], nr = ((from / COLS) | 0) + DY[d];
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        const v = cost[from + STEP[d]] + rnd();
        if (v < bv) { bv = v; dir = d; }
      }
    }
    if (dir >= 0) plan = from + STEP[dir];
    return { dir, fire };
  };
}
