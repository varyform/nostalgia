// Scorch's drivers. Each track gets one racing line, worked out once: the lateral offset at every
// sample that bends the path as little as the road (and the obstacles on it) allow, which cuts
// apexes and runs wide on the way in and out. Each driver then takes a speed for every sample from
// its car's grip and turn and its own skill, braking back from every corner, and follows the line
// by pure pursuit, steering with the slip angle in mind so it catches its own drifts.
//
// On top of that it races: it pulls out to pass a slower car or a wreck ahead (or, if aggressive,
// shunts it), steers round mines, shoots at whoever crosses its sights, drops mines on whoever is
// on its tail, lights the turbo on a straight, and backs out of anything it gets stuck against.
//
// A driver keeps its own memory and its own random numbers, never the sim's, so the demo pilot
// watching a race changes nothing.
//
//   const drive = createDriver(race, i, { skill, aggression, seed });
//   drive() → { steer -1…1, throttle 0…1, brake 0…1, fire, mine, turbo }   // mine, turbo: presses
import { SURFACES } from './track.js';

const LINES = new WeakMap();
const MARGIN = 2.1; // the line keeps the car's centre this far in from the walls
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));

/** the racing line: { off, lo, hi, k } per sample (offset, its bounds, the line's curvature) */
export function racingLine(geo) {
  let line = LINES.get(geo);
  if (line) return line;
  const { n, xs, ys, ws, txs, tys, step, len } = geo;
  const lo = new Float64Array(n), hi = new Float64Array(n);
  for (let i = 0; i < n; i++) { hi[i] = ws[i] / 2 - MARGIN; lo[i] = -hi[i]; }
  // a solid obstacle on the road closes the side it stands on, tapering off either side of it
  for (const p of geo.def.props || []) {
    if (!p.solid) continue;
    const q = geo.nearest(p.x, p.y);
    if (Math.abs(q.off) > ws[q.i] / 2 + p.r) continue;
    const reach = p.r + 9, need = p.r + MARGIN + 0.4;
    for (let k = -reach; k <= reach; k += step) {
      const j = Math.floor((((q.d + k) % len) + len) % len / step) % n;
      const t = clamp((reach - Math.abs(k)) / (reach - p.r - 1.5), 0, 1), e = need * t * t * (3 - 2 * t);
      if (q.off >= 0) hi[j] = Math.min(hi[j], q.off - e); else lo[j] = Math.max(lo[j], q.off + e);
    }
  }
  for (let i = 0; i < n; i++) if (lo[i] > hi[i]) lo[i] = hi[i] = (lo[i] + hi[i]) / 2;
  // relax the offsets on nodes every S samples toward the least bent path (each node toward the
  // point its neighbours' 5-point stencil says), then carry them to every sample
  const S = 4, m = Math.floor(n / S), o = new Float64Array(m);
  const nodeX = j => xs[j * S] - tys[j * S] * o[j], nodeY = j => ys[j * S] + txs[j * S] * o[j];
  for (let it = 0; it < 2500; it++) {
    for (let j = 0; j < m; j++) {
      const a = (j - 2 + m) % m, b = (j - 1 + m) % m, c = (j + 1) % m, d = (j + 2) % m;
      const qx = (-nodeX(a) + 4 * nodeX(b) + 4 * nodeX(c) - nodeX(d)) / 6, qy = (-nodeY(a) + 4 * nodeY(b) + 4 * nodeY(c) - nodeY(d)) / 6;
      const i = j * S, want = (qx - xs[i]) * -tys[i] + (qy - ys[i]) * txs[i];
      o[j] = clamp(want, lo[i], hi[i]);
    }
  }
  const off = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // the last node's span runs on to the end of the lap, a little longer than S
    const j = Math.min(Math.floor(i / S), m - 1), j2 = (j + 1) % m, i1 = j2 ? j2 * S : n;
    off[i] = clamp(o[j] + ((o[j2] - o[j]) * (i - j * S)) / (i1 - j * S), lo[i], hi[i]);
  }
  // the line's own curvature, from points 4 samples apart either side, smoothed
  const k = new Float64Array(n), raw = new Float64Array(n);
  const PX = i => xs[(i + n) % n] - tys[(i + n) % n] * off[(i + n) % n], PY = i => ys[(i + n) % n] + txs[(i + n) % n] * off[(i + n) % n];
  for (let i = 0; i < n; i++) {
    const ax = PX(i - 4), ay = PY(i - 4), bx = PX(i), by = PY(i), cx = PX(i + 4), cy = PY(i + 4);
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    const l = Math.hypot(bx - ax, by - ay) * Math.hypot(cx - bx, cy - by) * Math.hypot(cx - ax, cy - ay) || 1;
    raw[i] = (2 * cross) / l;
  }
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -4; j <= 4; j++) s += raw[(i + j + n) % n];
    k[i] = s / 9;
  }
  line = { off, lo, hi, k };
  LINES.set(geo, line);
  return line;
}

/** the speed a car can take at every sample of the line, braking back from every corner */
export function speedProfile(race, stats, skill) {
  const { P, SURF } = race.tune, geo = race.geo, { n, step } = geo, line = racingLine(geo);
  const v = new Float64Array(n), bk = new Float64Array(n);
  const care = 0.64 + 0.32 * skill; // how near the grip limit it dares
  for (let i = 0; i < n; i++) {
    const sf = SURF[SURFACES[geo.surf[i]]], grip = stats.grip * sf.grip, k = Math.abs(line.k[i]);
    let top = stats.top * sf.top;
    if (k > 1e-4) top = Math.min(top, Math.sqrt((P.G * grip * care) / k), (stats.turn * 0.85) / k);
    v[i] = top;
    bk[i] = P.brake * Math.min(1, grip + 0.3) * (0.4 + 0.35 * skill);
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = v[(i + 1) % n];
      v[i] = Math.min(v[i], Math.sqrt(next * next + 2 * bk[i] * step));
    }
  }
  return v;
}

export function createDriver(race, i, { skill = 0.6, aggression = 0.5, seed = 1 } = {}) {
  const { P, CAR } = race.tune, geo = race.geo, { n, len, step, xs, ys, txs, tys } = geo, DT = 1 / 60;
  const line = racingLine(geo), st = race.s.cars[i].stats, vmax = speedProfile(race, st, skill);
  let r = seed | 0;
  const rand = () => {
    let t = (r = (r + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const idx = d => Math.floor((((d % len) + len) % len) / step) % n;
  const wrapD = d => ((((d + len / 2) % len) + len) % len) - len / 2;
  const m = {
    off: race.s.cars[i].off, avoid: null, avoidT: 0, ph: rand() * 6.3, stuck: 0, rec: 0, grace: 1.5,
    chkT: 0, chkProg: race.s.cars[i].prog, think: rand() * 0.2, burst: 0, mineCd: 3, turboCd: 2, lap: -1, pace: 1,
    ramUntil: -1, ramCar: -1, scan: 0, blockV: 0, blockT: 0, vt: 0, recT: 0, shuffle: 0,
    noseT: -9, noseRel: 9, knot: 0, yieldT: 0, recX: 0, recY: 0, recBack: 4,
    turn: null, // a three-point turn under way: { rot, gear, t, gearT }
  };

  // ---- turning round: slow and facing well off the road (a spin, a shunt, a nose in the wall).
  // A three-point turn: it settles once which way to rotate (the short way, unless that sweeps
  // the car into the nearer wall), then goes forward or back, whichever has the more road ahead,
  // full lock so either gear swings the nose round, changing gear before it hits a wall ----
  function turnRound(s, c, out) {
    const vf = c.vf, jc = idx(c.d), ta = Math.atan2(tys[jc], txs[jc]), err = wrapA(ta - c.a);
    if (!m.turn) {
      if (Math.abs(err) < 1.1 || c.speed > 6 || c.spin > 0 || s.status !== 'race') return false;
      m.turn = { rot: Math.sign(err) || 1, gear: 0, t: 0, gearT: 0 };
    }
    const T = m.turn;
    T.t += DT; T.gearT += DT;
    // done: near enough the road's way (or it has taken too long: back to the stuck logic)
    if (Math.abs(err) < 0.45 || T.t > 6 || c.spin > 0) {
      m.turn = null; m.grace = 0.6; m.stuck = 0; m.chkT = 0; m.chkProg = c.prog;
      return false;
    }
    // room across the road in each gear: forward runs the way the nose points across it
    const rel = wrapA(c.a - ta), sr = Math.sin(rel), half = geo.ws[jc] / 2;
    const reach = (CAR.len / 2) * Math.abs(sr) + (CAR.wid / 2) * Math.abs(Math.cos(rel));
    const toR = half - reach - c.off, toL = half - reach + c.off; // centre to the right / left wall
    const fwd = sr >= 0 ? toR : toL, back = sr >= 0 ? toL : toR;
    if (T.gear === 0) {
      // nearly backwards: rotate the way that first sweeps the nose toward the roomier side
      if (Math.abs(err) > 2.75) T.rot = (toR > toL) === (Math.sin(rel + 0.5) > Math.sin(rel - 0.5)) ? 1 : -1;
      T.gear = fwd > 2.5 || fwd >= back ? 1 : -1;
    }
    // change gear before the wall, or when it's made no headway in this one
    const room = T.gear > 0 ? fwd : back, rate = Math.abs(sr) * Math.abs(vf);
    if ((room < 0.6 + rate * 0.35 && T.gearT > 0.25) || (T.gearT > 1 && Math.abs(vf) < 0.4)) { T.gear = -T.gear; T.gearT = 0; }
    out.steer = T.gear * T.rot;
    if (T.gear > 0) { out.throttle = vf < 4 ? 1 : 0; out.brake = 0; }
    else { out.brake = vf > -4 ? 1 : 0; out.throttle = 0; }
    return true;
  }

  drive.m = m; // its memory, for tools that want to see what it's doing
  return drive;
  function drive() {
    const s = race.s, c = s.cars[i], out = { steer: 0, throttle: 0, brake: 0, fire: false, mine: false, turbo: false };
    if (s.status === 'grid' || c.dead) return out;
    const live = s.status === 'race' && !c.done, vf = c.vf, v = c.speed;
    if (c.lap !== m.lap) { m.lap = c.lap; m.pace = 0.93 + 0.06 * skill + rand() * 0.02; }

    // ---- stuck: back out, turning the tail toward where the road goes ----
    if (m.rec > 0) {
      m.rec -= DT; m.recT += DT;
      // far enough back to steer round what stopped it (or out of time): race on
      if (Math.hypot(c.x - m.recX, c.y - m.recY) >= m.recBack) m.rec = 0;
      if (m.rec <= 0) { m.grace = 1.2; m.chkT = 0; m.chkProg = c.prog; m.stuck = 0; }
      // the wheel straightens the car up with the road as it goes, either gear (so the tail
      // swings away from whatever the nose was angled off toward, which is where the room is)
      const jr = idx(c.d), rel = wrapA(c.a - Math.atan2(tys[jr], txs[jr])), straight = clamp(rel / 0.4, -1, 1);
      // boxed in behind as well (it won't roll back): shuffle forward a moment
      if (m.recT > 0.5 && vf > -0.8 && !m.shuffle) m.shuffle = 0.5;
      if (m.shuffle > 0) { m.shuffle -= DT; out.throttle = 1; out.steer = -straight; if (m.shuffle <= 0) { m.shuffle = 0; m.recT = 0; } return out; }
      out.brake = 1; out.steer = straight;
      return out;
    }
    if (turnRound(s, c, out)) return out;
    m.grace -= DT;
    // stuck: crawling while it wants to go (nose in a wall, pinned on a wreck), or getting
    // nowhere along the road for 3 s while barely moving
    m.stuck = c.spin <= 0 && v < 2.5 && m.vt > 4 ? m.stuck + DT : Math.max(0, m.stuck - DT);
    m.chkT += DT;
    let trapped = m.grace <= 0 && m.stuck > 0.9;
    // a wreck (or a stopped car) right on the nose: no waiting, back off far enough to get round it
    const nosed = s.raceT - m.noseT < 0.2 && v < 2 && m.vt > 3;
    if (nosed && m.grace <= 0 && m.stuck > 0.25) trapped = true;
    if (m.chkT >= 3) {
      if (m.grace <= 0 && c.prog - m.chkProg < 8 && c.spin <= 0 && v < 4) trapped = true;
      m.chkT = 0; m.chkProg = c.prog;
    }

    // ---- traffic: pass what's slower ahead on the line, steer round wrecks and mines ----
    m.avoidT -= DT;
    if (m.avoidT <= 0) m.avoid = null;
    if (--m.scan <= 0) {
      m.scan = 3;
      // everything in reach ahead, as lateral spans the car's centre must keep out of; any one
      // across the path it means to take sends it to the free gap nearest its line
      const spans = [];
      let near = Infinity, nearV = 0, jRef = -1, inWay = false;
      const add = (off, k, rel, v, d) => {
        spans.push([off - k, off + k]);
        if (Math.abs((m.avoid ?? line.off[idx(d)]) - off) < k) inWay = true;
        if (rel < near) { near = rel; nearV = v; jRef = idx(d); }
      };
      for (const o of s.cars) {
        if (o === c) continue;
        const rel = wrapD(o.prog - c.prog);
        // a wreck (or a stopped car) right on the nose
        const jo = idx(o.d), r = o.a - Math.atan2(tys[jo], txs[jo]);
        const k = (CAR.len / 2) * Math.abs(Math.sin(r)) + (CAR.wid / 2) * Math.abs(Math.cos(r)) + CAR.wid / 2 + 0.6;
        if ((o.dead || o.speed < 1.5) && rel > 0 && rel < 6.5 && Math.abs(c.off - o.off) < k - 0.3) { m.noseT = s.raceT; m.noseRel = rel; }
        if (rel < 2.5 || rel > 28) continue;
        if (!o.dead && vf - o.vf < 0.5 && rel > 7) continue;
        // an aggressive driver sometimes keeps its line and shunts a live rival instead
        if (!o.dead && live && !o.done) {
          if (m.ramCar !== o.i || s.raceT > m.ramUntil + 3) { m.ramCar = o.i; m.ramUntil = rand() < aggression * 0.45 ? s.raceT + 3 : -1; }
          if (s.raceT < m.ramUntil) continue;
        }
        // k: how far its body reaches across the road, as it's turned, plus our half and a margin
        add(o.off, k, rel, o.dead ? 0 : o.vf, o.d);
      }
      for (const mn of s.mines) {
        if ((mn.x - c.x) ** 2 + (mn.y - c.y) ** 2 > 32 * 32) continue;
        const q = geo.nearest(mn.x, mn.y, c.d + 12), rel = wrapD(q.d - c.d);
        if (rel < 1 || rel > 30) continue;
        add(q.off, P.mineR + CAR.wid / 2 + 0.8, rel, 0, q.d);
      }
      if (inWay) {
        const lo = line.lo[jRef], hi = line.hi[jRef], want = line.off[jRef];
        const free = x => spans.every(([a, b]) => x <= a || x >= b);
        const cands = [want, lo, hi, ...spans.flat(), ...spans.map(([a, b]) => (a + b) / 2)].map(x => clamp(x, lo, hi));
        let best = null, cost = Infinity;
        for (const x of cands) {
          if (!free(x)) continue;
          const k = Math.abs(x - want) + 0.5 * Math.abs(x - m.off);
          if (k < cost) { cost = k; best = x; }
        }
        if (best != null) { m.avoid = best; m.avoidT = 0.6; }
        else {
          // no clean way past: a moving car is followed; a pile of wrecks or mines is squeezed
          // through at a crawl where it leaves the most room, shoving the hulks aside
          const deep = x => spans.reduce((t, [a, b]) => t + Math.max(0, Math.min(x - a, b - x)), 0);
          let squeeze = cands[0];
          for (let x = lo; x <= hi; x += 0.25) if (deep(x) < deep(squeeze)) squeeze = x;
          if (nearV > 2) { if (near < 14) { m.blockV = nearV; m.blockT = 0.3; } }
          else { m.avoid = squeeze; m.avoidT = 0.6; if (near < 10) { m.blockV = 3; m.blockT = 0.3; } }
        }
      }
    }

    // ---- the line ----
    const look = 5 + 0.38 * Math.max(0, vf), j = idx(c.d + look);
    const wob = (1 - skill) * (1.4 * Math.sin(m.ph) + 0.7 * Math.sin(2.3 * m.ph + 1));
    m.ph += DT * 0.7;
    let want = clamp(m.avoid ?? line.off[j] + wob, line.lo[j], line.hi[j]);
    // a knot: side by side at a crawl, leaning on each other (each steering for its own line
    // through the others). After a moment it unpicks: each steers away from its neighbour, and
    // the one further back lifts to let it go
    let knot = null;
    if (v < 6 && vf > -1 && m.vt > 6 && c.spin <= 0)
      for (const o of s.cars) {
        if (o === c || o.dead) continue;
        const rel = wrapD(o.prog - c.prog);
        if (Math.abs(rel) < CAR.len && Math.abs(o.off - c.off) < CAR.wid + 0.6 && (!knot || Math.abs(rel) < Math.abs(knot.rel))) knot = { o, rel };
      }
    m.knot = knot ? m.knot + DT : 0;
    if (m.knot > 0.6) {
      const away = Math.sign(c.off - knot.o.off) || (c.i < knot.o.i ? -1 : 1);
      want = clamp(knot.o.off + away * (CAR.wid + 1.2), line.lo[j], line.hi[j]);
      if (knot.rel > 0.4) m.yieldT = 0.5;
    }
    m.off += clamp(want - m.off, -7 * DT, 7 * DT);
    const tx = xs[j] - tys[j] * m.off, ty = ys[j] + txs[j] * m.off;
    const hv = v > 3 && vf > 0 ? Math.atan2(c.vy, c.vx) : c.a;
    const alpha = wrapA(Math.atan2(ty - c.y, tx - c.x) - hv), alphaH = wrapA(Math.atan2(ty - c.y, tx - c.x) - c.a);
    const dist = Math.max(3, Math.hypot(tx - c.x, ty - c.y));
    const wantW = ((2 * Math.sin(alpha)) / dist) * Math.max(v, 3);
    const af = Math.abs(vf), turnAt = Math.min(1, af / 5) * (1 - 0.2 * Math.min(1, af / 50));
    const beta = vf > 1 ? Math.atan2(-c.vx * Math.sin(c.a) + c.vy * Math.cos(c.a), vf) : 0;
    out.steer = turnAt > 0.2 ? clamp((wantW - P.beta * 0.8 * beta) / (st.turn * turnAt), -1, 1) : Math.sign(alphaH);
    // facing well away from the line (a spin, a shunt): full lock round, not pursuit's feeble sine
    if (Math.abs(alphaH) > 1.2) out.steer = Math.sign(alphaH) * (vf >= 0 ? 1 : -1);

    if (trapped) {
      m.rec = 2.5; m.recT = 0; m.shuffle = 0; m.stuck = 0; m.recX = c.x; m.recY = c.y; m.yieldT = 0; m.knot = 0;
      m.recBack = nosed ? clamp(10 - m.noseRel, 4, 7) : 4 + rand() * 1.5;
      out.brake = 1;
      return out;
    }

    // ---- speed ----
    let vt = Math.min(vmax[idx(c.d)], vmax[idx(c.d + Math.max(0, vf) * 0.3)]) * m.pace;
    if (Math.abs(alpha) > 0.5) vt = Math.min(vt, 14 - 7 * Math.min(1, Math.abs(alpha) - 0.5));
    if (m.blockT > 0) { m.blockT -= DT; vt = Math.min(vt, m.blockV + 1); }
    if (!live) vt *= 0.8;
    m.vt = vt;
    out.throttle = vf < vt - 0.3 ? 1 : vf < vt + 0.5 ? 0.25 : 0;
    if (m.yieldT > 0) { m.yieldT -= DT; out.throttle = 0; }
    out.brake = vf > vt + 1.5 ? clamp((vf - vt) / 4, 0.3, 1) : 0;
    if (!live) return out;

    // ---- the gun, mines, turbo ----
    m.burst -= DT; m.mineCd -= DT; m.turboCd -= DT; m.think -= DT;
    if (m.think <= 0) {
      m.think = 0.15 + rand() * 0.1;
      if (c.ammo > 0 && m.burst <= 0) {
        for (const o of s.cars) {
          if (o === c || o.dead || o.done) continue;
          const dx = o.x - c.x, dy = o.y - c.y, dd = Math.hypot(dx, dy);
          if (dd > 40 || dd < 3 || (c.ammo < 15 && dd > 20)) continue;
          const ang = wrapA(Math.atan2(dy, dx) - c.a), tol = Math.atan2(1, dd) + 0.02 + 0.06 * (1 - skill);
          if (Math.abs(ang) < tol && rand() < 0.08 + 0.3 * aggression) { m.burst = 0.12 + 0.3 * aggression + rand() * 0.2; break; }
        }
      }
      // no mines in the scramble off the grid
      if (c.mines > 0 && m.mineCd <= 0 && s.raceT > 8) {
        // someone on its tail, closing in on the same line
        const tail = s.cars.some(o => o !== c && !o.dead && !o.done && o.spin <= 0 && o.vf > 8 && wrapD(o.prog - c.prog) < -4 && wrapD(o.prog - c.prog) > -22 && Math.abs(o.off - c.off) < 3);
        if (tail && rand() < 0.04 + 0.12 * aggression) { out.mine = true; m.mineCd = 4 + rand() * 4; }
      }
      if (c.turbo > 0 && c.boost <= 0 && m.turboCd <= 0 && vf > 0.5 * st.top && Math.abs(alpha) < 0.15) {
        let clear = true;
        for (let k = 0; k < vf * 2 + 30 && clear; k += 3) clear = vmax[idx(c.d + k)] >= st.top * 0.98;
        if (clear && rand() < 0.2 + 0.6 * skill) { out.turbo = true; m.turboCd = 3; }
      }
    }
    out.fire = m.burst > 0 && c.ammo > 0;
    return out;
  }
}
