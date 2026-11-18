// The simulation: four counters, Pip, customers, glasses and tips, plus the Order Up! bonus
// round. Pure and deterministic: fixed 1/60 s steps, its own seeded random numbers, no DOM.
// Renderers and the sound read its state and the `events` it emits each step.
//
//   const sim = createSim({ seed });
//   sim.newGame();                  // venue 0, screen 0
//   sim.step({ up, down, left, right, pour, row, toX, pad });
//   sim.advance();                  // after a clear (next screen / bonus) or a finished bonus
//
// Input: up/down/left/right/pour are held states (edges are found here). `row` and `toX` are
// targets for touch and the autopilot: hop toward that counter, walk toward that spot. `pad`
// (0–3) presses one bonus pad this step.
import { VENUES, bonusParams, screenParams } from './venues.js';

export const DT = 1 / 60;
export const ROWS = 4;
export const LIVES = 3;
export const SERVE_X = 0.6; // Pip can fill while this close to the dispenser
export const GRAB_X = 0.9; // a customer this close to Pip's end climbs over the counter
export const FILL_T = 0.6; // seconds from empty to the brim
export const BRIM_OK = 0.22; // release this soon after the brim for a perfect pour
export const OVERFLOW_T = 0.6; // keep pouring this long past the brim and it overflows
export const FULL_V = 10; // a full glass's speed
export const PUSH_V = 7.5;
export const RUN_V = 8; // Pip along the counter
export const HOP_T = 0.12; // one counter up or down
export const SHOW_T = 5.5; // a tip's distraction lasts this long
export const READY_T = 1.4;
export const MISS_T = 2.4;
export const SCORE = { catch: 50, out: 100, empty: 100, tip: 250, brim: 25, clear: 1000, pad: 50, round: 250, perfect: 2000 };
const LIFE_FIRST = 20000, LIFE_EVERY = 40000, MAX_LIVES = 6;
const REPEAT_DELAY = 0.3, REPEAT_RATE = 0.16;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSim({ seed = 1 } = {}) {
  let rnd = mulberry32(seed);
  const rr = (a, b) => a + (b - a) * rnd();
  let uid = 1;

  const S = {
    events: [], t: 0,
    mode: 'counter', // 'counter' | 'bonus'
    status: 'ready', // ready | play | miss | clear | over
    statusT: 0,
    venue: 0, screen: 0, loop: 0, stage: 0, // stage: screens played this game
    lives: LIVES, score: 0, nextLife: LIFE_FIRST,
    P: screenParams(0, 0, 0), V: VENUES[0],
    rows: [], server: null, show: null, miss: null,
    quota: 0, spawned: 0, served: 0, spawnT: 0,
    tally: null, bonus: null,
    stats: { glasses: 0, empties: 0, tips: 0, perfect: 0, missed: 0 },
    newGame, loadScreen, step, advance, startBonus, reseed,
  };
  const emit = (type, e = {}) => S.events.push({ type, ...e });
  const prev = { up: false, down: false, pour: false, left: false, right: false };
  let holdUp = 0, holdDown = 0, needRelease = false;

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
    S.stats = { glasses: 0, empties: 0, tips: 0, perfect: 0, missed: 0 };
    loadScreen(0, 0, 0);
  }

  function makeServer(row = 1) {
    return { row, x: 0, hop: 0, fromRow: row, fill: 0, over: 0, face: 1, run: 0, moving: false, throwT: 0, catchT: 0, spillT: 0, cheer: 0 };
  }

  function customer(row, x, state = 'walk') {
    return { id: uid++, row, x, state, t: rr(0.6, 1.6), push: 0, kind: Math.floor(rnd() * 6), bob: rnd() * 6, catchT: 0, enter: 0, look: 0 };
  }

  function placeStarters() {
    for (let r = 0; r < ROWS; r++) {
      const len = S.rows[r].len;
      for (let k = 0; k < S.P.start && S.spawned < S.quota; k++) {
        S.rows[r].cust.push(customer(r, len - 1.2 - k * 3.2 - rnd() * 1.5, 'wait'));
        S.spawned++;
      }
    }
  }

  function loadScreen(venue, screen, loop = S.loop) {
    S.mode = 'counter'; S.bonus = null;
    S.venue = venue; S.screen = screen; S.loop = loop;
    S.V = VENUES[venue];
    S.P = screenParams(venue, screen, loop);
    S.rows = S.V.lens.map(len => ({ len, cust: [], glasses: [], tips: [] }));
    S.spawnT = rr(1.2, 2.2);
    S.server = makeServer(S.server?.row ?? 1);
    S.quota = S.P.quota; S.spawned = 0; S.served = 0;
    S.show = null; S.miss = null; S.tally = null;
    placeStarters();
    setStatus('ready');
    emit('screen', { venue, screen });
  }
  function setStatus(s) { S.status = s; S.statusT = 0; }

  // after a clear: the next screen of this venue, or the bonus round; after the bonus: the next venue
  function advance() {
    S.stage++;
    if (S.mode === 'bonus') {
      const v = (S.venue + 1) % VENUES.length;
      loadScreen(v, 0, v === 0 ? S.loop + 1 : S.loop);
    } else if (S.screen + 1 < S.V.screens) loadScreen(S.venue, S.screen + 1);
    else startBonus();
  }

  // ---------- the counters ----------
  function miss(cause, row, x) {
    if (S.status !== 'play') return;
    S.lives--;
    S.stats.missed++;
    S.miss = { cause, row, x };
    setStatus('miss');
    emit('miss', { cause, row, x });
  }

  function afterMiss() {
    if (S.lives <= 0) { setStatus('over'); emit('gameover'); return; }
    for (const r of S.rows) { S.spawned -= r.cust.length; r.cust = []; r.glasses = []; r.tips = []; }
    S.spawnT = rr(1.2, 2.2);
    S.show = null; S.miss = null;
    const row = S.server.row;
    S.server = makeServer(row);
    placeStarters();
    setStatus('ready');
  }

  function stepServer(inp) {
    const sv = S.server, row = S.rows[sv.row];
    sv.hop = Math.max(0, sv.hop - DT);
    sv.throwT = Math.max(0, sv.throwT - DT); sv.catchT = Math.max(0, sv.catchT - DT); sv.spillT = Math.max(0, sv.spillT - DT);

    // counter hops: edges, auto-repeat while held, or toward a target row
    const up = !!inp.up, down = !!inp.down;
    holdUp = up ? holdUp + DT : 0; holdDown = down ? holdDown + DT : 0;
    const rep = h => h > REPEAT_DELAY && Math.floor((h - REPEAT_DELAY) / REPEAT_RATE) !== Math.floor((h - DT - REPEAT_DELAY) / REPEAT_RATE);
    const pour = !!inp.pour, released = !pour && prev.pour;
    let dir = 0;
    if ((up && !prev.up) || rep(holdUp)) dir = -1;
    else if ((down && !prev.down) || rep(holdDown)) dir = 1;
    else if (inp.row != null && inp.row !== sv.row && sv.hop <= 0) {
      const d = (inp.row - sv.row + ROWS) % ROWS;
      dir = d <= ROWS / 2 ? 1 : -1;
    }
    prev.up = up; prev.down = down; prev.pour = pour;
    if (dir && sv.hop <= 0) {
      if (sv.fill > 0) emit('putdown', { row: sv.row });
      sv.fromRow = sv.row;
      sv.row = (sv.row + dir + ROWS) % ROWS;
      sv.x = 0; sv.fill = 0; sv.over = 0; sv.hop = HOP_T;
      emit('hop', { row: sv.row, dir });
      return;
    }

    // walking along the counter
    let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (!dx && inp.toX != null && Math.abs(inp.toX - sv.x) > 0.15) dx = Math.sign(inp.toX - sv.x);
    sv.moving = dx !== 0;
    if (dx) {
      sv.face = dx > 0 ? 1 : -1;
      sv.x = Math.max(0, Math.min(row.len - 1.2, sv.x + dx * RUN_V * DT));
      sv.run += DT;
      if (inp.toX != null && !inp.left && !inp.right && Math.abs(inp.toX - sv.x) < RUN_V * DT) sv.x = Math.max(0, Math.min(row.len - 1.2, inp.toX));
      if (sv.x > SERVE_X && sv.fill > 0) { sv.fill = 0; sv.over = 0; emit('putdown', { row: sv.row }); }
    } else sv.face = 1;

    // filling and sliding
    if (!pour) needRelease = false;
    if (sv.x <= SERVE_X && pour && !needRelease) {
      if (sv.fill === 0) emit('pour', { row: sv.row });
      if (sv.fill < 1) {
        sv.fill = Math.min(1, sv.fill + DT / FILL_T);
        if (sv.fill >= 1) emit('brim', { row: sv.row });
      } else {
        sv.over += DT;
        if (sv.over > OVERFLOW_T) {
          sv.fill = 0; sv.over = 0; sv.spillT = 0.6; needRelease = true;
          emit('spill', { row: sv.row });
        }
      }
    } else if (released && sv.fill >= 1 && sv.x <= SERVE_X) {
      const perfect = sv.over < BRIM_OK;
      row.glasses.push({ id: uid++, full: true, x: SERVE_X + 0.25, v: FULL_V, perfect, spin: 0 });
      sv.fill = 0; sv.over = 0; sv.throwT = 0.25;
      S.stats.glasses++;
      if (perfect) { S.stats.perfect++; addScore(SCORE.brim); }
      emit('slide', { row: sv.row, perfect });
    }
  }

  // one arrival clock for the whole venue; the newcomer picks a counter with room, the emptier the likelier
  function spawn() {
    S.spawnT -= DT;
    if (S.spawnT > 0 || S.spawned >= S.quota) return;
    const open = [];
    S.rows.forEach((row, r) => {
      if (row.cust.length >= S.P.maxPer || row.cust.some(c => c.x > row.len - 1.6)) return;
      for (let k = row.cust.length; k < S.P.maxPer; k++) open.push(r);
    });
    if (!open.length) { S.spawnT = 0.4; return; }
    const r = open[Math.floor(rnd() * open.length)], row = S.rows[r];
    const c = customer(r, row.len);
    c.enter = 1;
    row.cust.push(c);
    S.spawned++;
    S.spawnT = S.P.spawn * rr(0.6, 1.4);
    emit('enter', { row: r, x: row.len });
  }

  function stepCustomers(r) {
    const row = S.rows[r], P = S.P;
    const frozen = !!S.show;
    for (let i = row.cust.length - 1; i >= 0; i--) {
      const c = row.cust[i];
      c.bob += DT; c.catchT = Math.max(0, c.catchT - DT); c.enter = Math.max(0, c.enter - DT * 2);
      const idle = c.state === 'walk' || c.state === 'wait';
      c.look = idle && frozen ? Math.min(1, c.look + DT * 4) : Math.max(0, c.look - DT * 4);
      if (idle && frozen) continue;
      switch (c.state) {
        case 'walk':
          c.x -= P.walk * DT; c.t -= DT;
          if (c.t <= 0) { c.state = 'wait'; c.t = rr(0.35, 1.0); }
          if (c.x <= GRAB_X) { c.x = GRAB_X; miss('grab', r, c.x); return; }
          break;
        case 'wait':
          c.t -= DT;
          if (c.t <= 0) { c.state = 'walk'; c.t = rr(0.8, 2.0); }
          break;
        case 'pushed': {
          const d = PUSH_V * DT;
          c.x += d; c.push -= d;
          if (c.x >= row.len - 0.3) {
            row.cust.splice(i, 1);
            S.served++;
            addScore(SCORE.out);
            emit('out', { row: r, x: row.len });
          } else if (c.push <= 0) { c.state = 'drink'; c.t = P.drink; emit('sip', { row: r, x: c.x }); }
          break;
        }
        case 'drink':
          c.t -= DT;
          if (c.t <= 0) {
            row.glasses.push({ id: uid++, full: false, x: c.x - 0.5, v: -P.empty, spin: 0 });
            emit('return', { row: r, x: c.x });
            if (rnd() < P.tip && row.tips.length === 0 && c.x > 2) {
              row.tips.push({ id: uid++, x: Math.max(1.5, c.x - 0.9), t: 0 });
              emit('tipdrop', { row: r, x: c.x });
            }
            c.state = 'wait'; c.t = rr(0.5, 1.1);
          }
          break;
      }
    }
  }

  function stepGlasses(r) {
    const row = S.rows[r], sv = S.server;
    for (let i = row.glasses.length - 1; i >= 0; i--) {
      const g = row.glasses[i];
      g.x += g.v * DT; g.spin += DT;
      if (g.full) {
        // the nearest customer who is free to catch it
        let catcher = null;
        for (const c of row.cust) if ((c.state === 'walk' || c.state === 'wait') && c.x - g.x <= 0.3 && c.x - g.x > -0.4 && (!catcher || c.x < catcher.x)) catcher = c;
        if (catcher) {
          row.glasses.splice(i, 1);
          catcher.state = 'pushed'; catcher.push = S.P.push; catcher.catchT = 0.3;
          addScore(SCORE.catch);
          emit('catch', { row: r, x: catcher.x, perfect: g.perfect });
        } else if (g.x >= row.len - 0.1) { g.x = row.len; miss('crash', r, row.len); return; }
      } else {
        const here = sv.row === r && sv.hop <= HOP_T * 0.5;
        if (here && g.x <= sv.x + 0.45 && g.x >= sv.x - 0.7) {
          row.glasses.splice(i, 1);
          sv.catchT = 0.25;
          S.stats.empties++;
          addScore(SCORE.empty);
          emit('collect', { row: r, x: g.x });
        } else if (g.x <= -0.3) { g.x = -0.3; miss('drop', r, 0); return; }
      }
    }
  }

  function stepTips(r) {
    const row = S.rows[r], sv = S.server;
    for (let i = row.tips.length - 1; i >= 0; i--) {
      const tp = row.tips[i];
      tp.t += DT;
      if (sv.row === r && Math.abs(sv.x - tp.x) < 0.6) {
        row.tips.splice(i, 1);
        S.stats.tips++;
        addScore(SCORE.tip);
        S.show = { t: 0, dur: SHOW_T, kind: S.V.show };
        emit('tip', { row: r, x: tp.x });
        emit('show', { kind: S.V.show });
      } else if (tp.t > 9) { row.tips.splice(i, 1); emit('tipgone', { row: r, x: tp.x }); }
    }
  }

  function stepPlay(inp) {
    stepServer(inp);
    if (!S.show) spawn();
    if (S.show) { S.show.t += DT; if (S.show.t >= S.show.dur) { S.show = null; emit('showend'); } }
    for (let r = 0; r < ROWS && S.status === 'play'; r++) {
      stepCustomers(r);
      if (S.status !== 'play') break;
      stepGlasses(r);
      if (S.status !== 'play') break;
      stepTips(r);
    }
    if (S.status !== 'play') return;
    if (S.spawned >= S.quota && S.rows.every(r => r.cust.length === 0 && r.glasses.length === 0)) {
      const bonus = SCORE.clear + 250 * S.P.d;
      S.tally = { bonus, served: S.served };
      addScore(bonus);
      S.server.cheer = 1;
      for (const r of S.rows) r.tips = [];
      S.show = null;
      setStatus('clear');
      emit('clear', { bonus });
    }
  }

  // ---------- Order Up! ----------
  function startBonus() {
    S.mode = 'bonus';
    const B = bonusParams(S.loop), n = B.rounds[B.rounds.length - 1];
    const seq = [];
    for (let i = 0; i < n; i++) {
      let p = Math.floor(rnd() * 4);
      if (i >= 2 && p === seq[i - 1] && p === seq[i - 2]) p = (p + 1 + Math.floor(rnd() * 3)) % 4;
      seq.push(p);
    }
    S.bonus = { B, seq, round: 0, phase: 'intro', t: 0, idx: 0, lit: -1, litT: 0, got: 0, points: 0, wrong: -1 };
    S.show = null;
    setStatus('play');
    emit('bonus');
  }

  function stepBonus(inp) {
    const b = S.bonus, B = b.B;
    b.t += DT; b.litT -= DT;
    if (b.litT <= 0) b.lit = -1;
    // a pad pressed this step: a direction edge, or a direct pick
    let press = inp.pad ?? -1;
    const dirs = ['up', 'right', 'down', 'left'];
    dirs.forEach((d, k) => { if (inp[d] && !prev[d]) press = k; });
    for (const d of dirs) prev[d] = !!inp[d];
    const len = B.rounds[b.round];
    switch (b.phase) {
      case 'intro':
        if (b.t > 2.2) { b.phase = 'show'; b.t = 0; b.idx = -1; }
        break;
      case 'show': {
        const per = B.on + B.gap, k = Math.floor(b.t / per);
        if (k !== b.idx && k < len) { b.idx = k; b.lit = b.seq[k]; b.litT = B.on; emit('pad', { pad: b.lit, show: true }); }
        if (b.t >= per * len + 0.2) { b.phase = 'input'; b.t = 0; b.idx = 0; }
        break;
      }
      case 'input':
        if (press >= 0) {
          b.lit = press; b.litT = 0.22; b.t = 0;
          if (press === b.seq[b.idx]) {
            b.idx++; b.points += SCORE.pad; addScore(SCORE.pad);
            emit('pad', { pad: press });
            if (b.idx >= len) {
              const p = SCORE.round * len;
              b.points += p; addScore(p); b.got++;
              b.phase = 'good'; b.t = 0;
              emit('round', { n: len });
            }
          } else { b.wrong = press; b.phase = 'fail'; b.t = 0; emit('wrong', { pad: press }); }
        } else if (b.t > B.wait) { b.phase = 'fail'; b.t = 0; emit('wrong', { pad: -1 }); }
        break;
      case 'good':
        if (b.t > 1.0) {
          b.round++;
          if (b.round >= B.rounds.length) { b.points += SCORE.perfect; addScore(SCORE.perfect); b.phase = 'perfect'; b.t = 0; emit('perfect'); }
          else { b.phase = 'show'; b.t = 0; b.idx = -1; }
        }
        break;
      case 'fail': case 'perfect':
        if (b.t > 2.4) { b.phase = 'done'; b.t = 0; }
        break;
    }
  }

  // ---------- one step ----------
  function step(inp = {}) {
    S.t += DT; S.statusT += DT;
    if (S.mode === 'bonus') { stepBonus(inp); return; }
    const sv = S.server;
    for (const r of S.rows) for (const c of r.cust) c.bob += S.status === 'play' ? 0 : DT;
    switch (S.status) {
      case 'ready':
        // Pip may line up during the count-in; nobody else moves
        stepServer({ ...inp, pour: false });
        sv.fill = 0;
        if (S.statusT >= READY_T) setStatus('play');
        break;
      case 'play':
        stepPlay(inp);
        break;
      case 'miss':
        if (S.statusT >= MISS_T) afterMiss();
        break;
      case 'clear':
        sv.cheer += DT;
        break;
    }
  }

  return S;
}
