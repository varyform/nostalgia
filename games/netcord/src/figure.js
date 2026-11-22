// A player's body, posed from the rig editor's moves (src/rig-moves.json, packed from
// netcord.rig.json by tools/rig-pack.mjs) through @nostalgia/rig, in court space for the
// renderer and the tools. No DOM; nothing allocated per call once a figure has posed a player.
//
//   const fig = createFigure();       // one per player (it remembers the last pose, to blend)
//   fig.pose(p, out);                 // p: a player of match.s → out (made by newPose())
//
// out.joints   Float32Array, x y z per rig joint (`Joint` indices), court space
// out.racket   { grip, head, normal, up }: the grip's centre and the strings' centre (points),
//              the face's normal (the palm's side) and the shaft's way, grip → head (unit)
// out.ball     where a ball held in the other hand sits (for match.s.ball.inHand)
//
// A move plays at p.moveT (s in); locomotion loops at p.phase (0..1 a cycle); the ready stance
// breathes on p.moveT. A change of move blends over BLEND s of the new move's time, so a
// paused match holds still. Left-handers (p.hand −1) are the mirror. The body is scaled to
// p.height (the racket isn't) and turned to p.yaw at (p.x, p.z): see src/moves.js for the axes.
// The serve's root travel (MOVES.serve.travel) is the sim's to carry: the figure takes it out of
// the move. Around a swing's contact the racket reaches for p.contact (the ball where the swing
// means to meet it, court space; the figure keeps it after the sim clears it at the strike):
// the body crouches or rises for part of the height, the arm (and the other one on a
// two-handed shot) bends and turns for the rest, blended in and out over the swing.
import { createJointBuffer, Joint, JOINT_COUNT, JOINT_NAMES, parseProject, resolveKeys, sampleMove, solvePose } from '@nostalgia/rig';
import data from './rig-moves.json' with { type: 'json' };
import { ballOf, courtToBody, FIGURE, MOVES, newRacket, RACKET, racketOf, travelAt } from './moves.js';

export { BONES, FINGERS, isFingerJoint, Joint, JOINT_COUNT, JOINT_NAMES } from '@nostalgia/rig';
export { RACKET } from './moves.js';

const project = parseProject(data);
/** The rig's bone lengths for a player FIGURE.height tall (m); scale by height / FIGURE.height. */
export const PROPORTIONS = project.proportions;
export const HEIGHT = FIGURE.height;
/** The rig's ankles stand this far over the court (its y = 0 is ankle height). */
export const ANKLE = FIGURE.ankle;
/** How long a change of move blends (s). */
export const BLEND = 0.1;
const FPS = project.fps;
const N = JOINT_COUNT * 3;
const PROJECT_PROPS = project.proportions;
const BY_NAME = new Map(project.moves.map(m => [m.name, m]));
export const MOVE_NAMES = [...BY_NAME.keys()];

/** Every frame of a move solved once, on first use (rig space: x forward, y up, z to the racket side). */
const baked = new Map();
function framesOf(name) {
  let frames = baked.get(name);
  if (frames) return frames;
  const move = BY_NAME.get(name);
  const resolved = resolveKeys(move);
  const one = createJointBuffer();
  frames = new Float32Array(move.length * N);
  for (let f = 0; f < move.length; f++) {
    solvePose(sampleMove(move, f, resolved), PROJECT_PROPS, one);
    frames.set(one, f * N);
  }
  baked.set(name, frames);
  return frames;
}

/**
 * A move's joints `frame` (fractions blend) in rig space into `out`: x forward, y up from the
 * ankles' height, z to the racket side. Loops wrap; others hold their ends.
 */
export function sampleLocal(name, frame, out) {
  const move = BY_NAME.get(name);
  const frames = framesOf(name);
  const L = move.length;
  let f = frame;
  if (move.loop) f = ((f % L) + L) % L;
  else f = Math.min(Math.max(f, 0), L - 1);
  const f0 = Math.floor(f);
  const f1 = move.loop ? (f0 + 1) % L : Math.min(f0 + 1, L - 1);
  const t = f - f0;
  const a = f0 * N;
  const b = f1 * N;
  for (let i = 0; i < N; i++) out[i] = frames[a + i] + (frames[b + i] - frames[a + i]) * t;
  return out;
}

// --- reaching for the contact ------------------------------------------------------------------
/** How the reach comes in and goes out about a move's contact (s): from, full, full, gone. */
export const REACH = { in: 0.24, full: 0.05, hold: 0.04, out: 0.3 };
/** The body's share of the reach's height, and how far it goes (rig m): a crouch, a rise, a hop. */
const BODY_SHARE = 0.55;
const CROUCH = 0.3;
const RISE = 0.35;
const sideJoints = side => JOINT_NAMES.flatMap((n, i) => (n.endsWith(side) && /^(thumb|index|middle|ring|pinky)/.test(n) ? [i] : []));
const NEAR_FINGERS = sideJoints('Near');
const FAR_FINGERS = sideJoints('Far');
const NEAR_FORE = [Joint.wristNear, Joint.handNear, ...NEAR_FINGERS];
const NEAR_ARM = [Joint.elbowNear, ...NEAR_FORE];
const FAR_HAND = [Joint.wristFar, Joint.handFar, ...FAR_FINGERS];
const LEG_JOINTS = new Set([Joint.kneeNear, Joint.ankleNear, Joint.toeNear, Joint.ballNear, Joint.kneeFar, Joint.ankleFar, Joint.toeFar, Joint.ballFar]);
const UPPER = JOINT_NAMES.flatMap((_, i) => (LEG_JOINTS.has(i) ? [] : [i]));
const LEGS = [
  [Joint.hipNear, Joint.kneeNear, Joint.ankleNear],
  [Joint.hipFar, Joint.kneeFar, Joint.ankleFar],
];

// scratch vectors (no allocation per pose)
const vA = [0, 0, 0];
const vB = [0, 0, 0];
const vC = [0, 0, 0];
const vD = [0, 0, 0];
const ax = [0, 0, 0];
const get = (J, j, o) => ((o[0] = J[j * 3]), (o[1] = J[j * 3 + 1]), (o[2] = J[j * 3 + 2]), o);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = a => Math.hypot(a[0], a[1], a[2]);
function sub3(a, b, o) {
  o[0] = a[0] - b[0];
  o[1] = a[1] - b[1];
  o[2] = a[2] - b[2];
  return o;
}
function cross3(a, b, o) {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  o[0] = x;
  o[1] = y;
  o[2] = z;
  return o;
}
/** Turns joints `list` of J about point c, round unit axis k, by angle φ (Rodrigues). */
function turn(J, list, c, k, phi) {
  const cs = Math.cos(phi);
  const sn = Math.sin(phi);
  for (const j of list) {
    const i = j * 3;
    const x = J[i] - c[0];
    const y = J[i + 1] - c[1];
    const z = J[i + 2] - c[2];
    const kd = (k[0] * x + k[1] * y + k[2] * z) * (1 - cs);
    J[i] = c[0] + x * cs + (k[1] * z - k[2] * y) * sn + k[0] * kd;
    J[i + 1] = c[1] + y * cs + (k[2] * x - k[0] * z) * sn + k[1] * kd;
    J[i + 2] = c[2] + z * cs + (k[0] * y - k[1] * x) * sn + k[2] * kd;
  }
}
/** Turns joints `list` about c so the way c → from points c → to. */
function aim(J, list, c, from, to) {
  sub3(from, c, vC);
  sub3(to, c, vD);
  const a = len3(vC);
  const b = len3(vD);
  if (a < 1e-6 || b < 1e-6) return;
  cross3(vC, vD, ax);
  const s = len3(ax);
  if (s < 1e-9) return;
  ax[0] /= s;
  ax[1] /= s;
  ax[2] /= s;
  turn(J, list, c, ax, Math.atan2(s, dot3(vC, vD)));
}
/** Puts a two-bone limb's middle joint (root r, middle m, end e) back between r and a moved e, bent the way it was. */
function bendBetween(J, r, m, e, upper, lower) {
  const R = get(J, r, vA);
  const E = get(J, e, vB);
  sub3(E, R, vC);
  let d = len3(vC);
  if (d < 1e-6) return;
  vC[0] /= d;
  vC[1] /= d;
  vC[2] /= d;
  d = Math.min(d, (upper + lower) * 0.9995);
  const along = (upper * upper - lower * lower + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, upper * upper - along * along));
  // the bend's way: the middle joint's, square to the limb
  get(J, m, vD);
  sub3(vD, R, vD);
  const p = dot3(vD, vC);
  vD[0] -= vC[0] * p;
  vD[1] -= vC[1] * p;
  vD[2] -= vC[2] * p;
  const n = len3(vD) || 1;
  const i = m * 3;
  J[i] = R[0] + vC[0] * along + (vD[0] / n) * h;
  J[i + 1] = R[1] + vC[1] * along + (vD[1] / n) * h;
  J[i + 2] = R[2] + vC[2] * along + (vD[2] / n) * h;
}
const boneLength = (J, a, b) => Math.hypot(J[a * 3] - J[b * 3], J[a * 3 + 1] - J[b * 3 + 1], J[a * 3 + 2] - J[b * 3 + 2]);

/**
 * A move's racket at contact (rig space, as played: the travel out) and whether both hands
 * hold it then (the far hand by the grip), worked out once.
 */
const atContact = new Map();
function contactOf(name) {
  let c = atContact.get(name);
  if (c) return c;
  const J = sampleLocal(name, MOVES[name].contact * FPS, new Float32Array(N));
  const r = racketOf(J, newRacket());
  get(J, Joint.handFar, vA);
  c = { grip: r.grip, up: r.up, two: Math.hypot(vA[0] - r.grip[0], vA[1] - r.grip[1], vA[2] - r.grip[2]) < 0.16 };
  atContact.set(name, c);
  return c;
}

/** How much (0..1) of the reach a move has on at `t` s. */
function reachWeight(c, t) {
  if (t < c - REACH.in || t > c + REACH.hold + REACH.out) return 0;
  if (t < c - REACH.full) return smooth((t - (c - REACH.in)) / (REACH.in - REACH.full));
  if (t <= c + REACH.hold) return 1;
  return 1 - smooth((t - c - REACH.hold) / REACH.out);
}

const rkReach = newRacket();
const shoulder = [0, 0, 0];
const elbow = [0, 0, 0];
const armU = [0, 0, 0];
const armV = [0, 0, 0];
const sweet = [0, 0, 0];
const goal = [0, 0, 0];
/** The sweet spot (where the court figure has it: the racket isn't scaled) of joints J. */
function sweetOf(J, k) {
  racketOf(J, rkReach);
  const r = (RACKET.head - RACKET.grip) / k;
  sweet[0] = rkReach.grip[0] + rkReach.up[0] * r;
  sweet[1] = rkReach.grip[1] + rkReach.up[1] * r;
  sweet[2] = rkReach.grip[2] + rkReach.up[2] * r;
  return sweet;
}

/**
 * Shifts the racket of local joints J (rig space, a figure k times the rig's size) by `w` of the
 * way from the move's sweet spot at contact to `target` (rig space), so the swing's path runs
 * through the target: the body takes part of the height, the arm the rest.
 */
function reachFor(J, name, target, w, k) {
  const c = contactOf(name);
  const r = (RACKET.head - RACKET.grip) / k;
  sweetOf(J, k);
  goal[0] = sweet[0] + (target[0] - c.grip[0] - c.up[0] * r) * w;
  goal[1] = sweet[1] + (target[1] - c.grip[1] - c.up[1] * r) * w;
  goal[2] = sweet[2] + (target[2] - c.grip[2] - c.up[2] * r) * w;
  const two = c.two;
  const farUpper = two && boneLength(J, Joint.shoulderFar, Joint.elbowFar);
  const farLower = two && boneLength(J, Joint.elbowFar, Joint.wristFar);
  // the body: down by bending the knees, up by straightening them, then off the ground
  let dy = Math.min(RISE, Math.max(-CROUCH, (goal[1] - sweet[1]) * BODY_SHARE));
  if (Math.abs(dy) > 1e-4) {
    let lift = dy;
    let hop = 0;
    for (const [h, kn, a] of LEGS) {
      // the most the hip may rise over its ankle, the leg straight
      const R = (boneLength(J, h, kn) + boneLength(J, kn, a)) * 0.999;
      get(J, h, vA);
      get(J, a, vB);
      sub3(vA, vB, vC);
      const flat = R * R - vC[0] * vC[0] - vC[2] * vC[2];
      const most = flat > 0 ? Math.sqrt(flat) - vC[1] : 0;
      if (lift > most) lift = Math.max(0, most);
    }
    if (dy > lift) hop = dy - lift;
    const thighN = boneLength(J, Joint.hipNear, Joint.kneeNear);
    const shinN = boneLength(J, Joint.kneeNear, Joint.ankleNear);
    const thighF = boneLength(J, Joint.hipFar, Joint.kneeFar);
    const shinF = boneLength(J, Joint.kneeFar, Joint.ankleFar);
    for (const j of UPPER) J[j * 3 + 1] += lift;
    bendBetween(J, Joint.hipNear, Joint.kneeNear, Joint.ankleNear, thighN, shinN);
    bendBetween(J, Joint.hipFar, Joint.kneeFar, Joint.ankleFar, thighF, shinF);
    if (hop > 0) for (let i = 1; i < N; i += 3) J[i] += hop;
  }
  // the arm: bend or straighten the elbow for the distance, turn at the shoulder for the way;
  // what it can't reach, the body leans in for (the hips over the feet as far as the legs allow)
  for (let pass = 0; pass < 3; pass++) {
    if (pass === 2) {
      sweetOf(J, k);
      lean(J, (goal[0] - sweet[0]) * LEAN_SHARE, (goal[2] - sweet[2]) * LEAN_SHARE);
      // still short of a high ball: off the ground for it
      const up = Math.min(HOP, (goal[1] - sweet[1]) * LEAN_SHARE);
      if (up > 0) for (let i = 1; i < N; i += 3) J[i] += up;
    }
    const S = get(J, Joint.shoulderNear, shoulder);
    sweetOf(J, k);
    const E = get(J, Joint.elbowNear, elbow);
    const u = sub3(S, E, armU);
    const v = sub3(sweet, E, armV);
    const want = Math.hypot(goal[0] - S[0], goal[1] - S[1], goal[2] - S[2]);
    const a = len3(u);
    const b = len3(v);
    const now = Math.acos(Math.min(1, Math.max(-1, dot3(u, v) / (a * b))));
    const then = Math.acos(Math.min(1, Math.max(-1, (a * a + b * b - want * want) / (2 * a * b))));
    cross3(u, v, ax);
    const s = len3(ax);
    const turnBy = Math.min(Math.PI - 0.05, Math.max(0.5, then)) - now;
    // (an arm all but straight has no bend to read a hinge from: leave it)
    if (s > 0.08 * a * b && Math.abs(turnBy) > 1e-5) {
      ax[0] /= s;
      ax[1] /= s;
      ax[2] /= s;
      turn(J, NEAR_FORE, E, ax, turnBy);
      if (two) turn(J, FAR_HAND, E, ax, turnBy);
    }
    sweetOf(J, k);
    if (two) aim(J, FAR_HAND, S, sweet, goal);
    aim(J, NEAR_ARM, S, sweet, goal);
  }
  if (two) {
    // the other hand as near the grip as its arm reaches
    get(J, Joint.shoulderFar, vA);
    get(J, Joint.wristFar, vB);
    sub3(vB, vA, vC);
    const d = len3(vC);
    const most = (farUpper + farLower) * 0.999;
    if (d > most) {
      const f = most / d - 1;
      for (const j of FAR_HAND) {
        J[j * 3] += vC[0] * f;
        J[j * 3 + 1] += vC[1] * f;
        J[j * 3 + 2] += vC[2] * f;
      }
    }
    bendBetween(J, Joint.shoulderFar, Joint.elbowFar, Joint.wristFar, farUpper, farLower);
  }
}

/** Shifts the upper body by (dx, dz) (rig m, at most LEAN), as far as both legs still reach, the knees re-bent. */
const LEAN = 0.22;
const LEAN_SHARE = 0.9;
const HOP = 0.2;
function lean(J, dx, dz) {
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) return;
  if (d > LEAN) {
    dx *= LEAN / d;
    dz *= LEAN / d;
  }
  // the largest share of the shift both legs allow
  let hi = 1;
  for (const [h, kn, a] of LEGS) {
    const R = (boneLength(J, h, kn) + boneLength(J, kn, a)) * 0.998;
    const x = J[h * 3] - J[a * 3];
    const y = J[h * 3 + 1] - J[a * 3 + 1];
    const z = J[h * 3 + 2] - J[a * 3 + 2];
    if (Math.hypot(x + dx, y, z + dz) <= R) continue;
    let l = 0;
    let r = hi;
    for (let i = 0; i < 8; i++) {
      const m = (l + r) / 2;
      if (Math.hypot(x + dx * m, y, z + dz * m) <= R) l = m;
      else r = m;
    }
    hi = Math.min(hi, l);
  }
  if (hi <= 0) return;
  const thighN = boneLength(J, Joint.hipNear, Joint.kneeNear);
  const shinN = boneLength(J, Joint.kneeNear, Joint.ankleNear);
  const thighF = boneLength(J, Joint.hipFar, Joint.kneeFar);
  const shinF = boneLength(J, Joint.kneeFar, Joint.ankleFar);
  for (const j of UPPER) {
    J[j * 3] += dx * hi;
    J[j * 3 + 2] += dz * hi;
  }
  bendBetween(J, Joint.hipNear, Joint.kneeNear, Joint.ankleNear, thighN, shinN);
  bendBetween(J, Joint.hipFar, Joint.kneeFar, Joint.ankleFar, thighF, shinF);
}

/** A pose's output: joints, racket and the held ball, court space. */
export const newPose = () => ({ joints: new Float32Array(N), racket: newRacket(), ball: [0, 0, 0] });

/** The frame of a move a player is at (fractions), and which way a loop runs. */
function frameOf(p, name, move) {
  const m = MOVES[name];
  if (!move.loop) return (p.moveT ?? 0) * FPS;
  // locomotion by its cycle; the ready stance by the clock
  if (!m?.stride) return (p.moveT ?? 0) * FPS;
  let q = p.phase ?? 0;
  // a sideways loop made going to the racket side runs back the other way
  if (m.dir && Math.abs(m.dir[1]) > 0.5) {
    const sy = Math.sin(p.yaw ?? 0);
    const cy = Math.cos(p.yaw ?? 0);
    const side = ((p.vx ?? 0) * cy - (p.vz ?? 0) * sy) * (p.hand ?? 1);
    if (side * m.dir[1] < 0) q = 1 - q;
  }
  return q * move.length;
}

const smooth = q => q * q * (3 - 2 * q);

/** The body-to-court transform of the pose being made. */
const T = { k: 1, x0: 0, z0: 0, fx: 0, fz: -1, rx: 1, rz: 0 };
function point(v, o) {
  const f = v[0] * T.k;
  const s = v[2] * T.k;
  o[0] = T.x0 + T.fx * f + T.rx * s;
  o[1] = (v[1] + ANKLE) * T.k;
  o[2] = T.z0 + T.fz * f + T.rz * s;
}
function way(v, o) {
  o[0] = T.fx * v[0] + T.rx * v[2];
  o[1] = v[1];
  o[2] = T.fz * v[0] + T.rz * v[2];
}

export function createFigure() {
  const states = new WeakMap();
  const local = new Float32Array(N);
  const rk = newRacket();
  const ball = [0, 0, 0];
  const aimAt = [0, 0, 0];

  function stateOf(p) {
    let s = states.get(p);
    if (!s) {
      s = {
        name: '',
        moveT: 0,
        phase: 0,
        prev: new Float32Array(N),
        from: new Float32Array(N),
        blend: 1,
        fresh: true,
        // the contact being reached for (court space) and the move it's for
        target: [0, 0, 0],
        targetMove: '',
      };
      states.set(p, s);
    }
    return s;
  }

  /** Poses player `p` into `out` (newPose()). */
  function pose(p, out) {
    const name = BY_NAME.has(p.move) ? p.move : 'ready';
    const move = BY_NAME.get(name);
    const st = stateOf(p);
    const moveT = p.moveT ?? 0;
    const phase = p.phase ?? 0;
    sampleLocal(name, frameOf(p, name, move), local);
    const m = MOVES[name];
    // the serve's root travel is the sim's: take it out
    if (m?.travel) {
      const q = travelAt(name, moveT);
      const df = m.travel.f * q;
      const ds = m.travel.s * q;
      for (let i = 0; i < N; i += 3) {
        local[i] -= df;
        local[i + 2] -= ds;
      }
    }

    // blending from the last pose shown, over BLEND s of the new move
    if (st.fresh) st.fresh = false;
    else if (name !== st.name || (!move.loop && moveT < st.moveT - 1e-6)) {
      st.from.set(st.prev);
      st.blend = 0;
    } else if (st.blend < 1) {
      let dt = moveT - st.moveT;
      if (!(dt > 0) && move.loop) {
        const dq = Math.abs(phase - st.phase);
        dt = Math.min(dq, 1 - dq) * (MOVES[name]?.dur ?? 0.5);
      }
      if (dt > 0) st.blend = Math.min(1, st.blend + dt / BLEND);
    }
    if (st.blend < 1) {
      const w = smooth(st.blend);
      for (let i = 0; i < N; i++) local[i] = st.from[i] + (local[i] - st.from[i]) * w;
    }
    const hand = p.hand ?? 1;
    const k = (p.height ?? HEIGHT) / HEIGHT;

    // the racket reaching for the contact
    if (st.targetMove && (st.targetMove !== name || moveT < st.moveT - 1e-6)) st.targetMove = '';
    if (p.contact && m?.contact > 0) {
      st.target[0] = p.contact.x;
      st.target[1] = p.contact.y;
      st.target[2] = p.contact.z;
      st.targetMove = name;
    }
    if (st.targetMove === name) {
      const w = reachWeight(m.contact, moveT);
      if (w > 0) {
        courtToBody(p.x ?? 0, p.z ?? 0, p.yaw ?? 0, hand, st.target[0], st.target[1], st.target[2], aimAt);
        aimAt[0] /= k;
        aimAt[1] = aimAt[1] / k - ANKLE;
        aimAt[2] /= k;
        reachFor(local, name, aimAt, w, k);
      }
    }
    st.prev.set(local);
    st.name = name;
    st.moveT = moveT;
    st.phase = phase;

    racketOf(local, rk);
    ballOf(local, ball);

    // into the court: scaled about the root, mirrored for a left-hander, turned and placed
    const sy = Math.sin(p.yaw ?? 0);
    const cy = Math.cos(p.yaw ?? 0);
    T.k = k;
    T.x0 = p.x ?? 0;
    T.z0 = p.z ?? 0;
    // forward (−sin, −cos), right (cos, −sin) · hand
    T.fx = -sy;
    T.fz = -cy;
    T.rx = cy * hand;
    T.rz = -sy * hand;
    const J = out.joints;
    for (let i = 0; i < N; i += 3) {
      const f = local[i] * T.k;
      const s = local[i + 2] * T.k;
      J[i] = T.x0 + T.fx * f + T.rx * s;
      J[i + 1] = (local[i + 1] + ANKLE) * T.k;
      J[i + 2] = T.z0 + T.fz * f + T.rz * s;
    }
    const R = out.racket;
    point(rk.grip, R.grip);
    way(rk.up, R.up);
    way(rk.normal, R.normal);
    const reach = RACKET.head - RACKET.grip;
    R.head[0] = R.grip[0] + R.up[0] * reach;
    R.head[1] = R.grip[1] + R.up[1] * reach;
    R.head[2] = R.grip[2] + R.up[2] * reach;
    point(ball, out.ball);
    return out;
  }

  return { pose };
}
