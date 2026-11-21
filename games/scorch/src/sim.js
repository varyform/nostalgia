// Scorch's race: four cars on one of the tracks, pure and deterministic, a fixed step at a time.
// The page, the attract demo and tools/verify.mjs drive it with held-input snapshots
// { up, down, left, right, fire, mine, turbo } for the player's car (the sim finds the presses),
// and read `race.s` to draw it; rivals are driven by ai.js from inside. All randomness comes
// from the integer `s.rng` (mulberry32) and the drivers' own seeds, so a seed replays exactly.
//
// Metres and seconds, x right, y DOWN, headings clockwise (atan2(dy, dx)). Handling is arcade
// top-down with weight: the engine pushes along the nose, the tyres bleed off sideways speed up to
// a grip limit (stats.grip × the surface), and the steering asks for a yaw rate that a slip
// angle pulls back against, so hard steering at speed swings the tail out into a drift that
// settles at an angle instead of spinning, and countersteer or lifting tidies it up.
//
//   const race = createRace({ track: TRACKS[0], laps: 3, seed: 1, cars });
//   race.step([input]);   // every DT; race.events lists what happened
import { SURFACES, buildTrack } from './track.js';
import { createDriver } from './ai.js';

export const DT = 1 / 60;
// a car's body, the same for every model: collision is two discs along it
export const CAR = { len: 4.4, wid: 2.0, disc: 1.05, discAt: 1.15 };
export const P = {
  G: 16, // m/s² of sideways grip per unit of stats.grip, on asphalt
  brake: 20, reverse: 7, revTop: 9, coast: 1.2, // m/s², m/s
  steerOn: 6, steerOff: 9, steerAi: 10, // the wheel's travel, full lock per second (keys, AI)
  beta: 4, // how hard a slip angle pulls the yaw back (sets the drift angle)
  yaw: 10, // how fast the yaw rate follows the wheel, per second, on full grip
  wallFree: 5, wallDmg: 0.7, wallE: 0.25, wallMu: 0.25, // walls: m/s that don't hurt, damage per m/s over, bounce, rub
  bumpFree: 4, bumpDmg: 0.7, bumpE: 0.35, // car–car: the same
  bullet: 110, bulletLife: 0.55, bulletR: 1.15, spread: 0.03, // m/s, s, m, rad
  mineArm: 0.6, mineR: 0.6, mineDmg: 30, mineCap: 16, mineBack: 3.2,
  turbo: 1.5, turboTop: 1.3, // s of boost per charge, top speed × while boosting
  pickR: 2.4, respawn: [7, 5], // m; s + up to s more
  resolve: 10, // s the race runs on after the player finishes or is wrecked
  cap: 600, // s: a race that runs this long is called
};
// surfaces: grip ×, top speed ×, engine ×
export const SURF = {
  asphalt: { grip: 1, top: 1, acc: 1 },
  dirt: { grip: 0.72, top: 0.84, acc: 0.85 },
  snow: { grip: 0.6, top: 0.76, acc: 0.8 },
  water: { grip: 0.75, top: 0.86, acc: 0.9 },
  ice: { grip: 0.3, top: 1, acc: 0.55 },
  oil: { grip: 0.2, top: 1, acc: 0.45 },
  off: { grip: 0.72, top: 0.84, acc: 0.85 },
};
export const PICKUPS = { cash: 0.4, ammo: 0.25, repair: 0.2, turbo: 0.15 };
export const EMPTY_INPUT = { up: false, down: false, left: false, right: false, fire: false, mine: false, turbo: false };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sign = v => (v < 0 ? -1 : 1);
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));

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

export function createRace({ track, laps, seed = 1, cars: entrants }) {
  const geo = buildTrack(track), len = geo.len;
  const s = {
    t: 0, raceT: 0, status: 'grid', count: 3, laps: laps ?? track.laps, cars: [], shots: [], mines: [],
    pickups: track.pickups.map(([x, y]) => ({ x, y, kind: 'cash', on: true, t: 0 })),
    order: [], leader: 0, finishT: null, resolveT: null, rng: seed | 0,
  };
  const race = { s, events: [], geo, step, result, tune: { P, SURF, CAR } };
  const emit = (k, e = {}) => race.events.push({ k, ...e });
  for (const p of s.pickups) p.kind = pick(s, PICKUPS);
  // the solid props a car can touch: on the road or overhanging its edge
  const solids = track.props.filter(p => {
    if (!p.solid) return false;
    const q = geo.nearest(p.x, p.y);
    return Math.abs(q.off) < geo.ws[q.i] / 2 + p.r + 0.5;
  });

  // the player starts at the back of the grid; rivals fill it from the front
  const n = entrants.length;
  s.cars = entrants.map((e, i) => {
    const g = geo.grid[i === 0 ? n - 1 : i - 1] || geo.grid[geo.grid.length - 1];
    const st = e.stats, maxHp = st.hp;
    return {
      i, id: e.id, name: e.name, colour: e.colour, model: e.model, x: g.x, y: g.y, a: g.a, vx: 0, vy: 0, w: 0,
      speed: 0, steer: 0, throttle: 0, brake: 0, slip: 0, boost: 0, hp: clamp(e.hp ?? maxHp, 1, maxHp), maxHp,
      ammo: e.ammo | 0, mines: e.mines | 0, turbo: e.turbo | 0, lap: 0, d: g.d, place: i + 1, done: false,
      dead: false, deadT: 0, finishT: null, kills: 0, cash: 0, firing: false, hitT: 99, surface: 'asphalt', ai: e.ai || null,
      // additive: the stats, signed forward speed, total distance along the track since the start
      // line (negative on the grid), lateral offset (+ right of travel), seconds of mine spin left
      stats: st, vf: 0, prog: g.d - len, off: g.off, spin: 0,
    };
  });
  // the working memory nobody draws: input edges, gun cooldown, who hit last, wreck order…
  const M = s.cars.map(() => ({ prev: { ...EMPTY_INPUT }, fireCd: 0, by: -1, byT: -99, deadN: 0, low: false, spinW: 0, wallCd: 0, bumpCd: {} }));
  const mixSeed = k => (Math.imul((seed | 0) ^ 0x9e3779b9, k * 2654435761 + 1) ^ (k * 40503)) | 0;
  const drivers = s.cars.map((c, i) => (c.ai ? createDriver(race, i, { skill: c.ai.skill ?? 0.5, aggression: c.ai.aggression ?? 0.5, seed: mixSeed(i + 1) }) : null));
  race.drivers = drivers; // additive: the rivals' drivers (their memory at .m), for tools
  let cruise = null; // drives the player's car after it finishes
  let deadN = 0, finished = 0;
  const backs = s.pickups.map(() => 0);
  order();

  function step(inputs = []) {
    race.events = [];
    s.t += DT;
    if (s.status === 'grid') {
      const n = Math.max(0, 3 - Math.floor(s.t + 1e-9));
      if (s.t - DT <= 1e-9) emit('count', { n: 3 });
      else if (n !== s.count && n > 0) emit('count', { n });
      s.count = n;
      // revving on the line: the engines read throttle
      for (const c of s.cars) c.throttle = c.ai ? (s.t > 2.2 ? 1 : 0.3) : inputs[c.i]?.up ? 1 : 0;
      if (n === 0) { s.status = 'race'; s.count = 0; emit('go'); }
      return;
    }
    s.raceT += DT;
    for (const c of s.cars) {
      const m = M[c.i];
      m.fireCd -= DT; m.wallCd -= DT;
      c.hitT += DT;
      if (c.dead) { c.deadT += DT; settle(c); continue; }
      drive(c, control(c, inputs[c.i]));
    }
    collideCars();
    for (const c of s.cars) { collideProps(c); walls(c); progress(c); }
    shots();
    mines();
    pickups();
    for (const c of s.cars) health(c);
    order();
    if (s.status === 'race') resolve();
  }

  // ---------- controls ----------
  function control(c, inp) {
    const m = M[c.i], live = s.status === 'race' && !c.done;
    if (c.ai || !live) {
      if (!c.ai && !cruise) cruise = createDriver(race, c.i, { skill: 0.55, aggression: 0, seed: mixSeed(99) });
      const k = (c.ai ? drivers[c.i] : cruise)();
      if (!live) { k.fire = k.mine = k.turbo = false; k.throttle *= 0.8; }
      return k;
    }
    inp = inp || EMPTY_INPUT;
    const k = {
      steer: (inp.right ? 1 : 0) - (inp.left ? 1 : 0), throttle: inp.up ? 1 : 0, brake: inp.down ? 1 : 0,
      fire: !!inp.fire, mine: !!inp.mine && !m.prev.mine, turbo: !!inp.turbo && !m.prev.turbo, keys: true,
    };
    m.prev = { ...EMPTY_INPUT, ...inp };
    return k;
  }

  // ---------- handling ----------
  function drive(c, k) {
    const st = c.stats, sf = SURF[c.surface] || SURF.asphalt, m = M[c.i];
    // the wheel travels: keys ramp it, and it comes back faster than it goes out
    const out = k.steer !== 0 && (c.steer === 0 || sign(k.steer) === sign(c.steer));
    const rate = (k.keys ? (out ? P.steerOn : P.steerOff) : P.steerAi) * DT;
    c.steer += clamp(k.steer - c.steer, -rate, rate);
    c.throttle = clamp(k.throttle, 0, 1);
    c.brake = clamp(k.brake, 0, 1);
    if (k.turbo && c.turbo > 0 && c.boost <= 0) { c.turbo--; c.boost = P.turbo; emit('turbo', { car: c.i }); }
    if (c.boost > 0) c.boost = Math.max(0, c.boost - DT);
    const ca = Math.cos(c.a), sa = Math.sin(c.a);
    let vf = c.vx * ca + c.vy * sa, vl = -c.vx * sa + c.vy * ca;
    const top = st.top * sf.top * (c.boost > 0 ? P.turboTop : 1), grip = st.grip * sf.grip;
    // engine, brakes, reverse
    let acc = 0;
    if (c.throttle > 0) {
      if (vf < -0.5) acc += c.throttle * P.brake * Math.min(1, grip + 0.3);
      else acc += c.throttle * st.accel * sf.acc * clamp(1 - (vf / top) ** 2, 0, 1);
    }
    if (c.boost > 0) acc += st.turboPower * clamp(1 - (vf / top) ** 2, 0, 1);
    if (c.brake > 0) {
      if (vf > 0.5) acc -= c.brake * P.brake * Math.min(1, grip + 0.3);
      else if (vf > -P.revTop) acc -= c.brake * P.reverse * sf.acc;
    }
    if (vf > top) acc -= (vf - top) * 1.2; // over the surface's top (dirt, a turbo running out): it drags you down
    const drag = (c.throttle > 0 || c.boost > 0 ? 0.3 : 1) * P.coast;
    if (!c.throttle && !c.brake && Math.abs(vf) < drag * DT) vf = 0;
    else acc -= sign(vf) * drag;
    vf += acc * DT;
    // the tyres bleed sideways speed off up to the grip limit; past it the car slides and scrubs
    const A = P.G * grip * (c.spin > 0 ? 0.4 : 1), cut = A * DT;
    const slide = Math.max(0, Math.abs(vl) - cut);
    vl -= sign(vl) * Math.min(Math.abs(vl), cut);
    if (slide > 0) vf -= sign(vf) * Math.min(Math.abs(vf), 0.3 * cut * Math.min(1, slide / 2));
    // yaw: the wheel asks for a rate (reversed when reversing, none standing still), the slip
    // angle pulls back toward the direction of travel; on low grip both answer slower
    const af = Math.abs(vf), turnAt = Math.min(1, af / 5) * (1 - 0.2 * Math.min(1, af / 50));
    const beta = vf > 1 ? Math.atan2(vl, vf) : 0;
    const g1 = Math.min(1, grip);
    const kB = P.beta * (0.55 + 0.45 * g1) * (1 - 0.3 * c.throttle * clamp(vf / top, 0, 1));
    let want = c.steer * st.turn * turnAt * (vf >= 0 ? 1 : -1) + kB * beta;
    if (c.spin > 0) { c.spin = Math.max(0, c.spin - DT); want = m.spinW; m.spinW *= 0.97; }
    c.w += (want - c.w) * Math.min(1, P.yaw * (0.35 + 0.65 * g1) * DT);
    c.vx = vf * ca - vl * sa; c.vy = vf * sa + vl * ca;
    c.a = wrapA(c.a + c.w * DT);
    c.x += c.vx * DT; c.y += c.vy * DT;
    c.vf = vf; c.speed = Math.hypot(c.vx, c.vy);
    // how sideways (marks and smoke): sliding, hard braking, spinning the wheels on low grip
    const wheelspin = c.throttle > 0 && vf < top * 0.4 && grip < 0.8 ? 0.5 : 0;
    const braking = c.brake > 0 && vf > 6 ? 0.45 : 0;
    c.slip = clamp(Math.max(Math.abs(vl) / 4 + slide / 2, wheelspin, braking, c.spin > 0 ? 1 : 0), 0, 1);
    // the gun and the mines
    c.firing = !!k.fire && c.ammo > 0 && s.status === 'race' && !c.done;
    if (c.firing && m.fireCd <= 0) { shoot(c); m.fireCd = 1 / st.rate; }
    if (k.mine && c.mines > 0 && s.status === 'race' && !c.done) dropMine(c);
  }

  // a wreck: no driver, its brakes locked
  function settle(c) {
    const v = Math.hypot(c.vx, c.vy), dv = Math.min(v, 10 * DT);
    if (v > 0) { c.vx -= (c.vx / v) * dv; c.vy -= (c.vy / v) * dv; }
    c.w *= 0.95;
    c.a = wrapA(c.a + c.w * DT);
    c.x += c.vx * DT; c.y += c.vy * DT;
    c.speed = Math.hypot(c.vx, c.vy); c.vf = 0; c.throttle = 0; c.brake = 0; c.slip = 0; c.steer = 0; c.firing = false;
  }

  // ---------- collisions ----------
  const discs = c => {
    const ca = Math.cos(c.a) * CAR.discAt, sa = Math.sin(c.a) * CAR.discAt;
    return [[c.x + ca, c.y + sa], [c.x - ca, c.y - sa]];
  };
  const mass = c => c.stats.mass * (c.dead ? 5 : 1); // a burnt-out hulk sits heavy on its rims
  const inertia = c => (mass(c) * (CAR.len ** 2 + CAR.wid ** 2)) / 12;
  function hurt(c, dmg, by) {
    if (s.status !== 'race' || c.done || c.dead || dmg <= 0) return;
    c.hp -= dmg;
    c.hitT = 0;
    if (by >= 0 && by !== c.i) { M[c.i].by = by; M[c.i].byT = s.raceT; }
  }
  function collideCars() {
    const C = s.cars;
    for (let i = 0; i < C.length; i++) for (let j = i + 1; j < C.length; j++) {
      const A = C[i], B = C[j];
      if ((A.x - B.x) ** 2 + (A.y - B.y) ** 2 > 30) continue;
      // the deepest of the four disc pairs
      let best = null;
      for (const p of discs(A)) for (const q of discs(B)) {
        const dx = p[0] - q[0], dy = p[1] - q[1], dist = Math.hypot(dx, dy), pen = CAR.disc * 2 - dist;
        if (pen > 0 && (!best || pen > best.pen)) best = { pen, nx: dist ? dx / dist : 1, ny: dist ? dy / dist : 0, x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2 };
      }
      if (!best) continue;
      const { nx, ny, pen, x, y } = best, mA = mass(A), mB = mass(B), iA = 1 / mA, iB = 1 / mB;
      // push apart by inverse mass
      const corr = pen / (iA + iB);
      A.x += nx * corr * iA; A.y += ny * corr * iA; B.x -= nx * corr * iB; B.y -= ny * corr * iB;
      // the impulse at the contact point, spinning both by its lever
      const rAx = x - A.x, rAy = y - A.y, rBx = x - B.x, rBy = y - B.y;
      const vAx = A.vx - A.w * rAy, vAy = A.vy + A.w * rAx, vBx = B.vx - B.w * rBy, vBy = B.vy + B.w * rBx;
      const vrel = (vAx - vBx) * nx + (vAy - vBy) * ny;
      if (vrel >= 0) continue;
      const cA = rAx * ny - rAy * nx, cB = rBx * ny - rBy * nx;
      const imp = (-(1 + P.bumpE) * vrel) / (iA + iB + (cA * cA) / inertia(A) + (cB * cB) / inertia(B));
      A.vx += nx * imp * iA; A.vy += ny * imp * iA; A.w += (cA * imp) / inertia(A);
      B.vx -= nx * imp * iB; B.vy -= ny * imp * iB; B.w -= (cB * imp) / inertia(B);
      const rel = -vrel;
      // damage traded: each takes the relative speed over the free part × the other's ram, by mass
      if (rel > P.bumpFree) {
        const base = (rel - P.bumpFree) * P.bumpDmg;
        hurt(B, (base * A.stats.ram * 2 * mA) / (mA + mB), A.dead ? -1 : A.i);
        hurt(A, (base * B.stats.ram * 2 * mB) / (mA + mB), B.dead ? -1 : B.i);
      }
      const cd = M[i].bumpCd;
      if (rel > 1.5 && !(cd[j] > s.t)) { cd[j] = s.t + 0.25; emit('bump', { a: i, b: j, x, y, force: rel }); }
    }
  }
  // a hard surface along normal (nx, ny) pointing back into the road: bounce, rub, turn along it
  function bounce(c, nx, ny, x, y) {
    const vn = -(c.vx * nx + c.vy * ny);
    if (vn <= 0) return;
    const jn = (1 + P.wallE) * vn;
    c.vx += nx * jn; c.vy += ny * jn;
    const tx = -ny, ty = nx, vt = c.vx * tx + c.vy * ty, dvt = Math.min(Math.abs(vt), P.wallMu * jn);
    c.vx -= tx * sign(vt) * dvt; c.vy -= ty * sign(vt) * dvt;
    // a glance swings the nose along the wall, the way the car is going
    if (!c.dead) {
      const along = Math.atan2(ty * sign(vt), tx * sign(vt)), diff = wrapA(along - c.a);
      if (Math.abs(diff) < Math.PI / 2) c.w += clamp(diff, -1, 1) * Math.min(3, vn * 0.5);
    }
    if (vn > P.wallFree) hurt(c, (vn - P.wallFree) * P.wallDmg, -1);
    if (vn > 2 && M[c.i].wallCd <= 0) { M[c.i].wallCd = 0.2; emit('wall', { car: c.i, x, y, force: vn }); }
  }
  function walls(c) {
    const q = geo.nearest(c.x, c.y, c.d), i = q.i, nx = -geo.tys[i], ny = geo.txs[i];
    const ca = Math.cos(c.a), sa = Math.sin(c.a);
    // how far the body reaches across the road, as it's turned
    const ext = (CAR.len / 2) * Math.abs(ca * nx + sa * ny) + (CAR.wid / 2) * Math.abs(-sa * nx + ca * ny);
    const lim = geo.ws[i] / 2 - ext;
    if (Math.abs(q.off) > lim) {
      const sg = sign(q.off), pen = Math.abs(q.off) - lim;
      c.x -= nx * sg * pen; c.y -= ny * sg * pen;
      const ex = geo.xs[i] + nx * sg * geo.ws[i] / 2, ey = geo.ys[i] + ny * sg * geo.ws[i] / 2;
      bounce(c, -nx * sg, -ny * sg, ex, ey);
    }
  }
  function collideProps(c) {
    for (const p of solids) {
      if ((p.x - c.x) ** 2 + (p.y - c.y) ** 2 > (p.r + 3.5) ** 2) continue;
      for (const [x, y] of discs(c)) {
        const dx = x - p.x, dy = y - p.y, dist = Math.hypot(dx, dy), pen = p.r + CAR.disc - dist;
        if (pen <= 0) continue;
        const nx = dist ? dx / dist : 1, ny = dist ? dy / dist : 0;
        c.x += nx * pen; c.y += ny * pen;
        bounce(c, nx, ny, p.x + nx * p.r, p.y + ny * p.r);
      }
    }
  }

  // ---------- laps ----------
  function progress(c) {
    const q = geo.nearest(c.x, c.y, c.d);
    let dd = q.d - c.d;
    if (dd > len / 2) dd -= len; else if (dd < -len / 2) dd += len;
    c.prog += dd; c.d = q.d; c.off = q.off;
    c.surface = SURFACES[geo.surf[q.i]];
    // a lap is the line crossed going forward with a whole lap behind: total distance, so
    // reversing over the line and back never counts twice
    if (c.dead || c.done || s.status !== 'race') return;
    while (c.prog >= (c.lap + 1) * len) {
      c.lap++;
      if (c.lap >= s.laps) {
        c.done = true; c.finishT = s.raceT; c.place = ++finished;
        if (s.finishT == null) s.finishT = s.raceT;
        emit('finish', { car: c.i, place: c.place });
        break;
      }
      emit('lap', { car: c.i, lap: c.lap });
      if (c.lap === s.laps - 1) emit('last', { car: c.i });
    }
  }

  // ---------- weapons ----------
  function shoot(c) {
    c.ammo--;
    const a = c.a + (rand(s) - 0.5) * P.spread, ca = Math.cos(c.a), sa = Math.sin(c.a);
    const x = c.x + ca * (CAR.len / 2 + 0.3), y = c.y + sa * (CAR.len / 2 + 0.3);
    s.shots.push({ x, y, vx: c.vx + Math.cos(a) * P.bullet, vy: c.vy + Math.sin(a) * P.bullet, owner: c.i, t: 0, d: c.d });
    emit('shot', { car: c.i, x, y, a });
  }
  function shots() {
    s.shots = s.shots.filter(b => {
      b.t += DT;
      const x0 = b.x, y0 = b.y, x1 = b.x + b.vx * DT, y1 = b.y + b.vy * DT;
      b.x = x1; b.y = y1;
      // cars along the segment flown this step (the nearest along it wins)
      let hit = null, ht = 2;
      const ex = x1 - x0, ey = y1 - y0, l2 = ex * ex + ey * ey || 1;
      for (const c of s.cars) {
        if (c.i === b.owner) continue;
        for (const [px, py] of discs(c)) {
          const f = clamp(((px - x0) * ex + (py - y0) * ey) / l2, 0, 1);
          if ((x0 + ex * f - px) ** 2 + (y0 + ey * f - py) ** 2 < P.bulletR ** 2 && f < ht) { ht = f; hit = c; }
        }
      }
      if (hit) {
        const x = x0 + ex * ht, y = y0 + ey * ht;
        if (hit.dead || hit.done) { emit('spark', { x, y }); return false; }
        const dmg = s.cars[b.owner].stats.gun;
        hurt(hit, dmg, b.owner);
        hit.vx += (b.vx - hit.vx) * 0.004; hit.vy += (b.vy - hit.vy) * 0.004;
        emit('hit', { car: hit.i, by: b.owner, x, y, dmg });
        return false;
      }
      for (const p of solids) {
        if ((p.x - x1) ** 2 + (p.y - y1) ** 2 < p.r * p.r) { emit('spark', { x: x1, y: y1 }); return false; }
      }
      const q = geo.nearest(x1, y1, b.d);
      b.d = q.d;
      if (Math.abs(q.off) > geo.ws[q.i] / 2) {
        const sg = sign(q.off), e = geo.ws[q.i] / 2;
        emit('spark', { x: geo.xs[q.i] - geo.tys[q.i] * sg * e, y: geo.ys[q.i] + geo.txs[q.i] * sg * e });
        return false;
      }
      return b.t < P.bulletLife;
    });
  }
  function dropMine(c) {
    c.mines--;
    const x = c.x - Math.cos(c.a) * P.mineBack, y = c.y - Math.sin(c.a) * P.mineBack;
    s.mines.push({ x, y, owner: c.i, t: 0, armed: false });
    if (s.mines.length > P.mineCap) s.mines.shift();
    emit('drop', { car: c.i, x, y });
  }
  function mines() {
    s.mines = s.mines.filter(mn => {
      mn.t += DT;
      mn.armed = mn.t >= P.mineArm;
      if (!mn.armed) return true;
      for (const c of s.cars) {
        if (c.dead || c.done) continue;
        if (!discs(c).some(([x, y]) => (x - mn.x) ** 2 + (y - mn.y) ** 2 < (P.mineR + CAR.disc) ** 2)) continue;
        // it blows: heavy damage, the car thrown and spun
        hurt(c, P.mineDmg, mn.owner);
        if (mn.owner !== c.i) { M[c.i].by = mn.owner; M[c.i].byT = s.raceT; }
        emit('hit', { car: c.i, by: mn.owner, x: mn.x, y: mn.y, dmg: P.mineDmg });
        emit('boom', { x: mn.x, y: mn.y, car: c.i });
        c.spin = 0.9;
        M[c.i].spinW = (rand(s) < 0.5 ? -1 : 1) * (6 + rand(s) * 3);
        const k = rand(s) * Math.PI * 2;
        c.vx = c.vx * 0.45 + Math.cos(k) * 3; c.vy = c.vy * 0.45 + Math.sin(k) * 3;
        return false;
      }
      return true;
    });
  }

  // ---------- pickups ----------
  function pickups() {
    s.pickups.forEach((p, k) => {
      p.t += DT;
      if (!p.on) {
        // back after a while, once nobody is sitting on the spot
        if (p.t >= backs[k] && s.cars.every(c => (c.x - p.x) ** 2 + (c.y - p.y) ** 2 > 36)) { p.on = true; p.t = 0; p.kind = pick(s, PICKUPS); }
        return;
      }
      if (s.status !== 'race') return;
      const c = s.cars.find(c => !c.dead && !c.done && (c.x - p.x) ** 2 + (c.y - p.y) ** 2 < P.pickR ** 2);
      if (!c) return;
      let amount = 0;
      if (p.kind === 'cash') { amount = 50 * (1 + Math.floor(rand(s) * 4)); c.cash += amount; }
      else if (p.kind === 'ammo') { amount = 20; c.ammo += amount; }
      else if (p.kind === 'repair') { amount = Math.min(Math.round(c.maxHp * 0.25), Math.ceil(c.maxHp - c.hp)); c.hp = Math.min(c.maxHp, c.hp + amount); }
      else { amount = 1; c.turbo += 1; }
      emit('pickup', { car: c.i, kind: p.kind, x: p.x, y: p.y, amount });
      p.on = false; p.t = 0;
      backs[k] = P.respawn[0] + rand(s) * P.respawn[1];
    });
  }

  // ---------- armour, wrecks ----------
  function health(c) {
    const m = M[c.i];
    if (c.dead) return;
    if (c.hp <= 0) {
      c.hp = 0; c.dead = true; c.deadT = 0; m.deadN = ++deadN; c.boost = 0; c.spin = 0;
      const by = m.by >= 0 && s.raceT - m.byT < 5 ? m.by : -1;
      if (by >= 0) s.cars[by].kills++;
      emit('wreck', { car: c.i, by, x: c.x, y: c.y });
      emit('boom', { x: c.x, y: c.y, car: c.i });
      return;
    }
    const low = c.hp < c.maxHp * 0.25;
    if (low && !m.low) emit('low', { car: c.i });
    m.low = low;
  }

  // ---------- positions, the end ----------
  function order() {
    const key = c => (c.done ? 1e9 - c.place * 1e6 : c.dead ? -1e9 + M[c.i].deadN : c.prog);
    s.order = s.cars.map(c => c.i).sort((a, b) => key(s.cars[b]) - key(s.cars[a]) || a - b);
    s.order.forEach((i, k) => { if (!s.cars[i].done) s.cars[i].place = k + 1; });
    s.leader = s.order[0];
  }
  function resolve() {
    const me = s.cars[0], all = s.cars.every(c => c.done || c.dead);
    if ((me.done || me.dead) && s.resolveT == null) s.resolveT = P.resolve;
    if (s.resolveT != null) s.resolveT -= DT;
    if (!all && !(s.resolveT != null && s.resolveT <= 0) && s.raceT < P.cap) return;
    // the rest are placed where they run; wrecks last, the latest wrecked ahead of the earlier
    for (const i of s.order) { const c = s.cars[i]; if (!c.done) c.place = ++finished; }
    s.status = 'done';
    s.resolveT = 0;
    emit('done');
  }
  function result() {
    return [...s.cars].sort((a, b) => a.place - b.place).map(c => ({
      id: c.id, place: c.place, finished: c.done, wrecked: c.dead, time: c.finishT, kills: c.kills, cash: c.cash,
      hp: Math.max(0, Math.ceil(c.hp)), ammo: c.ammo, mines: c.mines, turbo: c.turbo,
    }));
  }

  return race;
}
