// The simulation: the player's jet, the Pact's fighters, bombers, ships, trucks, flak and SAM
// batteries, every bullet, missile, rocket, bomb and decoy, and the mission's objective. Pure
// and deterministic: fixed 1/60 s steps, its own seeded random numbers, no DOM. The renderer,
// the sound and the HUD read its state and the `events` each step leaves.
//
//   const sim = createSim({ seed });
//   sim.load(missionIndex);          // spawn the sortie
//   sim.step(ctrl);                  // ctrl: { pitch, roll, yaw (−1..1), thr (−1..1) or throttle
//                                    //   (0..1.2), gun (held), fire, weapon, target, decoy (edges),
//                                    //   targetId (the autopilot picks directly) }
//   sim.status                       // 'fly' | 'down' | 'failed' | 'landed'; sim.complete once won
//
// The jet flies an arcade model: its velocity is always along the nose; roll banks it, the bank
// turns it on its own (coordinated), the stick pitches it; thrust, drag and gravity along the
// path set the speed; under ~120 kt it stalls and the nose drops. Enemy aircraft steer
// kinematically (a turn-rate limited chase of a desired direction) and bank to match.
import { MISSIONS } from './missions.js';
import { THEATRES } from './theatres.js';
import { HALF, createWorld, polyAt, polyDist, polyLen } from './world.js';

export const DT = 1 / 60;
export const G = 9.81;
export const STALL = 62;
export const WEAPONS = ['ir', 'radar', 'rockets', 'bombs'];
export const WEAPON_NAME = { ir: 'IR MSL', radar: 'RDR MSL', rockets: 'ROCKETS', bombs: 'BOMBS' };
export const IR_CONE = 0.21, IR_RANGE = 3600, RADAR_CONE = 0.85, RADAR_RANGE = 11000, GUN_RANGE = 1300;
export const BULLET_V = 1000, ROCKET_V = 450;
const GUN_RATE = 1 / 16;
const COMPLETE_BONUS = 2000, LAND_BONUS = 1500;

// air: hp, hit radius, cruise speed, turn rate (rad/s), score; ground: hp, radius, half-length
export const KINDS = {
  player: { air: true, hp: 100, r: 10, label: 'SERAPH' },
  fighter: { air: true, hp: 30, r: 12, speed: 235, top: 320, turn: 0.5, score: 500, gun: true, ir: 2, label: 'SCYTHE' },
  ace: { air: true, hp: 50, r: 12, speed: 270, top: 345, turn: 0.68, score: 1200, gun: true, ir: 4, label: 'BLACK SCYTHE' },
  bomber: { air: true, hp: 70, r: 22, speed: 135, top: 170, turn: 0.16, score: 600, label: 'DROMON' },
  courier: { air: true, hp: 200, r: 18, speed: 140, top: 150, turn: 0.22, score: 0, label: 'COURIER', team: 'blue' },
  radar: { hp: 60, r: 24, score: 400, label: 'RADAR' },
  aa: { hp: 30, r: 13, score: 250, flak: true, label: 'FLAK' },
  sam: { hp: 40, r: 16, score: 400, sam: true, label: 'SAM' },
  depot: { hp: 60, r: 22, score: 300, label: 'FUEL' },
  hangar: { hp: 100, r: 28, hl: 20, score: 300, label: 'HANGAR' },
  bridge: { hp: 420, r: 16, hl: 200, score: 1500, label: 'BRIDGE' },
  tender: { hp: 260, r: 20, hl: 48, score: 900, flak: true, ship: true, speed: 9, label: 'TENDER' },
  gunboat: { hp: 110, r: 12, hl: 22, score: 450, flak: true, ship: true, speed: 9, label: 'GUNBOAT' },
  truck: { hp: 30, r: 9, hl: 5, score: 200, mover: true, speed: 20, label: 'TRUCK' },
  flaktruck: { hp: 40, r: 9, hl: 5, score: 300, mover: true, speed: 20, flak: true, label: 'FLAK' },
  factory: { hp: 140, r: 36, hl: 30, score: 500, label: 'FOUNDRY' },
  bunker: { hp: 600, r: 34, score: 3000, label: 'BUNKER' },
};
// how sharp the Pact pilots and gunners are, per theatre
const SKILL = [0.55, 0.78, 1];

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- vectors: plain [x, y, z] ----------
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** v rotated by angle a about the unit axis k (Rodrigues) */
export function rot(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), d = dot(k, v) * (1 - c), x = cross(k, v);
  return [v[0] * c + x[0] * s + k[0] * d, v[1] * c + x[1] * s + k[1] * d, v[2] * c + x[2] * s + k[2] * d];
}
const UP = [0, 1, 0];
export const headingOf = f => Math.atan2(f[0], -f[2]);
export const dirOf = (hdg, pitch = 0) => [Math.sin(hdg) * Math.cos(pitch), Math.sin(pitch), -Math.cos(hdg) * Math.cos(pitch)];
/** bank angle of a basis: + is the right wing down */
export const bankOf = (f, u) => { const r = cross(f, u); return Math.atan2(-r[1], u[1]); };
/** the up vector of an aircraft flying f, banked by b */
export function upOf(f, b) {
  let u = sub(UP, mul(f, f[1]));
  if (len(u) < 1e-3) u = [0, 0, 1];
  return rot(norm(u), f, b);
}
// shortest distance from p to the segment a–b
function segDist(p, a, b) {
  const ab = sub(b, a), t = clamp(dot(sub(p, a), ab) / (dot(ab, ab) || 1), 0, 1);
  return dist(p, add(a, mul(ab, t)));
}
// distance from a point to an actor's hit shape (a sphere, or a capsule along its heading)
function shapeDist(p, a) {
  const K = KINDS[a.kind];
  if (!K.hl) return dist(p, a.pos);
  const ax = mul(a.f, K.hl);
  return segDist(p, sub(a.pos, ax), add(a.pos, ax));
}
// distance from a moving point's step (p0 → p1) to an actor's shape
function stepDist(p0, p1, a) {
  const K = KINDS[a.kind];
  if (!K.hl) return segDist(a.pos, p0, p1);
  // capsule against segment: sample the step (short steps make this exact enough)
  let best = Infinity;
  for (let k = 0; k <= 4; k++) best = Math.min(best, shapeDist(add(p0, mul(sub(p1, p0), k / 4)), a));
  return best;
}

export function createSim({ seed = 1 } = {}) {
  let rnd = mulberry32(seed);
  const rr = (a, b) => a + (b - a) * rnd();
  let uid = 1;
  const S = {
    events: [], t: 0, mi: 0, mission: null, theatre: 0, T: null, world: null, skill: 0.5,
    player: null, actors: [], bullets: [], missiles: [], ordnance: [], flak: [], decoys: [],
    status: 'fly', statusT: 0, complete: false, completeT: 0, reason: '', score: 0,
    kills: {}, shots: 0, hits: 0, wave: 0, waveT: -1, killsTotal: 0, landedHome: false,
    lockState: 'off', threat: null, spiked: false, outside: false,
    load, step, reseed, objectives, targets, actorById: id => S.actors.find(a => a.id === id) ?? null,
  };
  const emit = (type, e = {}) => S.events.push({ type, ...e });
  const msg = text => emit('msg', { text });
  function reseed(s) { rnd = mulberry32(s); }

  // ---------- spawning ----------
  function lanePts(name) {
    if (name === 'road') return S.T.road;
    if (name === 'river') return S.T.river;
    return S.T.lanes[name];
  }
  function makeActor(kind, pos, f, extra = {}) {
    const K = KINDS[kind];
    const a = {
      id: uid++, kind, team: K.team ?? 'red', air: !!K.air, pos, f, u: UP, speed: K.speed ?? 0, bank: 0,
      hp: K.hp, alive: true, dying: false, deadT: 0, obj: false, wave: 0, ...extra,
    };
    if (a.air) a.u = upOf(f, 0);
    S.actors.push(a);
    return a;
  }
  function spawn(spec) {
    const W = S.world, n = spec.n ?? 1, gap = spec.gap ?? 300;
    for (let k = 0; k < n; k++) {
      let x, z, f, lane = null, s = 0;
      if (spec.lane) {
        lane = lanePts(spec.lane);
        s = Math.max(0, (spec.s ?? 0) - k * gap);
        const p = polyAt(lane, s);
        x = p.x; z = p.z; f = [p.dx, 0, p.dz];
      } else {
        const at = typeof spec.at === 'string' ? W.site(spec.at) : { x: spec.at[0], z: spec.at[1] };
        const hdg = ((spec.hdg ?? 0) * Math.PI) / 180;
        f = dirOf(hdg);
        const right = [-f[2], 0, f[0]];
        x = at.x + (spec.off?.[0] ?? 0) + right[0] * k * gap - f[0] * k * gap * 0.4;
        z = at.z + (spec.off?.[1] ?? 0) + right[2] * k * gap - f[2] * k * gap * 0.4;
      }
      const K = KINDS[spec.kind], ground = W.heightAt(x, z);
      let y;
      if (K.air) y = Math.max(spec.alt ?? 2000, ground + 300);
      else if (K.ship) y = W.water;
      else y = ground;
      const a = makeActor(spec.kind, [x, y, z], f, {
        obj: !!spec.obj, wave: spec.wave ?? 0, ai: spec.ai ?? 'patrol', lane, s, anchor: [x, y, z],
        orbit: rnd() < 0.5 ? 1 : -1, wp: 1, gunCd: 0, burst: 0, msl: K.ir ?? 0, mslCd: rr(4, 9), retarget: 0,
        tgt: null, jink: 0, jinkDir: 1, flares: 6, aaCd: rr(0.5, 2.5), aaShots: 0, lockT: 0, samCd: rr(2, 5), samAmmo: 4,
        arrived: false,
      });
      if (spec.kind === 'bridge') {
        // across the river, its deck level with the higher rim
        const R = polyDist(S.T.river, x, z), p = polyAt(S.T.river, R.along), ac = [-p.dz, 0, p.dx];
        a.f = ac;
        const rims = [-260, 260].map(o => W.heightAt(x + ac[0] * o, z + ac[2] * o));
        a.pos[1] = Math.max(...rims) - 4;
      }
      if (a.air && lane) a.wp = 1 + Math.max(0, polyDist(lane, x, z).seg);
    }
  }

  function load(mi, { carry = null } = {}) {
    const M = MISSIONS[mi];
    S.mi = mi; S.mission = M; S.theatre = M.theatre; S.T = THEATRES[M.theatre]; S.world = createWorld(M.theatre);
    S.skill = SKILL[M.theatre];
    S.t = 0; S.actors = []; S.bullets = []; S.missiles = []; S.ordnance = []; S.flak = []; S.decoys = [];
    S.status = 'fly'; S.statusT = 0; S.complete = false; S.completeT = 0; S.reason = ''; S.score = 0;
    S.kills = {}; S.shots = 0; S.hits = 0; S.wave = 0; S.waveT = -1; S.killsTotal = 0; S.landedHome = false;
    S.events.length = 0; S.lockState = 'off'; S.threat = null; S.spiked = false; S.outside = false;
    uid = 1;
    const st = M.start ?? S.T.start, f = dirOf((st.heading * Math.PI) / 180);
    const P = makeActor('player', [st.x, st.y, st.z], f, {
      team: 'blue', speed: 250, throttle: 0.85, fuel: 100, gun: 600, stores: { ...M.load }, sel: 0, decoys: 24,
      target: null, irTrack: null, irT: 0, irLock: null, radarT: 0, radarLock: null, gunCd: 0, rocketSide: 1,
      ground: false, stalled: false, lowFuel: false, hits: 0, carry,
    });
    P.u = upOf(f, 0);
    P.vel = mul(f, P.speed);
    S.player = P;
    P.sel = Math.max(0, WEAPONS.findIndex(w => P.stores[w] > 0));
    for (const spec of M.units) if ((spec.wave ?? 0) === 0) spawn(spec);
    emit('start');
    msg(M.text);
  }

  // ---------- damage ----------
  function hurt(a, dmg, byPlayer, kind = '') {
    if (!a.alive) return;
    a.hp -= dmg;
    if (a === S.player) {
      emit('damage', { amount: Math.min(1, dmg / 60), src: kind });
      if (a.hp <= 0) down('Shot down');
      return;
    }
    if (byPlayer) { S.hits++; emit('hit', { kind: a.kind, weapon: kind }); }
    if (a.hp > 0) return;
    a.alive = false; a.deadT = 0; a.dying = a.air;
    const K = KINDS[a.kind];
    emit('boom', { x: a.pos[0], y: a.pos[1], z: a.pos[2], big: !a.air || a.kind === 'bomber', air: a.air, kind: a.kind });
    if (a.team === 'red') {
      if (byPlayer) {
        S.score += K.score; S.kills[a.kind] = (S.kills[a.kind] ?? 0) + 1; S.killsTotal++;
        emit('kill', { id: a.id, kind: a.kind, label: K.label, score: K.score });
      }
      if (a.obj) emit('objective', { kind: a.kind });
    } else if (a.kind === 'courier') msg('The courier is going down!');
  }
  function down(reason) {
    if (S.status !== 'fly') return;
    const P = S.player;
    P.alive = false; P.hp = Math.min(P.hp, 0);
    S.status = 'down'; S.statusT = 0; S.reason = reason;
    if (reason === 'Shot down') emit('boom', { x: P.pos[0], y: P.pos[1], z: P.pos[2], big: true, air: true, kind: 'player' });
  }
  function fail(reason) {
    if (S.status !== 'fly' || S.complete) return;
    S.status = 'failed'; S.statusT = 0; S.reason = reason;
    emit('fail', { reason });
    msg(reason);
  }
  function splash(p, R, dmg, byPlayer, team, kind) {
    for (const a of S.actors) {
      if (!a.alive || a.team === team) continue;
      const d = shapeDist(p, a) - KINDS[a.kind].r;
      if (d < R) hurt(a, dmg * (1 - 0.65 * Math.max(0, d) / R), byPlayer, kind);
    }
  }

  // ---------- the player's jet ----------
  function onRunway(x, z) {
    for (const s of Object.values(S.world.sites)) {
      const R = s.runway;
      if (!R) continue;
      const c = Math.cos(R.dir), sn = Math.sin(R.dir), dx = x - R.x, dz = z - R.z;
      const along = dx * sn - dz * c, across = dx * c + dz * sn;
      if (Math.abs(along) < R.len / 2 && Math.abs(across) < R.wid / 2 + 6) return s;
    }
    return null;
  }
  function flyPlayer(c) {
    const P = S.player, W = S.world, dt = DT;
    if (c.throttle != null) P.throttle = clamp(c.throttle, 0, 1.2);
    else P.throttle = clamp(P.throttle + (c.thr ?? 0) * 0.65 * dt, 0, 1.2);
    const fuel = P.fuel > 0, burner = fuel && P.throttle > 1.0001;
    const q = clamp((P.speed - 45) / 110, 0.12, 1);
    let f = P.f, u = P.u;
    const r0 = cross(f, u);
    const pitch = clamp(c.pitch ?? 0, -1, 1), roll = clamp(c.roll ?? 0, -1, 1), yaw = clamp(c.yaw ?? 0, -1, 1);
    if (!P.ground) {
      // roll about the nose, pitch about the wing, yaw about the lift line
      const ra = roll * 2.5 * (0.45 + 0.55 * q) * dt;
      u = rot(u, f, ra);
      const r = cross(f, u), pa = pitch * 0.64 * q * dt;
      f = rot(f, r, pa); u = rot(u, r, pa);
      const ya = -yaw * 0.24 * q * dt;
      f = rot(f, u, ya);
      // coordinated: the bank turns the jet about the vertical
      const ta = 0.42 * q * r0[1] * dt;
      f = rot(f, UP, ta); u = rot(u, UP, ta);
      // a stall drops the nose toward the ground
      P.stalled = P.speed < STALL && f[1] > -0.9;
      if (P.stalled) {
        const ax = cross(f, [0, -1, 0]);
        if (len(ax) > 1e-3) { const k = norm(ax), a = (1 - P.speed / STALL) * 1.3 * dt + 0.15 * dt; f = rot(f, k, a); u = rot(u, k, a); }
      }
    } else {
      // rolling on the runway: nosewheel steering, wings level, the nose comes up past 160 kt
      const steer = (roll + yaw) * 0.35 * Math.min(1, P.speed / 30) * dt;
      f = rot(f, UP, -steer);
      const rr2 = norm(cross(f, UP)), pa = pitch > 0 && P.speed > 82 ? pitch * 0.4 * dt : 0;
      f = norm([f[0], Math.max(0, f[1]) , f[2]]);
      f = rot(f, rr2, pa);
      u = norm(cross(rr2, f));
    }
    f = norm(f);
    const r = norm(cross(f, u));
    u = cross(r, f);
    // out of the area: turned back toward the middle
    const out = Math.max(Math.abs(P.pos[0]), Math.abs(P.pos[2])) > HALF - 900;
    if (out && !P.ground) {
      const want = Math.atan2(-P.pos[0], P.pos[2]), e = Math.atan2(Math.sin(want - headingOf(f)), Math.cos(want - headingOf(f)));
      const ta = -Math.sign(e) * 0.5 * dt;
      f = rot(f, UP, ta); u = rot(u, UP, ta);
      if (!S.outside) msg('Leaving the area: turning back');
    }
    S.outside = out;
    P.f = f; P.u = u;
    // speed: thrust, drag, gravity along the path
    let thrust = !fuel ? 0 : P.throttle <= 1 ? 4 + 30 * P.throttle : 34 + ((P.throttle - 1) / 0.2) * 24;
    if (P.pos[1] > 12000) thrust *= 0.3;
    const drag = 3.7e-4 * (P.throttle < 0.04 ? 2.6 : 1) * (P.ground ? 1.4 : 1);
    let acc = thrust - drag * P.speed * P.speed - G * f[1];
    if (P.ground && P.throttle < 0.3) acc -= 7;
    P.speed = Math.max(0, P.speed + acc * dt);
    const v = mul(f, P.speed);
    if (!P.ground) v[1] -= Math.max(0, STALL + 25 - P.speed) * 0.3;
    P.vel = v;
    P.pos = add(P.pos, mul(v, dt));
    // fuel, %/s
    if (fuel) P.fuel = Math.max(0, P.fuel - (0.015 + 0.105 * Math.min(1, P.throttle) ** 1.5 + (burner ? 0.42 : 0)) * dt);
    if (!P.lowFuel && P.fuel < 20) { P.lowFuel = true; emit('lowfuel'); msg('Fuel low'); }
    if (P.stalled && !P.wasStalled) emit('stall');
    P.wasStalled = P.stalled;
    P.burner = burner;
    // the ground
    const gy = W.heightAt(P.pos[0], P.pos[2]);
    if (P.pos[1] - gy < 2.2) {
      const rw = onRunway(P.pos[0], P.pos[2]), vy = v[1];
      if (rw && (P.ground || (P.speed < 135 && vy > -9 && Math.abs(bankOf(f, u)) < 0.35 && f[1] > -0.15))) {
        if (!P.ground) { emit('land', { home: rw === W.site('home') }); msg(rw === W.site('home') ? 'Touchdown' : 'Touchdown on a hostile strip'); }
        P.ground = true; P.pos[1] = gy + 2.2; P.rw = rw;
      } else if (!rw && P.ground && P.speed < 40) {
        P.pos[1] = gy + 2.2; // rolled off the end, slowly
      } else {
        emit('crash', { x: P.pos[0], y: gy, z: P.pos[2], wet: W.wet(P.pos[0], P.pos[2]) });
        emit('boom', { x: P.pos[0], y: gy + 4, z: P.pos[2], big: true, air: false, kind: 'player' });
        if (W.wet(P.pos[0], P.pos[2])) emit('splash', { x: P.pos[0], y: W.water, z: P.pos[2], big: true });
        down(W.wet(P.pos[0], P.pos[2]) ? 'Crashed into the sea' : 'Crashed');
        return;
      }
    } else P.ground = false;
    if (P.ground && P.speed < 2.5 && S.complete && P.rw === W.site('home') && S.status === 'fly') {
      S.landedHome = true; S.status = 'landed'; S.statusT = 0; S.score += LAND_BONUS;
      msg('Landed at ' + W.site('home').label);
    }
  }

  // ---------- targeting ----------
  function targets() {
    const P = S.player;
    return S.actors.filter(a => a.alive && a.team === 'red' && dist(a.pos, P.pos) < 16000);
  }
  function rankTarget(a) {
    const P = S.player, d = sub(a.pos, P.pos), L = len(d), ang = Math.acos(clamp(dot(P.f, mul(d, 1 / (L || 1))), -1, 1));
    return L * (0.6 + ang) * (a.obj ? 0.7 : 1) * (a.air && L < 6000 ? 0.6 : 1);
  }
  function pickTarget(next) {
    const P = S.player, list = targets().sort((a, b) => rankTarget(a) - rankTarget(b));
    if (!list.length) { P.target = null; return; }
    if (!next || !P.target) { P.target = list[0]; return; }
    const i = list.indexOf(P.target);
    P.target = list[(i + 1) % list.length];
  }
  function angleTo(from, f, p) {
    const d = sub(p, from), L = len(d);
    return { L, ang: Math.acos(clamp(dot(f, mul(d, 1 / (L || 1))), -1, 1)) };
  }
  function sensors() {
    const P = S.player, w = WEAPONS[P.sel];
    if (P.target && !P.target.alive) P.target = null;
    if (!P.target && Math.floor(S.t * 2) !== Math.floor((S.t - DT) * 2)) pickTarget(false);
    // the heat-seeker's cone
    let cand = null, best = IR_CONE;
    if (w === 'ir' && P.stores.ir > 0) {
      for (const a of S.actors) {
        if (!a.alive || !a.air || a.team !== 'red') continue;
        const { L, ang } = angleTo(P.pos, P.f, a.pos);
        if (L < IR_RANGE && L > 150 && ang < best + (a === P.target ? 0.05 : 0)) { best = ang; cand = a; }
      }
    }
    if (cand && cand === P.irTrack) P.irT += DT;
    else { P.irTrack = cand; P.irT = 0; }
    P.irLock = P.irTrack && P.irT > 0.45 ? P.irTrack : null;
    // the radar lock on the selected target
    const T = P.target;
    let rl = false;
    if (w === 'radar' && P.stores.radar > 0 && T?.air) {
      const { L, ang } = angleTo(P.pos, P.f, T.pos);
      rl = L < RADAR_RANGE && ang < RADAR_CONE;
    }
    P.radarT = rl ? P.radarT + DT : 0;
    P.radarLock = rl && P.radarT > 0.8 ? T : null;
    S.lockState = w === 'ir' && P.stores.ir > 0 ? (P.irLock ? 'lock' : 'seek') : w === 'radar' && rl ? (P.radarLock ? 'lock' : 'seek') : 'off';
  }

  // ---------- firing ----------
  function launch(kind, owner, tgt) {
    const spec = {
      ir: { max: 620, turn: 0.95, life: 8, burn: 3, fuse: 16 }, radar: { max: 720, turn: 0.7, life: 16, burn: 6, fuse: 20 },
      eir: { max: 540, turn: 0.42, life: 8, burn: 2.5, fuse: 11 }, sam: { max: 560, turn: 0.33, life: 18, burn: 5, fuse: 11 },
    }[kind];
    const up = owner.air ? owner.u : UP;
    const f = owner.air ? owner.f : norm(add(norm(sub(tgt.pos, owner.pos)), [0, 0.35, 0]));
    const m = {
      kind, team: owner.team, owner, tgt, pos: add(add(owner.pos, mul(up, owner.air ? -2 : 6)), mul(f, 6)), f,
      speed: owner.air ? owner.speed : 60, ...spec, t: 0, seen: new Set(), guided: !!tgt,
    };
    S.missiles.push(m);
    if (tgt === S.player) emit('launch', { kind, x: m.pos[0], y: m.pos[1], z: m.pos[2] });
    return m;
  }
  function fireStores(c) {
    const P = S.player, w = WEAPONS[P.sel];
    if (c.weapon) {
      for (let k = 1; k <= WEAPONS.length; k++) {
        const n = (P.sel + k) % WEAPONS.length;
        if (P.stores[WEAPONS[n]] > 0) { if (n !== P.sel) { P.sel = n; P.irT = 0; P.radarT = 0; } break; }
      }
      emit('weapon', { name: WEAPONS[P.sel] });
    }
    if (c.targetId != null) P.target = S.actors.find(a => a.id === c.targetId && a.alive) ?? P.target;
    if (c.target) { pickTarget(true); emit('target'); }
    if (c.decoy && P.decoys > 0) {
      P.decoys -= 2;
      for (const kind of ['flare', 'chaff']) {
        const d = { kind, team: 'blue', owner: P, pos: [...P.pos], vel: add(mul(P.vel, 0.6), mul(P.u, -18)), life: kind === 'flare' ? 3 : 4 };
        S.decoys.push(d);
        decoyCheck(P, d);
        emit(kind, { x: P.pos[0], y: P.pos[1], z: P.pos[2] });
      }
    }
    if (!c.fire || P.stores[w] <= 0) return;
    if (w === 'ir') {
      P.stores.ir--; S.shots++;
      launch('ir', P, P.irLock);
      emit('missile', { kind: 'ir' });
    } else if (w === 'radar') {
      if (!P.radarLock) { msg(P.target?.air ? 'No radar lock' : 'Radar missiles need an air target'); return; }
      P.stores.radar--; S.shots++;
      launch('radar', P, P.radarLock);
      emit('missile', { kind: 'radar' });
    } else if (w === 'rockets') {
      const n = Math.min(2, P.stores.rockets);
      for (let k = 0; k < n; k++) {
        P.rocketSide = -P.rocketSide;
        const r = cross(P.f, P.u);
        S.ordnance.push({ kind: 'rocket', team: 'blue', pos: add(add(P.pos, mul(r, 4 * P.rocketSide)), mul(P.u, -1.5)), vel: add(mul(P.f, P.speed + ROCKET_V), mul(r, rr(-3, 3))), life: 5 });
      }
      P.stores.rockets -= n; S.shots += n;
      emit('rocket');
    } else if (w === 'bombs') {
      P.stores.bombs--; S.shots++;
      S.ordnance.push({ kind: 'bomb', team: 'blue', pos: add(P.pos, mul(P.u, -2)), vel: [...P.vel], life: 40 });
      emit('bomb');
    }
  }
  function gun(owner, aimDir, spread, dmg) {
    const v = norm(add(aimDir, [rr(-spread, spread), rr(-spread, spread), rr(-spread, spread)]));
    S.bullets.push({ team: owner.team, owner, pos: add(owner.pos, mul(owner.f, 9)), vel: add(mul(v, BULLET_V), mul(owner.f, owner.speed)), life: 1.5, dmg });
  }

  // ---------- decoys ----------
  // each missile chasing the decoy's owner rolls once per decoy: fooled, or not
  function decoyCheck(owner, d) {
    for (const m of S.missiles) {
      if (m.tgt !== owner || m.seen.has(d)) continue;
      m.seen.add(d);
      const ir = m.kind === 'ir' || m.kind === 'eir';
      if (ir !== (d.kind === 'flare')) continue;
      const D = dist(m.pos, owner.pos), chance = (D < 3500 ? 0.7 : 0.45) * (owner === S.player ? 1 : 0.75);
      if (rnd() < chance) m.tgt = d;
    }
  }

  // ---------- enemy (and courier) aircraft ----------
  function steer(a, d, turn, dt) {
    const c = clamp(dot(a.f, d), -1, 1), ang = Math.acos(c);
    if (ang < 1e-4) return;
    let ax = cross(a.f, d);
    if (len(ax) < 1e-6) ax = a.u;
    a.f = norm(rot(a.f, norm(ax), Math.min(ang, turn * dt)));
  }
  function avoidGround(a, d) {
    const W = S.world;
    let need = 0;
    for (const k of [1.2, 2.5, 4]) {
      const p = add(a.pos, mul([a.f[0], 0, a.f[2]], a.speed * k));
      need = Math.max(need, W.heightAt(p[0], p[2]) + 260 - (a.pos[1] + d[1] * a.speed * k * 0.5));
    }
    const agl = a.pos[1] - W.heightAt(a.pos[0], a.pos[2]);
    if (agl < 180) need = Math.max(need, 400);
    if (need > 0) d = norm([d[0], Math.max(d[1], Math.min(0.8, need / 600)), d[2]]);
    if (a.pos[1] > 9000) d = norm([d[0], Math.min(d[1], -0.1), d[2]]);
    return d;
  }
  function pickFoe(a) {
    let best = null, bs = Infinity;
    for (const b of S.actors) {
      if (!b.alive || !b.air || b.team === a.team) continue;
      const s = dist(a.pos, b.pos) * (b.kind === 'courier' && a.ai === 'raid' ? 0.45 : 1);
      if (s < bs) { bs = s; best = b; }
    }
    return best;
  }
  function incoming(a) {
    let best = null, bd = 2200;
    for (const m of S.missiles) if (m.tgt === a) { const d = dist(m.pos, a.pos); if (d < bd) { bd = d; best = m; } }
    return best;
  }
  function flyAI(a, dt) {
    const K = KINDS[a.kind], P = S.player, W = S.world, sk = a.team === 'red' ? S.skill : 1;
    let d = a.f, speed = K.speed, attack = null;
    if (a.ai === 'route') {
      const pts = a.lane, wp = Math.min(a.wp, pts.length - 1), [wx, wz] = pts[wp];
      if (Math.hypot(wx - a.pos[0], wz - a.pos[2]) < 700) {
        if (wp >= pts.length - 1) a.arrived = true; else a.wp++;
      }
      d = norm([wx - a.pos[0], (a.anchor[1] - a.pos[1]) / 1500, wz - a.pos[2]]);
      if (a.kind === 'courier') {
        const m = incoming(a);
        if (m && dist(m.pos, a.pos) < 1400 && a.flares > 0 && rnd() < dt * 2) {
          a.flares--;
          const dc = { kind: 'flare', team: a.team, owner: a, pos: [...a.pos], vel: mul(a.f, a.speed * 0.5), life: 3 };
          S.decoys.push(dc); decoyCheck(a, dc);
        }
      }
    } else {
      a.retarget -= dt;
      if (a.retarget <= 0 || !a.tgt?.alive) { a.tgt = pickFoe(a); a.retarget = 1.5; }
      const T = a.tgt, D = T ? dist(T.pos, a.pos) : Infinity;
      const engage = T && (a.ai === 'hunt' || a.ai === 'raid' || (a.ai === 'patrol' && (D < 8000 || a.hp < K.hp)) || (a.ai === 'escort' && D < 6500));
      const m = incoming(a);
      if (m) {
        // break across the missile's path, and maybe a flare
        const away = norm(sub(a.pos, m.pos)), side = norm(cross(away, UP));
        d = norm(add(mul(side, a.jinkDir), [0, -0.15, 0]));
        speed = K.top;
        if (a.flares > 0 && rnd() < dt * 1.4 * sk) {
          a.flares--;
          const dc = { kind: 'flare', team: a.team, owner: a, pos: [...a.pos], vel: mul(a.f, a.speed * 0.5), life: 3 };
          S.decoys.push(dc); decoyCheck(a, dc);
        }
      } else if (engage) {
        const toT = sub(T.pos, a.pos), behind = dot(T.f, mul(toT, 1 / D)) > 0.55 && dot(a.f, mul(toT, 1 / D)) < -0.2;
        if (behind && D < 1700 && T === P) {
          // the player is on our tail: jink
          a.jink -= dt;
          if (a.jink <= 0) { a.jink = rr(1.5, 3); a.jinkDir = rnd() < 0.5 ? -1 : 1; }
          d = norm(add(mul(norm(cross(a.f, UP)), a.jinkDir), [0, rr(-0.2, 0.3), 0]));
          speed = K.top;
        } else {
          const lead = clamp(D / (BULLET_V + a.speed), 0, 1.6);
          const aim = add(T.pos, mul(T.vel ?? mul(T.f, T.speed), lead * (0.6 + 0.4 * sk)));
          d = norm(sub(aim, a.pos));
          speed = D > 2500 ? K.top : K.speed + 20;
          attack = { T, D, aim };
          if (D < 260 && dot(a.f, T.f) < 0) d = norm(add(d, mul(cross(a.f, UP), 0.8))); // head-on pass: veer off
        }
      } else if (a.ai === 'escort') {
        const lead = S.actors.find(b => b.alive && b.kind === 'bomber');
        if (lead) { const p = add(lead.pos, [0, 300, 0]); d = norm(add(sub(p, a.pos), mul(lead.f, 900))); speed = lead.speed + (dist(p, a.pos) > 600 ? 60 : 0); }
        else a.ai = 'hunt';
      } else {
        // patrol: an orbit round the anchor
        const rx = a.pos[0] - a.anchor[0], rz = a.pos[2] - a.anchor[2], R = Math.hypot(rx, rz) || 1;
        const tan = [(-rz / R) * a.orbit, 0, (rx / R) * a.orbit], radial = (2600 - R) / 2600;
        d = norm([tan[0] + (rx / R) * radial, (a.anchor[1] - a.pos[1]) / 1200, tan[2] + (rz / R) * radial]);
        speed = K.speed * 0.85;
      }
    }
    d = avoidGround(a, d);
    const f0 = a.f;
    steer(a, d, K.turn * (0.75 + 0.25 * sk), dt);
    a.speed += (speed - a.speed) * Math.min(1, dt * 0.5);
    // bank into the turn
    const yawRate = Math.atan2(cross(f0, a.f)[1], dot(f0, a.f)) / dt;
    const bank = clamp(Math.atan((-yawRate * a.speed) / G), -1.35, 1.35);
    a.bank += (bank - a.bank) * Math.min(1, dt * 3);
    a.u = upOf(a.f, a.bank);
    a.vel = mul(a.f, a.speed);
    a.pos = add(a.pos, mul(a.vel, dt));
    if (a.pos[1] < W.heightAt(a.pos[0], a.pos[2]) + 3) { a.hp = 0; a.alive = false; a.dying = false; emit('boom', { x: a.pos[0], y: a.pos[1], z: a.pos[2], big: true, air: false, kind: a.kind }); if (a.obj) emit('objective', { kind: a.kind }); return; }
    // weapons
    a.gunCd -= dt; a.mslCd -= dt;
    if (attack && K.gun) {
      const { T, D, aim } = attack, ang = Math.acos(clamp(dot(a.f, norm(sub(aim, a.pos))), -1, 1));
      if (D < 900 && ang < 0.04 && a.gunCd <= 0) {
        if (a.burst <= 0) a.burst = 8;
        gun(a, a.f, 0.018 + (1 - sk) * 0.014, 3);
        a.burst--; a.gunCd = a.burst > 0 ? 0.09 : rr(1, 2) / sk;
      }
      if (a.msl > 0 && a.mslCd <= 0 && D > 900 && D < 3200 && ang < 0.22) {
        a.msl--; a.mslCd = rr(7, 12) / sk;
        launch('eir', a, T);
      }
    }
  }

  // ---------- ground units ----------
  function groundUnit(a, dt) {
    const K = KINDS[a.kind], P = S.player, W = S.world;
    if (a.lane && (K.ship || K.mover)) {
      const L = polyLen(a.lane);
      if (a.s < L) {
        a.s = Math.min(L, a.s + K.speed * dt);
        const p = polyAt(a.lane, a.s);
        a.pos = [p.x, K.ship ? W.water : W.heightAt(p.x, p.z), p.z];
        a.f = [p.dx, 0, p.dz];
        a.vel = mul(a.f, K.speed);
        if (a.s >= L) { a.arrived = true; a.vel = [0, 0, 0]; }
      }
    }
    if (!P.alive) return;
    const D = dist(a.pos, P.pos), agl = P.pos[1] - W.heightAt(P.pos[0], P.pos[2]);
    if (K.flak) {
      a.aaCd -= dt;
      if (a.aaCd <= 0) {
        if (D < 3000 && agl < 4000 && W.clear(a.pos[0], a.pos[1] + 6, a.pos[2], P.pos[0], P.pos[1], P.pos[2], 8)) {
          const tof = D / 750, aim = add(P.pos, mul(P.vel, tof * rr(0.6, 1.1))), err = (30 + D * 0.035) * (1.4 - 0.5 * S.skill);
          S.flak.push({ pos: add(aim, [rr(-err, err), rr(-err, err), rr(-err, err)]), t: tof, from: [...a.pos] });
          if (++a.aaShots >= 4) { a.aaShots = 0; a.aaCd = rr(2.4, 3.4) / (0.6 + 0.4 * S.skill); } else a.aaCd = 0.22;
        } else a.aaCd = 0.5;
      }
    }
    if (K.sam) {
      const sees = D < 9000 && agl > 60 && W.clear(a.pos[0], a.pos[1] + 8, a.pos[2], P.pos[0], P.pos[1], P.pos[2], 12);
      a.lockT = sees ? a.lockT + dt : Math.max(0, a.lockT - dt * 2);
      if (a.lockT > 0) S.spiked = true;
      a.samCd -= dt;
      if (sees && a.lockT > 2.6 && a.samCd <= 0 && a.samAmmo > 0) {
        a.samAmmo--; a.samCd = rr(8, 11) / (0.7 + 0.3 * S.skill); a.lockT = 1.2;
        launch('sam', a, P);
        msg('SAM launch!');
      }
    }
  }

  // ---------- projectiles ----------
  function stepBullets(dt) {
    const W = S.world;
    S.bullets = S.bullets.filter(b => {
      const p1 = add(b.pos, mul(b.vel, dt));
      b.vel[1] -= G * dt;
      b.life -= dt;
      for (const a of S.actors) {
        if (!a.alive || a.team === b.team || (!a.air && b.team === 'red')) continue;
        if (Math.abs(a.pos[0] - p1[0]) > 400 || Math.abs(a.pos[2] - p1[2]) > 400) continue;
        if (stepDist(b.pos, p1, a) < KINDS[a.kind].r) {
          emit('spark', { x: p1[0], y: p1[1], z: p1[2] });
          hurt(a, b.owner === S.player ? (a.air ? 10 : 6) : b.dmg, b.owner === S.player, 'gun');
          return false;
        }
      }
      if (p1[1] < W.heightAt(p1[0], p1[2])) {
        if (b.owner === S.player) emit(W.wet(p1[0], p1[2]) ? 'spout' : 'dust', { x: p1[0], y: W.heightAt(p1[0], p1[2]), z: p1[2] });
        return false;
      }
      b.pos = p1;
      return b.life > 0;
    });
  }
  function stepMissiles(dt) {
    const W = S.world;
    S.missiles = S.missiles.filter(m => {
      m.t += dt; m.life -= dt;
      // the motor burns, then the missile coasts and slows; too slow, it can't steer
      if (m.t < m.burn) m.speed = Math.min(m.max, m.speed + 320 * dt);
      else m.speed = Math.max(150, m.speed - (18 + m.speed * 0.06) * dt);
      if (m.speed < 260 && m.t > m.burn) m.tgt = null;
      const T = m.tgt;
      if (T && (T.alive === false || (T.life !== undefined && T.life <= 0))) m.tgt = null;
      if (m.tgt && m.t > 0.25) {
        const tp = m.tgt.pos, tv = m.tgt.vel ?? [0, 0, 0], D = dist(tp, m.pos);
        const close = Math.max(120, m.speed - dot(tv, norm(sub(tp, m.pos))));
        const aim = add(tp, mul(tv, clamp(D / close, 0, 4)));
        const dd = norm(sub(aim, m.pos)), ang = Math.acos(clamp(dot(dd, m.f), -1, 1));
        if (ang > 1.0) m.tgt = null; // out of the seeker's view: it can't come round
        else {
          let ax = cross(m.f, dd);
          if (len(ax) > 1e-6) m.f = norm(rot(m.f, norm(ax), Math.min(ang, m.turn * (m.speed / m.max) * dt)));
        }
      }
      const p0 = m.pos, p1 = add(m.pos, mul(m.f, m.speed * dt));
      m.pos = p1;
      // the fuse: anything hostile close enough
      for (const a of S.actors) {
        if (!a.alive || a.team === m.team || !a.air || (m.guided && m.tgt !== a)) continue;
        if (Math.abs(a.pos[0] - p1[0]) > 300 || Math.abs(a.pos[2] - p1[2]) > 300) continue;
        if (segDist(a.pos, p0, p1) < m.fuse + KINDS[a.kind].r * 0.5) {
          const dmg = m.kind === 'sam' ? 65 : m.kind === 'eir' ? 58 : 100;
          emit('boom', { x: p1[0], y: p1[1], z: p1[2], big: false, air: true, kind: 'missile' });
          hurt(a, dmg, m.owner === S.player, m.owner === S.player ? 'missile' : m.kind);
          return false;
        }
      }
      const gy = W.heightAt(p1[0], p1[2]);
      if (p1[1] < gy) {
        emit('boom', { x: p1[0], y: gy + 2, z: p1[2], big: false, air: false, kind: 'missile' });
        if (W.wet(p1[0], p1[2])) emit('splash', { x: p1[0], y: W.water, z: p1[2] });
        return false;
      }
      if (m.life <= 0) { emit('pop', { x: p1[0], y: p1[1], z: p1[2] }); return false; }
      return true;
    });
    // the threat: the nearest missile chasing us
    const P = S.player;
    let th = null, bd = Infinity;
    for (const m of S.missiles) if (m.tgt === P) { const d = dist(m.pos, P.pos); if (d < bd) { bd = d; th = m; } }
    S.threat = th;
  }
  function stepOrdnance(dt) {
    const W = S.world;
    S.ordnance = S.ordnance.filter(o => {
      o.life -= dt;
      o.vel[1] -= G * dt * (o.kind === 'rocket' ? 0.35 : 1);
      const p0 = o.pos, p1 = add(o.pos, mul(o.vel, dt));
      o.pos = p1;
      const R = o.kind === 'bomb' ? 62 : 35, dmg = o.kind === 'bomb' ? 230 : 60;
      for (const a of S.actors) {
        if (!a.alive || a.team === o.team || a.air) continue;
        if (Math.abs(a.pos[0] - p1[0]) > 400 || Math.abs(a.pos[2] - p1[2]) > 400) continue;
        if (stepDist(p0, p1, a) < KINDS[a.kind].r) {
          emit('boom', { x: p1[0], y: p1[1], z: p1[2], big: o.kind === 'bomb', air: false, kind: o.kind });
          splash(p1, R, dmg, true, o.team, o.kind);
          return false;
        }
      }
      const gy = W.heightAt(p1[0], p1[2]);
      if (p1[1] < gy) {
        const wet = W.wet(p1[0], p1[2]);
        emit(wet ? 'splash' : 'boom', { x: p1[0], y: gy + 2, z: p1[2], big: o.kind === 'bomb', air: false, kind: o.kind });
        splash([p1[0], gy + 4, p1[2]], R, dmg, true, o.team, o.kind);
        return false;
      }
      return o.life > 0;
    });
    S.flak = S.flak.filter(s => {
      s.t -= dt;
      if (s.t > 0) return true;
      emit('flak', { x: s.pos[0], y: s.pos[1], z: s.pos[2] });
      for (const a of S.actors) {
        if (!a.alive || a.team !== 'blue' || !a.air) continue;
        const d = dist(a.pos, s.pos);
        if (d < 34) hurt(a, 7 * (1 - d / 34) + 2, false, 'flak');
      }
      return false;
    });
    S.decoys = S.decoys.filter(d => {
      d.life -= dt;
      d.vel[1] -= (d.kind === 'flare' ? 4 : 1.5) * dt;
      d.vel = mul(d.vel, 1 - 0.8 * dt);
      d.pos = add(d.pos, mul(d.vel, dt));
      return d.life > 0;
    });
  }

  // ---------- waves and the objective ----------
  function stepWaves(dt) {
    const M = S.mission, next = M.waves?.[S.wave];
    if (!next) return;
    let ready = false;
    if (next.after === 'time') ready = S.t >= next.t;
    else if (next.after === 'kill') ready = S.killsTotal >= next.n;
    else if (next.after === 'clear') ready = !S.actors.some(a => a.alive && a.air && a.team === 'red');
    if (ready && S.waveT < 0) S.waveT = next.delay ?? 0;
    if (S.waveT >= 0) {
      S.waveT -= dt;
      if (S.waveT <= 0) {
        S.wave++; S.waveT = -1;
        for (const spec of M.units) if (spec.wave === S.wave) spawn(spec);
        msg('Bandits inbound');
      }
    }
  }
  function objectives() {
    const M = S.mission;
    if (M.goal === 'escort') {
      const c = S.actors.find(a => a.kind === 'courier');
      const total = c ? polyLen(c.lane) : 1, done = c ? Math.min(total, polyDist(c.lane, c.pos[0], c.pos[2]).along) : 0;
      return { done: Math.round((done / total) * 100), total: 100, pct: true };
    }
    let list;
    if (M.goal === 'air') {
      const n = M.units.filter(u => KINDS[u.kind].air && KINDS[u.kind].team !== 'blue').reduce((s, u) => s + (u.n ?? 1), 0);
      const dead = S.actors.filter(a => a.air && a.team === 'red' && !a.alive).length;
      return { done: dead, total: n };
    }
    list = S.actors.filter(a => a.obj);
    const total = M.units.filter(u => u.obj).reduce((s, u) => s + (u.n ?? 1), 0);
    return { done: list.filter(a => !a.alive).length, total };
  }
  function stepGoal() {
    if (S.complete || S.status !== 'fly') return;
    const M = S.mission;
    if (M.goal === 'escort') {
      const c = S.actors.find(a => a.kind === 'courier');
      if (!c || !c.alive) return fail('The courier was shot down');
      if (c.arrived) return win('The courier is down safe at Copperwell');
      return;
    }
    if (M.goal === 'intercept' && S.actors.some(a => a.obj && a.alive && a.arrived)) return fail('A bomber got through');
    if (S.actors.some(a => a.obj && a.alive && a.arrived && KINDS[a.kind].mover)) return fail('The convoy reached Saltpan');
    const o = objectives();
    if (o.done >= o.total && (M.goal !== 'air' || S.wave >= (M.waves?.length ?? 0))) win('Objectives complete');
  }
  function win(text) {
    S.complete = true; S.completeT = 0;
    S.score += COMPLETE_BONUS + 1000 * S.theatre;
    emit('objective', { all: true });
    emit('complete');
    msg(text);
  }

  // ---------- one step ----------
  function step(c = {}) {
    const dt = DT;
    S.t += dt; S.statusT += dt;
    if (S.complete) S.completeT += dt;
    const P = S.player;
    S.spiked = false;
    if (S.status === 'fly' && P.alive) {
      flyPlayer(c);
      if (P.alive) {
        sensors();
        fireStores(c);
        P.gunCd -= dt;
        if (c.gun && P.gun > 0 && P.gunCd <= 0) {
          P.gunCd += GUN_RATE; if (P.gunCd < 0) P.gunCd = 0;
          P.gun--;
          gun(P, P.f, 0.0035, 10);
          emit('cannon');
        }
        if (P.gunCd < -GUN_RATE) P.gunCd = 0;
      }
    } else if (!P.alive && S.status === 'down') {
      // the wreck falls
      P.vel = P.vel ?? mul(P.f, P.speed);
      P.vel[1] -= G * dt;
      P.pos = add(P.pos, mul(P.vel, dt));
      const gy = S.world.heightAt(P.pos[0], P.pos[2]);
      if (P.pos[1] < gy + 1) { P.pos[1] = gy + 1; P.vel = [0, 0, 0]; }
    }
    if (S.status === 'landed') { P.speed = 0; P.vel = [0, 0, 0]; }
    for (const a of S.actors) {
      if (a === P) continue;
      if (a.alive) { if (a.air) flyAI(a, dt); else groundUnit(a, dt); }
      else if (a.dying) {
        // a downed aircraft trails smoke to the ground
        a.deadT += dt;
        a.vel = a.vel ?? mul(a.f, a.speed);
        a.vel[1] -= G * dt; a.vel = mul(a.vel, 1 - 0.3 * dt);
        a.pos = add(a.pos, mul(a.vel, dt));
        a.f = norm(a.vel); a.bank += dt * 2.5; a.u = upOf(a.f, a.bank);
        const gy = S.world.heightAt(a.pos[0], a.pos[2]);
        if (a.pos[1] < gy + 2 || a.deadT > 25) {
          a.dying = false;
          const wet = S.world.wet(a.pos[0], a.pos[2]);
          emit(wet ? 'splash' : 'boom', { x: a.pos[0], y: gy + 2, z: a.pos[2], big: true, air: false, kind: a.kind });
        }
      } else a.deadT += dt;
    }
    stepBullets(dt);
    stepMissiles(dt);
    stepOrdnance(dt);
    stepWaves(dt);
    stepGoal();
    if (P.alive && S.status === 'fly' && P.fuel <= 0 && P.speed < 5 && P.ground) down('Out of fuel');
  }

  return S;
}

/** where a bomb dropped now would land (the HUD's impact cross, the autopilot's release) */
export function predictBomb(sim) {
  const P = sim.player, W = sim.world;
  let p = [...P.pos], v = [...(P.vel ?? mul(P.f, P.speed))];
  const h = 0.05;
  for (let t = 0; t < 40; t += h) {
    v[1] -= G * h;
    const p1 = add(p, mul(v, h));
    if (p1[1] < W.heightAt(p1[0], p1[2])) return { pos: p1, t };
    p = p1;
  }
  return null;
}
