// Quarry's simulation: the dig, the gems, the ore crates, the grubs, the shot and the lamp.
//
// Pure and deterministic: no DOM, no canvas, no audio, no Math.random. Positions are integer
// units, U = 16 to a cell, with cell centres on multiples of U; everything moves along the
// lanes through cell centres and only turns on a centre. The page, the demo and the Node
// tools all drive it with one input per fixed step and read `sim.s` to draw it. Things a
// renderer or the sound reacts to are queued in `sim.events`.
//
//   const sim = createSim();
//   sim.newGame({ level: 0, seed: 1 });
//   sim.step({ dir: RIGHT, fire: false });   // dir: -1 (none), RIGHT, DOWN, LEFT, UP
//   sim.s.hero, sim.s.mons, sim.s.crates …
import { COLS, LEVELS, ROWS, U, parseLevel } from './levels.js';

export { COLS, ROWS, U };
export const DT = 1 / 60;
export const RIGHT = 0, DOWN = 1, LEFT = 2, UP = 3;
export const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
export const SCORE = { gem: 25, streak: 250, kill: 250, gold: 500, bonus: 1000, eat: 200 };
export const LIFE_EVERY = 20000;
export const STREAK = 8; // gems in a row for the streak bonus
export const GOLD_LIFE = 10;
const STREAK_GAP = 1.25; // seconds allowed between gems of a streak
const MAX_X = (COLS - 1) * U, MAX_Y = (ROWS - 1) * U;
const HERO_SPEED = 16; // sixteenths of a unit per step
const SHOT_SPEED = 4, FALL_SPEED = 2;
const WOBBLE = 0.65;
const READY_T = 1.8, RESPAWN_T = 1.1, DYING_T = 2.2, CLEAR_T = 2.8;
const HIT = 11; // touching distance, units

// difficulty by level index (0 = the first level); the maps cycle every eight
export function levelParams(L) {
  return {
    total: 5 + Math.min(L, 11), // grubs per level
    cap: Math.min(3 + Math.floor(L / 2), 6), // out at once
    interval: Math.max(1, 3.2 - 0.25 * L), // seconds between grubs
    walker: Math.min(17, 12 + Math.floor(L * 0.7)), // sixteenths of a unit per step
    burrower: Math.min(13, 9 + Math.floor(L * 0.5)),
    morph: Math.min(0.09, 0.02 + 0.012 * L), // chance per crossing to turn borer
    reload: Math.min(8, 2.4 + 0.45 * L), // shot recharge, seconds
    frenzy: Math.max(5, 15 - L), // lamp time, seconds
  };
}

export function createSim() {
  const sim = { s: null, events: [], newGame, load, step, dugAt, crateAt };
  let s = null;
  const ev = (type, x = 0, y = 0, extra) => sim.events.push({ type, x, y, ...extra });

  function rnd() {
    let t = (s.seed = (s.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ---------- game and level ----------
  function newGame({ level = 0, seed = 1, lives = 2, score = 0, monsters = true } = {}) {
    s = sim.s = { level, score, lives, nextLife: LIFE_EVERY * (Math.floor(score / LIFE_EVERY) + 1), seed: seed | 0, monsters, loadId: 0, t: 0, tick: 0, nextId: 1, deaths: 0 };
    load(level);
  }
  function load(level) {
    const def = LEVELS[level % LEVELS.length], P = levelParams(level), L = parseLevel(def);
    Object.assign(s, {
      level, def, P, name: def.name,
      status: 'ready', statusT: 0, levelT: 0,
      cell: L.cell, hA: L.hA, hB: L.hB, vA: L.vA, vB: L.vB, gem: L.gem,
      gems: L.gemCount, gemTotal: L.gemCount,
      start: L.start, den: L.spawn,
      crates: L.crates.map(c => ({ id: s.nextId++, x: c.x * U, y: c.y * U, state: 'rest', t: 0, fell: 0, dir: 0, pushed: -1 })),
      gold: [], mons: [], shot: null,
      spawn: { total: P.total, spawned: 0, killed: 0, timer: 2.5 },
      bonus: { state: 'wait', x: L.spawn.x * U, y: L.spawn.y * U, t: 0 },
      frenzy: 0, chain: 0, streak: 0, lastGem: -9, reload: 0, digVer: 0,
    });
    s.loadId++;
    placeHero();
    ev('level', 0, 0, { level });
  }
  function placeHero() {
    // a crate that came to rest on the start cell is cleared away
    const c = crateAt(s.start.x * U, s.start.y * U);
    if (c) { s.crates.splice(s.crates.indexOf(c), 1); ev('burst', c.x, c.y); s.gold.push({ x: c.x, y: c.y, t: 0 }); }
    s.hero = { x: s.start.x * U, y: s.start.y * U, dir: LEFT, face: LEFT, moving: false, pushing: false, digN: 0, alive: true };
    s.shot = null;
  }
  function setStatus(st) { s.status = st; s.statusT = 0; }

  // ---------- the dig ----------
  const idx = (x, y) => (y / U) * COLS + x / U; // aligned positions only
  const cellOf = (x, y) => Math.round(y / U) * COLS + Math.round(x / U);
  function open(i) {
    if (s.cell[i]) return false;
    s.cell[i] = 1; s.digVer++;
    return true;
  }
  // a digger (or a shoved crate) moved one unit from p to n: extend the tunnel it came out of.
  // Returns true when it cut fresh soil.
  function carve(px, py, nx, ny) {
    const horiz = ny === py, A = horiz ? s.hA : s.vA, B = horiz ? s.hB : s.vB;
    const p = horiz ? px : py, n = horiz ? nx : ny, k = (horiz ? ny : nx) / U;
    const e = Math.floor(Math.min(p, n) / U), i = horiz ? k * COLS + e : e * COLS + k;
    const po = p - e * U, no = n - e * U;
    let fresh = false;
    if (po === 0 || po === U) open(horiz ? k * COLS + p / U : (p / U) * COLS + k);
    if (no > po) {
      if (no > A[i] && no < U - B[i]) fresh = true;
      if (po <= A[i] && no > A[i]) { A[i] = no; s.digVer++; }
    } else {
      if (U - no > B[i] && no > A[i]) fresh = true;
      if (U - po <= B[i] && U - no > B[i]) { B[i] = U - no; s.digVer++; }
    }
    if (no === 0 || no === U) fresh = open(horiz ? k * COLS + n / U : (n / U) * COLS + k) || fresh;
    return fresh;
  }
  // is this lane point dug out (walkable for a grub that cannot dig, passable for the shot)?
  function dugAt(x, y) {
    const ox = x % U, oy = y % U;
    if (!ox && !oy) return s.cell[idx(x, y)] === 1;
    if (!oy) { const e = Math.floor(x / U), i = (y / U) * COLS + e, o = x - e * U; return o <= s.hA[i] || o >= U - s.hB[i]; }
    const e = Math.floor(y / U), i = e * COLS + x / U, o = y - e * U;
    return o <= s.vA[i] || o >= U - s.vB[i];
  }
  const inField = (x, y) => x >= 0 && y >= 0 && x <= MAX_X && y <= MAX_Y;
  function crateAt(x, y, except = null) {
    for (const c of s.crates) if (c !== except && Math.abs(c.x - x) < U && Math.abs(c.y - y) < U) return c;
    return null;
  }
  const isNode = e => e.x % U === 0 && e.y % U === 0;

  // ---------- score ----------
  function addScore(n, x, y) {
    s.score += n;
    ev('score', x, y, { n });
    while (s.score >= s.nextLife) { s.nextLife += LIFE_EVERY; s.lives++; ev('life', x, y); }
  }

  // ---------- one step ----------
  function step(inp = {}) {
    s.statusT += DT; s.tick++;
    switch (s.status) {
      case 'ready': if (s.statusT >= (s.levelT > 0 ? RESPAWN_T : READY_T)) setStatus('play'); return;
      case 'dying': if (s.statusT >= DYING_T) afterDeath(); else crates(); return;
      case 'clear': if (s.statusT >= CLEAR_T) load(s.level + 1); return;
      case 'over': return;
    }
    s.t += DT; s.levelT += DT;
    if (s.reload > 0) s.reload = Math.max(0, s.reload - DT);
    if (s.frenzy > 0) {
      s.frenzy -= DT;
      if (s.frenzy <= 0) { s.frenzy = 0; s.chain = 0; ev('frenzyend'); }
    }
    hero(inp);
    fire(inp);
    shot();
    crates();
    if (s.status !== 'play') return;
    for (const m of s.mons.slice()) monster(m);
    shot();
    spawner();
    pickups();
    touch();
    if (s.status === 'play' && (s.gems === 0 || (s.monsters && s.spawn.killed >= s.spawn.total))) {
      setStatus('clear');
      ev('clear', s.hero.x, s.hero.y, { level: s.level });
    }
  }

  // ---------- the drill ----------
  function heroCan(h, d) {
    const nx = h.x + DX[d], ny = h.y + DY[d];
    if (!inField(nx, ny)) return false;
    const c = crateAt(nx, ny);
    if (!c) return true;
    // a sideways shove on the crate's own row moves it along, a cell at a time
    if (DY[d] !== 0 || c.y !== h.y || (c.state !== 'rest' && c.state !== 'wobble' && c.state !== 'slide')) return false;
    if (c.state === 'slide' && c.dir !== d) return false;
    if (c.state !== 'slide') {
      const tx = c.x + DX[d] * U;
      if (!inField(tx, c.y) || crateAt(tx, c.y, c) || s.gem[idx(tx, c.y)]) return false;
      c.state = 'slide'; c.dir = d; c.t = 0;
      ev('push', c.x, c.y);
    }
    slideCrate(c);
    return !crateAt(nx, ny);
  }
  function slideCrate(c) {
    if (c.pushed === s.tick) return;
    c.pushed = s.tick;
    const nx = c.x + DX[c.dir];
    carve(c.x, c.y, nx, c.y);
    c.x = nx;
    if (c.x % U === 0) { c.state = 'rest'; c.t = 0; c.fell = 0; }
  }
  function hero(inp) {
    const h = s.hero, want = inp.dir ?? -1;
    h.moving = false; h.pushing = false;
    let n = HERO_SPEED >> 4;
    while (n-- > 0 && want >= 0) {
      let d;
      if (isNode(h)) { d = want; h.face = want; }
      else {
        const onRow = h.y % U === 0, along = onRow ? DY[want] === 0 : DX[want] === 0;
        d = along ? want : h.dir; // a turn waits for the next crossing
      }
      const shoved = crateAt(h.x + DX[d], h.y + DY[d]);
      if (!heroCan(h, d)) { if (!isNode(h)) h.dir = d; break; }
      if (shoved) h.pushing = true;
      const nx = h.x + DX[d], ny = h.y + DY[d];
      if (carve(h.x, h.y, nx, ny)) { if (++h.digN % 4 === 1) ev('dig', nx, ny, { dir: d }); }
      h.x = nx; h.y = ny; h.dir = d; h.face = d; h.moving = true;
      gemCheck(h.x, h.y, true);
    }
  }
  function gemCheck(x, y, byHero) {
    const i = cellOf(x, y), gx = (i % COLS) * U, gy = Math.floor(i / COLS) * U;
    if (!s.gem[i] || Math.abs(gx - x) > 6 || Math.abs(gy - y) > 6) return;
    s.gem[i] = 0; s.gems--;
    if (!byHero) { ev('gemlost', gx, gy); return; }
    s.streak = s.t - s.lastGem <= STREAK_GAP ? s.streak + 1 : 1;
    s.lastGem = s.t;
    addScore(SCORE.gem, gx, gy);
    ev('gem', gx, gy, { streak: s.streak, left: s.gems });
    if (s.streak >= STREAK) { s.streak = 0; addScore(SCORE.streak, gx, gy); ev('streak', gx, gy); }
  }

  // ---------- the shot ----------
  function fire(inp) {
    const h = s.hero;
    if (!inp.fire || s.reload > 0 || s.shot) return;
    s.shot = { x: h.x, y: h.y, dir: h.face, t: 0 };
    s.reload = s.P.reload;
    ev('fire', h.x, h.y, { dir: h.face });
  }
  function shot() {
    const sh = s.shot;
    if (!sh) return;
    sh.t += DT / 2;
    for (let k = 0; k < SHOT_SPEED / 2; k++) {
      for (const m of s.mons)
        if (Math.abs(m.x - sh.x) < HIT && Math.abs(m.y - sh.y) < HIT) { kill(m, 'shot'); s.shot = null; return; }
      const nx = sh.x + DX[sh.dir], ny = sh.y + DY[sh.dir];
      if (!inField(nx, ny) || !dugAt(nx, ny) || crateAt(nx, ny)) { ev('fizzle', sh.x, sh.y, { dir: sh.dir }); s.shot = null; return; }
      sh.x = nx; sh.y = ny;
    }
  }

  // ---------- ore crates ----------
  const under = (c, e) => Math.abs(e.x - c.x) < U && e.y > c.y && e.y <= c.y + U;
  function canFall(c) {
    if (c.x % U || c.y % U || c.y >= MAX_Y) return false;
    return s.cell[idx(c.x, c.y + U)] === 1 && !crateAt(c.x, c.y + U, c);
  }
  function crates() {
    for (const c of s.crates.slice()) {
      c.t += DT;
      switch (c.state) {
        case 'rest':
          if (canFall(c)) { c.state = 'wobble'; c.t = 0; ev('wobble', c.x, c.y); }
          break;
        case 'wobble':
          if (!canFall(c)) { c.state = 'rest'; break; }
          // it waits while the drill is right underneath, then drops
          if (c.t >= WOBBLE && !(s.hero.alive && under(c, s.hero))) { c.state = 'fall'; c.fell = 0; c.t = 0; ev('drop', c.x, c.y); }
          break;
        case 'slide':
          if (c.pushed !== s.tick && c.pushed !== s.tick - 1) slideCrate(c); // finishes a shove on its own
          break;
        case 'fall':
          for (let k = 0; k < FALL_SPEED && c.state === 'fall'; k++) {
            carve(c.x, c.y, c.x, c.y + 1);
            c.y++;
            if (c.y % U === 0) {
              c.fell++;
              if (!canFall(c)) land(c);
            }
          }
          if (c.state === 'fall') crush(c);
          break;
      }
    }
  }
  function crush(c) {
    for (const m of s.mons.slice()) if (Math.abs(m.x - c.x) < 12 && m.y - c.y > -4 && m.y - c.y < 14) kill(m, 'crush', c);
    const h = s.hero;
    if (s.status === 'play' && Math.abs(h.x - c.x) < 12 && h.y - c.y > -4 && h.y - c.y < 14) die('crate');
  }
  function land(c) {
    crush(c);
    if (c.fell >= 2) {
      s.crates.splice(s.crates.indexOf(c), 1);
      s.gold.push({ x: c.x, y: c.y, t: 0 });
      ev('burst', c.x, c.y);
    } else {
      c.state = 'rest'; c.t = 0;
      ev('thud', c.x, c.y);
    }
  }

  // ---------- grubs ----------
  // distance in cells from the drill along open tunnels (for the walkers' chase and flight)
  let dist = new Int16Array(COLS * ROWS), distTick = -1;
  const passage = (i, d) => {
    const c = i % COLS, r = (i / COLS) | 0;
    if (d === RIGHT) return c < COLS - 1 && s.hA[i] + s.hB[i] >= U;
    if (d === LEFT) return c > 0 && s.hA[i - 1] + s.hB[i - 1] >= U;
    if (d === DOWN) return r < ROWS - 1 && s.vA[i] + s.vB[i] >= U;
    return r > 0 && s.vA[i - COLS] + s.vB[i - COLS] >= U;
  };
  const STEP = [1, COLS, -1, -COLS];
  // the cells the drill is joined to by dug tunnel, and which way it lies from each
  function heroSources() {
    const h = s.hero;
    if (isNode(h)) return [{ i: idx(h.x, h.y), d: -1 }];
    const out = [];
    if (h.y % U === 0) {
      const e = Math.floor(h.x / U), i = (h.y / U) * COLS + e, o = h.x - e * U;
      if (o <= s.hA[i] || s.hA[i] + s.hB[i] >= U) out.push({ i, d: RIGHT });
      if (o >= U - s.hB[i] || s.hA[i] + s.hB[i] >= U) out.push({ i: i + 1, d: LEFT });
    } else {
      const e = Math.floor(h.y / U), i = e * COLS + h.x / U, o = h.y - e * U;
      if (o <= s.vA[i] || s.vA[i] + s.vB[i] >= U) out.push({ i, d: DOWN });
      if (o >= U - s.vB[i] || s.vA[i] + s.vB[i] >= U) out.push({ i: i + COLS, d: UP });
    }
    return out;
  }
  function distances() {
    if (distTick === s.tick) return dist;
    distTick = s.tick;
    dist.fill(-1);
    const q = [];
    for (const src of heroSources()) if (dist[src.i] < 0) { dist[src.i] = 0; q.push(src.i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      for (let d = 0; d < 4; d++) {
        if (!passage(i, d)) continue;
        const j = i + STEP[d];
        if (dist[j] < 0) { dist[j] = dist[i] + 1; q.push(j); }
      }
    }
    return dist;
  }
  function monCan(m, d) {
    const nx = m.x + DX[d], ny = m.y + DY[d];
    if (!inField(nx, ny) || crateAt(nx, ny)) return false;
    return m.kind === 'burrower' || dugAt(nx, ny);
  }
  function spawner() {
    const sp = s.spawn;
    if (!s.monsters) return;
    sp.timer -= DT;
    if (sp.timer <= 0 && sp.spawned < sp.total && s.mons.length < s.P.cap) {
      sp.timer = s.P.interval;
      const x = s.den.x * U, y = s.den.y * U;
      s.mons.push({ id: s.nextId++, kind: 'walker', x, y, dir: -1, acc: 0, state: 'emerge', t: 0, life: 0, cool: 3, lost: 0, to: 'walker' });
      sp.spawned++;
      ev('spawn', x, y);
    }
    // the lamp comes out of the den once a full wave of grubs is out
    if (sp.spawned >= Math.min(sp.total, s.P.cap) && s.mons.length && s.bonus.state === 'wait') { s.bonus.state = 'shown'; s.bonus.t = 0; ev('bonusshow', s.bonus.x, s.bonus.y); }
  }
  function monster(m) {
    m.t += DT;
    if (m.cool > 0) m.cool -= DT;
    if (m.state === 'emerge') { if (m.t >= 0.9) { m.state = 'go'; m.t = 0; } return; }
    if (m.state === 'morph') { if (m.t >= 0.4) { m.state = 'go'; m.t = 0; m.kind = m.to; } return; }
    if (m.kind === 'burrower') m.life -= DT;
    const speed = (m.kind === 'walker' ? s.P.walker : s.P.burrower) - (s.frenzy > 0 ? 3 : 0);
    m.acc += speed;
    let n = m.acc >> 4;
    m.acc &= 15;
    while (n-- > 0) {
      if (isNode(m)) { decide(m); if (m.state !== 'go' || m.dir < 0) return; }
      if (!monCan(m, m.dir)) {
        if (isNode(m)) return;
        m.dir ^= 2; // blocked between crossings: turn back
        if (!monCan(m, m.dir)) return;
      }
      const nx = m.x + DX[m.dir], ny = m.y + DY[m.dir];
      if (m.kind === 'burrower') {
        carve(m.x, m.y, nx, ny);
        m.x = nx; m.y = ny;
        gemCheck(m.x, m.y, false);
        for (const gd of s.gold.slice()) if (Math.abs(gd.x - m.x) < 6 && Math.abs(gd.y - m.y) < 6) { s.gold.splice(s.gold.indexOf(gd), 1); ev('goldlost', gd.x, gd.y); }
      } else { m.x = nx; m.y = ny; }
    }
  }
  function morph(m, to) {
    m.state = 'morph'; m.t = 0; m.to = to;
    if (to === 'burrower') m.life = 3 + rnd() * 4; else m.cool = 4;
    ev('morph', m.x, m.y, { to });
  }
  function decide(m) {
    const opts = [];
    for (let d = 0; d < 4; d++) if (monCan(m, d)) opts.push(d);
    const flee = s.frenzy > 0, h = s.hero;
    if (m.kind === 'burrower') {
      if (m.life <= 0 && !flee) { morph(m, 'walker'); return; }
      const hc = h.x / U, hr = h.y / U;
      let best = -1, bestV = Infinity;
      for (const d of opts) {
        const md = Math.abs(m.x / U + DX[d] - hc) + Math.abs(m.y / U + DY[d] - hr);
        const v = (flee ? -md : md) + rnd() * 1.6 + (d === (m.dir ^ 2) && opts.length > 1 ? 3 : 0);
        if (v < bestV) { bestV = v; best = d; }
      }
      m.dir = best;
      return;
    }
    if (!opts.length) { m.dir = -1; m.lost += 0.5; if (m.lost > 2 && !flee) morph(m, 'burrower'); return; }
    const D = distances(), i = idx(m.x, m.y);
    const toward = !flee && heroSources().find(src => src.i === i && src.d >= 0);
    // value of each way: cells to the drill along the tunnels (lower is closer)
    const val = d => {
      if (toward && toward.d === d) return -1;
      if (!passage(i, d)) return Infinity; // a dead-end stub
      const v = D[i + STEP[d]];
      return v < 0 ? Infinity : v;
    };
    const known = D[i] >= 0 || toward;
    if (!flee && !known) m.lost += 1; else m.lost = 0;
    if (!flee && m.cool <= 0 && (rnd() < s.P.morph + (m.lost > 3 ? 0.25 : 0))) { morph(m, 'burrower'); return; }
    const rev = m.dir >= 0 ? m.dir ^ 2 : -1;
    let best = -1;
    if (known && rnd() > 0.12) {
      let bestV = flee ? -Infinity : Infinity;
      for (const d of opts) {
        let v = val(d);
        if (flee) { v = v === Infinity || v < 0 ? -2 : v; v += d === rev ? -0.5 : 0; if (v > bestV) { bestV = v; best = d; } }
        else { v += d === rev ? 0.5 : 0; v += rnd() * 0.3; if (v < bestV) { bestV = v; best = d; } }
      }
    }
    if (best < 0) {
      const fwd = opts.filter(d => d !== rev);
      const pick = fwd.length ? fwd : opts;
      best = pick[Math.floor(rnd() * pick.length)];
    }
    m.dir = best;
  }
  function kill(m, how, by) {
    const at = s.mons.indexOf(m);
    if (at < 0) return;
    s.mons.splice(at, 1);
    s.spawn.killed++;
    s.spawn.timer = Math.max(s.spawn.timer, 1.5);
    let pts = SCORE.kill;
    if (how === 'eat') { pts = SCORE.eat * 2 ** s.chain; s.chain++; }
    addScore(pts, m.x, m.y);
    ev('kill', m.x, m.y, { how, kind: m.kind, pts, by: by?.id });
  }

  // ---------- pickups, touches, death ----------
  function pickups() {
    const h = s.hero;
    for (const gd of s.gold.slice()) {
      gd.t += DT;
      if (Math.abs(gd.x - h.x) <= 8 && Math.abs(gd.y - h.y) <= 8) { s.gold.splice(s.gold.indexOf(gd), 1); addScore(SCORE.gold, gd.x, gd.y); ev('gold', gd.x, gd.y); }
      else if (gd.t >= GOLD_LIFE) { s.gold.splice(s.gold.indexOf(gd), 1); ev('goldgone', gd.x, gd.y); }
    }
    const b = s.bonus;
    if (b.state === 'shown') {
      b.t += DT;
      if (Math.abs(b.x - h.x) <= 8 && Math.abs(b.y - h.y) <= 8) {
        b.state = 'taken'; s.frenzy = s.P.frenzy; s.chain = 0;
        addScore(SCORE.bonus, b.x, b.y);
        ev('bonus', b.x, b.y);
      }
    }
  }
  function touch() {
    const h = s.hero;
    for (const m of s.mons.slice()) {
      if (m.state === 'emerge' || Math.abs(m.x - h.x) >= HIT || Math.abs(m.y - h.y) >= HIT) continue;
      if (s.frenzy > 0) kill(m, 'eat');
      else { die('grub'); return; }
    }
  }
  function die(why) {
    if (s.status !== 'play') return;
    s.hero.alive = false; s.deaths++;
    setStatus('dying');
    ev('die', s.hero.x, s.hero.y, { why });
  }
  function afterDeath() {
    if (s.lives <= 0) { setStatus('over'); ev('over'); return; }
    s.lives--;
    // the grubs out now go back to the den; the dig, the gems and the crates stay as they are
    s.spawn.spawned -= s.mons.length;
    s.mons = [];
    s.spawn.timer = 2.5;
    if (s.bonus.state === 'shown') s.bonus.state = 'wait';
    s.frenzy = 0; s.chain = 0; s.streak = 0;
    placeHero();
    setStatus('ready');
    ev('respawn', s.hero.x, s.hero.y);
  }

  sim.cellOf = cellOf;
  return sim;
}
