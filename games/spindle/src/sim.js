// Spindle's simulation: one tower at a time, pure and deterministic. The page, the attract
// demo and the Node tools (tools/solve.mjs, tools/verify.mjs) all drive it with plain input
// snapshots { left, right, up, down, jump, fire } and read `sim.s` to draw it. Everything that
// changes lives in `sim.s`, a plain object the solver can snapshot and restore; the tower's
// fixed layout is `sim.T`. Only + − × ÷ and Math.sqrt touch the state (no sin or pow), so a
// recorded route replays the same in every engine.
//
// The tower is a cylinder of COLS angle columns × rows. Clink stands on its ledges; his
// angle `th` (in columns, 0 ≤ th < COLS) is always the front of the view, so walking turns
// the tower. Floors sit at whole row heights; a block fills a cell and is a floor on top.
//
//   const sim = createSim();
//   sim.newGame({ tower: 0, seed: 1, lives: 3 });
//   sim.step({ right: true, jump: false, … });   // every DT; sim.events lists what happened
import { TOWERS } from './towers.js';

export const DT = 1 / 60;
export const COLS = 16, HALF = 8;
export const HERO_H = 1.4;
export const SEA = -0.55; // the sea surface, a little under the lowest floor
export const K = { EMPTY: 0, LEDGE: 1, SLIP: 2, CRUMB: 3, BLINK: 4, BLOCK: 5, DOOR: 6, EXIT: 7, LIFT: 8, SHAFT: 9, WINDOW: 10, SPOUT: 11 };
const CHARS = {
  '.': K.EMPTY, '-': K.LEDGE, S: K.LEDGE, u: K.LEDGE, '~': K.SLIP, '%': K.CRUMB, ':': K.BLINK, '#': K.BLOCK,
  D: K.DOOR, c: K.DOOR, X: K.EXIT, L: K.LIFT, '|': K.SHAFT, w: K.WINDOW, v: K.SPOUT, j: K.EMPTY,
};
export const SCORE = { row: 10, urchin: 150, jelly: 50, crab: 300, second: 50, gem: 100, perfect: 2500, tower: 1000 };
export const LIFE_EVERY = 20000;
export const P = {
  walk: 3, air: 3.4, airAcc: 14, g: 40, jumpV: 11.3, maxFall: 15, foot: 0.22, body: 0.3,
  slipAcc: 3.2, coyote: 0.1, buffer: 0.12, lift: 3, shotV: 11, shotLife: 0.34, fireCd: 0.3,
  door: 1.1, crumble: 0.45, regrow: 7, blink: 3.2, blinkOn: 2, inv: 1.6, ready: 1.8,
};
export const BONUS = { dur: 22, speed: 3, h: 6, top: 5.6, low: 0.35, kx: 3 };

const wrap = th => { const t = th % COLS; return t < 0 ? t + COLS : t; };
export const colOf = th => { const c = Math.floor(th) % COLS; return c < 0 ? c + COLS : c; };
/** shortest signed angle a − b, in columns, in (−HALF, HALF] */
export const adiff = (a, b) => { let d = (a - b) % COLS; if (d > HALF) d -= COLS; else if (d <= -HALF) d += COLS; return d; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const isInt = y => Math.abs(y - Math.round(y)) < 1e-6;
const FLOORS = new Set([K.LEDGE, K.SLIP, K.CRUMB, K.BLINK, K.DOOR, K.EXIT]);

/** the tower's fixed layout from its text map (top row first) */
export function parseTower(def, index = 0) {
  const rows = def.map.length, cell = new Uint8Array(rows * COLS);
  const spawns = [], lifts = [];
  let start = null, exit = null;
  def.map.forEach((line, i) => {
    const r = rows - 1 - i;
    if (line.length !== COLS) throw new Error(`${def.name}: row ${r} is ${line.length} wide`);
    for (let c = 0; c < COLS; c++) {
      const ch = line[c], k = CHARS[ch];
      if (k === undefined) throw new Error(`${def.name}: '${ch}' at ${c},${r}`);
      cell[r * COLS + c] = k;
      if (ch === 'S') start = { c, r };
      else if (ch === 'X') exit = { c, r };
      else if (ch === 'u') spawns.push({ k: 'urchin', c, r });
      else if (ch === 'c') spawns.push({ k: 'crab', c, r });
      else if (ch === 'j') spawns.push({ k: 'jelly', c, r });
      else if (ch === 'v') spawns.push({ k: 'drip', c, r });
    }
  });
  if (!start || !exit) throw new Error(`${def.name}: needs S and X`);
  const at = (c, r) => (r < 0 || r >= rows ? K.EMPTY : cell[r * COLS + c]);
  for (let r = 0; r < rows; r++) for (let c = 0; c < COLS; c++) {
    const k = at(c, r);
    if (k === K.LIFT) {
      let top = r;
      while (at(c, top + 1) === K.SHAFT) top++;
      if (top === r) throw new Error(`${def.name}: lift at ${c},${r} has no shaft`);
      lifts.push({ c, r0: r, r1: top });
    }
    if (k === K.DOOR && at((c + HALF) % COLS, r) !== K.DOOR) throw new Error(`${def.name}: door ${c},${r} has no far side`);
  }
  // a drip falls from its spout to the first floor under it (or into the sea)
  for (const sp of spawns) if (sp.k === 'drip') {
    let r = sp.r - 1;
    while (r >= 0 && !FLOORS.has(at(sp.c, r)) && at(sp.c, r - 1) !== K.BLOCK) r--;
    sp.to = r < 0 ? SEA : r;
  }
  return { ...def, index, rows, cell, start, exit, lifts, spawns, at };
}

// mulberry32 on an integer kept in the state
function rand(s) {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const fromBits = b => ({ left: !!(b & 1), right: !!(b & 2), up: !!(b & 4), down: !!(b & 8), jump: !!(b & 16), fire: !!(b & 32) });
export const toBits = i => (i.left ? 1 : 0) | (i.right ? 2 : 0) | (i.up ? 4 : 0) | (i.down ? 8 : 0) | (i.jump ? 16 : 0) | (i.fire ? 32 : 0);
const IDLE = fromBits(0);

export function createSim() {
  const sim = { s: null, T: null, events: [], newGame, loadTower, step, snapshot, restore, floorKind, crumbOf, blinkOf, knock, quiet: false };
  const towers = TOWERS.map(parseTower);
  sim.towers = towers;
  const emit = (type, e = {}) => sim.events.push({ type, ...e });

  // ---------- setup ----------
  function newGame({ tower = 0, seed = 1, lives = 3, loop = 0 } = {}) {
    sim.s = { score: 0, lives, nextLife: LIFE_EVERY, loop, rng: seed | 0, loadId: 0, reached: tower, best: tower };
    loadTower(tower);
  }
  function loadTower(i) {
    const s = sim.s, T = (sim.T = towers[i]);
    const spd = 1 + 0.15 * s.loop;
    s.tower = i; s.loadId++;
    s.reached = Math.max(s.reached, i + s.loop * towers.length);
    Object.assign(s, {
      status: 'ready', statusT: 0, t: 0, spd, maxRow: T.start.r,
      timeFull: Math.round(T.time * Math.max(0.6, 1 - 0.12 * s.loop)), time: 0,
      crumb: {}, shots: [], squalls: [], prevJump: false, prevFire: false, fireCd: 0,
      squallT: T.squall ? T.squall * 0.8 : 0, sinkT: 0, sinkY: 0, spin: 0, tally: 0, bonus: null, tick: 99,
      check: { th: T.start.c + 0.5, y: T.start.r },
      lifts: T.lifts.map(l => ({ y: l.r0, v: 0, idle: 0, ride: false })),
      foes: T.spawns.map(sp => foe(sp)),
    });
    s.time = s.timeFull;
    placeHero(T.start.c + 0.5, T.start.r, 1);
    s.cam = { th: s.hero.th, y: camTarget() };
  }
  function foe(sp) {
    const base = { k: sp.k, c: sp.c, r: sp.r, th: sp.c + 0.5, y: sp.r, dir: 1, t: 0, dead: 0, stun: 0, push: 0, vy: 0 };
    if (sp.k === 'jelly') base.t = (sp.c * 0.37 + sp.r * 0.21) % 1.6;
    if (sp.k === 'drip') { base.to = sp.to; base.t = (sp.c * 0.5) % 2.4; base.y = sp.r; }
    if (sp.k === 'urchin') base.dir = sp.c % 2 ? -1 : 1;
    return base;
  }
  function placeHero(th, y, dir) {
    sim.s.hero = {
      th, y, vy: 0, vth: 0, dir, ground: true, lift: -1, state: 'stand', coyote: 0, buffer: 0,
      inv: 0, drop: null, doorT: 0, upLock: false, from: 0, to: 0, stepDy: 0, walkT: 0, standT: 0, landV: 0, shootT: 0,
    };
  }
  const camTarget = () => Math.max(1.6, sim.s.hero.y + 0.8);

  // ---------- the tower's cells, as they are now ----------
  function blinkOf(c, r) { return ((sim.s.t + (c + r) * 0.4) % P.blink) / P.blink; } // < blinkOn/blink: there
  function crumbOf(c, r) { return sim.s.crumb[r * COLS + c] ?? null; }
  /** the floor at whole height r of column c, or 0 */
  function floorKind(c, r) {
    const T = sim.T;
    if (r < 0 || r >= T.rows + 1) return 0;
    const k = T.at(c, r);
    if (k === K.LEDGE || k === K.SLIP || k === K.DOOR || k === K.EXIT) return k;
    if (k === K.CRUMB) { const q = sim.s.crumb[r * COLS + c]; return q && q.gone ? 0 : k; }
    if (k === K.BLINK) return blinkOf(c, r) < P.blinkOn / P.blink ? k : 0;
    if (k !== K.BLOCK && T.at(c, r - 1) === K.BLOCK) return K.LEDGE;
    return 0;
  }
  const blockAt = (c, r) => sim.T.at(c, r) === K.BLOCK;
  // the lowest block row in column c overlapping heights [lo, hi), or −1
  function blockIn(c, lo, hi) {
    for (let r = Math.floor(lo); r < hi; r++) if (r >= 0 && blockAt(c, r)) return r;
    return -1;
  }

  // what Clink stands on at (th, y): { k, c, lift } or null
  function support(th, y, drop) {
    const cm = colOf(th);
    let best = null;
    if (isInt(y)) {
      const r = Math.round(y);
      if (drop === null || r < drop - 1e-6) for (const dx of [0, -P.foot, P.foot]) {
        const c = colOf(th + dx), k = floorKind(c, r);
        if (k) { best = { k, c, lift: -1 }; break; }
      }
    }
    if (!best) sim.T.lifts.forEach((L, i) => {
      const l = sim.s.lifts[i];
      if (best || Math.abs(l.y - y) > 1e-6 || (drop !== null && l.y >= drop - 1e-6)) return;
      if (colOf(th - P.foot) === L.c || colOf(th + P.foot) === L.c || cm === L.c) best = { k: K.LIFT, c: L.c, lift: i };
    });
    return best;
  }

  /** the floor cell (c + COLS·r) Clink is standing on, or null */
  function standCell() {
    const h = sim.s.hero;
    if (!h.ground || h.state !== 'stand') return null;
    const sup = support(h.th, h.y, null);
    return sup ? sup.c + COLS * Math.round(h.y) : null;
  }
  sim.standCell = standCell;

  // ---------- the hero ----------
  function jump(h, dirIn, slip) {
    h.vy = P.jumpV; h.ground = false; h.state = 'air'; h.lift = -1; h.buffer = 0; h.coyote = 0;
    h.vth = dirIn ? dirIn * P.air : slip ? h.vth : 0;
    emit('jump', { th: h.th, y: h.y });
  }
  function knock(dir) {
    const h = sim.s.hero;
    h.state = 'knock'; h.ground = false; h.lift = -1; h.vy = 5; h.vth = 2.2 * dir; h.drop = h.y;
    h.inv = P.inv; h.buffer = 0;
    emit('hit', { th: h.th, y: h.y });
  }
  function moveH(h, d) {
    if (!d) return;
    const dir = d > 0 ? 1 : -1;
    let nth = h.th + d;
    const leadOld = h.th + P.body * dir, leadNew = nth + P.body * dir;
    const cNew = colOf(leadNew);
    if (cNew !== colOf(leadOld)) {
      const b = blockIn(cNew, h.y + 0.02, h.y + HERO_H);
      const edge = dir > 0 ? Math.floor(leadNew) : Math.floor(leadOld);
      // a step up puts the leading foot on the new column
      const onto = () => { nth = dir > 0 ? Math.max(nth, edge - P.foot + 0.03) : Math.min(nth, edge + P.foot - 0.03); };
      if (b >= 0) {
        const top = b + 1;
        if (h.ground && top - h.y <= 1.0001 && blockIn(cNew, top, top + HERO_H) < 0) { stepUp(h, top); onto(); }
        else {
          nth = edge - P.body * dir - dir * 1e-4;
          h.vth = 0;
        }
      } else if (h.ground && !floorAt(cNew, h.y)) {
        const top = Math.floor(h.y + 1e-6) + 1;
        if (top - h.y <= 1.0001 && floorKind(cNew, top) && blockIn(colOf(h.th), top, top + HERO_H) < 0) { stepUp(h, top); onto(); }
      }
    }
    h.th = wrap(nth);
  }
  const floorAt = (c, y) => isInt(y) && floorKind(c, Math.round(y));
  function stepUp(h, top) {
    h.stepDy -= top - h.y; h.y = top; h.lift = -1;
    emit('step', { th: h.th, y: h.y });
  }
  function moveV(h) {
    const s = sim.s, y0 = h.y;
    h.vy = Math.max(h.vy - P.g * DT, -P.maxFall);
    let y1 = y0 + h.vy * DT;
    if (h.vy > 0) {
      // bonk on a block overhead
      const c0 = colOf(h.th - 0.2), c1 = colOf(h.th + 0.2), head0 = y0 + HERO_H, r = Math.floor(y1 + HERO_H);
      if (r >= head0 - 1e-6 && (blockAt(c0, r) || blockAt(c1, r))) { y1 = r - HERO_H; h.vy = 0; emit('bonk', { th: h.th, y: y1 }); }
      h.y = y1;
      return;
    }
    let land = null;
    for (let f = Math.floor(y0 + 1e-6); f >= Math.ceil(y1 - 1e-6) && land === null; f--) {
      if (h.drop !== null && f >= h.drop - 1e-6) continue;
      for (const dx of [0, -P.foot, P.foot]) if (floorKind(colOf(h.th + dx), f)) { land = f; break; }
    }
    sim.T.lifts.forEach((L, i) => {
      const ly = s.lifts[i].y;
      if (ly > y0 + 1e-6 || ly < y1 - 0.06 || (h.drop !== null && ly >= h.drop - 1e-6)) return;
      if (colOf(h.th - P.foot) !== L.c && colOf(h.th + P.foot) !== L.c) return;
      if (land === null || ly > land) land = ly;
    });
    if (land !== null) {
      h.landV = -h.vy; h.y = land; h.vy = 0; h.ground = true; h.drop = null; h.state = 'stand';
      const sup = support(h.th, h.y, null);
      h.lift = sup ? sup.lift : -1;
      if (!sup) { h.ground = false; h.state = 'air'; }
      emit('land', { th: h.th, y: h.y, v: h.landV });
      return;
    }
    h.y = y1;
    if (h.y < SEA - 0.3) splash();
  }
  function splash() {
    const s = sim.s, h = s.hero;
    s.status = 'splash'; s.statusT = 0; h.state = 'sunk';
    emit('splash', { th: h.th, y: SEA });
  }

  function heroStep(inp) {
    const s = sim.s, h = s.hero, T = sim.T;
    h.inv = Math.max(0, h.inv - DT);
    h.stepDy *= 0.7; if (Math.abs(h.stepDy) < 0.01) h.stepDy = 0;
    h.shootT = Math.max(0, h.shootT - DT);
    if (h.state === 'door') return doorStep(h);
    const ctl = h.state !== 'knock';
    const dirIn = ctl ? (inp.right ? 1 : 0) - (inp.left ? 1 : 0) : 0;
    if (inp.jump && !s.prevJump) h.buffer = P.buffer; else h.buffer = Math.max(0, h.buffer - DT);
    if (h.ground) {
      const sup = support(h.th, h.y, null);
      if (!sup) { h.ground = false; h.state = 'air'; h.coyote = P.coyote; h.lift = -1; h.vy = 0; }
      else {
        h.lift = sup.lift;
        const cc = colOf(h.th), here = floorKind(cc, Math.round(h.y));
        // a door, or the crown door at the top
        if (!inp.up) h.upLock = false;
        if (ctl && inp.up && !h.upLock && h.lift < 0 && isInt(h.y) && Math.abs(adiff(h.th, cc + 0.5)) < 0.42) {
          if (here === K.DOOR) return enterDoor(h, cc);
          if (here === K.EXIT) { s.status = 'sink'; s.statusT = 0; h.state = 'crown'; h.th = cc + 0.5; emit('crown', { th: h.th, y: h.y }); return; }
        }
        if (h.lift >= 0) liftControl(h.lift, inp);
        // crumbling ledges start to go under the feet
        for (const dx of [-P.foot, P.foot]) {
          const c = colOf(h.th + dx), r = Math.round(h.y);
          if (isInt(h.y) && T.at(c, r) === K.CRUMB && !s.crumb[r * COLS + c]) { s.crumb[r * COLS + c] = { t: P.crumble, gone: false }; emit('creak', { th: c + 0.5, y: r }); }
        }
        const slip = sup.k === K.SLIP || (here === 0 && sup.k === K.SLIP);
        if (slip) h.vth += clamp(dirIn * P.walk - h.vth, -P.slipAcc * DT, P.slipAcc * DT);
        else h.vth = dirIn * P.walk;
        if (dirIn) h.dir = dirIn;
        h.state = ctl ? 'stand' : h.state;
        if (ctl && h.buffer > 0) jump(h, dirIn, slip);
        if (h.ground && Math.abs(h.vth) > 0.1) {
          h.walkT += DT * Math.abs(h.vth);
          if (h.walkT > 0.75) { h.walkT = 0; emit('foot', { slip }); }
        }
        // a safe place to come back to
        h.standT = h.vth || h.lift >= 0 ? 0 : h.standT + DT;
        if (h.standT > 0.25 && (here === K.LEDGE || here === K.DOOR) && isInt(h.y)) {
          const c = colOf(h.th);
          if (floorKind(c, Math.round(h.y)) && (s.check.th !== c + 0.5 || s.check.y !== h.y)) s.check = { th: c + 0.5, y: h.y };
        }
        if (isInt(h.y) && h.y > s.maxRow) { score(SCORE.row * (h.y - s.maxRow), h.th, h.y, false); s.maxRow = h.y; }
      }
    } else {
      h.coyote = Math.max(0, h.coyote - DT);
      if (ctl && h.buffer > 0 && h.coyote > 0) jump(h, dirIn, false);
      else if (ctl) { h.vth += clamp(dirIn * P.air - h.vth, -P.airAcc * DT, P.airAcc * DT); if (dirIn) h.dir = dirIn; }
    }
    moveH(h, h.vth * DT);
    if (h.ground) {
      if (h.lift >= 0) h.y = s.lifts[h.lift].y;
      const sup = support(h.th, h.y, null);
      if (!sup) { h.ground = false; h.state = h.state === 'knock' ? 'knock' : 'air'; h.coyote = P.coyote; h.lift = -1; h.vy = 0; }
      else h.lift = sup.lift;
    }
    if (!h.ground) moveV(h);
    // the bubble gun
    s.fireCd = Math.max(0, s.fireCd - DT);
    if (ctl && inp.fire && !s.prevFire && s.fireCd <= 0 && s.shots.length < 2) {
      s.fireCd = P.fireCd; h.shootT = 0.18;
      s.shots.push({ th: wrap(h.th + h.dir * 0.3), y: h.y + 0.75, dir: h.dir, t: 0 });
      emit('shoot', { th: h.th, y: h.y });
    }
  }
  function enterDoor(h, c) {
    h.state = 'door'; h.doorT = 0; h.from = c + 0.5; h.to = ((c + HALF) % COLS) + 0.5; h.vth = 0; h.lift = -1;
    h.th = h.from;
    emit('door', { th: h.th, y: h.y });
  }
  function doorStep(h) {
    const s = sim.s;
    h.doorT += DT;
    const p = h.doorT / P.door;
    s.cam.th = wrap(h.from + HALF * h.dir * ease((p - 0.25) / 0.5));
    if (p >= 0.75) h.th = h.to;
    if (p >= 1) { h.state = 'stand'; h.ground = true; h.upLock = true; h.inv = Math.max(h.inv, 0.4); s.cam.th = h.th; emit('doorout', { th: h.th, y: h.y }); }
  }
  function liftControl(i, inp) {
    const l = sim.s.lifts[i], L = sim.T.lifts[i];
    l.ride = true; l.idle = 0;
    if (inp.up && l.y < L.r1 - 1e-6) { if (l.v <= 0) emit('lift', { th: L.c + 0.5, y: l.y }); l.v = P.lift; }
    else if (inp.down && l.y > L.r0 + 1e-6) { if (l.v >= 0) emit('lift', { th: L.c + 0.5, y: l.y }); l.v = -P.lift; }
  }
  function liftsStep() {
    const s = sim.s, h = s.hero;
    sim.T.lifts.forEach((L, i) => {
      const l = s.lifts[i], riding = h.ground && h.lift === i && h.state !== 'door';
      if (!riding) {
        l.idle += DT;
        if (l.idle > 1.2 && l.y > L.r0 + 1e-6 && l.v === 0) l.v = -P.lift * 0.6;
      }
      if (!l.v) return;
      const y0 = l.y;
      let y1 = y0 + l.v * DT;
      const held = riding && ((l.v > 0 && heldUp) || (l.v < 0 && heldDown));
      // stop at the ends, or at the next whole row once the key is let go
      if (y1 >= L.r1) { y1 = L.r1; l.v = 0; }
      else if (y1 <= L.r0) { y1 = L.r0; l.v = 0; }
      else if (!held && riding && Math.floor(y0 + 1e-6) !== Math.floor(y1 + 1e-6) && l.v > 0) { y1 = Math.floor(y1 + 1e-6); l.v = 0; }
      else if (!held && riding && Math.ceil(y0 - 1e-6) !== Math.ceil(y1 - 1e-6) && l.v < 0) { y1 = Math.ceil(y1 - 1e-6); l.v = 0; }
      if (!l.v) emit('liftstop', { th: L.c + 0.5, y: y1 });
      l.y = y1;
      if (riding) h.y = y1;
      l.ride = riding;
    });
  }
  let heldUp = false, heldDown = false;

  // ---------- enemies ----------
  function hitHero(f, rx, ry, cy) {
    const h = sim.s.hero;
    if (h.inv > 0 || h.state === 'door' || h.state === 'knock' || sim.s.status !== 'play') return;
    const dx = adiff(f.th, h.th);
    if (Math.abs(dx) < rx + 0.22 && cy + ry > h.y && cy - ry < h.y + HERO_H) knock(dx > 0 ? -1 : 1);
  }
  function foesStep() {
    const s = sim.s, spd = s.spd;
    for (const f of s.foes) {
      if (f.dead > 0) { f.dead -= DT; if (f.dead <= 0) respawnFoe(f); continue; }
      f.t += DT;
      if (f.k === 'urchin') {
        const v = 1.5 * spd, nth = f.th + f.dir * v * DT, lead = colOf(nth + f.dir * 0.36);
        if (lead !== colOf(f.th + f.dir * 0.36) && (!floorKind(lead, f.r) || sim.T.at(lead, f.r) === K.CRUMB || sim.T.at(lead, f.r) === K.BLINK || blockAt(lead, f.r))) f.dir = -f.dir;
        else f.th = wrap(nth);
        if (!floorKind(colOf(f.th), f.r) && !floorKind(colOf(f.th + 0.3), f.r) && !floorKind(colOf(f.th - 0.3), f.r)) { f.dead = 6; continue; }
        hitHero(f, 0.34, 0.34, f.y + 0.36);
      } else if (f.k === 'jelly') {
        if (f.stun > 0) { f.stun -= DT; f.y = Math.max(f.r, f.y - 2 * DT); if (f.stun <= 0) f.t = 0; continue; }
        const per = 1.7 / spd, q = (f.t % per) / per;
        f.y = f.r + 3.2 * 4 * q * (1 - q);
        hitHero(f, 0.34, 0.42, f.y + 0.45);
      } else if (f.k === 'crab') {
        if (f.vy) { // pushed off its ledge
          f.vy -= P.g * DT; f.y += f.vy * DT;
          if (f.y < SEA) { f.dead = 12; emit('crabsplash', { th: f.th, y: SEA }); }
          continue;
        }
        if (f.push) {
          const m = Math.sign(f.push) * Math.min(Math.abs(f.push), 6 * DT);
          f.th = wrap(f.th + m); f.push -= m;
          if (Math.abs(f.push) < 1e-6) f.push = 0;
          if (!floorKind(colOf(f.th), f.r)) { f.vy = 2; f.push = 0; score(SCORE.crab, f.th, f.r, true); emit('crabfall', { th: f.th, y: f.r }); }
          continue;
        }
        const home = f.c + 0.5, dx = adiff(f.th, home), v = 0.9 * spd * DT;
        if (Math.abs(dx) > 1.05) f.th = wrap(f.th - Math.sign(dx) * v); // walk back to its door
        else {
          const lead = colOf(f.th + f.dir * 0.45);
          if (Math.abs(adiff(f.th + f.dir * v, home)) > 1 || (lead !== colOf(f.th) && !floorKind(lead, f.r))) f.dir = -f.dir;
          else f.th = wrap(f.th + f.dir * v);
        }
        hitHero(f, 0.42, 0.34, f.y + 0.36);
      } else if (f.k === 'drip') {
        const per = 2.4 / spd;
        if (f.t < 0.5) f.y = f.r;
        else if (f.y > f.to) {
          f.vy = Math.min(f.vy + 26 * DT, 14);
          f.y -= f.vy * DT;
          if (f.y <= f.to) { f.y = f.to; emit('drip', { th: f.th, y: f.to }); }
          else hitHero(f, 0.2, 0.25, f.y);
        }
        if (f.t >= per) { f.t = 0; f.y = f.r; f.vy = 0; }
      }
    }
  }
  function respawnFoe(f) {
    Object.assign(f, foe({ k: f.k, c: f.c, r: f.r, to: f.to }));
    emit('foeback', { th: f.th, y: f.y, k: f.k });
  }
  function shotsStep() {
    const s = sim.s;
    for (const b of s.shots) {
      b.t += DT;
      b.th = wrap(b.th + b.dir * P.shotV * DT);
      if (blockAt(colOf(b.th), Math.floor(b.y))) { b.t = 99; emit('poof', { th: b.th, y: b.y }); continue; }
      for (const f of s.foes) {
        if (f.dead > 0 || f.vy || f.k === 'drip') continue;
        const cy = f.y + 0.4;
        if (Math.abs(adiff(f.th, b.th)) > 0.45 || Math.abs(cy - b.y) > 0.7) continue;
        if (f.k === 'urchin') { f.dead = 8; score(SCORE.urchin, f.th, f.y, true); emit('pop', { th: f.th, y: f.y }); }
        else if (f.k === 'jelly') { if (f.stun <= 0) score(SCORE.jelly, f.th, f.y, true); f.stun = 4; emit('stun', { th: f.th, y: f.y }); }
        else if (f.k === 'crab') { f.push = b.dir * 1.5; emit('push', { th: f.th, y: f.y }); }
        b.t = 99;
        break;
      }
      if (b.t >= P.shotLife && b.t < 99) emit('poof', { th: b.th, y: b.y });
    }
    s.shots = s.shots.filter(b => b.t < P.shotLife);
  }
  function squallsStep() {
    const s = sim.s, h = s.hero, T = sim.T;
    if (T.squall) {
      s.squallT -= DT;
      if (s.squallT <= 0 && !s.squalls.length && h.ground && h.state === 'stand') {
        const side = rand(s) < 0.5 ? -1 : 1;
        s.squalls.push({ sx: 12 * side, v: -side * 4.2 * s.spd, y: h.y + 0.55, t: 0 });
        s.squallT = T.squall * (0.7 + 0.6 * rand(s)) / s.spd;
        emit('squall', { side });
      }
    }
    for (const q of s.squalls) {
      q.t += DT; q.sx += q.v * DT;
      if (h.inv <= 0 && h.state !== 'door' && h.state !== 'knock' && Math.abs(q.sx) < 0.55 && q.y + 0.4 > h.y && q.y - 0.4 < h.y + HERO_H) knock(q.v > 0 ? 1 : -1);
    }
    s.squalls = s.squalls.filter(q => Math.abs(q.sx) < 13);
  }
  function cellsStep() {
    const s = sim.s;
    for (const key in s.crumb) {
      const q = s.crumb[key];
      q.t -= DT;
      if (q.t > 0) continue;
      if (!q.gone) { q.gone = true; q.t = P.regrow; emit('crumble', { th: (key % COLS) + 0.5, y: Math.floor(key / COLS) }); }
      else {
        // grows back, but not under someone standing in it
        const c = key % COLS, r = Math.floor(key / COLS), h = s.hero;
        if (Math.abs(adiff(h.th, c + 0.5)) < 0.8 && Math.abs(h.y - r) < 1.5) { q.t = 0.3; continue; }
        delete s.crumb[key];
        emit('regrow', { th: c + 0.5, y: r });
      }
    }
  }

  // ---------- score, lives ----------
  function score(n, th, y, pop) {
    const s = sim.s;
    s.score += n;
    if (pop) emit('score', { n, th, y });
    while (s.score >= s.nextLife) { s.lives++; s.nextLife += LIFE_EVERY; emit('life'); }
  }
  function loseLife() {
    const s = sim.s;
    s.lives--;
    if (s.lives <= 0) { s.lives = 0; s.status = 'over'; s.statusT = 0; emit('over'); return; }
    if (s.timeUp) { s.time = s.timeFull; s.timeUp = false; }
    placeHero(s.check.th, s.check.y, s.hero.dir);
    s.hero.inv = 2.2;
    s.squalls = []; s.shots = [];
    s.status = 'play'; s.statusT = 0;
    emit('respawn', { th: s.hero.th, y: s.hero.y });
  }

  // ---------- one step ----------
  function step(inp = IDLE) {
    const s = sim.s;
    s.statusT += DT;
    switch (s.status) {
      case 'ready':
        if (s.statusT >= P.ready) { s.status = 'play'; s.statusT = 0; emit('go'); }
        break;
      case 'play': {
        s.t += DT;
        heldUp = !!inp.up; heldDown = !!inp.down;
        cellsStep();
        liftsStep();
        heroStep(inp);
        if (s.status !== 'play') break;
        foesStep();
        shotsStep();
        squallsStep();
        s.prevJump = !!inp.jump; s.prevFire = !!inp.fire;
        s.time -= DT;
        if (s.time < 10.5 && Math.ceil(s.time) !== s.tick) { s.tick = Math.ceil(s.time); if (s.tick > 0) emit('tick', { n: s.tick }); }
        if (s.time <= 0) { s.time = 0; s.timeUp = true; s.status = 'timeup'; s.statusT = 0; emit('timeup'); }
        break;
      }
      case 'splash': case 'timeup':
        foesStep();
        if (s.statusT > 1.8) loseLife();
        break;
      case 'sink': sinkStep(); break;
      case 'bonus': bonusStep(inp); break;
      case 'over': break;
    }
    const h = s.hero;
    if (h.state !== 'door' && s.status !== 'sink') s.cam.th = h.th;
    const ty = s.status === 'sink' ? Math.max(1.6, h.y - s.sinkY + 0.8) : camTarget();
    s.cam.y += (ty - s.cam.y) * 0.08;
  }

  // the crown is reached: the time left is counted in, and the spire winds down into the sea
  function sinkStep() {
    const s = sim.s, T = sim.T, h = s.hero;
    s.sinkT += DT;
    if (s.sinkT > 0.6 && s.time > 0 && Math.floor(s.sinkT * 60) % 2 === 0) {
      const take = Math.min(1, s.time);
      s.time -= take; s.time = Math.max(0, Math.round(s.time * 1000) / 1000);
      score(Math.round(SCORE.second * take), h.th, h.y, false);
      emit('tally');
    }
    if (s.sinkT > 1.4) {
      const u = s.sinkT - 1.4;
      s.sinkY = Math.min(T.rows + 4, u * u * 5);
      s.spin += DT * Math.min(6, u * 2.5);
      s.cam.th = wrap(h.th + s.spin);
    }
    if (s.sinkT > 1.4 && s.sinkY >= T.rows + 4 && s.time <= 0 && !s.tally) {
      s.tally = 1;
      score(SCORE.tower * (1 + (T.index % 8)), h.th, 0, false);
      emit('sunk');
    }
    if (s.tally && s.sinkT > 1.4 + Math.sqrt((T.rows + 4) / 5) + 1.2) startBonus();
  }

  // ---------- Kite Run: the bonus between towers ----------
  function startBonus() {
    const s = sim.s;
    s.status = 'bonus'; s.statusT = 0;
    const gems = [], n = 34;
    const kind = s.tower % 4;
    for (let i = 0; i < n; i++) {
      const x = 8 + i * 1.55;
      // four rising-and-falling patterns, all made of straight lines
      const q = (i % 12) / 12, tri = q < 0.5 ? q * 2 : 2 - q * 2;
      let y;
      if (kind === 0) y = 1 + tri * 3.8;
      else if (kind === 1) y = i % 8 < 4 ? 1.2 + (i % 4) * 1.1 : 4.5 - (i % 4) * 1.1;
      else if (kind === 2) y = 2.9 + (i % 2 ? 1.7 : -1.4) * tri;
      else y = 1 + ((i * 7) % 11) / 11 * 4;
      gems.push({ x, y, got: false });
    }
    s.bonus = { t: 0, x: 0, ky: 3, vy: 0, gems, got: 0, n, done: false, doneT: 0, streak: 0, skim: 0 };
    emit('bonus');
  }
  function bonusStep(inp) {
    const s = sim.s, b = s.bonus;
    b.t += DT;
    if (!b.done) {
      b.x += BONUS.speed * DT;
      const target = inp.up ? 3.4 : inp.down ? -3.4 : -0.7;
      b.vy += clamp(target - b.vy, -12 * DT, 12 * DT);
      b.ky += b.vy * DT;
      if (b.ky > BONUS.top) { b.ky = BONUS.top; b.vy = Math.min(0, b.vy); }
      if (b.ky < BONUS.low) { b.ky = BONUS.low; b.vy = 2.2; b.streak = 0; b.skim = 0.4; emit('skim'); }
      b.skim = Math.max(0, b.skim - DT);
      const kx = b.x + BONUS.kx;
      for (const g of b.gems) {
        if (g.got || Math.abs(g.x - kx) > 0.42 || Math.abs(g.y - b.ky) > 0.5) continue;
        g.got = true; b.got++; b.streak++;
        score(SCORE.gem, g.x, g.y, false);
        emit('gem', { streak: b.streak, x: g.x, y: g.y });
      }
      if (b.t >= BONUS.dur) {
        b.done = true; b.doneT = 0;
        if (b.got === b.n) score(SCORE.perfect, 0, 0, false);
        emit('bonusdone', { perfect: b.got === b.n });
      }
    } else {
      b.doneT += DT;
      if (b.doneT > 2.6) nextTower();
    }
  }
  function nextTower() {
    const s = sim.s;
    let i = s.tower + 1;
    if (i >= towers.length) { i = 0; s.loop++; }
    loadTower(i);
    emit('tower', { i });
  }

  // ---------- snapshot (for the solver) ----------
  function snapshot() { return structuredClone(sim.s); }
  function restore(snap) { sim.s = structuredClone(snap); sim.T = towers[sim.s.tower]; sim.events.length = 0; }

  return sim;
}
