// Dewdrop's simulation: one stage at a time, Dew, the prickles, berries and the moonbloom.
//
// Units are tiles and seconds; one step is 1/60 s. No canvas, no DOM, no audio: the page, the
// demo and the Node solver all drive it with input snapshots and read its state to draw it.
// Everything that changes lives in `sim.s`, a plain object, so the solver can snapshot and
// restore it. Only + − × ÷ and Math.sqrt touch the state (no sin, exp or pow), so a recorded
// route replays exactly the same way in every engine.
//
//   const sim = createSim();
//   sim.load(stageDef, { world, seed, lives, score });
//   sim.step({ left, right, up, down, jump });
//   sim.s.p, sim.s.foes, sim.L …   sim.events: what happened this step, for sound and particles
import { COLS, ROWS, isClimb, isSolid, parseStage, tile } from './level.js';

export const DT = 1 / 60;

// Dew's feel, in tiles and tiles/s
export const PH = {
  w: 0.7, h: 0.85,
  run: 7, accel: 55, decel: 70, turn: 120, air: 42, airDrag: 14,
  g: 76, gHold: 46, jump: 18, cut: 0.45, maxFall: 20,
  coyote: 0.1, buffer: 0.13,
  climb: 4.6, rope: 4.2, ropeJump: 13, vineJump: 12,
  spring: 26, stream: 2.6, updraftMax: 8,
};
// pursuers: speeds per world (Mossy Hollow, Whisper Reeds, Thornwood, Moon Pond)
const FOE = {
  w: 0.8, h: 0.78,
  chase: [3.1, 3.5, 3.8, 4.1], patrol: [2.5, 2.8, 3.1, 3.3], hopVx: [3.4, 3.7, 4.0, 4.2],
  climb: 2.8, g: 70, hopVy: 15, hopHi: 21.5, jumpVy: 21.8, warn: 1.5, emerge: 0.7, respawn: 3.2, clearance: 3.6,
};
const HURRY = 1.25; // pursuers speed up once the time bonus runs out
const SCORE = { berry: 100, fly: 500, clear: 1000, perSec: 50, life: 20000 };
const LIVES = 3;

export const NO_INPUT = Object.freeze({ left: false, right: false, up: false, down: false, jump: false });
// inputs as bits, for recorded routes
export const BITS = { left: 1, right: 2, up: 4, down: 8, jump: 16 };
export const fromBits = b => ({ left: !!(b & 1), right: !!(b & 2), up: !!(b & 4), down: !!(b & 8), jump: !!(b & 16) });

export function rng(st) {
  let a = (st.rng = (st.rng + 0x6d2b79f5) | 0);
  a = Math.imul(a ^ (a >>> 15), 1 | a);
  a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a;
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}
export const hashStr = str => [...str].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));

// lily pad position at time t: eased there-and-back, polynomial only
export function moverAt(m, t) {
  const u = (t / m.period + m.phase) % 1, tri = u < 0.5 ? u * 2 : 2 - u * 2, e = tri * tri * (3 - 2 * tri);
  return { x: m.x + m.dx * e, y: m.y + m.dy * e };
}
export const MOVER_H = 0.32;

// ---------- the chasers' map: which tiles a prickle can be in, and how it gets between them ----------
// A node is a tile it can stand in (ground under it) or a vine tile. Edges walk, fall off an
// edge, drop through a branch, or climb. Built once per stage; crumbling leaves count as floor.
export function buildNav(L) {
  const climb = (c, r) => isClimb(tile(L, c, r));
  const top = (c, r) => {
    const ch = tile(L, c, r);
    return isSolid(ch) || ch === '=' || ch === '+' || ch === 'x' || (ch === 'H' && !climb(c, r - 1));
  };
  const open = (c, r) => { const ch = tile(L, c, r); return !isSolid(ch) && ch !== '~'; };
  const supported = (c, r) => open(c, r) && top(c, r + 1);
  const node = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS && open(c, r) && (supported(c, r) || climb(c, r));
  const fall = (c, r) => {
    for (let rr = r; rr < ROWS; rr++) {
      if (!open(c, rr)) return -1;
      if (supported(c, rr)) return rr * COLS + c;
    }
    return -1;
  };
  const adj = Array.from({ length: COLS * ROWS }, () => []);
  const isNode = new Uint8Array(COLS * ROWS), jumps = new Set();
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (!node(c, r)) continue;
      const i = r * COLS + c, out = adj[i];
      isNode[i] = 1;
      for (const dc of [-1, 1]) {
        const nc = c + dc;
        if (nc < 0 || nc >= COLS || !open(nc, r)) continue;
        // off a vine you only step sideways onto a floor
        if (supported(nc, r)) out.push(r * COLS + nc);
        else if (!supported(c, r)) continue;
        else { const f = fall(nc, r); if (f >= 0) out.push(f); }
      }
      const below = tile(L, c, r + 1);
      if (below === '=' || below === 'x') { const f = fall(c, r + 1); if (f >= 0) out.push(f); }
      if (climb(c, r) && node(c, r - 1)) out.push((r - 1) * COLS + c);
      if (climb(c, r + 1)) out.push((r + 1) * COLS + c);
      // hop straight up onto a branch up to three tiles above
      if (supported(c, r) && !climb(c, r))
        for (let dr = 1; dr <= 3; dr++) {
          if (!open(c, r - dr)) break;
          if (supported(c, r - dr)) { if (dr > 1) { out.push((r - dr) * COLS + c); jumps.add(i * 4096 + (r - dr) * COLS + c); } break; }
        }
    }
  return { adj, isNode, jumps };
}

export function createSim() {
  const sim = { s: null, L: null, nav: null, events: [], load, step, snapshot, restore, reset: respawnAll, berriesLeft, doorOpen };
  let L = null, nav = null;
  const ev = (type, x = 0, y = 0, extra) => sim.events.push({ type, x, y, ...extra });

  // ---------- tiles (with this stage's live state) ----------
  const T = (c, r) => tile(L, c, r);
  const climbable = (c, r) => isClimb(T(c, r));
  const crumbleGone = (c, r) => { const i = L.crumbleAt.get(r * COLS + c); return i !== undefined && sim.s.cr[i].st === 2; };
  const solid = (c, r) => isSolid(T(c, r));
  function oneTop(c, r) {
    const ch = T(c, r);
    if (ch === '=' || ch === '+') return true;
    if (ch === 'x') return !crumbleGone(c, r);
    return ch === 'H' && !climbable(c, r - 1);
  }

  // ---------- load ----------
  function load(def, { world = 0, seed = 1, lives = LIVES, score = 0, nextLife = 0 } = {}) {
    L = sim.L = def.t ? def : parseStage(def, world);
    nav = sim.nav = buildNav(L);
    sim.events.length = 0;
    const s = (sim.s = {
      t: 0, frame: 0, rng: seed | 0, seed: seed | 0,
      status: 'play', statusT: 0, // play | dying | clear | over
      lives, score, stageScore: 0, nextLife: nextLife || Math.floor(score / SCORE.life + 1) * SCORE.life,
      timeLeft: L.par, hurry: false, deaths: 0,
      taken: L.berries.map(() => false), flies: L.flies.map(() => false),
      open: false, openT: 0,
      cr: L.crumbles.map(() => ({ st: 0, t: 0 })), // 0 whole, 1 trembling, 2 fallen
      mv: L.movers.map(m => { const q = moverAt(m, 0); return { x: q.x, y: q.y, px: q.x, py: q.y }; }),
      slots: L.waves.map(w => ({ st: 'wait', t: w.delay })),
      foes: [], foeId: 0,
      p: null, prev: 0,
      tally: null,
    });
    spawnDew();
    return s;
  }
  function spawnDew() {
    const st = L.start;
    sim.s.p = {
      x: st.x - PH.w / 2, y: st.y - PH.h, w: PH.w, h: PH.h, vx: 0, vy: 0,
      mode: 'ground', face: 1, coyote: 0, buffer: 0, hold: false, spring: false,
      dropT: 0, ropeT: 0, climbT: 0, inv: 1.6, on: -1, onCr: -1, cell: -1, landT: 0, airT: 0, runT: 0,
    };
  }
  function berriesLeft() { return sim.s.taken.reduce((n, t) => n + (t ? 0 : 1), 0); }
  function doorOpen() { return sim.s.open; }

  // ---------- snapshot (for the solver) ----------
  function snapshot() { return structuredClone(sim.s); }
  function restore(snap) { sim.s = structuredClone(snap); sim.events.length = 0; }

  // ---------- bodies against the grid ----------
  function moveX(b, dx) {
    if (!dx) return false;
    b.x += dx;
    const r0 = Math.floor(b.y + 0.01), r1 = Math.floor(b.y + b.h - 0.01);
    if (dx > 0) {
      const c = Math.floor(b.x + b.w - 1e-9);
      for (let r = r0; r <= r1; r++) if (solid(c, r)) { b.x = c - b.w; return true; }
    } else {
      const c = Math.floor(b.x);
      for (let r = r0; r <= r1; r++) if (solid(c, r)) { b.x = c + 1; return true; }
    }
    return false;
  }
  // returns what it landed on: null, or { c, r, ch } for a tile, or { mover: i }
  function moveY(b, dy, ignoreOneWay) {
    const prevBot = b.y + b.h;
    b.y += dy;
    if (dy > 0) {
      const bot = b.y + b.h, r = Math.floor(bot);
      const c0 = Math.floor(b.x + 0.02), c1 = Math.floor(b.x + b.w - 0.02);
      let hit = null;
      for (let c = c0; c <= c1; c++) {
        if (solid(c, r) || (!ignoreOneWay && prevBot <= r + 1e-6 && oneTop(c, r))) {
          if (!hit || T(c, r) === 'T') hit = { c, r, ch: T(c, r) };
        }
      }
      if (hit) { b.y = r - b.h; return hit; }
      if (!ignoreOneWay) {
        for (let i = 0; i < L.movers.length; i++) {
          const m = sim.s.mv[i], mw = L.movers[i].w;
          if (b.x + b.w <= m.x + 0.05 || b.x >= m.x + mw - 0.05) continue;
          if (prevBot <= Math.max(m.py, m.y) + 0.02 && bot >= m.y) { b.y = m.y - b.h; return { mover: i }; }
        }
      }
    } else if (dy < 0) {
      const r = Math.floor(b.y);
      const c0 = Math.floor(b.x + 0.02), c1 = Math.floor(b.x + b.w - 0.02);
      for (let c = c0; c <= c1; c++) if (solid(c, r)) { b.y = r + 1; return { bonk: true }; }
    }
    return null;
  }
  // ride a lily pad: follow it before moving on our own
  function carry(b) {
    if (b.on < 0) return;
    const m = sim.s.mv[b.on];
    moveX(b, m.x - m.px);
    b.y = m.y - b.h;
  }
  const feetCell = b => Math.floor(b.y + b.h - 0.01) * COLS + Math.floor(b.x + b.w / 2);

  // ---------- one step ----------
  function step(input = NO_INPUT) {
    const s = sim.s;
    s.frame++; s.statusT += DT;
    if (s.status === 'over') return;
    if (s.status === 'clear') { s.openT += DT; return; }
    s.t += DT;
    if (s.status === 'play') {
      s.timeLeft = Math.max(0, s.timeLeft - DT);
      if (!s.hurry && s.timeLeft <= 0) { s.hurry = true; ev('hurry'); }
    }
    for (let i = 0; i < L.movers.length; i++) {
      const m = s.mv[i], q = moverAt(L.movers[i], s.t);
      m.px = m.x; m.py = m.y; m.x = q.x; m.y = q.y;
    }
    crumbles();
    if (s.open) s.openT += DT;
    if (s.status === 'play') stepDew(input);
    else if (s.status === 'dying' && s.statusT > 1.5) {
      if (s.lives <= 0) { s.status = 'over'; s.statusT = 0; ev('gameover'); return; }
      respawnAll();
    }
    waves();
    for (const f of s.foes) stepFoe(f);
    s.foes = s.foes.filter(f => !f.dead);
    if (s.status === 'play') touch();
    s.prev = bits(input);
  }
  const bits = i => (i.left ? 1 : 0) | (i.right ? 2 : 0) | (i.up ? 4 : 0) | (i.down ? 8 : 0) | (i.jump ? 16 : 0);

  function crumbles() {
    const s = sim.s;
    L.crumbles.forEach((k, i) => {
      const c = s.cr[i];
      c.t += DT;
      if (c.st === 1 && c.t > 0.5) { c.st = 2; c.t = 0; ev('crumble', k.c + 0.5, k.r + 0.3); }
      else if (c.st === 2 && c.t > 4) {
        const p = s.p, over = p && p.x < k.c + 1 && p.x + p.w > k.c && p.y < k.r + 1 && p.y + p.h > k.r;
        if (!over) { c.st = 0; c.t = 0; ev('regrow', k.c + 0.5, k.r + 0.3); }
      }
    });
  }
  function tremble(c, r) {
    const i = L.crumbleAt.get(r * COLS + c);
    if (i === undefined) return;
    const k = sim.s.cr[i];
    if (k.st === 0) { k.st = 1; k.t = 0; ev('tremble', c + 0.5, r + 0.2); }
  }

  // ---------- Dew ----------
  function stepDew(I) {
    const s = sim.s, p = s.p;
    const jumpDown = I.jump && !(s.prev & 16);
    const dir = (I.right ? 1 : 0) - (I.left ? 1 : 0);
    if (dir) p.face = dir;
    p.buffer = jumpDown ? PH.buffer : Math.max(0, p.buffer - DT);
    p.dropT = Math.max(0, p.dropT - DT); p.ropeT = Math.max(0, p.ropeT - DT); p.climbT = Math.max(0, p.climbT - DT);
    p.inv = Math.max(0, p.inv - DT); p.landT += DT;
    const cx = p.x + p.w / 2, col = Math.floor(cx);

    if (p.mode === 'climb') {
      // (Up is a jump key too: holding it on a vine climbs, it never throws her off)
      if (p.buffer > 0 && !I.up) {
        p.buffer = 0; p.mode = 'air'; p.vy = -PH.vineJump; p.vx = dir * PH.run * 0.7; p.hold = true; p.climbT = 0.25;
        ev('jump', cx, p.y + p.h, { small: true });
      } else if (dir && !I.up && !I.down) {
        p.mode = 'air'; p.vx = dir * PH.run * 0.5; p.vy = 0; p.climbT = 0.2;
      } else {
        const v = ((I.down ? 1 : 0) - (I.up ? 1 : 0)) * PH.climb;
        p.vy = v; p.vx = 0;
        p.x = approach(p.x, col + 0.5 - p.w / 2, 6 * DT);
        const res = climbMove(p, v, col);
        if (res === 'top' || res === 'floor') { p.mode = 'ground'; p.vy = 0; ev('step', cx, p.y + p.h); }
        else if (res === 'off') p.mode = 'air';
        p.runT += v ? DT : 0;
      }
    } else if (p.mode === 'rope') {
      const line = p.ropeLine;
      if (I.up && climbable(col, Math.floor(p.y + p.h / 2))) enterClimb(p, col);
      else if (I.down) { p.mode = 'air'; p.ropeT = 0.35; p.vy = 1; ev('let', cx, p.y); }
      else if (p.buffer > 0) {
        p.buffer = 0; p.mode = 'air'; p.vy = -PH.ropeJump; p.ropeT = 0.3; p.hold = true; p.vx = dir * PH.run * 0.6;
        ev('jump', cx, p.y, { small: true });
      } else {
        p.vx = dir * PH.rope;
        moveX(p, p.vx * DT);
        p.y = line + 0.04;
        p.runT += dir ? DT : 0;
        if (T(Math.floor(p.x + p.w / 2), Math.floor(line)) !== '-') { p.mode = 'air'; p.vy = 0; p.ropeT = 0.25; }
      }
    }

    if (p.mode === 'ground' || p.mode === 'air') {
      const ground = p.mode === 'ground';
      // run
      const target = dir * PH.run;
      if (ground) {
        const a = dir === 0 ? PH.decel : Math.sign(p.vx) !== dir && p.vx !== 0 ? PH.turn : PH.accel;
        p.vx = approach(p.vx, target, a * DT);
        p.runT = dir ? p.runT + DT : 0;
      } else p.vx = approach(p.vx, target, (dir ? PH.air : PH.airDrag) * DT);
      p.coyote = ground ? PH.coyote : Math.max(0, p.coyote - DT);

      // onto a vine
      const midRow = Math.floor(p.y + p.h / 2);
      if (p.climbT <= 0 && I.up && climbable(col, midRow) && Math.abs(cx - (col + 0.5)) < 0.45) {
        enterClimb(p, col);
      } else if (p.climbT <= 0 && I.down && ground && climbable(col, Math.floor(p.y + p.h + 0.05)) && Math.abs(cx - (col + 0.5)) < 0.45) {
        enterClimb(p, col);
        moveY(p, 0.05, true);
      }
    }

    if (p.mode === 'ground' || p.mode === 'air') {
      // drop through a branch
      if (p.mode === 'ground' && I.down && !I.jump && p.on < 0 && standingOnOneWay(p)) {
        p.dropT = 0.22; p.mode = 'air'; p.coyote = 0; p.vy = 2; ev('drop', p.x + p.w / 2, p.y + p.h);
      } else if (p.mode === 'ground' && I.down && p.on >= 0) {
        p.dropT = 0.22; p.mode = 'air'; p.coyote = 0; p.vy = 2; p.on = -1; ev('drop', p.x + p.w / 2, p.y + p.h);
      }
      // jump
      if (p.buffer > 0 && p.coyote > 0) {
        p.buffer = 0; p.coyote = 0; p.vy = -PH.jump; p.mode = 'air'; p.hold = true; p.spring = false; p.on = -1;
        ev('jump', p.x + p.w / 2, p.y + p.h);
      }
      if (p.hold && (!I.jump || p.vy >= 0)) {
        if (p.vy < 0 && !I.jump) p.vy *= PH.cut;
        p.hold = false;
      }
      if (p.spring && p.vy >= 0) p.spring = false;
      const g = p.vy < 0 && (p.hold || p.spring) ? PH.gHold : PH.g;
      p.vy = Math.min(PH.maxFall, p.vy + g * DT);
      // wind and updrafts
      let drift = 0;
      for (const w of L.wind) {
        if (cx < w.x || cx > w.x + w.w || p.y + p.h / 2 < w.y || p.y + p.h / 2 > w.y + w.h) continue;
        if (w.kind === 'U') { p.vy = Math.max(-PH.updraftMax, p.vy - w.k * DT); if (p.mode === 'ground') { p.mode = 'air'; p.on = -1; } }
        else drift += w.kind === 'L' ? -w.k : w.k;
      }
      // the stream under her feet
      if (p.mode === 'ground' && p.on < 0) {
        const under = T(col, Math.floor(p.y + p.h + 0.05));
        if (under === '<') drift -= PH.stream; else if (under === '>') drift += PH.stream;
      }
      if (p.mode === 'ground' && p.on >= 0) carry(p);
      if (moveX(p, (p.vx + drift) * DT)) p.vx = 0;
      const vyBefore = p.vy;
      const hit = moveY(p, p.vy * DT, p.dropT > 0);
      p.on = -1;
      if (hit?.bonk) { p.vy = 0; p.hold = false; p.spring = false; }
      else if (hit) {
        if (hit.ch === 'T') {
          p.vy = -PH.spring; p.spring = true; p.hold = false; p.mode = 'air'; p.coyote = 0;
          ev('boing', hit.c + 0.5, hit.r, { c: hit.c, r: hit.r });
        } else {
          if (p.mode === 'air') { ev('land', p.x + p.w / 2, p.y + p.h, { hard: vyBefore > 15 }); p.landT = 0; }
          p.mode = 'ground'; p.vy = 0; p.on = hit.mover ?? -1;
          if (hit.ch === 'x') tremble(hit.c, hit.r);
          const c2 = Math.floor(p.x + p.w - 0.02), c1 = Math.floor(p.x + 0.02);
          if (hit.ch && c1 !== c2) { if (T(c1, hit.r) === 'x') tremble(c1, hit.r); if (T(c2, hit.r) === 'x') tremble(c2, hit.r); }
        }
      } else if (p.mode === 'ground') {
        p.mode = 'air';
      }
      if (p.mode === 'air') p.airT += DT; else p.airT = 0;
      // catch a hanging vine as she passes it
      if (p.mode === 'air' && p.ropeT <= 0 && !I.down) {
        const r = Math.floor(p.y + 0.02), c = Math.floor(p.x + p.w / 2);
        for (const rr of [r, r - 1]) {
          if (T(c, rr) !== '-') continue;
          const line = rr + 0.16, prevTop = p.y - p.vy * DT;
          if ((prevTop >= line && p.y <= line + 0.12) || (prevTop <= line && p.y >= line)) {
            p.mode = 'rope'; p.ropeLine = line; p.y = line + 0.04; p.vy = 0; p.vx = 0; p.spring = false; p.hold = false;
            ev('grab', c + 0.5, line);
            break;
          }
        }
      }
    }
    if (p.mode === 'ground' || p.mode === 'climb') { const fc = feetCell(p); if (nav.isNode[fc]) p.cell = fc; }
    if (p.cell < 0) p.cell = feetCell(p);
    pickups();
    hazards();
  }
  function topOfVine(c, r) {
    let rr = r;
    while (rr > 0 && climbable(c, rr - 1)) rr--;
    return rr;
  }
  // one step along a vine; says when it stepped out on top, reached a floor or ran off the end
  function climbMove(b, v, col) {
    if (v < 0) {
      const top = topOfVine(col, Math.floor(b.y + b.h - 0.01));
      if (b.y + b.h + v * DT <= top) { b.y = top - b.h; return 'top'; }
      return moveY(b, v * DT, true)?.bonk ? 'bonk' : null;
    }
    if (v > 0) {
      const prevBot = b.y + b.h, r = Math.floor(prevBot + v * DT);
      if (prevBot <= r + 1e-6 && (solid(col, r) || (oneTop(col, r) && !climbable(col, r)))) { b.y = r - b.h; return 'floor'; }
      b.y += v * DT;
      if (!overVine(b)) return 'off';
    }
    return null;
  }
  const overVine = p => climbable(Math.floor(p.x + p.w / 2), Math.floor(p.y + p.h * 0.5)) || climbable(Math.floor(p.x + p.w / 2), Math.floor(p.y + p.h - 0.02));
  function enterClimb(p, col) {
    p.mode = 'climb'; p.vx = 0; p.vy = 0; p.on = -1; p.hold = false; p.spring = false; p.buffer = 0;
    p.x = clamp(p.x, col + 0.5 - p.w / 2 - 0.3, col + 0.5 - p.w / 2 + 0.3);
    ev('vine', col + 0.5, p.y + p.h / 2);
  }
  function standingOnOneWay(p) {
    const r = Math.floor(p.y + p.h + 0.05), c0 = Math.floor(p.x + 0.02), c1 = Math.floor(p.x + p.w - 0.02);
    for (let c = c0; c <= c1; c++) if (solid(c, r)) return false;
    let any = false;
    for (let c = c0; c <= c1; c++) if (oneTop(c, r)) any = true;
    return any;
  }

  function pickups() {
    const s = sim.s, p = s.p, cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    L.berries.forEach((b, i) => {
      if (s.taken[i]) return;
      const dx = b.x - cx, dy = b.y - cy;
      if (dx * dx + dy * dy < 0.6 * 0.6) {
        s.taken[i] = true; add(SCORE.berry); ev('berry', b.x, b.y, { left: berriesLeft() });
        if (!s.open && berriesLeft() === 0) { s.open = true; s.openT = 0; ev('bloom', L.door.x, L.door.y - 1); }
      }
    });
    L.flies.forEach((f, i) => {
      if (s.flies[i]) return;
      const dx = f.x - cx, dy = f.y - cy;
      if (dx * dx + dy * dy < 0.65 * 0.65) { s.flies[i] = true; add(SCORE.fly); ev('fly', f.x, f.y); }
    });
    if (s.open && s.openT > 0.6) {
      const d = L.door;
      if (cx > d.c + 0.1 && cx < d.c + 0.9 && p.y + p.h > d.r + 0.2 && p.y < d.r + 1) clear();
    }
  }
  function add(n) {
    const s = sim.s;
    s.score += n; s.stageScore += n;
    while (s.score >= s.nextLife) { s.nextLife += SCORE.life; s.lives++; ev('life'); }
  }
  function clear() {
    const s = sim.s;
    s.status = 'clear'; s.statusT = 0;
    const secs = Math.floor(s.timeLeft);
    s.tally = {
      berries: L.berries.length, fireflies: s.flies.filter(Boolean).length, flyCount: L.flies.length,
      secs, time: secs * SCORE.perSec, clear: SCORE.clear, deaths: s.deaths,
    };
    add(s.tally.time + s.tally.clear);
    s.tally.stage = s.stageScore;
    ev('home', L.door.x, L.door.y - 0.5);
  }
  function hazards() {
    const s = sim.s, p = s.p;
    const c0 = Math.floor(p.x + 0.12), c1 = Math.floor(p.x + p.w - 0.12);
    const rT = Math.floor(p.y + 0.2), rB = Math.floor(p.y + p.h - 0.05);
    for (let r = rT; r <= rB; r++)
      for (let c = c0; c <= c1; c++)
        if (T(c, r) === '^' && p.y + p.h > r + 0.45) return die('thorns');
    const cx = p.x + p.w / 2, cy = p.y + p.h * 0.6, ch = T(Math.floor(cx), Math.floor(cy));
    if (ch === '~' && cy - Math.floor(cy) > 0.3) return die('pond');
    if (p.y > ROWS) return die('pond');
  }
  function die(why) {
    const s = sim.s, p = s.p;
    if (s.status !== 'play') return;
    s.status = 'dying'; s.statusT = 0; s.lives--; s.deaths++;
    ev('die', p.x + p.w / 2, p.y + p.h / 2, { why });
  }
  // after a lost life: Dew back at the start, every prickle gone, the knots counting again
  function respawnAll() {
    const s = sim.s;
    s.status = 'play'; s.statusT = 0;
    s.foes = [];
    L.waves.forEach((w, i) => { s.slots[i] = { st: 'wait', t: Math.max(2.5, w.delay) }; });
    spawnDew();
    ev('respawn', L.start.x, L.start.y - 0.5);
  }

  // ---------- prickles ----------
  function waves() {
    const s = sim.s, p = s.p;
    L.waves.forEach((w, i) => {
      const sl = s.slots[i];
      if (sl.st === 'live') return;
      if (s.status !== 'play') return;
      sl.t -= DT;
      const k = L.knots[w.knot];
      if (sl.st === 'wait' && sl.t <= FOE.warn) { sl.st = 'warn'; ev('warn', k.x, k.y - 0.5, { kind: w.kind }); }
      if (sl.st === 'warn' && sl.t <= 0) {
        // never pop out right next to her: wait until she has moved off
        const dx = p.x + p.w / 2 - k.x, dy = p.y + p.h / 2 - (k.y - 0.4);
        if (dx * dx + dy * dy < FOE.clearance * FOE.clearance) return;
        sl.st = 'live';
        s.foes.push(newFoe(w.kind, i, k));
        ev('spawn', k.x, k.y - 0.4, { kind: w.kind });
      }
    });
  }
  function newFoe(kind, slot, k) {
    const s = sim.s;
    return {
      id: s.foeId++, kind, slot, x: k.x - FOE.w / 2, y: k.y - FOE.h, w: FOE.w, h: FOE.h, vx: 0, vy: 0,
      mode: 'air', dir: s.p.x + s.p.w / 2 < k.x ? -1 : 1, emerge: FOE.emerge, t: 0, on: -1,
      next: -1, here: -1, plan: 0, dropT: 0, climbX: 0, crouch: 0, big: false, bump: false, hopT: 0.8 + rng(s) * 0.6, squash: 0, stuck: 0, lastX: 0, roll: 0, dead: false,
    };
  }
  function stepFoe(f) {
    const s = sim.s;
    if (s.status === 'clear') return;
    f.t += DT;
    if (f.emerge > 0) { f.emerge -= DT; return; }
    if (s.status !== 'play') { // she's splashing: everyone holds still
      f.vx = 0;
    } else if (f.kind === 'chase') chaseAI(f);
    else if (f.kind === 'patrol') patrolAI(f);
    else hopAI(f);
    const spd = (s.hurry ? HURRY : 1);
    f.dropT = Math.max(0, f.dropT - DT);
    if (f.mode === 'climb') {
      moveX(f, clamp(f.climbX - f.x, -FOE.climb * DT * 2, FOE.climb * DT * 2));
      const res = climbMove(f, f.vy * spd, Math.floor(f.x + f.w / 2));
      if (res === 'top' || res === 'floor') { f.mode = 'ground'; f.vy = 0; }
      else if (res === 'off') f.mode = 'air';
    } else {
      if (f.on >= 0 && f.mode === 'ground') carry(f);
      f.vy = Math.min(PH.maxFall, f.vy + FOE.g * DT);
      if (moveX(f, f.vx * DT * spd)) { f.bump = true; }
      const hit = moveY(f, f.vy * DT, f.dropT > 0);
      f.on = -1;
      if (hit && !hit.bonk) {
        if (f.mode === 'air' && f.kind === 'hop') { f.squash = 0.18; ev('thump', f.x + f.w / 2, f.y + f.h); }
        f.mode = 'ground'; f.vy = 0; f.on = hit.mover ?? -1;
      } else if (hit?.bonk) f.vy = 0;
      else f.mode = 'air';
    }
    f.roll += f.vx * DT * spd;
    f.squash = Math.max(0, f.squash - DT);
    // into the pond: it sinks, and its knot grows another
    const cx = f.x + f.w / 2, cy = f.y + f.h * 0.7;
    if (T(Math.floor(cx), Math.floor(cy)) === '~' || f.y > ROWS) {
      f.dead = true;
      s.slots[f.slot] = { st: 'wait', t: FOE.respawn };
      ev('sink', cx, Math.floor(cy) + 0.3, { kind: f.kind });
    }
  }
  function chaseAI(f) {
    const s = sim.s, spd = FOE.chase[L.world] ?? 3.5;
    if (f.mode === 'air') {
      // committed to the jump or fall; drift over the tile it aims for
      if (f.next >= 0 && f.vy < 0) { const tx = (f.next % COLS) + 0.5, cx = f.x + f.w / 2; f.vx = Math.abs(tx - cx) < 0.05 ? 0 : Math.sign(tx - cx) * Math.min(spd, Math.abs(tx - cx) * 10); }
      return;
    }
    const here = feetCell(f);
    f.plan -= DT;
    if (f.plan <= 0 || here !== f.here) { f.plan = 0.25; f.here = here; f.next = route(here, s.p.cell); }
    const n = f.next;
    if (n < 0 || n === here) {
      // nowhere better to go: face her and hold
      f.vx = 0;
      if (f.mode === 'climb') f.vy = 0;
      return;
    }
    const hc = here % COLS, hr = (here / COLS) | 0, nc = n % COLS, nr = (n / COLS) | 0;
    if (nc !== hc) {
      if (f.mode === 'climb') {
        // leave the vine at floor level
        const floorY = hr + 1 - f.h;
        f.vy = 0; f.climbX = hc + 0.5 - f.w / 2;
        f.y = approach(f.y, floorY, FOE.climb * DT);
        if (f.y !== floorY) return;
        f.mode = 'ground';
      }
      f.dir = nc > hc ? 1 : -1;
      f.vx = f.dir * spd;
      return;
    }
    // same column: up or down
    f.vx = 0;
    const cx = f.x + f.w / 2;
    if (Math.abs(cx - (hc + 0.5)) > 0.08 && f.mode !== 'climb') { f.vx = Math.sign(hc + 0.5 - cx) * Math.min(spd, Math.abs(hc + 0.5 - cx) * 20); return; }
    f.climbX = hc + 0.5 - f.w / 2;
    if (nr < hr && nav.jumps.has(here * 4096 + n)) {
      // crouch, then spring up through the branch
      if (f.mode !== 'ground') return;
      f.crouch = (f.crouch || 0) + DT;
      f.squash = 0.2;
      if (f.crouch < 0.3) return;
      f.crouch = 0; f.mode = 'air'; f.vy = -FOE.jumpVy; f.on = -1; f.plan = 0.6;
      ev('hop', cx, f.y + f.h);
    } else if (nr < hr) { f.mode = 'climb'; f.vy = -FOE.climb; }
    else if (climbable(hc, hr + 1) || (f.mode === 'climb' && climbable(hc, hr))) {
      if (f.mode !== 'climb') { f.mode = 'climb'; f.y += 0.05; }
      f.vy = FOE.climb;
    } else { f.dropT = 0.25; f.mode = 'air'; f.vy = 1; }
  }
  // breadth-first over the chasers' map toward her tile (or as close to it as it can get)
  const queue = new Int32Array(COLS * ROWS), from = new Int32Array(COLS * ROWS);
  function route(a, goal) {
    if (a < 0 || !nav.isNode[a] || goal < 0) return -1;
    from.fill(-2);
    let qh = 0, qt = 0;
    queue[qt++] = a; from[a] = -1;
    const gc = goal % COLS, gr = (goal / COLS) | 0;
    let best = a, bestD = Infinity;
    while (qh < qt) {
      const i = queue[qh++];
      if (i === goal) { best = i; bestD = -1; break; }
      const d = Math.abs((i % COLS) - gc) + Math.abs(((i / COLS) | 0) - gr) * 2;
      if (d < bestD) { bestD = d; best = i; }
      for (const j of nav.adj[i]) if (from[j] === -2) { from[j] = i; queue[qt++] = j; }
    }
    if (best === a) return -1;
    let i = best;
    while (from[i] !== a && from[i] >= 0) i = from[i];
    return i;
  }
  function patrolAI(f) {
    const spd = FOE.patrol[L.world] ?? 2.8;
    if (f.mode !== 'ground') { f.vx = 0; return; }
    const front = f.dir > 0 ? f.x + f.w + 0.08 : f.x - 0.08;
    const c = Math.floor(front), r = Math.floor(f.y + f.h + 0.05);
    const mid = Math.floor(f.y + f.h / 2);
    const floorAhead = (solid(c, r) || oneTop(c, r)) && T(c, mid) !== '~';
    if (f.bump || solid(c, mid) || !floorAhead) f.dir = -f.dir;
    f.bump = false;
    f.vx = f.dir * spd;
  }
  function hopAI(f) {
    const s = sim.s;
    if (f.mode !== 'ground') return;
    f.vx = 0;
    f.hopT -= DT;
    if (f.hopT <= 0.35 && f.hopT + DT > 0.35) f.squash = 0.35; // wind-up: it crouches before every hop
    if (f.hopT <= 0) {
      const px = s.p.x + s.p.w / 2, cx = f.x + f.w / 2;
      f.dir = Math.abs(px - cx) < 0.3 ? f.dir : px < cx ? -1 : 1;
      const above = s.p.y + s.p.h < f.y + f.h - 1.5;
      f.vx = f.dir * (FOE.hopVx[L.world] ?? 3.8);
      f.vy = above ? -FOE.hopHi : -FOE.hopVy; f.mode = 'air'; f.on = -1; f.big = above;
      f.hopT = 0.9 + rng(s) * 0.7;
      ev('hop', cx, f.y + f.h);
    }
  }

  // ---------- touching a prickle ----------
  function touch() {
    const s = sim.s, p = s.p;
    if (p.inv > 0) return;
    const px = p.x + p.w / 2, py = p.y + p.h * 0.55;
    for (const f of s.foes) {
      if (f.emerge > 0) continue;
      const dx = f.x + f.w / 2 - px, dy = f.y + f.h / 2 - py;
      // a forgiving hitbox: the spikes are drawn bigger than they bite
      if (dx * dx + dy * dy < 0.6 * 0.6) return die('prickle');
    }
  }

  return sim;
}
