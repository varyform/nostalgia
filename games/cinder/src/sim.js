// Cinder's simulation: one scene of the Keep at a time, pure and deterministic. The page, the
// attract demo and tools/verify.mjs drive it with held-input snapshots { left, right, up, down,
// punch, kick, stance, bow } and read `sim.s` to draw it; the sim finds the presses itself.
// All randomness comes from the integer `s.rng` (mulberry32), so a seed replays exactly.
//
// The world is a line: x in metres, growing to the right, the way Wren climbs. Foes wait off to
// the right and come one at a time: they walk in, bow, take their guard and fight. In run stance
// a fighter moves fast but can't attack or block, and any hit taken in it is a KO at once.
//
//   const sim = createSim();
//   sim.newGame({ scene: 0, seed: 1 });
//   sim.step({ right: true, punch: false, … });   // every DT; sim.events lists what happened
import { MOVES, attackOf, isAttack } from './moves.js';
import { SCENES } from './scenes.js';

export const DT = 1 / 60;
export const SCORE = { pip: 100, ko: 500 /* × the foe's tier */, bow: 300, clear: 1000, win: 5000, life: 1500 };
export const P = {
  run: 2.6, walk: 1.05, // m/s in run stance · guard-stance step
  intro: 2, dead: 2.5, clear: 1.5, // seconds in each status
  gap: 0.75, // closest two fighting fighters stand, centre to centre
  bowGap: 2.0, bowAt: 2.8, rush: 2.3, // a foe that hasn't taken its guard: kept at bowGap; bows from bowAt; crowded inside rush, it skips the bow
  near: 4, // a foe within this makes "away" a block instead of a step back
  regenR: 6, regenT: 0.9, // no foe within regenR: a pip back every regenT seconds in run stance
  buffer: 0.15, // a press made while busy still counts this long
  strideRun: 1.7, strideWalk: 0.7, // metres per walk/run cycle (fighter.phase)
  honour: 0.8, // a bow begun this long after the foe's own bow ends still answers it
};
// a fighter's kind: pips, attack tempo, speeds and, for foes, how it fights
//   tier: KO score multiplier · want: the distance it fights from · react: seconds to read an attack
//   guard: chance it tries to defend · right: chance its defence is the right one · aggr: chance a
//   think ends in an attack · think: seconds between decisions (plus as much again at random)
//   cool: seconds after an attack before the next · combo: chance of a follow-up at once
//   counter: chance of striking straight back after a block · punish: of hitting Wren's recovery · hold: chance of standing in a guard
//   adapt: chance it aims round the guard Wren is holding · palm: seconds between palm strikes
//   power: pips its hits take on top of the move's own · chase: runs after Wren when she's 5 m off,
//   taking its guard this close (none: it walks)
export const KINDS = {
  hero: { hp: 6, tempo: 1, walk: P.walk, run: P.run },
  footman: {
    hp: 6, tempo: 0.62, walk: 0.85, run: 2.1, tier: 1, want: 1.05, react: 0.22, guard: 0.35, right: 0.6,
    aggr: 0.7, think: 0.4, cool: 1.0, combo: 0, counter: 0, punish: 0.3, hold: 0, adapt: 0, chase: 1.6,
    seq: ['punchMid', 'punchMid', 'punchHigh', 'kickMid'], // the footman's drill: always the same round
  },
  brawler: {
    hp: 9, tempo: 0.7, walk: 1.0, run: 2.3, tier: 2, want: 1.4, react: 0.18, guard: 0.55, right: 0.75,
    aggr: 0.9, think: 0.25, cool: 0.45, combo: 0.5, counter: 0.15, punish: 0.5, hold: 0, adapt: 0.35, chase: 3,
    pref: { kickMid: 3, kickHigh: 2, kickLow: 2, punchMid: 2, punchHigh: 1 },
  },
  adept: {
    hp: 11, tempo: 0.72, walk: 1.0, run: 2.3, tier: 3, want: 1.15, react: 0.12, guard: 0.85, right: 0.9,
    aggr: 0.7, think: 0.3, cool: 0.7, combo: 0.35, counter: 0.7, punish: 0.7, hold: 0.45, adapt: 0.75,
    pref: { punchMid: 3, punchHigh: 2, punchLow: 2, kickMid: 1, kickLow: 1 },
  },
  regent: {
    hp: 22, tempo: 0.75, walk: 0.95, run: 2.0, tier: 6, want: 1.3, react: 0.13, guard: 0.8, right: 0.9,
    aggr: 0.8, think: 0.3, cool: 0.55, combo: 0.45, counter: 0.4, punish: 0.6, hold: 0.25, adapt: 0.75, palm: 5, power: 0,
    pref: { punchHigh: 2, punchMid: 2, kickMid: 2, kickLow: 2, kickHigh: 1 },
  },
};
// drop gates: shut → rise → open → shake (the tell) → slam → shut; seconds, [base, + random]
export const GATE = { shut: [1.1, 0.9], rise: 0.9, open: [1.6, 1.0], shake: 0.55, slam: 0.12, half: 0.5, crush: 0.42 }; // half: a shut gate's wall · crush: its blade
// the archer: draws for `draw` seconds (the tell), then looses a dart flying at vx m/s; it only
// shoots while Wren is within `range` m in front of it and no foe is out
export const ARCHER = { draw: 0.95, vx: -9, range: 24, near: 1.5, dmg: 1 };

const FREE = new Set(['idle', 'walk', 'run', 'block', 'blockLow', 'duck', 'cheer']);
const HELD = new Set(['block', 'blockLow', 'duck']);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sign = v => (v < 0 ? -1 : 1);

// mulberry32 on an integer kept in the state
function rand(s) {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function pick(s, weights) {
  let sum = 0;
  for (const k in weights) sum += weights[k];
  let r = rand(s) * sum;
  for (const k in weights) if ((r -= weights[k]) < 0) return k;
  return Object.keys(weights)[0];
}

/** a fighter in its starting pose */
function fighter(id, kind, x, face, stance) {
  const K = KINDS[kind];
  return {
    id, kind, x, face, stance, hp: K.hp, maxHp: K.hp, move: 'idle', moveT: 0, phase: 0,
    active: kind === 'hero', down: false, flash: 0,
    // additive: the foe's flow ('wait' | 'arrive' | 'bow' | 'ready' | 'fight' | 'down'; the hero: 'hero'),
    // its attack tempo, a knock-back velocity and the AI's working fields
    ai: kind === 'hero' ? 'hero' : 'wait', tempo: K.tempo, vx: 0, struck: false, atk: 0,
    think: 0, cd: 0, defend: null, reactAt: -1, seen: -1, holdTo: 0, palmT: K.palm || 0, seqI: 0,
    bowEnd: -9, honoured: false, wary: -1, punished: -1, counterAt: -1, combo: false, lastH: 'mid', want: K.want || 0, walkDir: 0,
  };
}

export const EMPTY_INPUT = { left: false, right: false, up: false, down: false, punch: false, kick: false, stance: false, bow: false };

export function createSim() {
  const sim = { s: null, events: [], scenes: SCENES, newGame, step, checkpoint };
  let held = false; // events raised by newGame() are kept for the next step
  const emit = (k, e = {}) => sim.events.push({ k, ...e });

  // ---------- setup ----------
  function newGame({ scene = 0, seed = 1, score = 0, lives = 3 } = {}) {
    sim.s = { score, lives, rng: seed | 0, atkId: 0 };
    sim.events = [];
    held = true;
    loadScene(clamp(scene | 0, 0, SCENES.length - 1));
  }
  function loadScene(i) {
    const s = sim.s, S = SCENES[i];
    Object.assign(s, {
      t: 0, scene: i, status: 'intro', statusT: 0, w: S.w,
      check: { scene: i, score: s.score, lives: s.lives, seed: s.rng },
      hero: fighter('hero', 'hero', -2, 1, 'run'),
      foes: S.foes.map((f, j) => Object.assign(fighter(`${S.id}-${j}`, f.kind, f.x, -1, 'run'), { at: f.at })),
      teacher: S.teacher ? { x: S.teacher.x, face: -1, move: 'idle', moveT: 0, freed: false } : null,
      gates: S.gates.map((x, j) => ({ x, y: 1, shake: 0, st: 'shut', t: 0, hold: 0.6 + j * 1.15 })),
      darts: [], dartN: 0,
      archer: S.archer ? { x: S.archer.x, every: S.archer.every, draw: 0, h: 'high', st: 'idle', t: 0, wait: S.archer.every * 0.5 } : null,
      engaged: null, regenT: 0, buf: null, prev: { ...EMPTY_INPUT }, endT: 0, cheerAt: 0,
    });
    s.cam = camTarget();
    emit('intro', { scene: i });
  }
  /** the checkpoint: what it takes to begin the current scene again as it began */
  function checkpoint() { return { ...sim.s.check }; }

  // ---------- fighters ----------
  function set(f, move) {
    f.move = move; f.moveT = 0;
    if (isAttack(move)) { f.struck = false; f.atk = ++sim.s.atkId; emit('swing', { who: f.id, move }); }
  }
  const live = f => f.ai !== 'wait' && f.ai !== 'down';
  const out = () => sim.s.foes.find(live) || null;
  // the hero is KO'd by any hit in run stance, and in the first half of a switch out of it
  const open = f => f.stance === 'run' || (f.move === 'stance' && f.moveT < MOVES.stance.dur / 2);

  function moveHero(dx) {
    const s = sim.s, h = s.hero;
    let nx = Math.max(0, h.x + dx);
    const stop = (lo, hi) => { nx = clamp(nx, Math.min(h.x, lo), Math.max(h.x, hi)); };
    for (const f of s.foes) {
      if (!live(f)) continue;
      const g = f.ai === 'fight' ? P.gap : P.bowGap;
      if (f.x >= h.x) stop(-1e9, f.x - g); else stop(f.x + g, 1e9);
    }
    if (s.teacher) stop(-1e9, s.teacher.x - 1.1);
    for (const g of s.gates) if (g.y > 0.5) {
      if (h.x <= g.x) stop(-1e9, g.x - GATE.half); else stop(g.x + GATE.half, 1e9);
    }
    if (s.foes.some(f => f.ai !== 'down')) stop(-1e9, s.w - 0.3);
    stride(h, nx - h.x);
    h.x = nx;
  }
  function moveFoe(f, dx) {
    const h = sim.s.hero;
    let nx = f.x + dx;
    const g = f.ai === 'fight' ? P.gap : P.bowGap;
    if (h.ai !== 'down') {
      if (f.x >= h.x) nx = Math.max(nx, Math.min(f.x, h.x + g));
      else nx = Math.min(nx, Math.max(f.x, h.x - g));
    }
    stride(f, nx - f.x);
    f.x = nx;
  }
  function stride(f, dx) {
    if (!dx) return;
    const was = Math.floor(f.phase * 2);
    f.phase = (((f.phase + Math.abs(dx) / (f.stance === 'run' ? P.strideRun : P.strideWalk)) % 1) + 1) % 1;
    if (Math.floor(f.phase * 2) !== was) emit('step', { who: f.id, x: f.x });
  }

  function tick(f) {
    f.flash = Math.max(0, f.flash - DT);
    if (f.vx) {
      const dx = f.vx * DT;
      f.vx *= 0.88;
      if (Math.abs(f.vx) < 0.05) f.vx = 0;
      if (f.kind === 'hero') { const ph = f.phase; moveHero(dx); f.phase = ph; } else { const ph = f.phase; moveFoe(f, dx); f.phase = ph; }
    }
    const m = MOVES[f.move];
    f.moveT += DT * (isAttack(f.move) ? f.tempo : 1);
    if (!m.dur || f.moveT < m.dur) return;
    if (f.move === 'ko') { f.moveT = m.dur; f.down = true; return; }
    const was = f.move;
    set(f, 'idle');
    if (was === 'bow' && f.kind !== 'hero') f.bowEnd = sim.s.t;
    if (isAttack(was) && f.kind !== 'hero') { f.lastH = MOVES[was].height; afterAttack(f); }
  }

  // an attack's window: it lands once, on the first step that finds the target in reach
  function attacks(a, d) {
    if (!isAttack(a.move) || a.struck || !d) return;
    const m = MOVES[a.move];
    if (a.moveT < m.on || a.moveT >= m.off || d.ai === 'down' || (d.kind !== 'hero' && d.ai !== 'fight')) return;
    const dx = d.x - a.x;
    if (sign(dx) !== a.face || Math.abs(dx) > m.reach) return;
    a.struck = true;
    const s = sim.s, h = m.height, x = d.x - sign(dx) * 0.3;
    if (d.move === 'duck' && h === 'high') return; // over the head
    if (!m.unblockable && ((d.move === 'block' && h !== 'low') || (d.move === 'blockLow' && h === 'low'))) {
      emit('block', { who: d.id, x, h });
      d.vx = sign(dx) * 1.0;
      if (d.kind !== 'hero') blocked(d);
      return;
    }
    const was = d.hp, ko = open(d);
    d.hp = ko ? 0 : Math.max(0, d.hp - m.dmg - (KINDS[a.kind].power || 0));
    d.flash = 0.25;
    emit('hit', { who: d.id, x, h, dmg: was - d.hp, move: a.move });
    if (d.kind !== 'hero') s.score += SCORE.pip * (was - d.hp);
    if (d.hp <= 0) return knockOut(d, sign(dx));
    d.vx = sign(dx) * 2.6;
    d.wary = s.t + 1.2;
    // the Regent doesn't flinch out of a palm strike: it lands unless Wren gets under it
    if (d.move !== 'palm') set(d, 'hit');
  }
  function knockOut(d, dir) {
    const s = sim.s;
    set(d, 'ko');
    d.vx = dir * 1.8; d.hp = 0;
    emit('ko', { who: d.id, x: d.x });
    if (d.kind === 'hero') return heroDown();
    d.ai = 'down'; d.active = false;
    s.score += SCORE.ko * KINDS[d.kind].tier;
    s.cheerAt = s.t + 0.5;
  }
  function heroDown() {
    const s = sim.s;
    s.hero.ai = 'down';
    s.status = 'dead'; s.statusT = 0;
    s.lives = Math.max(0, s.lives - 1);
    emit('die');
    emit('life', { lives: s.lives });
  }

  // ---------- the hero ----------
  function heroStep(inp) {
    const s = sim.s, h = s.hero, pv = s.prev;
    for (const a of ['punch', 'kick', 'stance', 'bow']) if (inp[a] && !pv[a]) s.buf = { a, t: P.buffer };
    if (s.buf && (s.buf.t -= DT) < 0) s.buf = null;
    const dirIn = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const foe = out(), near = foe && Math.abs(foe.x - h.x) < P.near ? foe : null;
    if (!FREE.has(h.move)) return;
    if (h.stance === 'guard' && foe && Math.abs(foe.x - h.x) < 6) h.face = sign(foe.x - h.x);
    const any = dirIn || inp.down || inp.up || s.buf;
    if (h.move === 'cheer' && !any) return;
    if (s.buf) {
      const a = s.buf.a;
      if (a === 'stance') {
        s.buf = null;
        h.stance = h.stance === 'run' ? 'guard' : 'run';
        set(h, 'stance');
        emit('stance', { who: 'hero', to: h.stance });
        return;
      }
      if (a === 'bow' && h.stance === 'run') { s.buf = null; return heroBow(); }
      if ((a === 'punch' || a === 'kick') && h.stance === 'guard') {
        s.buf = null;
        if (near) h.face = sign(near.x - h.x);
        return set(h, attackOf(a, inp.up ? 'high' : inp.down ? 'low' : 'mid'));
      }
      s.buf = null; // a press that means nothing in this stance
    }
    // "away" blocks: from a foe close by, or from the archer's side while a dart is coming
    const a = s.archer;
    const side = near ? sign(near.x - h.x) : a && h.x < a.x - ARCHER.near && (a.st === 'draw' || s.darts.some(d => d.x > h.x)) ? 1 : 0;
    const away = side && dirIn === -side;
    if (h.stance === 'guard') {
      if (inp.down && away) { h.face = side; return hold(h, 'blockLow'); }
      if (inp.down) return hold(h, 'duck');
      if (away) { h.face = side; return hold(h, 'block'); }
      if (dirIn) {
        if (!near) h.face = dirIn;
        if (h.move !== 'walk') set(h, 'walk');
        return moveHero(dirIn * P.walk * DT);
      }
    } else {
      if (inp.down) return hold(h, 'duck');
      if (dirIn) {
        h.face = dirIn;
        if (h.move !== 'run') set(h, 'run');
        return moveHero(dirIn * P.run * DT);
      }
    }
    if (h.move !== 'idle' && h.move !== 'cheer') set(h, 'idle');
  }
  const hold = (f, move) => { if (f.move !== move) set(f, move); };
  function heroBow() {
    const s = sim.s, h = s.hero;
    set(h, 'bow');
    const t = s.teacher;
    if (t && Math.abs(t.x - h.x) < 2.6) {
      emit('bow', { who: 'hero' });
      return win();
    }
    // answering a foe's bow is honourable
    const f = s.foes.find(f => !f.honoured && (f.ai === 'bow' || ((f.ai === 'ready' || f.ai === 'fight') && s.t - f.bowEnd < P.honour)));
    if (f) { f.honoured = true; s.score += SCORE.bow; }
    emit('bow', { who: 'hero', honour: !!f });
  }
  function win() {
    const s = sim.s;
    s.status = 'won'; s.statusT = 0;
    s.score += SCORE.win + SCORE.life * s.lives;
    emit('win');
  }

  // ---------- the foes ----------
  function trigger() {
    const s = sim.s, h = s.hero;
    if (out()) return;
    const f = s.foes.find(f => f.ai === 'wait');
    if (!f || h.x < f.at) return;
    f.ai = 'arrive'; f.face = -1; f.stance = 'run';
    set(f, 'run');
    emit('foe', { who: f.id });
  }
  function foeStep(f) {
    const s = sim.s, h = s.hero, K = KINDS[f.kind];
    if (f.ai === 'wait' || f.ai === 'down') return;
    const d = h.x - f.x, dist = Math.abs(d);
    if (f.ai === 'arrive') {
      f.face = sign(d);
      if (dist < P.rush) return ready(f);
      if (dist <= P.bowAt) { f.ai = 'bow'; set(f, 'bow'); emit('bow', { who: f.id }); return; }
      return moveFoe(f, f.face * K.run * DT);
    }
    if (f.ai === 'bow') {
      if (dist < P.rush - 0.4 || f.move !== 'bow') { if (f.move === 'bow') f.bowEnd = s.t; ready(f); }
      return;
    }
    if (f.ai === 'ready') {
      if (f.move !== 'stance') { f.ai = 'fight'; f.active = true; f.think = 0.3 + rand(s) * K.think; }
      return;
    }
    // fighting
    if (!(s.status === 'play' && h.ai !== 'down')) { if (HELD.has(f.move) || f.move === 'walk') set(f, 'idle'); return; }
    f.face = sign(d);
    f.cd -= DT; f.think -= DT;
    if (K.palm && f.palmT > 0) f.palmT -= DT;
    // read Wren's attack as it starts, even while reeling: decide once, act after the reaction time
    if (isAttack(h.move) && h.atk !== f.seen && dist < MOVES[h.move].reach + 0.6) {
      f.seen = h.atk;
      const hh = MOVES[h.move].height;
      const holding = HELD.has(f.move) && guards(f.move, hh);
      // just hit, a foe is wary: it guards the next one far more often
      let c = s.t < f.wary ? Math.min(0.95, K.guard + 0.45) : K.guard;
      if (HELD.has(f.move) && !holding) c *= 0.4; // caught in the wrong guard
      f.defend = holding ? f.move : rand(s) < c ? (rand(s) < K.right ? defence(hh, s) : wrong(hh, s)) : null;
      f.reactAt = s.t + K.react + rand(s) * 0.08;
    }
    if (!FREE.has(f.move)) return;
    // left far behind, a footman or a brawler runs after Wren, and takes its guard only once it's
    // close (the footman carelessly close: a kick timed to meet it lands while it's still running)
    if (f.stance === 'run') {
      if (dist <= K.chase) { f.stance = 'guard'; set(f, 'stance'); emit('stance', { who: f.id, to: 'guard' }); return; }
      if (f.move !== 'run') set(f, 'run');
      return moveFoe(f, f.face * K.run * DT);
    }
    if (K.chase && dist > 5) { f.stance = 'run'; set(f, 'stance'); emit('stance', { who: f.id, to: 'run' }); return; }
    // straight back after a block, as Wren's attack spends itself
    if (f.counterAt > 0 && s.t >= f.counterAt) {
      f.counterAt = -1;
      if (dist <= MOVES.punchMid.reach + 0.05 && (!isAttack(h.move) || h.moveT >= MOVES[h.move].off)) {
        f.defend = null;
        return set(f, rand(s) < 0.5 ? 'punchMid' : 'punchHigh');
      }
    }
    if (f.defend && isAttack(h.move) && h.atk === f.seen && h.moveT < MOVES[h.move].off && s.t >= f.reactAt) {
      hold(f, f.defend);
      f.holdTo = s.t + Math.max(0.12, (MOVES[h.move].off - h.moveT) / h.tempo + 0.06);
      return;
    }
    if (HELD.has(f.move)) {
      if (s.t < f.holdTo) return;
      f.defend = null;
      set(f, 'idle');
    }
    // Wren in run stance close by: one hit is enough
    if (h.stance === 'run' && dist < MOVES.punchMid.reach + 0.05 && f.cd < 0.3) return set(f, 'punchMid');
    // Wren spent, an attack whiffed or blocked: punish it
    if (isAttack(h.move) && h.moveT >= MOVES[h.move].off && h.atk !== f.punished && f.cd < 0.4) {
      f.punished = h.atk;
      const left = (MOVES[h.move].dur - h.moveT) / h.tempo;
      if (left > 0.08 && rand(s) < K.punish) {
        if (dist <= MOVES.punchMid.reach + 0.05) return set(f, rand(s) < 0.6 ? 'punchMid' : 'punchLow');
        if (dist <= MOVES.kickMid.reach + 0.05) return set(f, rand(s) < 0.6 ? 'kickMid' : 'kickLow');
      }
    }
    if (f.think > 0) {
      if (f.move === 'walk') {
        const step = f.walkDir * K.walk * DT;
        if (f.walkDir === f.face && dist - Math.abs(step) < f.want) return set(f, 'idle');
        return moveFoe(f, step);
      }
      return;
    }
    // think
    f.think = K.think * (0.6 + rand(s) * 0.8);
    f.want = K.want + (rand(s) - 0.5) * 0.3;
    if (K.palm && f.palmT <= 0 && dist <= MOVES.palm.reach - 0.1) { f.palmT = K.palm * (0.8 + rand(s) * 0.6); return set(f, 'palm'); }
    const atk = chooseAttack(f, K, dist);
    if (f.cd <= 0 && dist <= MOVES[atk].reach + 0.05 && (f.combo || rand(s) < K.aggr)) {
      f.combo = false;
      if (K.seq) f.seqI++;
      return set(f, atk);
    }
    f.combo = false;
    if (dist > f.want + 0.15) { f.walkDir = f.face; return set(f, 'walk'); }
    if (dist < f.want - 0.35) { f.walkDir = -f.face; f.think = 0.3; return set(f, 'walk'); }
    if (K.hold && rand(s) < K.hold) { f.holdTo = s.t + f.think; return set(f, rand(s) < 0.6 ? 'block' : 'blockLow'); }
    if (f.move !== 'idle') set(f, 'idle');
  }
  const guards = (move, h) => (move === 'block' && h !== 'low') || (move === 'blockLow' && h === 'low') || (move === 'duck' && h === 'high');
  function defence(h, s) { return h === 'low' ? 'blockLow' : h === 'high' && rand(s) < 0.3 ? 'duck' : 'block'; }
  function wrong(h, s) { return h === 'low' ? (rand(s) < 0.5 ? 'block' : 'duck') : h === 'mid' ? (rand(s) < 0.5 ? 'blockLow' : 'duck') : 'blockLow'; }
  // the attack a foe tries next: one that reaches Wren from where she stands
  function chooseAttack(f, K, dist) {
    const s = sim.s, h = s.hero, far = dist > MOVES.punchMid.reach;
    if (K.seq) { const a = K.seq[f.seqI % K.seq.length]; return far && !a.startsWith('kick') ? 'kickMid' : a; }
    // aim round the guard Wren is holding
    if (HELD.has(h.move) && !f.combo && rand(s) < K.adapt) {
      const hh = h.move === 'block' ? 'low' : h.move === 'blockLow' ? (rand(s) < 0.5 ? 'high' : 'mid') : 'mid';
      return attackOf(far || rand(s) < 0.5 ? 'kick' : 'punch', hh);
    }
    let pref = Object.entries(K.pref).filter(([k]) => !far || k.startsWith('kick'));
    if (f.combo) pref = pref.filter(([k]) => MOVES[k].height !== f.lastH);
    return pick(s, Object.fromEntries(pref.length ? pref : Object.entries(K.pref)));
  }
  function ready(f) {
    f.ai = 'ready'; f.stance = 'guard';
    set(f, 'stance');
    emit('stance', { who: f.id, to: 'guard' });
  }
  function afterAttack(f) {
    const K = KINDS[f.kind];
    f.cd = K.cool * (0.7 + rand(sim.s) * 0.6);
    // a follow-up comes at once, at another height: a mix-up on the guard that took the first
    if (K.combo && rand(sim.s) < K.combo) { f.combo = true; f.think = 0; f.cd = 0; }
  }
  function blocked(f) {
    const K = KINDS[f.kind];
    if (K.counter && rand(sim.s) < K.counter) f.counterAt = sim.s.t + 0.04;
  }

  // ---------- hazards ----------
  function gatesStep() {
    const s = sim.s, h = s.hero;
    for (const g of s.gates) {
      g.t += DT;
      switch (g.st) {
        case 'shut':
          g.y = 1;
          if (g.t >= g.hold) { g.st = 'rise'; g.t = 0; }
          break;
        case 'rise':
          g.y = Math.max(0, 1 - g.t / GATE.rise);
          if (g.t >= GATE.rise) { g.y = 0; g.st = 'open'; g.t = 0; g.hold = GATE.open[0] + rand(s) * GATE.open[1]; }
          break;
        case 'open':
          if (g.t >= g.hold) { g.st = 'shake'; g.t = 0; emit('gateShake', { x: g.x }); }
          break;
        case 'shake':
          g.shake = Math.min(1, g.t / (GATE.shake * 0.5));
          if (g.t >= GATE.shake) { g.st = 'slam'; g.t = 0; g.shake = 0; }
          break;
        case 'slam':
          g.y = Math.min(1, g.t / GATE.slam);
          if (g.t >= GATE.slam) {
            g.y = 1; g.st = 'shut'; g.t = 0; g.hold = GATE.shut[0] + rand(s) * GATE.shut[1];
            emit('gateSlam', { x: g.x });
            if (s.status === 'play' && h.ai !== 'down' && Math.abs(h.x - g.x) < GATE.crush) {
              emit('crush', { x: g.x });
              set(h, 'ko'); h.hp = 0; h.flash = 0.3;
              heroDown();
            }
          }
          break;
      }
    }
  }
  function archerStep() {
    const s = sim.s, a = s.archer, h = s.hero;
    if (!a) return;
    const zone = s.status === 'play' && h.ai !== 'down' && !out() && h.x >= a.x - ARCHER.range && h.x < a.x - ARCHER.near;
    if (!zone) { a.st = 'idle'; a.draw = 0; a.t = Math.min(a.t, a.wait * 0.6); return; }
    a.t += DT;
    if (a.st === 'idle') {
      if (a.t >= a.wait) { a.st = 'draw'; a.t = 0; a.h = rand(s) < 0.5 ? 'high' : 'mid'; emit('draw', { h: a.h }); }
    } else {
      a.draw = Math.min(1, a.t / ARCHER.draw);
      if (a.t >= ARCHER.draw) {
        s.darts.push({ x: a.x - 0.4, h: a.h, vx: ARCHER.vx, id: ++s.dartN });
        emit('dart', { x: a.x - 0.4, h: a.h });
        a.st = 'idle'; a.t = 0; a.draw = 0; a.wait = a.every * (0.75 + rand(s) * 0.5);
      }
    }
  }
  function dartsStep() {
    const s = sim.s, h = s.hero;
    for (const d of s.darts) {
      const was = d.x;
      d.x += d.vx * DT;
      if (d.gone || h.ai === 'down' || !(was > h.x && d.x <= h.x)) continue;
      if (d.h === 'high' && h.move === 'duck') continue;
      d.gone = true;
      if (h.move === 'block') { emit('dartBlock', { x: d.x }); h.vx = -0.4; continue; }
      const ko = open(h);
      h.hp = ko ? 0 : Math.max(0, h.hp - ARCHER.dmg);
      h.flash = 0.25;
      emit('dartHit', { x: d.x, who: 'hero', h: d.h });
      if (h.hp <= 0) knockOut(h, -1);
      else { h.vx = -1.2; if (FREE.has(h.move) || h.move === 'stance') set(h, 'hit'); }
    }
    s.darts = s.darts.filter(d => !d.gone && d.x > s.cam - 14);
  }

  // ---------- the flow ----------
  function regen() {
    const s = sim.s, h = s.hero;
    const f = out();
    if (h.stance !== 'run' || h.hp >= h.maxHp || h.ai === 'down' || (f && Math.abs(f.x - h.x) < P.regenR)) { s.regenT = 0; return; }
    if ((s.regenT += DT) >= P.regenT) { s.regenT = 0; h.hp++; emit('regen', { pips: h.hp }); }
  }
  function camTarget() {
    const s = sim.s, h = s.hero, f = out();
    const x = f && f.ai !== 'arrive' && Math.abs(f.x - h.x) < 6 ? (h.x + f.x) / 2 : h.x + 1.5;
    return clamp(x, 5, s.w - 5);
  }
  function teacherStep() {
    const s = sim.s, t = s.teacher;
    if (!t) return;
    t.moveT += DT;
    if (s.status !== 'won') return;
    // the ending: Oriel bows back and is free, then the two of them rejoice
    const T = s.statusT;
    const to = move => { t.move = move; t.moveT = 0; };
    if (s.endT === 0 && T >= 0.5) { s.endT = 1; to('bow'); t.freed = true; emit('bow', { who: 'teacher' }); }
    if (s.endT === 1 && T >= 2) { s.endT = 2; to('cheer'); set(s.hero, 'cheer'); }
    if (t.move !== 'idle' && t.moveT >= MOVES[t.move].dur) to('idle');
  }

  function step(inp = EMPTY_INPUT) {
    if (held) held = false; else sim.events = [];
    const s = sim.s, h = s.hero;
    s.t += DT; s.statusT += DT;
    switch (s.status) {
      case 'intro':
        if (h.x < 1.5) { if (h.move !== 'run') set(h, 'run'); const x = h.x; h.x = Math.min(1.5, h.x + 2 * DT); stride(h, h.x - x); }
        else if (h.move === 'run') set(h, 'idle');
        if (s.statusT >= P.intro) { s.status = 'play'; s.statusT = 0; if (h.move === 'run') set(h, 'idle'); }
        break;
      case 'play':
        heroStep(inp);
        trigger();
        for (const f of s.foes) foeStep(f);
        break;
      case 'dead':
        for (const f of s.foes) foeStep(f);
        if (s.statusT >= P.dead) {
          if (s.lives > 0) loadScene(s.scene);
          else { s.status = 'over'; s.statusT = 0; emit('over'); }
        }
        break;
      case 'clear': {
        const x = h.x;
        h.x += (h.stance === 'run' ? P.run : P.walk) * DT;
        if (h.move !== (h.stance === 'run' ? 'run' : 'walk') && FREE.has(h.move)) set(h, h.stance === 'run' ? 'run' : 'walk');
        stride(h, h.x - x);
        if (s.statusT >= P.clear) loadScene(s.scene + 1);
        break;
      }
    }
    if (s.status === 'intro' && s.statusT === 0) { s.prev = { ...EMPTY_INPUT, ...inp }; return; } // a scene just loaded
    tick(h);
    for (const f of s.foes) tick(f);
    if (s.status === 'play') {
      // Wren strikes first on the same step: a foe she staggers loses its own swing
      attacks(h, s.foes.find(f => f.ai === 'fight'));
      for (const f of s.foes) if (s.status === 'play') attacks(f, h);
    }
    gatesStep();
    archerStep();
    dartsStep();
    teacherStep();
    if (s.status === 'play') {
      regen();
      if (s.cheerAt && s.t >= s.cheerAt) { s.cheerAt = 0; if (h.move === 'idle' && !out()) set(h, 'cheer'); }
      if (h.x > s.w && s.foes.every(f => f.ai === 'down')) {
        s.status = 'clear'; s.statusT = 0;
        s.score += SCORE.clear;
        emit('clear', { scene: s.scene });
      }
    }
    s.engaged = out();
    s.cam += (camTarget() - s.cam) * Math.min(1, DT * 3);
    s.prev = { ...EMPTY_INPUT, ...inp };
  }

  return sim;
}
