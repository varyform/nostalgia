// What the sim needs to time and place a player's moves, and the racket as the figure holds it.
// Every move is made in the rig editor (netcord.rig.json, first built by tools/rig-moves.mjs);
// the numbers in MOVES are measured from the game's copy of it (src/rig-moves.json) by
// tools/rig-pack.mjs, which rewrites the block between the GENERATED marks: don't edit them by
// hand, re-pack instead.
//
// Body space: from the player's root (p.x, p.z on the ground) and facing (p.yaw): f forward,
// u up from the ground, s to the racket side (the right for a right-hander, the left for a
// left-hander, who is the mirror). Court space: x across, y up, z along the court; yaw 0 faces
// −z (a near-end player facing the net) and a positive yaw turns toward −x (to the left, seen
// from above): forward = (−sin yaw, 0, −cos yaw), right = (cos yaw, 0, −sin yaw).
//
// MOVES[name]:
//   dur       s, the whole move (a loop's: one cycle at the speed it was made for)
//   contact   s from the start to the middle of the rig's `active` range (the racket meets the
//             ball), or −1
//   at        the racket's sweet spot (centre of the strings) at contact, body space, m, for a
//             player of FIGURE.height (`contactAt` scales it to another height)
//   hand      the racket hand's grip at contact, body space (what scales with the body)
//   reach     m of slack around `at` the swing still meets the ball within
//   kind      'loop' | 'swing' | 'serve' | 'react'
//   window    [from, to] s, the active range (the frames the racket can meet the ball)
//   stride    loops: m travelled per cycle with the feet not skating (phase += speed / stride · dt)
//   dir       loops: the way the root travels, body space [f, s] (unit)
//   face      swings: the racket face's normal at contact, body space [f, u, s] (the palm side)
//   release   serve, bounceBall: { t, at } when and where the tossing hand lets go of the ball
//   catch     bounceBall: { t, at } when and where it has it back
//   travel    serve: { f, s, from, to } m the root should travel (body space) from `from` to `to`
//             s, smoothstepped (travelAt): the figure stays over the root as it goes, so the sim
//             carries it. `at` is from the root as it is at contact.
export const HANDEDNESS = { right: 1, left: -1 };

/**
 * The racket (m): `length` butt to tip, the grip's centre `grip` from the butt, the strings'
 * centre `head` from the butt, the head's oval `headLength` × `headWidth`. In the hand, the
 * handle runs across the palm from the little finger's side to the thumb's, tilted `tilt` rad
 * toward the fingers, `palm` (× hand length / 0.095) in front of the palm; the strings face the
 * way the palm does.
 */
export const RACKET = {
  length: 0.69,
  grip: 0.08,
  head: 0.53,
  headLength: 0.32,
  headWidth: 0.25,
  tilt: 0.6,
  palm: 0.024,
  along: 0.5,
};

// The rig's joints racketOf reads (@nostalgia/rig `Joint`; tools/rig-check.mjs checks them).
export const RACKET_JOINTS = { wrist: 7, hand: 8, index1: 29, pinky1: 40 };

/**
 * The racket in the near (racket) hand of a rig joint buffer (x forward, y up, z the near
 * side, a right hand), into `out` { grip, head, normal, up } (arrays of 3): the grip's centre,
 * the strings' centre, the face's normal (the palm's side) and the shaft's way (grip → head).
 */
export function racketOf(j, out) {
  const { wrist, hand, index1, pinky1 } = RACKET_JOINTS;
  const w = wrist * 3;
  const h = hand * 3;
  let dx = j[h] - j[w];
  let dy = j[h + 1] - j[w + 1];
  let dz = j[h + 2] - j[w + 2];
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;
  // toward the thumb, square to the hand
  let ax = j[index1 * 3] - j[pinky1 * 3];
  let ay = j[index1 * 3 + 1] - j[pinky1 * 3 + 1];
  let az = j[index1 * 3 + 2] - j[pinky1 * 3 + 2];
  const ad = ax * dx + ay * dy + az * dz;
  ax -= ad * dx;
  ay -= ad * dy;
  az -= ad * dz;
  const al = Math.hypot(ax, ay, az) || 1;
  ax /= al;
  ay /= al;
  az /= al;
  // a right hand's palm: across × along
  const px = ay * dz - az * dy;
  const py = az * dx - ax * dz;
  const pz = ax * dy - ay * dx;
  const c = Math.cos(RACKET.tilt);
  const s = Math.sin(RACKET.tilt);
  const ux = ax * c + dx * s;
  const uy = ay * c + dy * s;
  const uz = az * c + dz * s;
  const off = (RACKET.palm * len) / 0.095;
  const g = out.grip;
  g[0] = j[w] + dx * len * RACKET.along + px * off;
  g[1] = j[w + 1] + dy * len * RACKET.along + py * off;
  g[2] = j[w + 2] + dz * len * RACKET.along + pz * off;
  const k = RACKET.head - RACKET.grip;
  out.head[0] = g[0] + ux * k;
  out.head[1] = g[1] + uy * k;
  out.head[2] = g[2] + uz * k;
  out.normal[0] = px;
  out.normal[1] = py;
  out.normal[2] = pz;
  out.up[0] = ux;
  out.up[1] = uy;
  out.up[2] = uz;
  return out;
}

// The other (tossing) hand's joints: wrist, middle knuckle, index and little finger bases.
export const BALL_JOINTS = { wrist: 11, hand: 12, index1: 48, pinky1: 59 };
export const BALL_RADIUS = 0.0335;

/**
 * Where a ball sits in the other hand of a rig joint buffer (a left hand), into `out` [x, y, z]:
 * in the cup of the palm, a ball's radius and the fingers' depth off it.
 */
export function ballOf(j, out) {
  const { wrist, hand, index1, pinky1 } = BALL_JOINTS;
  const w = wrist * 3;
  const h = hand * 3;
  let dx = j[h] - j[w];
  let dy = j[h + 1] - j[w + 1];
  let dz = j[h + 2] - j[w + 2];
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;
  const ax = j[index1 * 3] - j[pinky1 * 3];
  const ay = j[index1 * 3 + 1] - j[pinky1 * 3 + 1];
  const az = j[index1 * 3 + 2] - j[pinky1 * 3 + 2];
  // a left hand's palm: along × across
  let px = dy * az - dz * ay;
  let py = dz * ax - dx * az;
  let pz = dx * ay - dy * ax;
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl;
  py /= pl;
  pz /= pl;
  const off = BALL_RADIUS + (0.012 * len) / 0.095;
  out[0] = j[w] + dx * len * 0.75 + px * off;
  out[1] = j[w + 1] + dy * len * 0.75 + py * off;
  out[2] = j[w + 2] + dz * len * 0.75 + pz * off;
  return out;
}

export const newRacket = () => ({ grip: [0, 0, 0], head: [0, 0, 0], normal: [0, 0, 0], up: [0, 0, 0] });

/** The way a yaw faces, court x and z. */
export const forwardOf = yaw => [-Math.sin(yaw), -Math.cos(yaw)];
/** The yaw that faces along court (dx, dz). */
export const yawToward = (dx, dz) => Math.atan2(-dx, -dz);

/**
 * A body-space point (f, u, s) in court space for a player at (x, z) facing yaw, `hand` 1 or −1
 * (s is to the racket side), into `out` [x, y, z].
 */
export function bodyToCourt(x, z, yaw, hand, f, u, s, out = [0, 0, 0]) {
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  out[0] = x - sy * f + cy * s * hand;
  out[1] = u;
  out[2] = z - cy * f - sy * s * hand;
  return out;
}

/** A court-space point in body space [f, u, s] (the inverse of bodyToCourt). */
export function courtToBody(x, z, yaw, hand, px, py, pz, out = [0, 0, 0]) {
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const dx = px - x;
  const dz = pz - z;
  out[0] = -sy * dx - cy * dz;
  out[1] = py;
  out[2] = (cy * dx - sy * dz) * hand;
  return out;
}

/** A move's sweet spot at contact for a player `height` m tall, body space { f, u, s }. */
export function contactAt(name, height, out = { f: 0, u: 0, s: 0 }) {
  const m = MOVES[name];
  const k = height / FIGURE.height;
  out.f = m.hand.f * k + (m.at.f - m.hand.f);
  out.u = m.hand.u * k + (m.at.u - m.hand.u);
  out.s = m.hand.s * k + (m.at.s - m.hand.s);
  return out;
}

/** How far (0..1) a move's root travel has gone `t` s in (MOVES[name].travel). */
export function travelAt(name, t) {
  const tr = MOVES[name]?.travel;
  if (!tr) return 0;
  const q = Math.min(1, Math.max(0, (t - tr.from) / (tr.to - tr.from)));
  return q * q * (3 - 2 * q);
}

// GENERATED by tools/rig-pack.mjs — do not edit below this line by hand.
export const FIGURE = { height: 1.85, ankle: 0.075, fps: 60 };
export const MOVES = {
  forehand: {dur: 1.1,contact: 0.417,kind: 'swing',window: [0.4,0.433],at: {f: 0.451,u: 0.956,s: 0.822},hand: {f: 0.493,u: 0.907,s: 0.377},reach: 0.16,face: [0.994,0.069,0.085]},
  ready: {dur: 1.2,contact: -1,kind: 'loop',stride: 0,dir: [0,0]},
  run: {dur: 0.6,contact: -1,kind: 'loop',stride: 2.704,dir: [1,0]},
  shuffle: {dur: 0.5,contact: -1,kind: 'loop',stride: 1.251,dir: [-0.001,1]},
  backpedal: {dur: 0.5,contact: -1,kind: 'loop',stride: 1.172,dir: [-1,-0.001]},
  walk: {dur: 1.1,contact: -1,kind: 'loop',stride: 1.556,dir: [1,-0.001]},
  split: {dur: 0.4,contact: -1,kind: 'react'},
  backhand: {dur: 1.1,contact: 0.433,kind: 'swing',window: [0.417,0.45],at: {f: 0.504,u: 0.947,s: -0.721},hand: {f: 0.545,u: 0.898,s: -0.275},reach: 0.16,face: [0.994,0.072,-0.083]},
  forehandSlice: {dur: 1,contact: 0.4,kind: 'swing',window: [0.383,0.417],at: {f: 0.452,u: 0.929,s: 0.781},hand: {f: 0.466,u: 0.825,s: 0.343},reach: 0.16,face: [0.901,0.428,-0.074]},
  backhandSlice: {dur: 1,contact: 0.417,kind: 'swing',window: [0.4,0.433],at: {f: 0.542,u: 0.93,s: -0.746},hand: {f: 0.538,u: 0.832,s: -0.306},reach: 0.16,face: [0.909,0.404,0.1]},
  forehandLob: {dur: 1.1,contact: 0.417,kind: 'swing',window: [0.4,0.433],at: {f: 0.413,u: 0.864,s: 0.804},hand: {f: 0.445,u: 0.789,s: 0.361},reach: 0.16,face: [0.713,0.698,-0.066]},
  backhandLob: {dur: 1.1,contact: 0.433,kind: 'swing',window: [0.417,0.45],at: {f: 0.446,u: 0.879,s: -0.621},hand: {f: 0.49,u: 0.797,s: -0.181},reach: 0.16,face: [0.714,0.698,0.06]},
  dropForehand: {dur: 0.9,contact: 0.383,kind: 'swing',window: [0.367,0.4],at: {f: 0.441,u: 0.86,s: 0.754},hand: {f: 0.457,u: 0.743,s: 0.319},reach: 0.16,face: [0.752,0.643,-0.146]},
  dropBackhand: {dur: 0.9,contact: 0.383,kind: 'swing',window: [0.367,0.4],at: {f: 0.495,u: 0.862,s: -0.697},hand: {f: 0.487,u: 0.742,s: -0.263},reach: 0.16,face: [0.764,0.618,0.184]},
  volleyForehand: {dur: 0.6,contact: 0.25,kind: 'swing',window: [0.233,0.267],at: {f: 0.643,u: 1.201,s: 0.627},hand: {f: 0.619,u: 0.969,s: 0.242},reach: 0.16,face: [0.976,0.153,-0.154]},
  volleyBackhand: {dur: 0.6,contact: 0.25,kind: 'swing',window: [0.233,0.267],at: {f: 0.648,u: 1.205,s: -0.551},hand: {f: 0.624,u: 0.963,s: -0.172},reach: 0.16,face: [0.974,0.157,0.162]},
  volleyLowF: {dur: 0.7,contact: 0.3,kind: 'swing',window: [0.283,0.317],at: {f: 0.539,u: 0.608,s: 0.574},hand: {f: 0.452,u: 0.441,s: 0.165},reach: 0.16,face: [0.861,0.381,-0.338]},
  volleyLowB: {dur: 0.7,contact: 0.3,kind: 'swing',window: [0.283,0.317],at: {f: 0.541,u: 0.607,s: -0.525},hand: {f: 0.452,u: 0.442,s: -0.116},reach: 0.16,face: [0.855,0.39,0.341]},
  smash: {dur: 1.2,contact: 0.55,kind: 'swing',window: [0.533,0.567],at: {f: 0.471,u: 2.428,s: 0.269},hand: {f: 0.363,u: 1.992,s: 0.271},reach: 0.16,face: [0.97,-0.241,-0.017]},
  bounceBall: {dur: 1,contact: -1,kind: 'serve',release: {t: 0.233,at: {f: 0.406,u: 0.869,s: -0.013}},catch: {t: 0.667,at: {f: 0.406,u: 0.871,s: -0.013}}},
  serve: {dur: 2,contact: 1.1,kind: 'serve',window: [1.083,1.117],at: {f: 0.507,u: 2.583,s: 0.301},hand: {f: 0.432,u: 2.14,s: 0.301},reach: 0.16,face: [0.986,-0.168,0.014],release: {t: 0.567,at: {f: 0.289,u: 2.067,s: 0.096}},travel: {f: 0.45,s: 0,from: 1.1,to: 1.667}},
  lunge: {dur: 1.2,contact: 0.383,kind: 'swing',window: [0.367,0.4],at: {f: 0.443,u: 0.731,s: 1.443},hand: {f: 0.504,u: 0.631,s: 1.008},reach: 0.16,face: [0.956,0.284,0.07]},
  lungeBackhand: {dur: 1.2,contact: 0.4,kind: 'swing',window: [0.383,0.417],at: {f: 0.437,u: 0.733,s: -1.365},hand: {f: 0.498,u: 0.639,s: -0.929},reach: 0.16,face: [0.92,0.389,-0.046]},
  celebrate: {dur: 1.6,contact: -1,kind: 'react'},
  dejected: {dur: 2,contact: -1,kind: 'react'},
  bow: {dur: 1.8,contact: -1,kind: 'react'},
};
// END GENERATED
