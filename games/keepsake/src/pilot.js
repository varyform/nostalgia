// The autopilot: plays the attract-mode demo (and the verify tool's strong bot). A few times a
// second it maps every way round the scene from where Wick stands (nav.js), with the cells near
// Rumbold priced up, and picks a job: the keepsake that will sink first that he can still reach
// in time, the Haymaker glove when it's close, or Rumbold himself while the glove lasts. Every
// step it also watches for pots, bottles and birds to punch, and springs the crate or the
// sandbag on Rumbold when he walks into it. `sloppy` (0–1) adds hesitation and misses.
//
//   const pilot = createPilot(sim, { sloppy: 0.4, seed: 1 });
//   sim.step(pilot());
import { buildNav } from './nav.js';
import { BOTTOM, FLOOR_Y, W, dxOn, floorBelow, segAt } from './scenes.js';
import { CATCH_TOP, DT, GRAB, PUNCH_HIT, PUNCH_REACH, bagPos, floorOf, keepAt, keepToWater } from './sim.js';

export function createPilot(sim, { sloppy = 0, seed = 7 } = {}) {
  let a = seed | 0;
  const rnd = () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; };
  let nav = null, navScene = -1, P = null, from = -1, replan = 0, job = null;
  let lastPunch = false, lastUp = false, stairKey = null, flipped = false, hesitate = 0, blind = 0;

  const live = b => b.mode !== 'flung' && b.mode !== 'out' && b.mode !== 'climb' && b.stun <= 0;

  // seconds added for stepping into a cell Rumbold can reach soon
  function dangerAt(id) {
    const s = sim, sc = s.sc, b = s.brute, h = s.hero;
    if (!live(b) || h.power > 0.6) return 0;
    const f = nav.fOf(id), x = nav.xOf(id), bf = floorOf(sc, b), onFloor = b.mode === 'floor';
    const d = Math.abs(dxOn(sc, f, x, b.x + (onFloor ? b.dir * 80 : 0)));
    let v = 0;
    if (f === bf) v = d < 200 ? 8 : d < 300 ? 2.5 : d < 420 ? 0.5 : 0;
    // right under him he drops, right over him he leaps
    if (f === bf + 1 && onFloor && (d < 110 || (b.act === 'drop' && d < 230))) v = Math.max(v, b.act === 'drop' ? 8 : 1);
    if (f === bf - 1 && onFloor && d < 110) v = Math.max(v, b.cool <= 0.3 ? 8 : 2.5);
    // both ends of the stair he is on
    if (b.mode === 'stair') {
      const st = sc.stairs[b.stair];
      if ((f === st.f && Math.abs(x - st.xt) < 130) || (f === st.f + 1 && Math.abs(x - st.xb) < 130)) v = Math.max(v, 8);
    }
    // where he lands when he walks off the end of a floor
    if (onFloor && b.dir) {
      const ax = b.x + b.dir * 140;
      if (ax > 0 && ax < W && segAt(sc, b.f, ax) < 0 && f === floorBelow(sc, b.f, ax) && Math.abs(x - ax) < 160) v = Math.max(v, 8);
    }
    return v;
  }
  let dz = null;
  const danger = id => dz[id];

  // Where a keepsake can be caught: the earliest moment Wick can be under it before it's lost,
  // setting off `t0` seconds from now with `tm(cell)` the seconds the way to a cell takes (and
  // `risk(cell)` the danger priced along it, for the first leg).
  function catchPlan(k, tm, t0 = 0, risk = () => 0) {
    const sinkT = k.state === 'float' ? k.floatT : keepToWater(k) + sim.P.float;
    if (k.state === 'float') {
      const id = nav.node(BOTTOM, k.x), at = t0 + tm(id);
      return { id, at, deadline: sinkT, x: k.x, f: BOTTOM, t: at, risk: risk(id), late: at + 0.1 > sinkT };
    }
    const wetT = keepToWater(k);
    let best = null;
    for (let t = Math.max(0.05, t0); t < sinkT; t += 0.1) {
      let f = -1, x;
      if (t < wetT) {
        const p = keepAt(k, t);
        x = p.x;
        for (let q = 0; q < FLOOR_Y.length; q++) if (p.y > FLOOR_Y[q] - CATCH_TOP + 16 && p.y < FLOOR_Y[q] + 6) f = q;
      } else { x = keepAt(k, wetT).x; f = BOTTOM; }
      if (f < 0) continue;
      const id = nav.node(f, x);
      if (Math.abs(dxOn(sim.sc, f, nav.xOf(id), x)) > 40) continue; // no floor under it there
      const at = t0 + tm(id), r = risk(id);
      if (at + 0.15 <= t && r < 6) { best = { id, at, deadline: sinkT, x, f, t, risk: r }; break; }
      if (!best || at + r - t < best.at + best.risk - best.t) best = { id, at, deadline: sinkT, x, f, t, risk: r, late: true };
    }
    return best;
  }
  // the keepsake to go for first: the order that loses fewest, then finishes soonest
  function pickKeep() {
    const ks = sim.keeps;
    if (!ks.length) return null;
    const firstLeg = id => P.time[id], risk = id => P.dist[id] - P.time[id];
    const orders = ks.length === 1 ? [[0]] : ks.length === 2 ? [[0, 1], [1, 0]] : [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    let best = null, bestV = Infinity;
    for (const o of orders) {
      let lost = 0, t = 0, at = -1, plan0 = null;
      for (const i of o) {
        const p = at < 0 ? catchPlan(ks[i], firstLeg, 0, risk) : catchPlan(ks[i], id => nav.between(at, id), t);
        if (!p) { lost++; continue; }
        if (!plan0) plan0 = { k: ks[i], p };
        if (p.late) { lost++; if (at < 0) { at = p.id; t = p.at; } continue; }
        at = p.id; t = p.t;
      }
      const v = lost * 100 + t;
      if (plan0 && v < bestV - 0.3) { bestV = v; best = plan0; }
    }
    // stay with the keepsake already chosen unless the new order is clearly better
    if (best && job?.kind === 'keep' && job.k !== best.k && ks.includes(job.k) && Math.abs(bestV - lastV) < 0.6) {
      const p = catchPlan(job.k, firstLeg, 0, risk);
      if (p && !p.late) best = { k: job.k, p };
    }
    lastV = bestV;
    return best;
  }
  let lastV = 0;

  function choose() {
    const s = sim, h = s.hero, b = s.brute;
    const d = P.dist, tm = P.time;
    // the glove's while it lasts: go and get him
    if (h.power > 0.5 && live(b) && b.mode !== 'leap') {
      const id = nav.node(floorOf(s.sc, b), b.x);
      if (tm[id] < h.power - 0.2 && urgentSlack() > tm[id] + 4) return { kind: 'brute', id };
    }
    const first = pickKeep();
    const urgent = first?.p;
    // too close to him: out of his reach first, toward the keepsake (unless it must be now)
    const mustGo = urgent && !urgent.late && urgent.deadline - urgent.at < 1.1;
    if (!mustGo && (danger(from) >= 2.5 || (job?.kind === 'escape' && danger(from) > 0))) {
      const away = id => (urgent ? (Math.abs(dxOn(s.sc, nav.fOf(id), nav.xOf(id), urgent.x)) / 340 + Math.abs(nav.fOf(id) - urgent.f) * 1.2) * 0.6 : 0);
      let best = -1, bestV = Infinity;
      for (let id = 0; id < nav.N; id++) {
        if (!nav.has[id] || danger(id) !== 0) continue;
        const v = d[id] + away(id);
        if (v < bestV) { bestV = v; best = id; }
      }
      if (best >= 0) return { kind: 'escape', id: best, x: nav.xOf(best) };
    }
    const G0 = s.glove;
    if (G0.state === 'ready' && h.power <= 0) {
      const id = nav.node(G0.f, G0.x), slack = urgent ? urgent.deadline - urgent.at : 99, risk = d[id] - tm[id];
      if (tm[id] < 4.5 && risk < 4 && slack > tm[id] * 2 + 1.5) return { kind: 'glove', id, x: G0.x };
    }
    // time to spare: lie in wait by the scene's trick (the crate over him, the sandbag in his path)
    const gm = s.gim, bf = live(b) ? floorOf(s.sc, b) : -1;
    const trapX = gm.kind === 'crate' && gm.state === 'hang' && bf > gm.f ? gm.x - 50 * Math.sign(b.x - gm.x || 1)
      : gm.kind === 'swing' && !gm.live && bf === gm.f && Math.abs(b.x - gm.px) > 160 ? gm.px - 100 * Math.sign(b.x - gm.px || 1) : null;
    if (trapX !== null) {
      const id = nav.node(gm.f, trapX), slack = urgentSlack(), risk = d[id] - tm[id];
      if (nav.has[id] && tm[id] < 4 && risk < 3 && (!first || slack > tm[id] + 3)) return { kind: 'trap', id, x: trapX };
    }
    if (first) return { kind: 'keep', id: first.p.id, x: first.p.x, k: first.k, t: first.p.t };
    // nothing falling: wait below Clementine, out of Rumbold's way
    let best = -1, bestV = Infinity;
    for (let f = 1; f < FLOOR_Y.length; f++) {
      const id = nav.node(f, s.sweet.x), v = d[id] + Math.abs(f - 1.6) * 0.5;
      if (v < bestV) { bestV = v; best = id; }
    }
    return { kind: 'idle', id: best, x: nav.xOf(best) };
  }
  function urgentSlack() {
    let m = 99;
    for (const k of sim.keeps) m = Math.min(m, k.state === 'float' ? k.floatT : keepToWater(k) + sim.P.float);
    return m;
  }

  // a shot or a bird about to hit: punch it now, or turn to face it first
  function threatPunch(out) {
    const s = sim, h = s.hero;
    if (h.mode !== 'floor' && h.mode !== 'stair') return false;
    const fistAt = (x, y, r) => {
      const x0 = h.face > 0 ? h.x - 10 : h.x - PUNCH_REACH, x1 = h.face > 0 ? h.x + PUNCH_REACH : h.x + 10;
      return x + r >= x0 && x - r <= x1 && y + r >= h.y - 150 && y - r <= h.y - 40;
    };
    const hits = (x, y) => Math.abs(x - h.x) < 46 && y > h.y - 166 && y < h.y + 8;
    const things = [];
    for (const sh of s.shots) things.push(tt => ({ x: sh.x + sh.vx * tt, y: sh.y + sh.vy * tt + 0.5 * sh.g * tt * tt, r: 20 }));
    const B = s.bird;
    if (B && B.state === 'swoop') things.push(tt => ({ x: B.x + B.dir * s.P.birdV * tt, y: FLOOR_Y[B.f] - 100 + Math.sin((B.ph + tt) * 4.2) * 34, r: 34 }));
    for (const at of things) {
      let impact = -1;
      for (let tt = 0; tt < 0.5; tt += DT) { const q = at(tt); if (hits(q.x, q.y)) { impact = tt; break; } }
      if (impact < 0) continue;
      if (blind > 0) continue;
      let ok = false;
      for (let tt = PUNCH_HIT[0] + DT; tt <= PUNCH_HIT[1] - DT; tt += DT) { const q = at(tt); if (fistAt(q.x, q.y, q.r)) { ok = true; break; } }
      if (ok && h.punchCD <= 0) { out.punch = !lastPunch; return true; }
      const q = at(Math.min(impact, 0.1));
      const side = Math.sign(q.x - h.x) || h.face;
      // the fist is busy, or it is coming down on him: step out from under it
      if (h.mode === 'floor' && (h.punchCD > impact - 0.05 || Math.abs(at(impact).x - h.x) < 30)) {
        if (h.punchT <= 0) out[side > 0 ? 'left' : 'right'] = true;
        return true;
      }
      if (side !== h.face && h.mode === 'floor') { out[side > 0 ? 'right' : 'left'] = true; return true; }
      if (impact < 0.3) return true; // stand ready to punch
    }
    return false;
  }

  // spring the crate or the sandbag when Rumbold walks under it; swing the glove at him
  function trickPunch(out) {
    const s = sim, h = s.hero, b = s.brute, gm = s.gim;
    if (h.mode !== 'floor' || h.punchCD > 0) return false;
    const facing = x => Math.sign(dxOn(s.sc, h.f, h.x, x)) === h.face || Math.abs(h.x - x) < 10;
    if (h.power > 0 && live(b) && Math.abs(b.y - h.y) < 80 && Math.abs(dxOn(s.sc, h.f, h.x, b.x)) < PUNCH_REACH + 30) {
      if (facing(b.x)) out.punch = !lastPunch;
      else out[b.x > h.x ? 'right' : 'left'] = true;
      return true;
    }
    if (!live(b)) return false;
    if (gm.kind === 'crate' && gm.state === 'hang' && h.f === gm.f && Math.abs(h.x - gm.x) < PUNCH_REACH - 10 && b.f > gm.f) {
      const drop = Math.sqrt((2 * Math.max(10, b.y - 120 - gm.y)) / 1800) + 0.1;
      const bx = b.x + (b.mode === 'floor' ? b.dir * s.P.bruteV * drop : 0);
      if (Math.abs(bx - gm.x) < 55 && Math.abs(b.x - gm.x) < 160) {
        if (facing(gm.x)) out.punch = !lastPunch; else out[gm.x > h.x ? 'right' : 'left'] = true;
        return true;
      }
    }
    if (gm.kind === 'swing' && !gm.live && h.f === gm.f && floorOf(s.sc, b) === gm.f) {
      // the bag only reaches about 190 px out while it is still low enough to hit him
      const p = bagPos(gm), side = Math.sign(gm.px - h.x || 1), soon = b.x + (b.mode === 'floor' ? b.dir * s.P.bruteV * 0.35 : 0);
      const near = (b.x - gm.px) * side, then = (soon - gm.px) * side;
      if (Math.abs(h.x - p.x) < PUNCH_REACH - 15 && near > 30 && near < 260 && then > 30 && then < 200) {
        if (facing(p.x)) out.punch = !lastPunch; else out[p.x > h.x ? 'right' : 'left'] = true;
        return true;
      }
    }
    return false;
  }

  function moveTo(out) {
    const s = sim, h = s.hero;
    if (h.mode === 'stair') {
      // turn back when he waits at the other end
      const st = s.sc.stairs[h.stair];
      const up = nav.node(st.f, st.xt), down = nav.node(st.f + 1, st.xb);
      if (stairKey) {
        // turn back once, early on, and only to a safe end
        const [to, back] = stairKey === 'up' ? [up, down] : [down, up];
        const gone = stairKey === 'up' ? h.p : 1 - h.p;
        if (!flipped && gone < 0.7 && dangerAt(to) >= 8 && dangerAt(back) < 2.5) { stairKey = stairKey === 'up' ? 'down' : 'up'; flipped = true; }
        out[stairKey] = true;
      }
      return;
    }
    if (h.mode !== 'floor') return;
    stairKey = null; flipped = false;
    // running from him on his own floor: straight away from him, whatever the map says
    const b = s.brute, bf = floorOf(s.sc, b);
    if (job.kind === 'escape' && bf === h.f && live(b)) {
      const bdx = dxOn(s.sc, h.f, h.x, b.x);
      if (Math.abs(bdx) < 280) {
        const away = bdx > 0 ? -1 : 1, wall = !s.sc.floors[h.f].wrap && (h.x < 40 || h.x > W - 40) && Math.sign(W / 2 - h.x) !== away;
        if (!wall) { out[away > 0 ? 'right' : 'left'] = true; return; }
      }
    }
    const e = nav.firstEdge(P, from, job.id);
    if (!e) {
      // at the job's cell: line up under the keepsake (or on the glove, or on him)
      let tx = job.x ?? nav.xOf(job.id);
      if (job.kind === 'keep' && job.k) {
        const k = job.k;
        tx = k.state === 'float' ? k.x : keepAt(k, Math.max(0, Math.min(job.t, keepToWater(k)) - 0.05)).x;
      }
      if (job.kind === 'brute') tx = s.brute.x;
      const dx = dxOn(s.sc, h.f, h.x, tx);
      if (Math.abs(dx) > 8) out[dx > 0 ? 'right' : 'left'] = true;
      return;
    }
    if (e.kind === 'walk' || e.kind === 'fall') { out[e.dir > 0 ? 'right' : 'left'] = true; return; }
    const dx = dxOn(s.sc, h.f, h.x, e.x);
    if (Math.abs(dx) > GRAB - 8) { out[dx > 0 ? 'right' : 'left'] = true; return; }
    if (e.kind === 'stair') { out[e.key] = true; stairKey = e.key; return; }
    if (e.kind === 'spring') { out.up = !lastUp; }
  }

  return () => {
    const s = sim, out = {};
    if (s.status !== 'play') { lastPunch = false; lastUp = false; stairKey = null; job = null; return out; }
    if (navScene !== s.scene) { nav = buildNav(s.scene); navScene = s.scene; P = null; }
    const h = s.hero;
    blind = Math.max(0, blind - DT);
    if (h.mode === 'floor') {
      const id = nav.node(h.f, h.x);
      replan -= DT;
      if (!P || id !== from || replan <= 0) {
        from = id;
        dz = new Float64Array(nav.N);
        for (let i = 0; i < nav.N; i++) dz[i] = nav.has[i] ? dangerAt(i) : 0;
        P = nav.paths(from, danger); job = choose(); replan = 0.12 + sloppy * rnd() * 0.25;
        if (sloppy && rnd() < sloppy * 0.05) hesitate = 0.15 + rnd() * 0.4 * sloppy;
        if (sloppy && rnd() < sloppy * 0.04) blind = 0.6;
      }
    }
    if (hesitate > 0) { hesitate -= DT; lastPunch = false; return out; }
    if (!threatPunch(out) && !trickPunch(out) && job) moveTo(out);
    lastPunch = !!out.punch; lastUp = !!out.up;
    return out;
  };
}
