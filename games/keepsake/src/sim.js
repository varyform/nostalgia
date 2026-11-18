// The simulation: Wick, Rumbold, Clementine and her keepsakes, the pests and the scene tricks.
// Pure and deterministic: fixed 1/60 s steps, its own seeded random numbers, no DOM. The
// renderer and the sound read its state and the `events` each step leaves.
//
//   const sim = createSim({ seed });
//   sim.newGame();                    // scene 0, loop 0
//   sim.step({ left, right, up, down, punch });   // held states; punch edges are found here
//   sim.advance();                    // after a clear: the next scene (and a faster loop)
//
// Positions are in the 1920 × 1080 reference frame; a character's y is its feet.
import {
  BOTTOM, FLOOR_Y, FLOORS, SCENES, W, WATER_Y, dxOn, floorBelow, mod, params, pieceAt, segAt, stairLen, stairPos, walkWay,
} from './scenes.js';

export const DT = 1 / 60;
export const G = 2600; // falling, px/s²
export const HERO_V = 340, STAIR_V = 300, GRAB = 30;
export const PUNCH_T = 0.26, PUNCH_CD = 0.36, PUNCH_REACH = 135, PUNCH_HIT = [0.04, 0.2];
export const CATCH_W = 58, CATCH_TOP = 168, KEEP_R = 22, FLOAT_REACH = 80;
export const SPRING_T = 0.8, LEAP_T = 0.5, SWIPE_R = 175, SWIPE_ON = 0.16;
export const LIVES = 3, READY_T = 1.6, MISS_T = 2.6, CLEAR_T = 3.8, OUT_T = 3.4, CLIMB_T = 1.0, STUN_T = 3.2;
export const SCORE = { band: [500, 300, 200, 100], float: 50, smash: 100, bird: 300, bonk: 1000, swing: 1500, fling: 3000, glove: 200, clear: 2000, life: 500 };
const LIFE_FIRST = 20000, LIFE_EVERY = 50000, MAX_LIVES = 6;
const SWING_K = 6.6, SWING_DAMP = 0.32; // the sandbag: g/L and its drag

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// where a falling keepsake is `dt` seconds from now (the autopilot reads ahead with it)
export function keepAt(k, dt = 0) {
  const t = k.t + dt;
  return { x: k.x0 + k.drift * t + k.amp * Math.sin(k.freq * t + k.ph), y: k.y0 + k.vy * t };
}
// seconds until a falling keepsake reaches the water
export const keepToWater = k => (WATER_Y - k.y0) / k.vy - k.t;
// the floor a character counts as standing on (for the brute's chase and the autopilot)
export function floorOf(sc, a) {
  if (a.mode === 'floor') return a.f;
  if (a.mode === 'stair') { const s = sc.stairs[a.stair]; return a.p > 0.5 ? s.f : s.f + 1; }
  if (a.mode === 'fall') { const k = floorBelow(sc, a.from, a.x); return k < 0 ? BOTTOM : k; }
  if (a.mode === 'leap') return a.leap.to;
  if (a.mode === 'fly') return a.fly.to;
  for (let k = 0; k < FLOORS; k++) if (FLOOR_Y[k] >= a.y - 30) return k;
  return BOTTOM;
}
// the sandbag's position from its swing angle
export function bagPos(gm) {
  return { x: gm.px + gm.len * Math.sin(gm.th), y: gm.py + gm.len * Math.cos(gm.th) };
}

export function createSim({ seed = 1 } = {}) {
  let rnd = mulberry32(seed);
  const rr = (a, b) => a + (b - a) * rnd();
  let uid = 1;

  const S = {
    events: [], t: 0,
    status: 'ready', statusT: 0, // ready | play | miss | clear | over
    scene: 0, loop: 0, stage: 0,
    lives: LIVES, score: 0, nextLife: LIFE_FIRST,
    sc: SCENES[0], P: params(0, 0),
    hero: null, brute: null, sweet: null, keeps: [], shots: [], bird: null, thrower: null, glove: null, gim: null,
    caught: 0, quota: 0, miss: null, tally: null,
    stats: { caught: 0, lost: 0, deaths: 0, flings: 0, bonks: 0, swings: 0, smashes: 0, birds: 0, powers: 0 },
    newGame, resume, loadScene, step, advance, reseed,
  };
  const emit = (type, e = {}) => S.events.push({ type, ...e });
  let prevPunch = false, prevUp = false;

  function reseed(s) { rnd = mulberry32(s); }
  function addScore(n) {
    S.score += n;
    while (S.score >= S.nextLife) {
      S.nextLife += LIFE_EVERY;
      if (S.lives < MAX_LIVES) { S.lives++; emit('life'); }
    }
  }

  function newGame() {
    S.lives = LIVES; S.score = 0; S.nextLife = LIFE_FIRST; S.loop = 0; S.stage = 0;
    S.stats = { caught: 0, lost: 0, deaths: 0, flings: 0, bonks: 0, swings: 0, smashes: 0, birds: 0, powers: 0 };
    loadScene(0, 0);
  }

  // begin a saved checkpoint's scene as it began
  function resume(st) {
    S.lives = Math.max(1, Math.min(MAX_LIVES, st.lives | 0)); S.score = Math.max(0, st.score | 0);
    S.nextLife = Number.isFinite(st.nextLife) && st.nextLife > S.score ? st.nextLife : LIFE_FIRST + Math.ceil(Math.max(0, S.score - LIFE_FIRST + 1) / LIFE_EVERY) * LIFE_EVERY;
    S.stage = Math.max(0, st.stage | 0);
    S.stats = { caught: 0, lost: 0, deaths: 0, flings: 0, bonks: 0, swings: 0, smashes: 0, birds: 0, powers: 0 };
    loadScene(st.scene, Math.max(0, st.loop | 0));
  }

  function loadScene(scene, loop) {
    S.scene = scene; S.loop = loop;
    S.sc = SCENES[scene]; S.P = params(scene, loop);
    S.caught = 0; S.quota = S.sc.quota; S.tally = null;
    const gl = S.sc.glove;
    S.glove = { f: gl.f, x: gl.x, state: 'hidden', t: 6 };
    const gm = S.sc.gimmick;
    if (gm.kind === 'crate') S.gim = { kind: 'crate', f: gm.f, x: gm.x, y: FLOOR_Y[gm.f] - 122, state: 'hang', vy: 0, t: 0, spin: 0 };
    else if (gm.kind === 'spring') S.gim = { kind: 'spring', f: gm.f, x: gm.x, to: gm.to, cool: 0, squash: 0 };
    else S.gim = { kind: 'swing', f: gm.f, px: gm.px, py: gm.py, len: gm.len, th: 0, om: 0, live: false, hit: false };
    S.sweet = { x: (S.sc.sweet[0] + S.sc.sweet[1]) / 2, dir: 1, pause: 0, dropT: 1.2, toss: 0, cheer: 0, walkT: 0 };
    resetActors();
    S.status = 'ready'; S.statusT = 0;
    emit('scene', { scene, loop });
  }

  function resetActors() {
    const sc = S.sc, h0 = sc.hero, b0 = sc.brute;
    S.hero = { f: h0.f, x: h0.x, y: FLOOR_Y[h0.f], mode: 'floor', face: 1, vy: 0, from: 0, stair: -1, p: 0, sdir: 0, punchT: 0, punchCD: 0, power: 0, run: 0, moving: false, fly: null, catchT: 0 };
    S.brute = { f: b0.f, x: b0.x, y: FLOOR_Y[b0.f], mode: 'floor', face: -1, vy: 0, from: 0, stair: -1, p: 0, sdir: 0, dir: 0, act: null, actT: 0, think: 0, goal: -1, stun: 0, outT: 0, vx: 0, spin: 0, run: 0, cool: 0, throwCool: 2, goalDir: 0, stillT: 0, lx: b0.x, ly: FLOOR_Y[b0.f], leap: null, climbX: 0 };
    S.keeps = []; S.shots = [];
    S.thrower = sc.thrower ? { x: sc.thrower.x, y: sc.thrower.y, dir: sc.thrower.dir, state: 'idle', t: rr(2.5, 4.5), aim: 0 } : null;
    S.bird = sc.bird ? { state: 'wait', t: rr(5, 8), x: 0, y: 0, dir: 1, f: 1, ph: 0 } : null;
    const gm = S.gim;
    if (gm.kind === 'crate' && gm.state !== 'hang') { gm.state = 'gone'; gm.t = Math.min(gm.t, 2); }
    if (gm.kind === 'swing') { gm.th = 0; gm.om = 0; gm.live = false; }
    S.sweet.dropT = Math.max(S.sweet.dropT, 1.4);
    prevPunch = true; prevUp = true;
  }

  function advance() {
    let scene = S.scene + 1, loop = S.loop;
    if (scene >= SCENES.length) { scene = 0; loop++; }
    S.stage++;
    loadScene(scene, loop);
  }

  // ---------- movement shared by Wick and Rumbold ----------
  function walk(a, dx) {
    const fl = S.sc.floors[a.f];
    let nx = a.x + dx;
    nx = fl.wrap ? mod(nx, W) : Math.max(24, Math.min(W - 24, nx));
    a.x = nx;
    if (segAt(S.sc, a.f, nx) < 0) startFall(a, a.f);
  }
  function startFall(a, from) { a.mode = 'fall'; a.from = from; a.vy = 0; a.y = FLOOR_Y[from]; }
  function fall(a) {
    const y0 = a.y;
    a.vy = Math.min(1800, a.vy + G * DT);
    a.y += a.vy * DT;
    for (let k = a.from + 1; k < FLOORS; k++) {
      if (y0 < FLOOR_Y[k] && a.y >= FLOOR_Y[k] && segAt(S.sc, k, a.x) >= 0) {
        a.mode = 'floor'; a.f = k; a.y = FLOOR_Y[k]; a.vy = 0;
        return true;
      }
    }
    if (a.y > FLOOR_Y[BOTTOM]) { a.mode = 'floor'; a.f = BOTTOM; a.y = FLOOR_Y[BOTTOM]; a.vy = 0; return true; }
    return false;
  }
  function enterStair(a, s, fromTop) {
    const st = S.sc.stairs[s];
    a.mode = 'stair'; a.stair = s; a.p = fromTop ? 1 : 0; a.x = fromTop ? st.xt : st.xb; a.sdir = fromTop ? -1 : 1;
  }
  // move along a stair by `d` px of path; returns true when it stepped off
  function climb(a, d) {
    const st = S.sc.stairs[a.stair];
    a.p += d / stairLen(st);
    const q = stairPos(S.sc, a.stair, Math.max(0, Math.min(1, a.p)));
    a.x = q.x; a.y = q.y;
    if (a.p >= 1) { a.mode = 'floor'; a.f = st.f; a.x = st.xt; a.y = FLOOR_Y[st.f]; return true; }
    if (a.p <= 0) { a.mode = 'floor'; a.f = st.f + 1; a.x = st.xb; a.y = FLOOR_Y[st.f + 1]; return true; }
    return false;
  }
  const stairFoot = (f, x, r = GRAB) => S.sc.stairs.findIndex(st => st.f === f - 1 && Math.abs(dxOn(S.sc, f, x, st.xb)) < r);
  const stairHead = (f, x, r = GRAB) => S.sc.stairs.findIndex(st => st.f === f && Math.abs(dxOn(S.sc, f, x, st.xt)) < r);

  // ---------- Wick ----------
  function updateHero(inp) {
    const h = S.hero, sc = S.sc;
    const punchEdge = !!inp.punch && !prevPunch, upEdge = !!inp.up && !prevUp;
    prevPunch = !!inp.punch; prevUp = !!inp.up;
    h.punchCD -= DT; h.catchT -= DT;
    if (h.power > 0) {
      h.power -= DT;
      if (h.power <= 0) { h.power = 0; emit('powerend'); }
    }
    h.moving = false;
    if (h.punchT > 0) h.punchT -= DT;
    if ((h.mode === 'floor' || h.mode === 'stair') && punchEdge && h.punchCD <= 0) {
      h.punchT = PUNCH_T; h.punchCD = PUNCH_CD;
      emit('punch', { x: h.x, y: h.y, face: h.face, power: h.power > 0 });
    }
    if (h.mode === 'floor') {
      if (h.punchT > 0) return;
      if (inp.up) {
        const s = stairFoot(h.f, h.x);
        if (s >= 0) { enterStair(h, s, false); return; }
        const gm = S.gim;
        if (upEdge && gm.kind === 'spring' && h.f === gm.f && Math.abs(h.x - gm.x) < 40 && gm.cool <= 0) {
          const to = segAt(sc, gm.to, gm.x) >= 0 ? gm.to : gm.to + 1;
          h.mode = 'fly'; h.fly = { t: 0, x0: h.x, x1: gm.x, y0: h.y, y1: FLOOR_Y[to], to };
          gm.cool = 0.9; gm.squash = 1;
          emit('boing', { x: gm.x });
          return;
        }
      }
      if (inp.down) {
        const s = stairHead(h.f, h.x);
        if (s >= 0) { enterStair(h, s, true); return; }
      }
      const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      if (dir) {
        h.face = dir; h.moving = true; h.run += DT;
        walk(h, dir * HERO_V * DT);
      }
    } else if (h.mode === 'stair') {
      if (h.punchT > 0) return;
      const st = sc.stairs[h.stair], rightUp = st.xt > st.xb;
      let d = 0;
      if (inp.up || (inp.right && rightUp) || (inp.left && !rightUp)) d = 1;
      else if (inp.down || (inp.left && rightUp) || (inp.right && !rightUp)) d = -1;
      if (d) {
        h.sdir = d; h.moving = true; h.run += DT;
        h.face = (rightUp ? 1 : -1) * d;
        climb(h, d * STAIR_V * DT);
      }
    } else if (h.mode === 'fall') {
      fall(h);
    } else if (h.mode === 'fly') {
      const F = h.fly;
      F.t += DT;
      const e = Math.min(1, F.t / SPRING_T), k = 1 - (1 - e) * (1 - e);
      h.x = F.x0 + (F.x1 - F.x0) * e;
      h.y = F.y0 + (F.y1 - F.y0) * k - Math.sin(Math.PI * e) * 70;
      if (e >= 1) { h.mode = 'floor'; h.f = F.to; h.y = FLOOR_Y[F.to]; h.fly = null; emit('land', { x: h.x, y: h.y }); }
    }
  }
  // Wick's fist this step: a box in front of him, or null
  function fist() {
    const h = S.hero;
    if (h.punchT <= 0) return null;
    const e = PUNCH_T - h.punchT;
    if (e < PUNCH_HIT[0] || e > PUNCH_HIT[1]) return null;
    return { x0: h.face > 0 ? h.x - 10 : h.x - PUNCH_REACH, x1: h.face > 0 ? h.x + PUNCH_REACH : h.x + 10, y0: h.y - 150, y1: h.y - 40 };
  }
  const inBox = (b, x, y, r = 0) => b && x + r >= b.x0 && x - r <= b.x1 && y + r >= b.y0 && y - r <= b.y1;

  // ---------- Rumbold ----------
  const bruteLive = b => b.mode !== 'flung' && b.mode !== 'out' && b.mode !== 'climb' && b.stun <= 0;
  function fling(dir, cause) {
    const b = S.brute;
    b.mode = 'flung'; b.vx = dir * 1050; b.vy = -950; b.act = null; b.spin = 0; b.stun = 0;
    S.stats.flings++;
    if (cause === 'swing') S.stats.swings++;
    const pts = cause === 'swing' ? SCORE.swing : SCORE.fling;
    addScore(pts);
    emit('fling', { x: b.x, y: b.y, dir, cause, pts });
  }
  function updateBrute() {
    const b = S.brute, h = S.hero, sc = S.sc, P = S.P;
    b.cool -= DT; b.throwCool -= DT;
    if (b.stun > 0) {
      b.stun -= DT;
      if (b.stun <= 0) { b.stun = 0; emit('wake', { x: b.x, y: b.y }); }
      if (b.mode === 'floor' || b.mode === 'stair') return;
    }
    switch (b.mode) {
      case 'flung': {
        b.vy += 2000 * DT; b.x += b.vx * DT; const y0 = b.y; b.y += b.vy * DT; b.spin += DT * 9;
        if (y0 < WATER_Y && b.y >= WATER_Y && b.x > 0 && b.x < W) emit('splash', { x: b.x, big: true });
        if (b.y > 1300 || b.x < -260 || b.x > W + 260) { b.mode = 'out'; b.outT = OUT_T; }
        return;
      }
      case 'out':
        b.outT -= DT;
        if (b.outT <= 0) {
          // he hauls himself out of the water at the far side of the bottom floor from Wick
          b.mode = 'climb'; b.outT = CLIMB_T; b.f = BOTTOM;
          b.x = mod(h.x + W / 2 + rr(-200, 200), W); b.x = Math.max(80, Math.min(W - 80, b.x));
          b.y = WATER_Y + 60; b.climbX = b.x;
          emit('climb', { x: b.x });
        }
        return;
      case 'climb':
        b.outT -= DT;
        b.y = FLOOR_Y[BOTTOM] + (WATER_Y + 60 - FLOOR_Y[BOTTOM]) * Math.max(0, b.outT / CLIMB_T);
        if (b.outT <= 0) { b.mode = 'floor'; b.y = FLOOR_Y[BOTTOM]; b.think = 0; b.stillT = 0; }
        return;
      case 'fall':
        if (fall(b)) { emit('thud', { x: b.x, y: b.y }); b.think = 0; }
        return;
      case 'leap': {
        const L = b.leap;
        L.t += DT;
        const e = Math.min(1, L.t / LEAP_T);
        b.y = L.y0 + (L.y1 - L.y0) * (1 - (1 - e) * (1 - e)) - Math.sin(Math.PI * e) * 50;
        if (e >= 1) { b.mode = 'floor'; b.f = L.to; b.y = FLOOR_Y[L.to]; b.leap = null; b.think = 0; emit('thud', { x: b.x, y: b.y }); }
        return;
      }
      case 'stair':
        if (climb(b, b.sdir * P.bruteV * 0.8 * DT)) b.think = 0;
        b.run += DT;
        return;
    }
    // on a floor
    if (b.act) { bruteAct(); return; }
    const hf = floorOf(sc, h), dx = dxOn(sc, b.f, b.x, h.x), adx = Math.abs(dx);
    const fleeing = h.power > 0;
    b.think -= DT;
    if (!fleeing && h.mode !== 'fly') {
      // attacks start the moment they make sense
      if (hf === b.f && adx < SWIPE_R - 20 && Math.abs(h.y - b.y) < 90 && b.cool <= 0) { b.face = Math.sign(dx) || b.face; startAct('swipe', P.swipeWind); return; }
      if (hf === b.f + 1 && adx < 70 && floorBelow(sc, b.f, b.x) >= 0 && h.mode === 'floor') { startAct('drop', 0.3); return; }
      if (hf === b.f - 1 && adx < 90 && segAt(sc, b.f - 1, b.x) >= 0 && h.mode === 'floor' && b.cool <= 0) { startAct('leap', 0.42); return; }
    }
    if (b.think <= 0) { b.think = P.think * (0.7 + rnd() * 0.6); decide(hf, dx, fleeing); if (b.act) return; }
    if (b.goal >= 0) {
      const st = sc.stairs[b.goal], d = dxOn(sc, b.f, b.x, st.xb);
      if (Math.abs(d) <= P.bruteV * DT + 1) { b.x = st.xb; enterStair(b, b.goal, false); b.goal = -1; return; }
      b.dir = b.goalDir || Math.sign(d);
    }
    if (b.dir) {
      b.face = b.dir; b.run += DT;
      walk(b, b.dir * P.bruteV * (fleeing ? 0.85 : 1) * DT);
      if (b.mode === 'fall') { b.goal = -1; return; }
    }
    // a watchdog: never stand stuck against a wall
    if (Math.abs(b.x - b.lx) < 0.5 && b.mode === 'floor') b.stillT += DT; else b.stillT = 0;
    b.lx = b.x;
    if (b.stillT > 1.6) {
      b.stillT = 0;
      if (floorBelow(sc, b.f, b.x) >= 0 && rnd() < 0.6) startAct('drop', 0.3);
      else if (b.f > 0 && segAt(sc, b.f - 1, b.x) >= 0) startAct('leap', 0.42);
      else b.dir = -b.dir || 1;
    }
  }
  function decide(hf, dx, fleeing) {
    const b = S.brute, h = S.hero, sc = S.sc;
    b.goal = -1;
    if (fleeing) {
      // keep away from the glove: along the floor, or down through it when close
      if (hf === b.f && Math.abs(dx) < 520) {
        b.dir = -Math.sign(dx) || 1;
        if (Math.abs(dx) < 260 && floorBelow(sc, b.f, b.x) >= 0 && rnd() < 0.3) startAct('drop', 0.15);
      } else b.dir = rnd() < 0.5 ? 0 : b.dir;
      return;
    }
    // far from Wick he sometimes stops to flex for the crowd
    if (Math.abs(dx) > 640 && rnd() < S.P.flex) { startAct('flex', 1.1); return; }
    if (hf === b.f) {
      const way = walkWay(sc, b.f, b.x, h.x);
      b.dir = way.dir || Math.sign(dx);
      if (Math.abs(dx) > 460 && b.throwCool <= 0 && way.dir && rnd() < S.P.throwAt) { b.face = way.dir; startAct('throw', 0.5); }
      return;
    }
    if (hf > b.f) {
      // above Wick: get over him and drop; far above, drop wherever
      if (hf > b.f + 1 && floorBelow(sc, b.f, b.x) >= 0 && rnd() < 0.5) { startAct('drop', 0.3); return; }
      const way = walkWay(sc, b.f, b.x, h.x);
      b.dir = way.dir || Math.sign(dx);
      return;
    }
    // below Wick: the best stair up from this piece of floor, or a leap
    const piece = pieceAt(sc, b.f, b.x);
    let best = -1, bestCost = Infinity;
    sc.stairs.forEach((st, i) => {
      if (st.f !== b.f - 1 || pieceAt(sc, b.f, st.xb) !== piece) return;
      const way = walkWay(sc, b.f, b.x, st.xb);
      if (!way.dir && Math.abs(b.x - st.xb) > 2) return;
      const cost = way.dist + Math.abs(dxOn(sc, st.f, st.xt, h.x)) * 0.6;
      if (cost < bestCost) { bestCost = cost; best = i; }
    });
    if (best >= 0 && !(Math.abs(dx) < 260 && segAt(sc, b.f - 1, b.x) >= 0 && rnd() < 0.35)) {
      b.goal = best; b.goalDir = walkWay(sc, b.f, b.x, sc.stairs[best].xb).dir;
      return;
    }
    if (segAt(sc, b.f - 1, b.x) >= 0 && (best < 0 || rnd() < 0.5)) { startAct('leap', 0.42); return; }
    b.dir = Math.sign(dx) || 1;
  }
  function startAct(act, t) {
    const b = S.brute;
    b.act = act; b.actT = t; b.dir = 0; b.goal = -1; b.stillT = 0;
    emit(act === 'swipe' || act === 'throw' ? 'wind' : act === 'flex' ? 'flex' : 'crouch', { x: b.x, y: b.y, act });
  }
  function bruteAct() {
    const b = S.brute, sc = S.sc;
    b.actT -= DT;
    if (b.act === 'swipe') {
      if (b.actT <= 0 && b.actT > -DT) emit('swipe', { x: b.x, y: b.y, face: b.face });
      if (b.actT <= -SWIPE_ON - 0.36) { b.act = null; b.cool = 0.8; b.think = 0; }
      return;
    }
    if (b.actT > 0) return;
    if (b.act === 'flex') { b.act = null; b.think = 0; return; }
    if (b.act === 'drop') {
      b.act = null;
      if (floorBelow(sc, b.f, b.x) >= 0) { startFall(b, b.f); b.vy = 120; emit('drop', { x: b.x, y: b.y }); }
    } else if (b.act === 'leap') {
      b.act = null;
      if (b.f > 0 && segAt(sc, b.f - 1, b.x) >= 0) {
        b.mode = 'leap'; b.leap = { t: 0, y0: b.y, y1: FLOOR_Y[b.f - 1], to: b.f - 1 };
        b.cool = 0.6;
        emit('leap', { x: b.x, y: b.y });
      }
    } else if (b.act === 'throw') {
      b.act = null; b.throwCool = 4 + rnd() * 3;
      S.shots.push({ id: uid++, kind: 'bottle', x: b.x + b.face * 40, y: b.y - 112, vx: b.face * 560, vy: 0, g: 0, f: b.f, spin: 0, run: 0, wrap: sc.floors[b.f].wrap });
      emit('throw', { x: b.x, y: b.y, who: 'brute' });
    }
  }
  // Rumbold's swing this step: the box it covers, or null
  function swipeBox() {
    const b = S.brute;
    if (b.act !== 'swipe' || b.actT > 0 || b.actT < -SWIPE_ON) return null;
    return { x0: b.face > 0 ? b.x - 20 : b.x - SWIPE_R, x1: b.face > 0 ? b.x + SWIPE_R : b.x + 20, y0: b.y - 190, y1: b.y + 10 };
  }

  // ---------- Clementine and the keepsakes ----------
  function updateSweet() {
    const s = S.sweet, P = S.P, [a, b] = S.sc.sweet;
    s.toss = Math.max(0, s.toss - DT); s.cheer = Math.max(0, s.cheer - DT);
    if (s.pause > 0) s.pause -= DT;
    else {
      s.x += s.dir * 110 * DT; s.walkT += DT;
      if (s.x < a) { s.x = a; s.dir = 1; }
      if (s.x > b) { s.x = b; s.dir = -1; }
      if (rnd() < 0.004) s.pause = rr(0.5, 1.4);
      if (rnd() < 0.003) s.dir = -s.dir;
    }
    s.dropT -= DT;
    const live = S.keeps.length;
    if (s.dropT <= 0 && live < P.maxLive && live < S.quota - S.caught) {
      s.dropT = rr(P.gap[0], P.gap[1]);
      s.toss = 0.45;
      const F = S.sc.fall, amp = rr(F.amp[0], F.amp[1]);
      let x0 = s.x + s.dir * 30;
      x0 = Math.max(60 + amp, Math.min(W - 60 - amp, x0));
      const fallT = (WATER_Y - (FLOOR_Y[0] - 110)) / P.fallV;
      let drift = rr(-14, 14);
      if (x0 + drift * fallT < 80 || x0 + drift * fallT > W - 80) drift = -drift;
      S.keeps.push({ id: uid++, kind: S.sc.keep, x0, y0: FLOOR_Y[0] - 110, t: 0, vy: P.fallV * rr(0.92, 1.08), amp, freq: rr(F.freq[0], F.freq[1]), ph: rr(0, Math.PI * 2), drift, state: 'fall', x: x0, y: FLOOR_Y[0] - 110, floatT: 0, n: 0 });
      emit('toss', { x: s.x, y: FLOOR_Y[0] - 110, kind: S.sc.keep });
    }
  }
  function catchKeep(k, how) {
    const h = S.hero;
    S.keeps.splice(S.keeps.indexOf(k), 1);
    S.caught++; S.stats.caught++;
    const pts = how === 'float' ? SCORE.float : SCORE.band[Math.max(0, Math.min(3, floorOf(S.sc, h)))];
    addScore(pts);
    h.catchT = 0.35; S.sweet.cheer = 0.8;
    emit('catch', { x: k.x, y: k.y, kind: k.kind, n: S.caught, left: S.quota - S.caught, pts, how });
    if (S.caught >= S.quota) clear();
  }
  function updateKeeps() {
    const h = S.hero;
    for (const k of S.keeps.slice()) {
      if (k.state === 'fall') {
        k.t += DT;
        const p = keepAt(k);
        k.x = p.x; k.y = p.y;
        if (k.y >= WATER_Y) { k.state = 'float'; k.y = WATER_Y; k.floatT = S.P.float; emit('splash', { x: k.x, small: true }); }
      } else {
        k.floatT -= DT; k.t += DT;
        if (k.floatT <= 0) {
          S.keeps.splice(S.keeps.indexOf(k), 1);
          S.stats.lost++;
          emit('sink', { x: k.x, kind: k.kind });
          die('sank', k);
          return;
        }
      }
      // caught by Wick's hands: anywhere on his body, or scooped from the water at the bottom
      let dx = k.x - h.x;
      if (h.mode === 'floor' && S.sc.floors[h.f].wrap) dx = mod(dx + W / 2, W) - W / 2;
      if (k.state === 'fall' && Math.abs(dx) < CATCH_W + KEEP_R && k.y > h.y - CATCH_TOP && k.y < h.y + 20) catchKeep(k, 'hand');
      else if (k.state === 'float' && h.mode === 'floor' && h.f === BOTTOM && Math.abs(dx) < FLOAT_REACH) catchKeep(k, 'float');
      if (S.status !== 'play') return;
    }
  }

  // ---------- pests ----------
  function updateThrower() {
    const T = S.thrower, h = S.hero;
    if (!T) return;
    T.t -= DT;
    if (T.state === 'idle' && T.t <= 0) { T.state = 'wind'; T.t = 0.7; emit('heave', { x: T.x, y: T.y }); }
    else if (T.state === 'wind' && T.t <= 0) {
      // lob a pot to land where Wick stands now
      const tx = h.x, ty = h.y - 80, dx = tx - T.x, fl = Math.max(0.95, Math.min(1.7, Math.abs(dx) / 760));
      const g = 1000, vx = dx / fl, vy = (ty - T.y - 0.5 * g * fl * fl) / fl;
      S.shots.push({ id: uid++, kind: S.sc.id === 'roofs' ? 'soot' : 'pot', x: T.x, y: T.y, vx, vy, g, spin: 0, run: 0, wrap: false });
      emit('throw', { x: T.x, y: T.y, who: 'thrower' });
      T.state = 'idle'; T.t = rr(S.P.throwGap[0], S.P.throwGap[1]);
    }
  }
  function updateBird() {
    const B = S.bird, h = S.hero;
    if (!B) return;
    B.t -= DT; B.ph += DT;
    if (B.state === 'wait' && B.t <= 0) {
      B.state = 'warn'; B.t = 1.1; B.f = Math.max(1, floorOf(S.sc, h)); B.dir = h.x > W / 2 ? -1 : 1; B.x = B.dir > 0 ? -90 : W + 90;
      B.y = FLOOR_Y[B.f] - 100;
      emit('squawk', { x: B.dir > 0 ? 40 : W - 40, y: B.y });
    } else if (B.state === 'warn' && B.t <= 0) { B.state = 'swoop'; B.ph = 0; }
    else if (B.state === 'swoop') {
      B.x += B.dir * S.P.birdV * DT;
      B.y = FLOOR_Y[B.f] - 100 + Math.sin(B.ph * 4.2) * 34;
      if (B.x < -120 || B.x > W + 120) { B.state = 'wait'; B.t = rr(S.P.birdGap[0], S.P.birdGap[1]); }
    } else if (B.state === 'hit') {
      B.x += B.dir * 160 * DT; B.y -= 420 * DT;
      if (B.y < -100) { B.state = 'wait'; B.t = rr(S.P.birdGap[0], S.P.birdGap[1]); }
    }
  }
  function updateShots() {
    for (const s of S.shots.slice()) {
      s.vy += s.g * DT; s.x += s.vx * DT; s.y += s.vy * DT; s.spin += DT * 10; s.run += Math.abs(s.vx) * DT;
      if (s.wrap) s.x = mod(s.x, W);
      if (s.y > WATER_Y + 40 || s.x < -120 || s.x > W + 120 || s.run > 1700) {
        S.shots.splice(S.shots.indexOf(s), 1);
        if (s.y > WATER_Y) emit('splash', { x: s.x, small: true });
      }
    }
  }

  // ---------- the glove and the scene's trick ----------
  function updateGlove() {
    const G0 = S.glove, h = S.hero;
    if (G0.state === 'hidden' || G0.state === 'used') {
      G0.t -= DT;
      if (G0.t <= 0) { G0.state = 'ready'; emit('glove', { x: G0.x, y: FLOOR_Y[G0.f] }); }
      return;
    }
    if (h.mode === 'floor' && h.f === G0.f && Math.abs(dxOn(S.sc, h.f, h.x, G0.x)) < 48) {
      G0.state = 'used'; G0.t = 30;
      h.power = S.P.power;
      S.stats.powers++;
      addScore(SCORE.glove);
      emit('power', { x: G0.x, y: FLOOR_Y[G0.f] });
    }
  }
  function updateGimmick() {
    const gm = S.gim, b = S.brute;
    if (gm.kind === 'crate') {
      if (gm.state === 'gone') { gm.t -= DT; if (gm.t <= 0) { gm.state = 'hang'; gm.y = FLOOR_Y[gm.f] - 122; emit('rehang', { x: gm.x }); } }
      else if (gm.state === 'fall') {
        gm.vy += 1800 * DT; gm.y += gm.vy * DT; gm.spin += DT * 3;
        if (bruteLive(b) && Math.abs(b.x - gm.x) < 70 && gm.y > b.y - 200 && gm.y < b.y - 40) {
          b.stun = STUN_T; b.act = null; b.dir = 0; b.goal = -1;
          gm.state = 'gone'; gm.t = 12;
          S.stats.bonks++;
          addScore(SCORE.bonk);
          emit('bonk', { x: gm.x, y: gm.y, pts: SCORE.bonk });
        } else if (gm.y > WATER_Y) { gm.state = 'gone'; gm.t = 12; emit('splash', { x: gm.x }); }
      }
    } else if (gm.kind === 'spring') {
      gm.cool -= DT; gm.squash = Math.max(0, gm.squash - DT * 2.5);
    } else {
      gm.om += (-SWING_K * Math.sin(gm.th) - SWING_DAMP * gm.om) * DT; gm.th += gm.om * DT;
      if (gm.live && Math.abs(gm.om) < 0.6 && Math.abs(gm.th) < 0.12) gm.live = false;
      if (gm.live && Math.abs(gm.om) > 1 && bruteLive(b) && (b.mode === 'floor' || b.mode === 'stair' || b.mode === 'leap')) {
        const p = bagPos(gm);
        if (Math.abs(b.x - p.x) < 72 && p.y > b.y - 210 && p.y < b.y - 20) fling(Math.sign(gm.om), 'swing');
      }
    }
  }

  // ---------- what Wick's fist and body touch ----------
  function collide() {
    const h = S.hero, b = S.brute, sc = S.sc, F = fist();
    // the fist
    if (F) {
      for (const s of S.shots.slice()) {
        if (inBox(F, s.x, s.y, 20)) {
          S.shots.splice(S.shots.indexOf(s), 1);
          S.stats.smashes++;
          addScore(SCORE.smash);
          emit('smash', { x: s.x, y: s.y, kind: s.kind, pts: SCORE.smash });
        }
      }
      const B = S.bird;
      if (B && B.state === 'swoop' && inBox(F, B.x, B.y, 34)) {
        B.state = 'hit'; S.stats.birds++;
        addScore(SCORE.bird);
        emit('birdhit', { x: B.x, y: B.y, pts: SCORE.bird });
      }
      const gm = S.gim;
      if (gm.kind === 'crate' && gm.state === 'hang' && h.mode === 'floor' && h.f === gm.f && inBox(F, gm.x, gm.y, 30)) {
        gm.state = 'fall'; gm.vy = 0;
        emit('crate', { x: gm.x, y: gm.y });
      }
      if (gm.kind === 'swing' && !gm.live && Math.abs(gm.om) < 1) {
        const p = bagPos(gm);
        if (inBox(F, p.x, p.y, 30)) { gm.om = h.face * 3.3; gm.live = true; emit('swing', { x: p.x, y: p.y }); }
      }
      if (h.power > 0 && bruteLive(b) && inBox(F, b.x, b.y - 100, 50)) fling(h.face, 'glove');
    }
    if (S.status !== 'play') return;
    // Rumbold himself
    if (bruteLive(b)) {
      let dx = b.x - h.x;
      if (h.mode === 'floor' && b.mode === 'floor' && h.f === b.f && sc.floors[h.f].wrap) dx = mod(dx + W / 2, W) - W / 2;
      const touch = Math.abs(dx) < 66 && Math.abs(b.y - h.y) < 110;
      if (touch && h.power > 0) fling(Math.sign(dx) || h.face, 'glove');
      else if (touch) { die('brute'); return; }
      const sw = swipeBox();
      if (sw && h.power <= 0 && inBox(sw, h.x, h.y - 80, 30)) { die('swipe'); return; }
    }
    // pots, soot and bottles
    for (const s of S.shots) {
      if (Math.abs(s.x - h.x) < 40 && s.y > h.y - 160 && s.y < h.y + 6) { die(s.kind); return; }
    }
    const B = S.bird;
    if (B && B.state === 'swoop' && Math.abs(B.x - h.x) < 56 && Math.abs(B.y - (h.y - 90)) < 72) { die('bird'); return; }
  }

  // ---------- outcomes ----------
  function die(cause, k = null) {
    if (S.status !== 'play') return;
    S.status = 'miss'; S.statusT = 0;
    S.stats.deaths++;
    S.miss = { cause, x: k ? k.x : S.hero.x, y: k ? WATER_Y : S.hero.y, kind: k?.kind };
    emit('miss', { cause, x: S.miss.x, y: S.miss.y });
  }
  function clear() {
    S.status = 'clear'; S.statusT = 0;
    const bonus = SCORE.clear + SCORE.life * S.lives;
    S.tally = { caught: S.caught, bonus };
    addScore(bonus);
    S.keeps = []; S.shots = [];
    emit('clear', { bonus });
  }

  function step(inp = {}) {
    S.t += DT; S.statusT += DT;
    switch (S.status) {
      case 'ready':
        S.sweet.walkT += DT;
        if (S.statusT >= READY_T) { S.status = 'play'; S.statusT = 0; emit('go'); }
        break;
      case 'play':
        updateHero(inp);
        updateBrute();
        updateSweet();
        if (S.status === 'play') updateKeeps();
        if (S.status === 'play') { updateThrower(); updateBird(); updateShots(); updateGlove(); updateGimmick(); collide(); }
        break;
      case 'miss':
        if (S.statusT >= MISS_T) {
          S.lives--;
          if (S.lives <= 0) { S.status = 'over'; S.statusT = 0; emit('over'); }
          else { S.miss = null; resetActors(); S.status = 'ready'; S.statusT = 0; emit('ready'); }
        }
        break;
      case 'clear':
        S.sweet.walkT += DT;
        break;
    }
  }

  return S;
}
