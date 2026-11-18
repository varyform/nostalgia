// Glimmer's simulation: one level at a time, Wren, the sentinels, the holes and the glimmers.
//
// Positions are whole numbers of 1/U tile and time is whole steps of 1/60 s; only integer
// arithmetic and a seeded generator touch the state, so a recorded route replays exactly the
// same way in every engine. No canvas, no DOM, no audio: the page, the demo and the Node solver
// all drive it with input snapshots and read `sim.s` (all that changes, a plain object the
// solver snapshots and restores) and `sim.L` (the parsed level) to draw it.
//
//   const sim = createSim();
//   sim.load(levelDef, { seed, score });
//   sim.step({ left, right, up, down, digL, digR });
//   sim.s.hero, sim.s.guards, sim.s.holes …   sim.events: what happened this step
import { COLS, ROWS, U, parseLevel } from './level.js';
import { buildGraph } from './reach.js';

export const DT = 1 / 60;
// durations in steps
export const T = { dig: 24, open: 330, fill: 60, trap: 150, respawn: 100, dying: 80, clear: 60 };
// sentinel pace per world, in 1/16 sub-steps per step (Wren runs at 16)
export const SPEED = [9, 10, 11, 12];
export const SCORE = { shard: 250, trap: 75, crush: 75, clear: 1500 };
const TOUCH = 8; // a sentinel nearer than this on both axes catches Wren
const PICK = 0.45; // chance a sentinel lifts a glimmer it walks over

// inputs as action ids, for recorded routes: 0 still, 1 left, 2 right, 3 up, 4 down, 5 dig left, 6 dig right
export const NO_INPUT = Object.freeze({ left: false, right: false, up: false, down: false, digL: false, digR: false });
const INPUTS = [0, 1, 2, 3, 4, 5, 6].map(a => Object.freeze({ left: a === 1, right: a === 2, up: a === 3, down: a === 4, digL: a === 5, digR: a === 6 }));
export const fromAction = a => INPUTS[a];

export function rng(st) {
  let a = (st.rng = (st.rng + 0x6d2b79f5) | 0);
  a = Math.imul(a ^ (a >>> 15), 1 | a);
  a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a;
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}
export const colOf = x => Math.floor((x + U / 2) / U);
export const rowOf = colOf;

function clone(s) {
  return {
    ...s, hero: { ...s.hero }, guards: s.guards.map(g => ({ ...g })), holes: s.holes.map(h => ({ ...h })),
    shards: s.shards.map(k => ({ ...k })), tally: { ...s.tally },
  };
}

export function createSim() {
  const sim = { s: null, L: null, graph: null, events: [], load, step, snapshot, restore, die, shardAt };
  let L = null, s = null, speed = 10, reachable = null;
  const holeAt = new Int16Array(COLS * ROWS); // index + 1 into s.holes
  const ev = (type, x, y, extra) => sim.events.push(extra ? { type, x, y, ...extra } : { type, x, y });
  const evAt = (type, a, extra) => ev(type, a.x / U + 0.5, a.y / U + 0.5, extra);

  // ---------- load ----------
  function load(def, { seed = 1, score = 0 } = {}) {
    L = sim.L = def.t ? def : parseLevel(def);
    sim.graph = buildGraph(L);
    reachable = sim.graph.reach(L.start.c, L.start.r);
    speed = L.speed ?? SPEED[L.world] ?? 10;
    sim.events.length = 0;
    s = sim.s = {
      t: 0, rng: seed | 0, seed: seed | 0,
      status: 'play', statusT: 0, // play | dying | dead | clear
      score, levelScore: 0, revealed: false, revealT: 0, left: L.shards.length,
      hero: { x: L.start.c * U, y: L.start.r * U, face: 1, mode: 'stand', dig: 0, dc: 0, dr: 0, anim: 0, moved: false, fallN: 0 },
      guards: L.guards.map((p, i) => ({
        id: i, x: p.c * U, y: p.r * U, face: -1, mode: 'stand', st: 'walk', t: 0, acc: i * 5, dir: 0,
        hc: 0, hr: 0, out: -1, carry: -1, carryN: 0, rc: p.c, rr: p.r, anim: 0,
      })),
      holes: [], // { c, r, ph: 0 being dug | 1 open | 2 growing back, t }
      shards: L.shards.map(p => ({ c: p.c, r: p.r, st: 0 })), // st 0 lying, 1 gathered, 2 carried
      tally: { shards: 0, traps: 0, crushed: 0 },
    };
    holeAt.fill(0);
    return s;
  }
  function snapshot() { return clone(s); }
  function restore(snap) {
    s = sim.s = clone(snap);
    holeAt.fill(0);
    s.holes.forEach((h, i) => { holeAt[h.r * COLS + h.c] = i + 1; });
    sim.events.length = 0;
  }
  function reindex() { holeAt.fill(0); s.holes.forEach((h, i) => { holeAt[h.r * COLS + h.c] = i + 1; }); }

  // ---------- the live map ----------
  const raw = (c, r) => (c < 0 || c >= COLS || r < 0 || r >= ROWS ? '=' : L.t[r][c]);
  const holeOf = (c, r) => (c < 0 || c >= COLS || r < 0 || r >= ROWS ? null : holeAt[r * COLS + c] ? s.holes[holeAt[r * COLS + c] - 1] : null);
  const ladder = (c, r) => { const ch = raw(c, r); return ch === 'H' || (ch === '^' && s.revealed && r >= 0); };
  const bar = (c, r) => raw(c, r) === '-';
  // blocks a body moving into it; above the top row only the way out is open, and only to Wren
  function solid(c, r, hero) {
    if (c < 0 || c >= COLS || r >= ROWS) return true;
    if (r < 0) return !(hero && s.revealed && ladder(c, 0));
    const ch = L.t[r][c];
    if (ch === '=') return true;
    if (ch === '#') { const h = holeOf(c, r); return !h || h.ph === 0; }
    return false;
  }
  const overlaps = (o, c, r) => Math.abs(o.x - c * U) < U && Math.abs(o.y - r * U) < U;
  // something to stand on at (c, r): for a sentinel, also any other sentinel; for Wren only a stuck one
  function floor(c, r, g) {
    if (r >= ROWS) return true;
    if (c < 0 || c >= COLS || r < 0) return false;
    const ch = L.t[r][c];
    if (ch === '=' || ch === 'H' || (ch === '^' && s.revealed)) return true;
    if (ch === '#') { const h = holeOf(c, r); if (!h || h.ph === 0) return true; }
    for (const o of s.guards) if (o !== g && o.st !== 'dead' && (g || o.st === 'trap') && overlaps(o, c, r)) return true;
    return false;
  }
  function supported(a, g) {
    const c = colOf(a.x), rb = Math.ceil(a.y / U);
    if (ladder(c, rb)) return true;
    if (a.y % U !== 0) return false;
    const r = a.y / U;
    if (bar(c, r) || floor(c, r + 1, g)) return true;
    return !!g && g.out === c && !!holeOf(c, r + 1);
  }
  function canUp(c, y, g) {
    if (y % U !== 0) return ladder(c, Math.ceil(y / U));
    const r = y / U;
    return ladder(c, r) && !solid(c, r - 1, !g);
  }
  function canDown(c, y, g) {
    if (y % U !== 0) return ladder(c, Math.ceil(y / U));
    const r = y / U;
    return !solid(c, r + 1, !g) && (ladder(c, r) || bar(c, r) || ladder(c, r + 1));
  }
  // would a sentinel stepping to (nx, ny) bump into another one?
  function blocked(g, nx, ny) {
    for (const o of s.guards) {
      if (o === g || o.st === 'dead') continue;
      const dx = Math.abs(o.x - nx), dy = Math.abs(o.y - ny);
      if (dx < U && dy < U && dx + dy < Math.abs(o.x - g.x) + Math.abs(o.y - g.y)) return true;
    }
    return false;
  }
  // one sub-step of a body: d 1 left, 2 right, 3 up, 4 down; g is the sentinel (null: Wren).
  // Off the grid lines it first lines up with the nearest row or column (cornering).
  function move(a, d, g) {
    const c = colOf(a.x), r = rowOf(a.y), ax = a.x === c * U, ay = a.y === r * U;
    if (d === 1 || d === 2) {
      const dx = d === 1 ? -1 : 1;
      if (!ay) {
        if (solid(c + dx, r, !g)) return false;
        a.y += a.y < r * U ? 1 : -1;
        a.face = dx;
        return true;
      }
      const nx = a.x + dx, tc = dx > 0 ? Math.ceil(nx / U) : Math.floor(nx / U);
      if (solid(tc, r, !g) || (g && blocked(g, nx, a.y))) return false;
      a.x = nx; a.face = dx;
      return true;
    }
    const up = d === 3;
    if (!(up ? canUp(c, a.y, g) : canDown(c, a.y, g))) return false;
    if (!ax) { a.x += a.x < c * U ? 1 : -1; return true; }
    const ny = a.y + (up ? -1 : 1);
    if (g && blocked(g, a.x, ny)) return false;
    a.y = ny;
    return true;
  }
  function modeOf(a) {
    const c = colOf(a.x), ay = a.y % U === 0;
    if (ladder(c, Math.ceil(a.y / U)) && !(ay && !ladder(c, a.y / U))) return 'ladder';
    if (ay && bar(c, a.y / U)) return 'bar';
    return 'stand';
  }

  // ---------- glimmers ----------
  function shardAt(c, r) {
    for (let i = 0; i < s.shards.length; i++) { const k = s.shards[i]; if (k.st === 0 && k.c === c && k.r === r) return i; }
    return -1;
  }
  function gather(i) {
    const k = s.shards[i];
    k.st = 1; s.left--; s.tally.shards++;
    s.score += SCORE.shard; s.levelScore += SCORE.shard;
    ev('shard', k.c + 0.5, k.r + 0.5, { left: s.left });
    if (!s.left) { s.revealed = true; s.revealT = s.t; ev('reveal', 0, 0, { tiles: L.stair }); }
  }
  // a sentinel lets a glimmer go only where Wren can get to it
  function canDrop(c, r) {
    if (raw(c, r) !== '.' || shardAt(c, r) >= 0 || !reachable[r * COLS + c]) return false;
    const below = raw(c, r + 1);
    return r + 1 >= ROWS || ((below === '#' && !holeOf(c, r + 1)) || below === '=' || below === 'H');
  }

  // ---------- holes ----------
  function canDig(c, r, dx) {
    const tc = c + dx, tr = r + 1;
    if (tr >= ROWS || tc < 0 || tc >= COLS || r < 0 || raw(tc, tr) !== '#' || holeOf(tc, tr)) return false;
    if (solid(tc, r, true) || ladder(tc, r) || shardAt(tc, r) >= 0) return false;
    for (const g of s.guards) if (g.st !== 'dead' && overlaps(g, tc, r)) return false;
    return true;
  }
  function holesTick() {
    let closed = null;
    for (let i = s.holes.length - 1; i >= 0; i--) {
      const h = s.holes[i];
      if (h.ph === 0) continue;
      h.t++;
      if (h.ph === 1 && h.t >= T.open) { h.ph = 2; h.t = 0; ev('regrow', h.c + 0.5, h.r + 0.5); }
      else if (h.ph === 2 && h.t >= T.fill) { s.holes.splice(i, 1); (closed ??= []).push(h); }
    }
    if (!closed) return;
    reindex();
    for (const h of closed) {
      ev('sealed', h.c + 0.5, h.r + 0.5);
      const w = s.hero;
      if (s.status === 'play' && colOf(w.x) === h.c && rowOf(w.y) === h.r) die('sealed');
      for (const g of s.guards) if (g.st !== 'dead' && colOf(g.x) === h.c && rowOf(g.y) === h.r) crush(g);
    }
  }

  // ---------- Wren ----------
  function heroStep(inp) {
    const h = s.hero;
    h.moved = false;
    if (h.dig) {
      const hole = holeOf(h.dc, h.dr);
      if (!hole || s.guards.some(g => g.st !== 'dead' && overlaps(g, h.dc, h.dr - 1))) {
        // someone stepped onto the brick: the dig fizzles
        if (hole) { s.holes.splice(holeAt[h.dr * COLS + h.dc] - 1, 1); reindex(); }
        h.dig = 0; h.mode = 'stand';
        ev('fizzle', h.dc + 0.5, h.dr + 0.5);
        return;
      }
      hole.t = T.dig - --h.dig;
      if (!h.dig) { hole.ph = 1; hole.t = 0; h.mode = modeOf(h); }
      return;
    }
    if (!supported(h, null)) {
      const c = colOf(h.x);
      if (h.x !== c * U) h.x += h.x < c * U ? 1 : -1;
      h.y += 1;
      if (h.mode !== 'fall') { h.mode = 'fall'; h.fallN = 0; }
      h.fallN++;
      if (supported(h, null)) { h.mode = modeOf(h); evAt('land', h, { n: h.fallN }); }
      return;
    }
    const c = colOf(h.x), r = rowOf(h.y), aligned = h.x === c * U && h.y === r * U;
    const dig = inp.digL ? -1 : inp.digR ? 1 : 0;
    if (dig && canDig(c, r, dig)) {
      if (!aligned) {
        // line up first
        if (h.x !== c * U) h.x += h.x < c * U ? 1 : -1;
        else h.y += h.y < r * U ? 1 : -1;
        h.moved = true; h.face = dig;
        return;
      }
      s.holes.push({ c: c + dig, r: r + 1, ph: 0, t: 0 });
      reindex();
      h.dig = T.dig; h.dc = c + dig; h.dr = r + 1; h.face = dig; h.mode = 'dig';
      ev('dig', c + dig + 0.5, r + 1.5, { dx: dig });
      return;
    }
    let moved = false;
    if (inp.up || inp.down) moved = move(h, inp.up ? 3 : 4, null);
    if (!moved && (inp.left || inp.right)) moved = move(h, inp.left ? 1 : 2, null);
    if (moved) { h.moved = true; h.anim++; }
    h.mode = modeOf(h);
  }

  // ---------- sentinels ----------
  // how a sentinel sees the level: every brick it once saw is there, dug or false
  const pSolid = (c, r) => { const ch = raw(c, r); return r < 0 || ch === '#' || ch === '=' || ch === '~'; };
  const pStand = (c, r) => ladder(c, r) || bar(c, r) || r + 1 >= ROWS || pSolid(c, r + 1) || ladder(c, r + 1);
  // from (c, r) heading down: the nearest to row hr it could stop at
  function descend(c, r, hr) {
    let best = 99;
    for (let rr = r; rr < ROWS; rr++) {
      if (pSolid(c, rr)) break;
      if (ladder(c, rr)) { best = Math.min(best, Math.abs(rr - hr)); continue; }
      if (pStand(c, rr)) { best = Math.min(best, Math.abs(rr - hr)); break; }
    }
    return best;
  }
  function upScore(c, r, hr) {
    if (!ladder(c, r) || pSolid(c, r - 1)) return 99;
    let best = 99;
    for (let rr = r - 1; rr >= 0; rr--) {
      best = Math.min(best, Math.abs(rr - hr));
      if (!ladder(c, rr) || pSolid(c, rr - 1)) break;
    }
    return best;
  }
  const downScore = (c, r, hr) => (!pSolid(c, r + 1) && (ladder(c, r) || bar(c, r) || ladder(c, r + 1)) ? descend(c, r + 1, hr) : 99);
  function decide(g) {
    const c = g.x / U, r = g.y / U, h = s.hero, hc = colOf(h.x), hr = Math.max(0, rowOf(h.y));
    if (hr === r) {
      if (hc === c) return 0;
      const dx = hc > c ? 1 : -1;
      let open = true;
      for (let cc = c + dx; cc !== hc; cc += dx) if (pSolid(cc, r) || !pStand(cc, r)) { open = false; break; }
      if (open && !pSolid(hc, r)) return dx > 0 ? 2 : 1;
    }
    let bs = 99, bd = 99, dir = 0;
    const consider = (sc, d, to) => { if (sc < bs || (sc === bs && d < bd)) { bs = sc; bd = d; dir = to; } };
    consider(upScore(c, r, hr), 0, 3);
    consider(downScore(c, r, hr), 0, 4);
    for (const dx of [-1, 1]) {
      const to = dx < 0 ? 1 : 2;
      for (let cc = c + dx, d = 1; cc >= 0 && cc < COLS; cc += dx, d++) {
        if (pSolid(cc, r)) break;
        if (!pStand(cc, r)) { consider(descend(cc, r + 1, hr), d, to); break; }
        consider(Math.min(upScore(cc, r, hr), downScore(cc, r, hr)), d, to);
      }
    }
    if (bs < Math.abs(r - hr)) return dir;
    // nothing brings it nearer his row: along the row towards his column
    return hc < c ? 1 : hc > c ? 2 : 0;
  }
  // a sentinel reaches the middle of a tile: glimmers, and where next
  function arrive(g) {
    const c = g.x / U, r = g.y / U;
    if (g.out >= 0 && c !== g.out) g.out = -1;
    if (g.carry < 0) {
      const k = shardAt(c, r);
      if (k >= 0 && rng(s) < PICK) { g.carry = k; g.carryN = 3 + Math.floor(rng(s) * 9); s.shards[k].st = 2; ev('lift', c + 0.5, r + 0.5); }
    } else if (--g.carryN <= 0 && canDrop(c, r)) dropShard(g, c, r);
    g.dir = decide(g);
  }
  function dropShard(g, c, r) {
    const k = s.shards[g.carry];
    k.c = c; k.r = r; k.st = 0; g.carry = -1;
    ev('drop', c + 0.5, r + 0.5);
  }
  function trap(g) {
    const c = colOf(g.x), r = rowOf(g.y);
    g.st = 'trap'; g.t = T.trap; g.hc = c; g.hr = r; g.dir = 0; g.out = -1;
    s.score += SCORE.trap; s.levelScore += SCORE.trap; s.tally.traps++;
    ev('trap', c + 0.5, r + 0.5);
    if (g.carry >= 0 && r > 0 && !solid(c, r - 1) && !ladder(c, r - 1) && shardAt(c, r - 1) < 0) dropShard(g, c, r - 1);
  }
  function crush(g) {
    if (g.carry >= 0) { const k = s.shards[g.carry]; k.st = 0; k.c = L.shards[g.carry].c; k.r = L.shards[g.carry].r; g.carry = -1; }
    const p = L.respawn[Math.floor(rng(s) * L.respawn.length)];
    g.st = 'dead'; g.t = T.respawn; g.rc = p.c; g.rr = p.r; g.dir = 0; g.out = -1;
    s.score += SCORE.crush; s.levelScore += SCORE.crush; s.tally.crushed++;
    evAt('crush', g);
  }
  function inOpenHole(g) {
    if (g.x % U || g.y % U) return false;
    const h = holeOf(g.x / U, g.y / U);
    return !!h && h.ph > 0;
  }
  function guardStep(g) {
    switch (g.st) {
      case 'dead':
        if (--g.t > 0) return;
        // back at the top, away from Wren if it can
        if (Math.abs(g.rc * U - s.hero.x) < 3 * U && Math.abs(g.rr * U - s.hero.y) < 3 * U) {
          const far = L.respawn.filter(p => Math.abs(p.c * U - s.hero.x) >= 3 * U || Math.abs(p.r * U - s.hero.y) >= 3 * U);
          if (far.length) { const p = far[Math.floor(rng(s) * far.length)]; g.rc = p.c; g.rr = p.r; }
        }
        g.x = g.rc * U; g.y = g.rr * U; g.st = 'walk'; g.acc = 0; g.dir = 0;
        evAt('respawn', g);
        return;
      case 'trap':
        if (--g.t <= 0) { g.st = 'climb'; g.acc = 0; }
        return;
      case 'climb':
        g.acc += speed;
        while (g.acc >= 16) {
          g.acc -= 16;
          if (blocked(g, g.x, g.y - 1)) break;
          g.y--;
          g.anim++;
          if (g.y === (g.hr - 1) * U) { g.st = 'walk'; g.out = g.hc; g.mode = 'stand'; g.dir = decide(g); evAt('free', g); break; }
        }
        return;
    }
    if (!supported(g, g)) {
      const c = colOf(g.x);
      if (g.x !== c * U) g.x += g.x < c * U ? 1 : -1;
      g.y++;
      g.st = 'fall'; g.mode = 'fall';
      if (inOpenHole(g)) trap(g);
      else if (supported(g, g)) { g.st = 'walk'; g.dir = 0; g.mode = modeOf(g); }
      return;
    }
    g.acc += speed;
    while (g.acc >= 16) {
      g.acc -= 16;
      if (g.x % U === 0 && g.y % U === 0) arrive(g);
      if (!g.dir) break;
      if (!move(g, g.dir, g)) {
        // bumped mid-tile: turn back
        if (g.x % U || g.y % U) g.dir = [0, 2, 1, 4, 3][g.dir];
        else g.dir = 0;
        break;
      }
      g.anim++;
      if (inOpenHole(g)) { trap(g); break; }
      if (!supported(g, g)) break;
    }
    g.mode = g.st === 'walk' ? modeOf(g) : g.mode;
  }

  // ---------- life and death ----------
  function die(why = 'caught') {
    if (s.status !== 'play') return;
    s.status = 'dying'; s.statusT = 0;
    evAt('die', s.hero, { why });
  }

  // ---------- one step ----------
  function step(inp = NO_INPUT) {
    s.t++;
    if (s.status !== 'play') {
      s.statusT++;
      if (s.status === 'dying' && s.statusT >= T.dying) s.status = 'dead';
      return;
    }
    heroStep(inp);
    for (const g of s.guards) guardStep(g);
    holesTick();
    if (s.status !== 'play') return;
    const h = s.hero, hc = colOf(h.x), hr = rowOf(h.y);
    const k = hr >= 0 ? shardAt(hc, hr) : -1;
    if (k >= 0) gather(k);
    for (const g of s.guards) {
      if (g.st === 'dead') continue;
      if (Math.abs(g.x - h.x) < TOUCH && Math.abs(g.y - h.y) < TOUCH) { die('caught'); return; }
    }
    if (s.revealed && h.y <= -U) {
      s.status = 'clear'; s.statusT = 0;
      s.score += SCORE.clear; s.levelScore += SCORE.clear;
      ev('clear', h.x / U + 0.5, 0);
    }
  }
  return sim;
}
