// Netcord's moves, keyed in code as rig poses: a first pass a person refines in the rig editor
// (~/projects/rig-editor). Each key is written the way a coach would see it, in the player's
// root frame (x forward to the net, y up from the court, z to the racket side): where the feet
// stand and point, how far the hips drop, the hips' turn (yaw) and the shoulders' on top of it
// (spineTwist), and the RACKET — where its strings' centre (or grip) is, the way its shaft and
// face point. The racket arm's wrist, elbow swivel, wrist flex and forearm twist are solved to
// put the racket there (the figure reads the racket off the hand: src/moves.js racketOf); the
// other hand rides the handle or the throat where a key says so, solved on every frame and
// keyed where it strays (as the editor's foot hold does). Planted feet are held still with the
// editor's own hold (hold.ts). Loops (run, shuffle…) are made per frame and fitted to keys
// with the editor's Import pipeline (fit.ts posesToMove).
//
// The moves replace their namesakes in netcord.rig.json and leave any other move there be;
// then the game's copy is packed (tools/rig-pack.mjs → src/rig-moves.json, src/moves.js).
//
//   mise exec -- node games/netcord/tools/rig-moves.mjs [--only name,name] [--report]
//   (Node 24: it loads the editor's .ts; RIG_EDITOR points at its src, ~/projects/rig-editor/src)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NETCORD = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const RIG = process.env.RIG_EDITOR ?? fileURLToPath(new URL('../../../../rig-editor/src', import.meta.url));
const R = await import(`${RIG}/rig/index.ts`);
const { posesToMove } = await import(`${RIG}/editor/fit.ts`);
const { plant, toesDown } = await import(`${RIG}/editor/presets.ts`);
const { FLAT_FLOOR } = await import(`${RIG}/editor/ground.ts`);
const { RACKET, racketOf, newRacket } = await import(`${NETCORD}/src/moves.js`);
const { Joint, JOINT_STRIDE: S, FINGERS } = R;

const args = process.argv.slice(2);
const ONLY = (args.find(a => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const REPORT = args.includes('--report');

export const FPS = 60;
// A 1.85 m player (head top, standing): the game scales it to each player's height.
export const PROPS = {
  spineLower: 0.28,
  spineUpper: 0.28,
  neck: 0.11,
  headRadius: 0.11,
  shoulderWidth: 0.4,
  hipWidth: 0.2,
  upperArm: 0.31,
  forearm: 0.27,
  hand: 0.095,
  thigh: 0.46,
  shin: 0.44,
  foot: 0.2,
  limbWidth: 0.11,
};
// The rig's y = 0 is the ankles' height; the court is this far below it.
export const ANKLE = 0.075;
// The pelvis standing tall (rig y).
const TALL = 0.885;

// --- small vector helpers ---------------------------------------------------------------------
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const norm = a => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const jointAt = (buf, j) => [buf[j * S], buf[j * S + 1], buf[j * S + 2]];
/** A court-height point (y up from the court) in the rig's y. */
const rigY = p => [p[0], p[1] - ANKLE, p[2]];
/** A unit direction at `yaw` (rad, + toward the racket side) and `pitch` (rad, + up). */
export const dir = (yaw, pitch = 0) => [Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)];
const DEG = Math.PI / 180;

// --- fingers -------------------------------------------------------------------------------------
const curls = (side, f) => Object.fromEntries(FINGERS.map(n => [`${n}${side}`, f(n)]));
/** The editor's Grip preset (part-presets.ts), and the other hand's shapes. */
const HANDS_SHAPE = {
  grip: { curl: n => (n === 'thumb' ? 0.9 : n === 'pinky' ? 1.15 : 1.05), spread: -0.05 },
  relax: { curl: n => (n === 'thumb' ? 0.15 : n === 'index' ? 0.25 : 0.35), spread: 0 },
  open: { curl: n => (n === 'thumb' ? 0.1 : 0.12), spread: 0.15 },
  ball: { curl: n => (n === 'thumb' ? 0.45 : 0.55), spread: 0.12 },
  fist: { curl: n => (n === 'thumb' ? 0.7 : 1.45), spread: -0.1 },
  throat: { curl: n => (n === 'thumb' ? 0.6 : 0.75), spread: 0.05 },
};
function fingers(far) {
  const g = HANDS_SHAPE.grip;
  const f = HANDS_SHAPE[far] ?? HANDS_SHAPE.relax;
  return {
    curl: { ...curls('Near', g.curl), ...curls('Far', f.curl) },
    spread: { handNear: g.spread, handFar: f.spread },
  };
}

// --- hands and the racket ---------------------------------------------------------------------
const buf = R.createJointBuffer();
const rk = newRacket();
/** The other hand's racket frame, as racketOf reads the near one (mirrored: a left hand). */
function leftGrip(j, out) {
  const w = jointAt(j, Joint.wristFar);
  const h = jointAt(j, Joint.handFar);
  const len = dist(w, h) || 1;
  const d = norm(sub(h, w));
  let a = sub(jointAt(j, Joint.index1Far), jointAt(j, Joint.pinky1Far));
  a = norm(add(a, d, -dot(a, d)));
  // a left hand's palm: along × across
  const p = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
  const c = Math.cos(RACKET.tilt);
  const s = Math.sin(RACKET.tilt);
  const off = (RACKET.palm * len) / 0.095;
  out.grip = add(add(w, d, len * RACKET.along), p, off);
  out.up = [a[0] * c + d[0] * s, a[1] * c + d[1] * s, a[2] * c + d[2] * s];
  out.normal = p;
  out.dir = d;
  return out;
}
const lg = {};

/** Nelder–Mead: the x near `x0` (steps `step`) where f is least. */
function minimize(f, x0, step, iters = 500) {
  const n = x0.length;
  let pts = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const p = x0.slice();
    p[i] += step[i];
    pts.push(p);
  }
  let vals = pts.map(f);
  for (let it = 0; it < iters; it++) {
    const order = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    pts = order.map(i => pts[i]);
    vals = order.map(i => vals[i]);
    if (vals[n] - vals[0] < 1e-10) break;
    const c = Array.from({ length: n }, () => 0);
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) c[k] += pts[i][k] / n;
    const at = t => c.map((v, k) => v + t * (pts[n][k] - v));
    const r = at(-1);
    const fr = f(r);
    if (fr < vals[0]) {
      const e = at(-2);
      const fe = f(e);
      [pts[n], vals[n]] = fe < fr ? [e, fe] : [r, fr];
    } else if (fr < vals[n - 1]) {
      [pts[n], vals[n]] = [r, fr];
    } else {
      const k = at(fr < vals[n] ? -0.5 : 0.5);
      const fk = f(k);
      if (fk < Math.min(fr, vals[n])) [pts[n], vals[n]] = [k, fk];
      else {
        for (let i = 1; i <= n; i++) {
          pts[i] = pts[i].map((v, k2) => pts[0][k2] + (v - pts[0][k2]) * 0.5);
          vals[i] = f(pts[i]);
        }
      }
    }
  }
  return { x: pts[0], cost: vals[0] };
}

/** The pose with one hand's wrist (rig space) and angles set. */
function withHand(pose, hand, [wx, wy, wz, swivel, flex, twist, reach, shrug]) {
  if (reach !== undefined) {
    // the collarbone first: the wrist's target hangs from the shoulder it moves
    pose = {
      ...pose,
      reach: { ...pose.reach, [hand]: reach },
      shrug: { ...pose.shrug, [hand]: shrug },
    };
  }
  return {
    ...pose,
    [hand]: R.targetFromWorld(pose, PROPS, hand, v3(wx, wy, wz)),
    swivel: { ...pose.swivel, [hand]: swivel },
    flex: { ...pose.flex, [hand]: flex },
    twist: { ...pose.twist, [hand]: twist },
  };
}

const ARM = PROPS.upperArm + PROPS.forearm;
/** How far a wrist is past the arm's reach (m), from its shoulder. */
function overReach(pose, hand, w) {
  R.solvePose(pose, PROPS, buf);
  const sh = jointAt(buf, hand === 'handNear' ? Joint.shoulderNear : Joint.shoulderFar);
  return Math.max(0, dist(sh, w) - ARM * 0.995);
}

/**
 * Solves the racket arm so the racket's strings centre (`at`) or grip (`grip`) lands where
 * the key says, its shaft along `up` and face (palm side) along `n`: rig-space targets.
 */
/** How near the racket hand may come to its shoulder between keys (m): any nearer, it goes round. */
const KEEP_OUT = 0.34;

function solveRacket(pose, spec, prev, alts) {
  let goal = spec.at ? rigY(spec.at) : rigY(spec.grip);
  if (spec.keepOut && !spec.at) {
    R.solvePose(pose, PROPS, buf);
    const sh = jointAt(buf, Joint.shoulderNear);
    const v = sub(goal, sh);
    const d = Math.hypot(...v);
    if (d < KEEP_OUT) goal = add(sh, v, KEEP_OUT / Math.max(d, 1e-3));
  }
  const up = norm(spec.up);
  const n = spec.n && norm(add(spec.n, up, -dot(norm(spec.n), up)));
  const prior = spec.swivel ?? 0;
  const reach0 = pose.reach?.handNear ?? 0;
  const shrug0 = pose.shrug?.handNear ?? 0;
  const cost = x => {
    const p = withHand(pose, 'handNear', x);
    R.solvePose(p, PROPS, buf);
    racketOf(buf, rk);
    const pt = spec.at ? rk.head : rk.grip;
    let c = (dist(pt, goal) / 0.005) ** 2;
    c += (dist(rk.up, up) / 0.01) ** 2;
    if (n) c += (dist(rk.normal, n) / (spec.nTol ?? (spec.strict ? 0.015 : 0.12))) ** 2;
    c += ((x[3] - prior) / 0.9) ** 2;
    c += (x[4] / 1.2) ** 2 + twistOut(x[5]);
    c += ((x[6] - reach0) / 0.25) ** 2 + ((x[7] - shrug0) / 0.2) ** 2;
    if (prev) c += ((x[3] - prev[3]) / (alts ? 0.2 : 0.7)) ** 2;
    if (prev && alts) c += ((x[6] - prev[6]) / 0.04) ** 2 + ((x[7] - prev[7]) / 0.04) ** 2 + ((x[4] - prev[4]) / 0.25) ** 2;
    c += (Math.max(0, Math.abs(x[4]) - 1.25) / 0.05) ** 2;
    if (prev) c += ((x[5] - prev[5]) / (alts ? 0.2 : 0.6)) ** 2;
    const over = overReach(p, 'handNear', [x[0], x[1], x[2]]);
    c += (over / 0.003) ** 2;
    return c;
  };
  if (alts) {
    // between keys: run on from the frame before, or the keys either side, whichever fits best
    const pad = x => (x.length === 8 ? x : [...x, reach0, shrug0]);
    const tries = [prev, ...alts].filter(Boolean).map(x => warmStart(cost, pad(x)));
    const best = tries.reduce((a, b) => (b.cost < a.cost ? b : a));
    if (best.cost < 2000) return best;
  }
  return bestOf(cost, guessWrist(goal, up, spec.at), prev, prior, [reach0, shrug0]);
}

/**
 * How far a forearm twist is past what a forearm turns (rad, squared and weighted): from a
 * little past palm forward (0) to a little past palm back (π), the hand hanging.
 */
const TWIST = [-0.35, Math.PI + 0.35];
function twistOut(t) {
  const w = Math.atan2(Math.sin(t - 1.4), Math.cos(t - 1.4)) + 1.4;
  const out = Math.max(0, TWIST[0] - w, w - TWIST[1]);
  return (out / 0.05) ** 2;
}

/** Where the wrist about is for a racket at `goal` along `up`. */
function guessWrist(goal, up, head) {
  const g = head ? add(goal, up, -(RACKET.head - RACKET.grip)) : goal;
  return add(g, up, -0.05);
}

/** How good a solve run on from the last one must be to keep (frames run on; keys start afresh). */
const WARM_OK = { cost: 25 };

function bestOf(cost, w, prev, prior, collar) {
  // From the last solve first (keys and frames run on from each other): good enough, done.
  if (prev) {
    const r = warmStart(cost, prev);
    if (r.cost < WARM_OK.cost) return r;
  }
  const starts = [];
  if (prev) starts.push(prev.slice());
  for (const twist of [-1.5, 0, 1.5, 3]) {
    for (const flex of [-0.5, 0.4]) starts.push([w[0], w[1], w[2], prior, flex, twist, ...(collar ?? [])]);
  }
  const big = [0.05, 0.05, 0.05, 0.3, 0.3, 0.5, 0.15, 0.1];
  const small = [0.01, 0.01, 0.01, 0.08, 0.08, 0.1, 0.04, 0.03];
  let best = null;
  for (const x0 of starts) {
    let r = minimize(cost, x0, big.slice(0, x0.length), 500);
    r = minimize(cost, r.x, small.slice(0, x0.length), 400);
    if (!best || r.cost < best.cost) best = r;
  }
  return best;
}

/**
 * Solves the other hand onto the racket handle (`off` m up the shaft from the racket hand's
 * grip), or the throat, either palm facing: from the near hand already solved in `pose`.
 */
function solveOnRacket(pose, off, prev) {
  R.solvePose(pose, PROPS, buf);
  racketOf(buf, rk);
  const goal = add(rk.grip, rk.up, off);
  const up = rk.up.slice();
  const n = rk.normal.slice();
  const costs = [1, -1].map(sign => x => {
      const p = withHand(pose, 'handFar', x);
      R.solvePose(p, PROPS, buf);
      leftGrip(buf, lg);
      let c = (dist(lg.grip, goal) / 0.005) ** 2;
      c += (dist(lg.up, up) / 0.03) ** 2;
      c += (dist(lg.normal, [n[0] * sign, n[1] * sign, n[2] * sign]) / 0.06) ** 2;
      c += ((x[3] - 0) / 0.8) ** 2;
      c += (Math.max(0, Math.abs(x[4]) - 1.25) / 0.05) ** 2 + twistOut(x[5]);
      if (prev) c += ((x[5] - prev[5]) / 1.0) ** 2;
      c += (overReach(p, 'handFar', [x[0], x[1], x[2]]) / 0.003) ** 2;
      return c;
  });
  const pick = rs => rs.reduce((a, b) => (b.cost < a.cost ? b : a));
  if (prev) {
    const warm = pick(costs.map(cost => warmStart(cost, prev)));
    if (warm.cost < WARM_OK.cost) return warm;
  }
  return pick(costs.map(cost => bestOf(cost, add(goal, up, -0.05), null, 0)));
}

function warmStart(cost, prev) {
  const n = prev.length;
  const r = minimize(cost, prev.slice(), [0.03, 0.03, 0.03, 0.2, 0.2, 0.3, 0.1, 0.06].slice(0, n), 500);
  return minimize(cost, r.x, [0.01, 0.01, 0.01, 0.05, 0.05, 0.08, 0.03, 0.02].slice(0, n), 300);
}

/** Solves the free hand: wrist at `at` (court heights), the palm facing `palm`, the hand along `d`. */
function solveFree(pose, hand, spec, prev) {
  const goal = rigY(spec.at);
  const palm = spec.palm && norm(spec.palm);
  const along = spec.d && norm(spec.d);
  const cost = x => {
    const p = withHand(pose, hand, x);
    R.solvePose(p, PROPS, buf);
    const w = jointAt(buf, hand === 'handNear' ? Joint.wristNear : Joint.wristFar);
    let c = (dist(w, goal) / 0.005) ** 2;
    if (palm || along) {
      leftGrip(buf, lg);
      if (palm) c += (dist(lg.normal, palm) / 0.05) ** 2;
      if (along) c += (dist(lg.dir, along) / 0.08) ** 2;
    }
    c += ((x[3] - (spec.swivel ?? 0)) / 0.5) ** 2;
    c += ((x[4] - (spec.flex ?? 0.1)) / (palm ? 1.2 : 0.3)) ** 2;
    c += twistOut(x[5]);
    if (!palm && !along) c += ((x[5] - (spec.twist ?? 1.4)) / 0.3) ** 2;
    else if (prev) c += ((x[5] - prev[5]) / 1.5) ** 2;
    c += (overReach(p, hand, [x[0], x[1], x[2]]) / 0.003) ** 2;
    return c;
  };
  return bestOf(cost, goal, prev, spec.swivel ?? 0);
}

// --- keys ------------------------------------------------------------------------------------
/** A full rest pose, every channel set. */
const BASE = (() => {
  const p = R.clonePose(R.REST_POSE);
  return { ...p, bend: 0, yaw: 0, pitch: 0, bank: 0, roll: 0, upperRoll: 0, spineTwist: 0, hipTilt: 0 };
})();

const merge = (a, b) => {
  if (b === undefined) return a;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) return b;
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) };
  for (const [k, v] of Object.entries(b)) out[k] = REPLACED.has(k) ? v : merge(out[k], v);
  return out;
};
// What a key sets whole, rather than merged onto the key before's.
const REPLACED = new Set(['racket', 'left', 'arm']);

/**
 * A key's pose from its spec (merged onto the key before's):
 *   body  { px, pz (pelvis off the root), drop (below standing tall), lean, bend, yaw, twist
 *           (spineTwist), roll, upperRoll, hipTilt, head (headTilt), pitch, shrug/reach [near, far] }
 *   near, far  the right and left foot: { x, z (court, the root frame), y (ankle lift), heel
 *           (on the ball, the heel this high), turn (rad the toes point off forward, + toward
 *           the racket side), point (flex in the air) }
 *   racket { at | grip: [x, y, z] (court heights), up: shaft, n: face (palm side), swivel }
 *   left  { at: wrist, palm, d, swivel, flex, twist } | { on: m up the handle from the grip }
 *   hand  the left hand's fingers: 'relax' | 'open' | 'ball' | 'fist' | 'throat' | 'grip'
 */
function buildPose(spec, prevSol = {}) {
  const b = spec.body ?? {};
  let pose = {
    ...BASE,
    pelvis: { x: b.px ?? 0, y: TALL - (b.drop ?? 0), ...(b.pz ? { z: b.pz } : {}) },
    lean: b.lean ?? 0.05,
    bend: b.bend ?? 0,
    yaw: b.yaw ?? 0,
    spineTwist: b.twist ?? 0,
    roll: b.roll ?? 0,
    upperRoll: b.upperRoll ?? 0,
    hipTilt: b.hipTilt ?? 0,
    headTilt: b.head ?? 0,
    pitch: b.pitch ?? 0,
    shrug: { handNear: b.shrug?.[0] ?? 0, handFar: b.shrug?.[1] ?? 0 },
    reach: { handNear: b.reach?.[0] ?? 0, handFar: b.reach?.[1] ?? 0 },
    swivel: { ...BASE.swivel },
    flex: { ...BASE.flex },
    twist: { ...BASE.twist },
    toes: { footNear: 0, footFar: 0 },
    ...fingers(spec.hand ?? 'relax'),
  };
  for (const [foot, f] of [
    ['footNear', spec.near],
    ['footFar', spec.far],
  ]) {
    if (!f) continue;
    const y = f.y ?? 0;
    const turn = f.turn ?? 0;
    const place = p => ({ ...p, [foot]: R.targetFromWorld(p, PROPS, foot, v3(f.x, y, f.z)) });
    pose = place(pose);
    // The knee's swivel turns the toes `turn` off forward (body yaw taken out).
    const ankle = R.targetInWorld(pose, PROPS, foot);
    const toe = v3(ankle.x + Math.cos(turn) * PROPS.foot, ankle.y - 0.02, ankle.z + Math.sin(turn) * PROPS.foot);
    pose = R.withScalar(pose, `swivel.${foot}`, bestSwivel(pose, foot, toe));
    if (y <= 0.001 && f.heel) pose = toesDown({ ...pose, [foot]: { ...pose[foot], y: f.heel } }, PROPS, foot, FLAT_FLOOR);
    else if (y <= 0.001) pose = plant(pose, PROPS, foot, FLAT_FLOOR);
    else {
      // pointed in the air, but no further than keeps the toes off the court
      const [ball, toe] = foot === 'footNear' ? [Joint.ballNear, Joint.toeNear] : [Joint.ballFar, Joint.toeFar];
      pose = R.withScalar(pose, `toes.${foot}`, f.toes ?? 0);
      for (let flex = f.point ?? 0.3; ; flex -= 0.05) {
        pose = R.withScalar(pose, `flex.${foot}`, Math.round(flex * 1000) / 1000);
        R.solvePose(pose, PROPS, buf);
        if (Math.min(buf[ball * S + 1], buf[toe * S + 1]) > 0.004 || flex < -0.8) break;
      }
    }
  }
  const sol = {};
  if (spec.racket) {
    const pr = prevSol.racket;
    const r = solveRacket(pose, spec.racket, pr && (pr.length === 8 ? pr : [...pr, 0, 0]), prevSol.alts);
    sol.racket = r.x;
    sol.racketCost = r.cost;
    pose = withHand(pose, 'handNear', r.x);
  } else if (spec.arm) {
    const r = solveFree(pose, 'handNear', spec.arm, prevSol.racket?.slice(0, 6));
    sol.racket = r.x;
    pose = withHand(pose, 'handNear', r.x);
  }
  const L = spec.left;
  if (L && L.on != null) {
    const r = solveOnRacket(pose, L.on, prevSol.left);
    sol.left = r.x;
    sol.leftCost = r.cost;
    pose = withHand(pose, 'handFar', r.x);
  } else if (L) {
    const r = solveFree(pose, 'handFar', L, prevSol.left);
    sol.left = r.x;
    pose = withHand(pose, 'handFar', r.x);
  }
  return { pose, sol };
}

function bestSwivel(pose, foot, toe) {
  const tj = foot === 'footNear' ? Joint.toeNear : Joint.toeFar;
  const err = s => {
    R.solvePose(R.withScalar(pose, `swivel.${foot}`, s), PROPS, buf);
    const t = jointAt(buf, tj);
    return Math.hypot(t[0] - toe.x, t[2] - toe.z);
  };
  let best = 0;
  let e = err(0);
  for (const step of [0.1, 0.02, 0.005]) {
    const from = best;
    for (let k = -8; k <= 8; k++) {
      const s = Math.max(-1.6, Math.min(1.6, from + k * step));
      const v = err(s);
      if (v < e) [best, e] = [s, v];
    }
  }
  return Math.round(best * 1000) / 1000;
}

const round = n => Math.round(n * 1e5) / 1e5;
function roundPose(p) {
  return JSON.parse(JSON.stringify(p, (k, v) => (typeof v === 'number' ? round(v) : v)));
}

/** Twist and swivel angles kept within a turn of the key before's, so blends take the short way. */
function unwrap(pose, prev) {
  if (!prev) return pose;
  for (const g of ['twist', 'swivel', 'flex']) {
    for (const k of Object.keys(pose[g] ?? {})) {
      const a = prev[g]?.[k];
      if (a !== undefined) pose[g][k] = a + Math.atan2(Math.sin(pose[g][k] - a), Math.cos(pose[g][k] - a));
    }
  }
  return pose;
}

const issues = [];

// --- interpolating keys -------------------------------------------------------------------------
/** Tangents (per frame) for a curve through `ys` at `ts`: Catmull–Rom, flat at the ends; `monotone` keeps it from overshooting. */
function tangents(ts, ys, monotone) {
  const n = ts.length;
  const m = ys.map(() => 0);
  for (let i = 1; i < n - 1; i++) {
    m[i] = (ys[i + 1] - ys[i - 1]) / (ts[i + 1] - ts[i - 1]);
    if (monotone) {
      const d0 = (ys[i] - ys[i - 1]) / (ts[i] - ts[i - 1]);
      const d1 = (ys[i + 1] - ys[i]) / (ts[i + 1] - ts[i]);
      if (d0 * d1 <= 0) m[i] = 0;
      else m[i] = Math.sign(m[i]) * Math.min(Math.abs(m[i]), 3 * Math.abs(d0), 3 * Math.abs(d1));
    }
  }
  return m;
}
/** The cubic Hermite curve through (ts, ys) with tangents `m`, at `t`. */
function hermite(ts, ys, m, t) {
  let i = 0;
  while (i < ts.length - 2 && t > ts[i + 1]) i++;
  const h = ts[i + 1] - ts[i];
  const u = Math.min(1, Math.max(0, (t - ts[i]) / h));
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * m[i + 1]
  );
}
/** A number per key through time, smooth. */
function track(ts, ys, monotone = true) {
  const m = tangents(ts, ys, monotone);
  return t => hermite(ts, ys, m, t);
}

/**
 * A move from keys [frame, spec, ease?]: each spec merges onto the one before. Between keys the
 * spec is interpolated (smooth curves through the keys: the racket's head on its own path, its
 * shaft turning with it), every frame is solved on from the one before, and the frames are
 * fitted to keys with the editor's Import pipeline (fit.ts). A foot that moves between two keys
 * on the court steps (lifts) on the way. `active` is the contact frames [from, to].
 */
function keyed(name, { frames, keys, active, tags = [], folder, travel }) {
  if (ONLY.length && !ONLY.includes(name)) return null;
  // the keys' specs, whole, and their poses
  let spec = {};
  let sol = {};
  const ks = [];
  for (const [frame, s] of keys) {
    spec = merge(spec, s);
    const here = travelled(spec, travel, frame / FPS);
    WARM_OK.cost = 25;
    const built = buildPose(here, sol);
    sol = built.sol;
    if (REPORT && here.racket) console.log(`  ${name} @${frame}: ${explain(built.pose, here)}`);
    if (here.racket && missed(built.pose, here.racket)) issues.push(`${name} @${frame}: racket off: ${explain(built.pose, here)}`);
    if (here.left?.on != null) {
      R.solvePose(built.pose, PROPS, buf);
      racketOf(buf, rk);
      leftGrip(buf, lg);
      const d = dist(lg.grip, add(rk.grip, rk.up, here.left.on));
      const a = Math.acos(Math.min(1, dot(lg.up, rk.up))) / DEG;
      if (d > 0.015 || a > 15) issues.push(`${name} @${frame}: left hand off the racket by ${(d * 100).toFixed(1)} cm, ${a.toFixed(0)}°`);
    }
    ks.push({ frame, spec, here, pose: built.pose, sol: built.sol });
  }
  const ts = ks.map(k => k.frame);
  // the racket: its head's path and its shaft's way, through every key
  // the hand's path (the racket turning about it), so a swing round the body doesn't cut through it
  const grips = ks.map(k => {
    const r = k.here.racket;
    const u = norm(r.up);
    return r.grip ? r.grip : add(r.at, u, -(RACKET.head - RACKET.grip));
  });
  const ups = ks.map(k => norm(k.here.racket.up));
  const gripAt = [0, 1, 2].map(d => track(ts, grips.map(h => h[d]), false));
  const upAt = [0, 1, 2].map(d => track(ts, ups.map(u => u[d]), false));
  // the body's numbers and the feet's
  const num = (get, monotone = true) => track(ts, ks.map(k => get(k.here) ?? 0), monotone);
  const BODY = ['px', 'pz', 'drop', 'lean', 'bend', 'yaw', 'twist', 'roll', 'upperRoll', 'hipTilt', 'head', 'pitch'];
  const body = Object.fromEntries(BODY.map(k => [k, num(h => h.body?.[k] ?? (k === 'lean' ? 0.05 : 0))]));
  const collar = ['shrug', 'reach'].map(k => [0, 1].map(i => num(h => h.body?.[k]?.[i] ?? 0)));
  const FOOT = ['x', 'z', 'y', 'heel', 'turn', 'point'];
  const feet = Object.fromEntries(
    ['near', 'far'].map(f => [f, Object.fromEntries(FOOT.map(k => [k, num(h => h[f]?.[k] ?? (k === 'point' ? 0.3 : 0))]))]),
  );

  const poses = [];
  const cramped = [];
  let lastUp = null;
  let lastSpecUp = null;
  let prevSol = { racket: ks[0].sol.racket, left: ks[0].sol.left };
  let prevPose = null;
  for (let f = 0; f < frames; f++) {
    let i = 0;
    while (i < ks.length - 2 && f > ks[i + 1].frame) i++;
    const [a, b] = [ks[i], ks[Math.min(i + 1, ks.length - 1)]];
    const t = b.frame > a.frame ? Math.min(1, Math.max(0, (f - a.frame) / (b.frame - a.frame))) : 0;
    const exact = ks.find(k => k.frame === f);
    const sp = {
      body: { ...Object.fromEntries(BODY.map(k => [k, body[k](f)])), shrug: collar[0].map(c => c(f)), reach: collar[1].map(c => c(f)) },
      hand: (t < 0.5 ? a : b).here.hand,
    };
    for (const side of ['near', 'far']) {
      const ft = Object.fromEntries(FOOT.map(k => [k, feet[side][k](f)]));
      const [fa, fb] = [a.here[side], b.here[side]];
      // stepping from one place on the court to another: up and over
      const moved = fa && fb && Math.hypot(fb.x - fa.x, fb.z - fa.z);
      if (moved > 0.03 && !(fa.y > 0) && !(fb.y > 0) && t > 0 && t < 1) {
        ft.y = Math.max(ft.y, Math.min(0.1, 0.04 + moved * 0.12) * Math.sin(Math.PI * t));
        if (ft.y > 0.001) ft.heel = 0;
      }
      if (ft.y < 0.002) ft.y = 0;
      if (ft.heel < 0.004) ft.heel = 0;
      sp[side] = ft;
    }
    const ra = a.here.racket;
    const rb = b.here.racket;
    sp.racket = { grip: gripAt.map(c => c(f)), up: norm(upAt.map(c => c(f))), swivel: lerp(ra.swivel ?? 0, rb.swivel ?? 0, t), keepOut: true };
    if (exact) sp.racket = exact.here.racket;
    else {
      // the face turns toward a key's that's set, the nearer the firmer
      const faceOf = (k, w) => k.here.racket.n && { n: k.here.racket.n, tol: (k.here.racket.strict ? 0.015 : 0.12) / Math.max(w * w, 0.01) };
      const fa = faceOf(a, 1 - t);
      const fb = faceOf(b, t);
      // both set: the face turns from one to the other; one: it eases toward that one
      const face = fa && fb ? { n: norm(add(fa.n, sub(fb.n, fa.n), smooth(t))), tol: Math.min(fa.tol, fb.tol) } : (fa ?? fb);
      if (face && face.tol < 1) Object.assign(sp.racket, { n: face.n, nTol: face.tol });
    }
    // the other hand: on the racket where both keys have it there, else between the keys' own
    const both = a.here.left?.on != null && b.here.left?.on != null;
    if (both) sp.left = { on: lerp(a.here.left.on, b.here.left.on, t) };
    WARM_OK.cost = 400;
    let built = buildPose(sp, { ...prevSol, alts: exact ? [exact.sol.racket] : [a.sol.racket, b.sol.racket] });
    // a racket that flips round in a frame where its spec hardly turns: solve on from the last frame alone
    if (lastUp) {
      R.solvePose(built.pose, PROPS, buf);
      racketOf(buf, rk);
      const flip = Math.acos(Math.min(1, dot(rk.up, lastUp)));
      const asked = lastSpecUp ? Math.acos(Math.min(1, dot(sp.racket.up ?? lastSpecUp, lastSpecUp))) : 0;
      if (flip > 0.7 && flip > asked + 0.4) {
        const again = buildPose(sp, { ...prevSol, alts: [prevSol.racket] });
        R.solvePose(again.pose, PROPS, buf);
        racketOf(buf, rk);
        if (Math.acos(Math.min(1, dot(rk.up, lastUp))) < flip) built = again;
      }
    }
    R.solvePose(built.pose, PROPS, buf);
    racketOf(buf, rk);
    lastUp = rk.up.slice();
    lastSpecUp = sp.racket.up && norm(sp.racket.up);
    if (process.env.DEBUG_FRAMES) console.log(name, f, built.sol.racketCost?.toFixed(1), explain(built.pose, sp));
    {
      R.solvePose(built.pose, PROPS, buf);
      const r = dist(jointAt(buf, Joint.shoulderNear), jointAt(buf, Joint.wristNear)) / ARM;
      if (r < 0.4) cramped.push(f);
    }
    let pose = built.pose;
    if (!both) pose = leftBetween(pose, a.pose, b.pose, smooth(t));
    // the fingers as the keys have them
    pose.curl = Object.fromEntries(Object.keys(a.pose.curl).map(k => [k, lerp(a.pose.curl[k], b.pose.curl[k] ?? 0, smooth(t))]));
    pose.spread = { handNear: lerp(a.pose.spread.handNear, b.pose.spread.handNear, smooth(t)), handFar: lerp(a.pose.spread.handFar, b.pose.spread.handFar, smooth(t)) };
    prevSol = { racket: built.sol.racket, left: both ? built.sol.left : prevSol.left };
    if (!both) prevSol.left = handOf(pose, 'handFar');
    pose = unwrap(roundPose(pose), prevPose);
    prevPose = pose;
    poses.push(pose);
  }
  if (cramped.length) issues.push(`${name}: the racket hand cramped against the shoulder on frames ${cramped.join(' ')}`);
  const move = posesToMove(name, poses, PROPS, 0.004);
  move.tags = [...tags];
  if (active) move.active = { from: active[0], to: active[1], joint: 'handNear', radius: 0.16 };
  move.folder = folder;
  return move;
}

const smooth = t => t * t * (3 - 2 * t);

/** The other hand's channels `t` of the way between two poses' (the wrist swung about the shoulder, as the rig blends it). */
function leftBetween(pose, a, b, t) {
  const near = { ...b, twist: { ...b.twist, handFar: a.twist.handFar + Math.atan2(Math.sin(b.twist.handFar - a.twist.handFar), Math.cos(b.twist.handFar - a.twist.handFar)) } };
  const blended = R.lerpPose(a, near, t);
  return {
    ...pose,
    handFar: blended.handFar,
    swivel: { ...pose.swivel, handFar: blended.swivel.handFar ?? 0 },
    flex: { ...pose.flex, handFar: blended.flex.handFar ?? 0 },
    twist: { ...pose.twist, handFar: blended.twist.handFar ?? 0 },
  };
}

/** A hand's solve vector (wrist in the rig's world, swivel, flex, twist) from a pose. */
function handOf(pose, hand) {
  R.solvePose(pose, PROPS, buf);
  const w = jointAt(buf, hand === 'handNear' ? Joint.wristNear : Joint.wristFar);
  return [...w, pose.swivel?.[hand] ?? 0, pose.flex?.[hand] ?? 0, pose.twist?.[hand] ?? 0];
}

/** Whether a solved key misses its racket spec: by 1.5 cm, 5° of shaft, or 6° of face where strict. */
function missed(pose, r) {
  R.solvePose(pose, PROPS, buf);
  racketOf(buf, rk);
  const goal = r.at ? rigY(r.at) : rigY(r.grip);
  const off = dist(r.at ? rk.head : rk.grip, goal);
  const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) / DEG;
  return off > 0.015 || ang(rk.up, r.up) > 5 || (r.strict && r.n && ang(rk.normal, r.n) > 6);
}

/** How a solved key misses its racket spec: cm, and degrees off the shaft and face. */
function explain(pose, spec) {
  R.solvePose(pose, PROPS, buf);
  racketOf(buf, rk);
  const r = spec.racket;
  const goal = r.at ? rigY(r.at) : rigY(r.grip);
  const pt = r.at ? rk.head : rk.grip;
  const ang = (a, b) => (Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) / DEG).toFixed(0);
  const sh = jointAt(buf, Joint.shoulderNear);
  const w = jointAt(buf, Joint.wristNear);
  const ch = jointAt(buf, Joint.shoulderNear).map(v => v.toFixed(2)).join(',');
  return `sh ${ch} pos ${(dist(pt, goal) * 100).toFixed(1)}cm up ${ang(rk.up, r.up)}° n ${r.n ? ang(rk.normal, r.n) : '-'}° reach ${(dist(sh, w) / ARM).toFixed(2)} sw ${pose.swivel.handNear.toFixed(2)} fl ${pose.flex.handNear.toFixed(2)} tw ${pose.twist.handNear.toFixed(2)}`;
}

/** A spec carried back by the root's travel so far (the sim carries the root instead). */
function travelled(spec, travel, t) {
  if (!travel) return spec;
  const k = travelAt(travel, t);
  const [df, ds] = [travel.f * k, (travel.s ?? 0) * k];
  const shift = f => f && { ...f, x: f.x - df, z: f.z - ds };
  const out = { ...spec, body: { ...spec.body, px: (spec.body?.px ?? 0) - df, pz: (spec.body?.pz ?? 0) - ds } };
  out.near = shift(spec.near);
  out.far = shift(spec.far);
  const pt = p => p && [p[0] - df, p[1], p[2] - ds];
  if (spec.racket) out.racket = { ...spec.racket, ...(spec.racket.at ? { at: pt(spec.racket.at) } : { grip: pt(spec.racket.grip) }) };
  if (spec.left?.at) out.left = { ...spec.left, at: pt(spec.left.at) };
  return out;
}
export const travelAt = (tr, t) => {
  const q = Math.min(1, Math.max(0, (t - tr.from) / (tr.to - tr.from)));
  return q * q * (3 - 2 * q);
};


/** A loop made per frame from `at(q)` (q 0..1 round the cycle) and fitted to keys. */
function looped(name, { frames, at, tags = [], folder, tolerance = 0.004 }) {
  if (ONLY.length && !ONLY.includes(name)) return null;
  const poses = [];
  let sol = {};
  let prevPose = null;
  for (let f = 0; f < frames; f++) {
    const built = buildPose(at(f / frames), sol);
    sol = built.sol;
    const pose = unwrap(roundPose(built.pose), prevPose);
    prevPose = pose;
    poses.push(pose);
  }
  const move = posesToMove(name, poses, PROPS, tolerance);
  move.tags = [...tags];
  move.loop = true;
  move.folder = folder;
  return move;
}

// --- the shared stances ----------------------------------------------------------------------
const up45 = norm([0.75, 0.62, -0.2]);
/** The ready position: knees flexed, weight forward, the racket in front held at the throat. */
const READY = {
  body: { px: 0.02, pz: 0, drop: 0.11, lean: 0.24, bend: 0.06, yaw: 0, twist: 0, head: -0.12, roll: 0, upperRoll: 0, hipTilt: 0 },
  near: { x: 0, z: 0.31, turn: 0.3, heel: 0, y: 0 },
  far: { x: 0.02, z: -0.31, turn: -0.3, heel: 0, y: 0 },
  racket: { grip: [0.34, 0.98, 0.12], up: up45, n: [0, 0, -1], swivel: 0.2 },
  left: { on: 0.27 },
  hand: 'throat',
};
/** Ready, the feet a touch wider and the heels up: the split step's landing. */
const READY_WIDE = { ...READY, near: { ...READY.near, z: 0.36, heel: 0.03 }, far: { ...READY.far, z: -0.36, heel: 0.03 } };

/** The serve's stance: side-on behind the baseline, the front (left) foot toward the net post. */
const SERVE_STANCE = {
  body: { px: 0, pz: 0.02, drop: 0.03, lean: 0.08, bend: 0.04, yaw: 1.05, twist: 0.12, head: 0.05, roll: 0, upperRoll: 0, hipTilt: 0 },
  near: { x: -0.2, z: 0.3, turn: 1.4, heel: 0, y: 0 },
  far: { x: 0.18, z: -0.06, turn: 0.75, heel: 0, y: 0 },
  racket: { grip: [0.22, 1.02, 0.1], up: [0.9, 0.3, -0.15], n: [0, 0, -1] },
  left: { on: 0.3 },
  hand: 'ball',
};

export const MOVES_DEF = [];
const def = m => MOVES_DEF.push(m);
const L = 'Locomotion';
const G = 'Groundstrokes';
const NET = 'Net';
const SERVE = 'Serve';
const REACT = 'Reactions';

// --- locomotion: loops, made per frame ---------------------------------------------------------
const wrap01 = q => q - Math.floor(q);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = 2 * Math.PI;

/**
 * A foot over a cycle: on the court for `ground` of it, travelling from `land` to `lift` (root
 * frame, straight and steady: the root goes the other way as fast), then through the air by the
 * `air` points ([q 0..1 of the air time, x, y, z]).
 */
function stepper({ ground, land, lift, air, heel = [0, 0], heelFrom = 0.6 }) {
  return q => {
    if (q < ground) {
      const t = q / ground;
      const h = t < heelFrom ? heel[0] : lerp(heel[0], heel[1], (t - heelFrom) / (1 - heelFrom));
      return { x: lerp(land[0], lift[0], t), z: lerp(land[1], lift[1], t), y: 0, heel: h };
    }
    const t = (q - ground) / (1 - ground);
    const pts = [[0, lift[0], heel[1], lift[1]], ...air, [1, land[0], 0, land[1]]];
    let k = 0;
    while (k < pts.length - 2 && t > pts[k + 1][0]) k++;
    const [a, b] = [pts[k], pts[k + 1]];
    const s = (t - a[0]) / (b[0] - a[0]);
    const e = s * s * (3 - 2 * s);
    // smooth through the air, steady on and off the court
    const ee = k === 0 ? s * (2 - s) : k === pts.length - 2 ? s * s : e;
    // off the court at once, and down on it only at the end
    const clear = 0.05 * Math.sqrt(Math.sin(Math.PI * t));
    return { x: lerp(a[1], b[1], ee), y: Math.max(0.005, clear, lerp(a[2], b[2], e)), z: lerp(a[3], b[3], ee) };
  };
}

def(() =>
  looped('ready', {
    folder: L,
    tags: ['loop', 'stance'],
    frames: 72,
    at: q => {
      const bob = Math.sin(q * TAU * 2);
      const sway = Math.sin(q * TAU);
      return merge(READY, {
        body: { drop: 0.11 + 0.012 * bob, pz: 0.018 * sway, roll: -0.02 * sway, head: -0.12 + 0.02 * bob },
        near: { heel: 0.015 },
        far: { heel: 0.015 },
        racket: { ...READY.racket, grip: [0.34, 0.98 - 0.01 * bob, 0.12 + 0.012 * sway] },
      });
    },
  }),
);

def(() => {
  // Running: 0.6 s a cycle of two strides, the feet down for 30 % of it each.
  const frames = 36;
  const stride = 2.6;
  const g = 0.3;
  const D = stride * g;
  const foot = z =>
    stepper({
      ground: g,
      land: [0.36, z],
      lift: [0.36 - D, z * 1.1],
      heel: [0, 0.1],
      heelFrom: 0.45,
      air: [
        [0.3, -0.38, 0.3, z * 1.2],
        [0.62, 0.12, 0.3, z],
        [0.86, 0.36, 0.08, z],
      ],
    });
  const Rf = foot(0.11);
  const Lf = foot(-0.11);
  return looped('run', {
    folder: L,
    tags: ['loop', 'run'],
    frames,
    at: q => {
      const c = Math.cos(q * TAU);
      const r = Rf(q);
      const l = Lf(wrap01(q - 0.5));
      return {
        body: {
          drop: 0.08 - 0.035 * Math.cos(TAU * 2 * (q - 0.41)),
          px: 0.03,
          lean: 0.26,
          bend: 0.04,
          yaw: -0.12 * c,
          twist: 0.26 * c,
          hipTilt: 0.05 * Math.sin(q * TAU),
          head: -0.15,
        },
        near: { ...r, turn: 0.08, point: r.y > 0.02 ? 0.45 : 0 },
        far: { ...l, turn: -0.08, point: l.y > 0.02 ? 0.45 : 0 },
        arm: { at: [lerp(0.2, -0.08, (1 + c) / 2), lerp(1.08, 0.98, (1 + c) / 2), 0.3], twist: 1.5, flex: 0.15, swivel: 0.3 },
        left: { at: [lerp(-0.22, 0.24, (1 + c) / 2), lerp(0.95, 1.18, (1 + c) / 2), lerp(-0.25, -0.12, (1 + c) / 2)], twist: 1.5, flex: 0.1, swivel: -0.3 },
        hand: 'fist',
      };
    },
  });
});

def(() => {
  // The shuffle to the racket side: a gallop, the lead (right) foot out, the left closing in.
  const frames = 30;
  const stride = 1.3;
  const g = 0.55;
  const D = stride * g;
  const A = D / 2;
  // the feet 0.25–0.6 m apart: the trailing foot lands 0.12 of a cycle after the lead
  const Rf = stepper({ ground: g, land: [0.02, 0.24 + A], lift: [0.02, 0.24 - A], heel: [0.02, 0.02], air: [[0.5, 0.02, 0.09, 0.24]] });
  const Lf = stepper({ ground: g, land: [0.0, -0.16 + A], lift: [0.0, -0.16 - A], heel: [0.02, 0.02], air: [[0.5, 0.0, 0.08, -0.16]] });
  return looped('shuffle', {
    folder: L,
    tags: ['loop', 'shuffle'],
    frames,
    at: q => {
      const r = Rf(q);
      const l = Lf(wrap01(q - 0.12));
      const mid = (r.z + l.z) / 2 - 0.04;
      return merge(READY, {
        body: { drop: 0.15 - 0.02 * Math.cos(TAU * 2 * q), pz: 0.35 * mid + 0.04, roll: -0.04 * Math.sin(TAU * q) },
        near: { ...r, turn: 0.2, point: 0.1 },
        far: { ...l, turn: -0.2, point: 0.1 },
      });
    },
  });
});

def(() => {
  // Backpedalling: quick short steps back on the balls of the feet.
  const frames = 30;
  const stride = 1.2;
  const g = 0.55;
  const D = stride * g;
  const foot = z =>
    stepper({
      ground: g,
      land: [-D / 2 - 0.02, z],
      lift: [D / 2 - 0.02, z],
      heel: [0.05, 0.08],
      air: [[0.5, 0, 0.13, z]],
    });
  const Rf = foot(0.17);
  const Lf = foot(-0.17);
  return looped('backpedal', {
    folder: L,
    tags: ['loop', 'backpedal'],
    frames,
    at: q => {
      const r = Rf(q);
      const l = Lf(wrap01(q - 0.5));
      return merge(READY, {
        body: { drop: 0.13 - 0.02 * Math.cos(TAU * 2 * q), lean: 0.18, yaw: 0.06 * Math.cos(TAU * q), px: -0.02 },
        near: { ...r, turn: 0.25, point: 0.2 },
        far: { ...l, turn: -0.25, point: 0.2 },
      });
    },
  });
});

def(() => {
  // Walking between points, the racket carried in the hand.
  const frames = 66;
  const stride = 1.5;
  const g = 0.62;
  const D = stride * g;
  const foot = z =>
    stepper({
      ground: g,
      land: [0.42, z],
      lift: [0.42 - D, z],
      heel: [0, 0.12],
      heelFrom: 0.65,
      air: [
        [0.35, -0.2, 0.1, z],
        [0.75, 0.3, 0.06, z],
      ],
    });
  const Rf = foot(0.1);
  const Lf = foot(-0.1);
  return looped('walk', {
    folder: L,
    tags: ['loop', 'walk'],
    frames,
    at: q => {
      const c = Math.cos(q * TAU);
      const r = Rf(q);
      const l = Lf(wrap01(q - 0.5));
      return {
        body: {
          drop: 0.03 - 0.015 * Math.cos(TAU * 2 * (q - 0.31)),
          lean: 0.05,
          yaw: -0.08 * c,
          twist: 0.14 * c,
          hipTilt: 0.04 * Math.sin(q * TAU),
          head: 0.05,
        },
        near: { ...r, turn: 0.1, point: 0.2 },
        far: { ...l, turn: -0.1, point: 0.2 },
        arm: { at: [lerp(0.12, -0.04, (1 + c) / 2), 0.9, 0.27], twist: 1.4, flex: 0.2, swivel: 0.3 },
        left: { at: [lerp(-0.14, 0.14, (1 + c) / 2), 0.86, -0.24], twist: 1.5, flex: 0.15, swivel: -0.2 },
        hand: 'relax',
      };
    },
  });
});

def(() =>
  keyed('split', {
    folder: L,
    tags: ['react', 'split'],
    frames: 24,
    keys: [
      [0, READY],
      [5, { body: { drop: 0.15 } }],
      [9, { body: { drop: 0.03 }, near: { heel: 0.07 }, far: { heel: 0.07 } }, 'out'],
      [12, { body: { drop: 0.0 }, near: { y: 0.05, heel: 0, point: 0.45, z: 0.34 }, far: { y: 0.05, heel: 0, point: 0.45, z: -0.34 } }, 'out'],
      [16, { body: { drop: 0.14 }, near: { y: 0, heel: 0.03, z: 0.36 }, far: { y: 0, heel: 0.03, z: -0.36 } }, 'in'],
      [23, READY_WIDE],
    ],
  }),
);

// --- groundstrokes -----------------------------------------------------------------------------
def(() =>
  keyed('forehand', {
    folder: G,
    tags: ['swing', 'drive'],
    frames: 66,
    active: [24, 26],
    keys: [
      [0, READY],
      // unit turn: hips and shoulders coil to the racket side, the racket goes back with them
      [
        10,
        {
          body: { yaw: 0.55, twist: 0.45, drop: 0.13, pz: 0.04, head: -0.05 },
          near: { x: -0.08, z: 0.36, turn: 0.9 },
          racket: { grip: [0.05, 1.12, 0.45], up: [-0.1, 0.95, 0.25] },
          left: { at: [0.42, 1.2, 0.18], palm: [0, -0.4, 1], d: [1, 0.1, 0.1] },
          hand: 'open',
        },
      ],
      // the loop's top: racket head high behind
      [
        18,
        {
          body: { yaw: 0.7, twist: 0.55, drop: 0.16, pz: 0.07 },
          racket: { grip: [-0.22, 1.2, 0.55], up: [-0.55, 0.7, 0.2] },
          left: { at: [0.4, 1.15, 0.05] },
        },
      ],
      // the drop: racket head falls below the hand, butt to the ball, legs load
      [
        22,
        {
          body: { yaw: 0.45, twist: 0.25, drop: 0.17, pz: 0.05 },
          racket: { grip: [-0.12, 1.0, 0.62], up: [-0.55, -0.7, 0.3] },
          left: { at: [0.35, 1.1, -0.15] },
        },
      ],
      // contact in front, face square to the net, low to high
      [
        25,
        {
          body: { px: 0.06, lean: 0.28, yaw: 0.0, twist: -0.08, drop: 0.13, pz: 0.0, head: 0.1 },
          near: { heel: 0.03 },
          racket: { at: [0.45, 0.95, 0.82], up: [-0.1, 0.12, 1], n: [1, 0.06, 0], strict: true },
          left: { at: [0.15, 1.1, -0.35] },
        },
        'in',
      ],
      // extension toward the target, the racket rising
      [
        30,
        {
          body: { px: 0.04, yaw: -0.35, twist: -0.3, drop: 0.1, pz: -0.03 },
          near: { heel: 0.07, turn: 0.4 },
          racket: { at: [0.7, 1.55, 0.2], up: [0.35, 0.75, -0.55] },
          left: { at: [-0.1, 1.05, -0.4] },
        },
        'out',
      ],
      // on across in front of the face
      [35, { body: { yaw: -0.5, twist: -0.4, drop: 0.09 }, racket: { grip: [0.5, 1.52, -0.22], up: [-0.15, 0.6, -0.8] } }],
      // the wrap: racket over the far shoulder, elbow up front
      [
        40,
        {
          body: { px: 0.02, yaw: -0.6, twist: -0.45, drop: 0.08, pz: -0.05, head: 0 },
          racket: { grip: [-0.05, 1.55, -0.4], up: [-0.5, 0.3, -0.8] },
          left: { at: [0.05, 1.3, -0.45], palm: [0.3, 0, 1], d: [0.2, 1, 0] },
          hand: 'open',
        },
      ],
      // back to the front, the other hand coming to the throat
      [52, { body: { yaw: -0.15, twist: -0.1, drop: 0.1 }, racket: { grip: [0.3, 1.12, -0.12], up: [0.6, 0.75, -0.25] }, left: { on: 0.3 }, hand: 'throat' }],
      [65, READY],
    ],
  }),
);

def(() =>
  keyed('backhand', {
    folder: G,
    tags: ['swing', 'drive', 'two-handed'],
    frames: 66,
    active: [25, 27],
    keys: [
      [0, READY],
      // unit turn to the other side, both hands on the handle
      [
        10,
        {
          body: { yaw: -0.5, twist: -0.5, drop: 0.13, pz: -0.03, head: -0.05 },
          far: { x: -0.06, z: -0.36, turn: -0.9 },
          racket: { grip: [0.02, 1.05, -0.3], up: [-0.15, 0.9, -0.35] },
          left: { on: 0.1 },
          hand: 'grip',
        },
      ],
      // the take-back, the right foot stepping in across
      [
        18,
        {
          body: { yaw: -0.75, twist: -0.6, drop: 0.16, pz: -0.05 },
          near: { x: 0.22, z: 0.05, turn: -0.5 },
          racket: { grip: [-0.22, 1.05, -0.42], up: [-0.6, 0.6, -0.3] },
        },
      ],
      // the drop below the ball
      [
        22,
        {
          body: { yaw: -0.55, twist: -0.35, drop: 0.18, pz: -0.03 },
          racket: { grip: [-0.08, 0.9, -0.42], up: [-0.5, -0.7, -0.35] },
        },
      ],
      // contact in front of the front hip, face square
      [
        26,
        {
          body: { px: 0.08, lean: 0.26, yaw: -0.05, twist: 0.05, drop: 0.14, pz: 0, head: 0.1 },
          far: { heel: 0.03 },
          racket: { at: [0.5, 0.95, -0.72], up: [-0.1, 0.12, -1], n: [-1, -0.06, 0], strict: true },
        },
        'in',
      ],
      [
        31,
        {
          body: { yaw: 0.3, twist: 0.3, drop: 0.11 },
          far: { heel: 0.07, turn: -0.4 },
          racket: { at: [0.75, 1.55, -0.15], up: [0.35, 0.75, 0.55] },
        },
        'out',
      ],
      // finish over the racket shoulder
      [
        41,
        {
          body: { yaw: 0.55, twist: 0.45, drop: 0.08, head: 0 },
          racket: { at: [0.05, 1.65, 0.4], up: [-0.65, 0.3, 0.7] },
        },
      ],
      [52, { racket: { grip: [0.32, 1.0, 0.1], up: up45 }, left: { on: 0.27 }, hand: 'throat', far: { heel: 0 } }],
      [65, READY],
    ],
  }),
);

def(() =>
  keyed('forehandSlice', {
    folder: G,
    tags: ['swing', 'slice'],
    frames: 60,
    active: [23, 25],
    keys: [
      [0, READY],
      // a high take-back, face open
      [
        12,
        {
          body: { yaw: 0.6, twist: 0.4, drop: 0.14, pz: 0.04, head: -0.05 },
          near: { x: -0.08, z: 0.36, turn: 0.9 },
          racket: { at: [-0.25, 1.65, 0.55], up: [-0.45, 0.8, 0.3], n: [0.2, 0.3, -0.9] },
          left: { at: [0.4, 1.2, 0.1], palm: [0, -0.4, 1], d: [1, 0.1, 0.1] },
          hand: 'open',
        },
      ],
      [
        19,
        {
          body: { yaw: 0.45, twist: 0.3, drop: 0.16 },
          racket: { at: [-0.1, 1.25, 0.85], up: [-0.45, 0.35, 0.8], n: [0.6, 0.6, -0.4] },
          left: { at: [0.35, 1.1, -0.1] },
        },
      ],
      // contact: high to low, face open
      [
        24,
        {
          body: { px: 0.06, lean: 0.28, yaw: 0.1, twist: 0.0, drop: 0.15, pz: 0.01, head: 0.12 },
          racket: { at: [0.45, 0.92, 0.78], up: [-0.05, 0.25, 1], n: [0.9, 0.42, 0], strict: true },
          left: { at: [0.1, 1.1, -0.35] },
        },
        'in',
      ],
      // a long finish out toward the target, low
      [
        32,
        {
          body: { px: 0.06, yaw: -0.15, twist: -0.15, drop: 0.13 },
          near: { heel: 0.04 },
          racket: { at: [0.7, 1.0, 0.15], up: [0.6, 0.15, -0.8], n: [0.2, 0.95, 0] },
          left: { at: [-0.15, 1.05, -0.4] },
        },
        'out',
      ],
      [44, { racket: { grip: [0.3, 1.05, 0.0], up: [0.6, 0.6, -0.5] }, left: { on: 0.3 }, hand: 'throat' }],
      [59, READY],
    ],
  }),
);

def(() =>
  keyed('backhandSlice', {
    folder: G,
    tags: ['swing', 'slice', 'one-handed'],
    frames: 60,
    active: [24, 26],
    keys: [
      [0, READY],
      // turned side-on, racket high by the far shoulder, the other hand on the throat
      [
        12,
        {
          body: { yaw: -0.7, twist: -0.5, drop: 0.14, pz: -0.03, head: -0.05 },
          far: { x: -0.06, z: -0.36, turn: -0.9 },
          racket: { at: [-0.25, 1.65, -0.35], up: [-0.5, 0.75, 0.3] },
          left: { on: 0.27 },
        },
      ],
      [
        19,
        {
          body: { yaw: -0.8, twist: -0.6, drop: 0.16 },
          near: { x: 0.22, z: 0.04, turn: -0.5 },
          racket: { at: [-0.1, 1.45, -0.75], up: [-0.4, 0.5, -0.75] },
        },
      ],
      // contact out in front, face open; the other arm goes back for balance
      [
        25,
        {
          body: { px: 0.07, lean: 0.28, yaw: -0.35, twist: -0.25, drop: 0.16, head: 0.12 },
          racket: { at: [0.55, 0.92, -0.75], up: [0.0, 0.25, -1], n: [-0.9, -0.42, 0], strict: true },
          left: { at: [-0.3, 1.2, -0.35], palm: [0, -1, 0], d: [-1, -0.1, -0.2] },
          hand: 'open',
        },
        'in',
      ],
      [
        33,
        {
          body: { yaw: -0.2, twist: -0.1, drop: 0.14 },
          racket: { at: [0.95, 1.2, -0.25], up: [0.65, 0.4, 0.6], n: [-0.16, 0.86, -0.48] },
          left: { at: [-0.35, 1.15, -0.45] },
        },
        'out',
      ],
      [46, { racket: { grip: [0.32, 1.0, 0.1], up: up45 }, left: { on: 0.27 }, hand: 'throat' }],
      [59, READY],
    ],
  }),
);

def(() =>
  keyed('forehandLob', {
    folder: G,
    tags: ['swing', 'lob'],
    frames: 66,
    active: [24, 26],
    keys: [
      [0, READY],
      [
        12,
        {
          body: { yaw: 0.6, twist: 0.45, drop: 0.15, pz: 0.05 },
          near: { x: -0.08, z: 0.36, turn: 0.9 },
          racket: { grip: [-0.15, 1.05, 0.55], up: [-0.6, 0.45, 0.4] },
          left: { at: [0.4, 1.15, 0.1], palm: [0, -0.4, 1], d: [1, 0.1, 0.1] },
          hand: 'open',
        },
      ],
      // deep under the ball
      [
        21,
        {
          body: { yaw: 0.4, twist: 0.25, drop: 0.22 },
          racket: { grip: [-0.02, 0.88, 0.55], up: [-0.5, -0.6, 0.6] },
          left: { at: [0.35, 1.05, -0.1] },
        },
      ],
      // contact, face open to the sky
      [
        25,
        {
          body: { px: 0.04, lean: 0.22, yaw: 0.05, twist: -0.05, drop: 0.17, head: 0.0 },
          racket: { at: [0.42, 0.85, 0.8], up: [-0.1, 0.2, 1], n: [0.7, 0.7, 0], strict: true },
          left: { at: [0.1, 1.1, -0.35] },
        },
        'in',
      ],
      // up and over: a high finish
      [
        34,
        {
          body: { yaw: -0.25, twist: -0.2, drop: 0.08, head: -0.2 },
          near: { heel: 0.05 },
          racket: { at: [0.5, 2.0, 0.25], up: [0.15, 0.98, -0.15] },
          left: { at: [-0.1, 1.05, -0.4] },
        },
        'out',
      ],
      [46, { racket: { at: [0.1, 1.85, -0.25], up: [-0.3, 0.8, -0.5] }, left: { on: 0.3 }, hand: 'throat' }],
      [65, READY],
    ],
  }),
);

def(() =>
  keyed('backhandLob', {
    folder: G,
    tags: ['swing', 'lob', 'two-handed'],
    frames: 66,
    active: [25, 27],
    keys: [
      [0, READY],
      [
        12,
        {
          body: { yaw: -0.6, twist: -0.5, drop: 0.15, pz: -0.04 },
          far: { x: -0.06, z: -0.36, turn: -0.9 },
          racket: { grip: [-0.12, 1.0, -0.42], up: [-0.6, 0.45, -0.4] },
          left: { on: 0.1 },
          hand: 'grip',
        },
      ],
      [
        21,
        {
          body: { yaw: -0.45, twist: -0.3, drop: 0.22 },
          near: { x: 0.2, z: 0.06, turn: -0.5 },
          racket: { grip: [-0.02, 0.85, -0.42], up: [-0.5, -0.6, -0.6] },
        },
      ],
      [
        26,
        {
          body: { px: 0.05, lean: 0.22, yaw: -0.05, twist: 0.05, drop: 0.17, head: 0 },
          racket: { at: [0.45, 0.88, -0.62], up: [-0.1, 0.2, -1], n: [-0.7, -0.7, 0], strict: true },
        },
        'in',
      ],
      [
        35,
        {
          body: { yaw: 0.25, twist: 0.25, drop: 0.08, head: -0.2 },
          far: { heel: 0.05 },
          racket: { at: [0.45, 2.0, -0.2], up: [0.15, 0.98, 0.15] },
        },
        'out',
      ],
      [47, { racket: { grip: [0.32, 1.0, 0.1], up: up45 }, left: { on: 0.27 }, hand: 'throat', far: { heel: 0 } }],
      [65, READY],
    ],
  }),
);

def(() =>
  keyed('dropForehand', {
    folder: G,
    tags: ['swing', 'drop'],
    frames: 54,
    active: [22, 24],
    keys: [
      [0, READY],
      // disguised as a slice: a high take-back
      [
        12,
        {
          body: { yaw: 0.55, twist: 0.35, drop: 0.15, pz: 0.04 },
          near: { x: -0.06, z: 0.36, turn: 0.85 },
          racket: { at: [-0.15, 1.55, 0.55], up: [-0.4, 0.8, 0.3], n: [0.2, 0.3, -0.9] },
          left: { at: [0.4, 1.15, 0.1], palm: [0, -0.4, 1], d: [1, 0.1, 0.1] },
          hand: 'open',
        },
      ],
      [
        19,
        {
          body: { yaw: 0.35, twist: 0.2, drop: 0.18 },
          racket: { at: [0.1, 1.1, 0.8], up: [-0.4, 0.3, 0.85], n: [0.6, 0.65, -0.3] },
        },
      ],
      // under the ball, the face wide open, soft hands
      [
        23,
        {
          body: { px: 0.05, lean: 0.28, yaw: 0.12, twist: 0.02, drop: 0.19, head: 0.15 },
          racket: { at: [0.45, 0.85, 0.75], up: [-0.05, 0.3, 1], n: [0.75, 0.66, 0], strict: true },
          left: { at: [0.1, 1.05, -0.35] },
        },
        'in',
      ],
      // a short finish under it, the face to the sky
      [
        30,
        {
          body: { yaw: 0.0, twist: -0.05, drop: 0.17 },
          racket: { at: [0.72, 0.82, 0.55], up: [0.3, 0.15, 0.95], n: [0.15, 0.98, 0] },
        },
        'out',
      ],
      [40, { racket: { grip: [0.32, 1.0, 0.1], up: up45 }, left: { on: 0.3 }, hand: 'throat' }],
      [53, READY],
    ],
  }),
);

def(() =>
  keyed('dropBackhand', {
    folder: G,
    tags: ['swing', 'drop', 'one-handed'],
    frames: 54,
    active: [22, 24],
    keys: [
      [0, READY],
      [
        12,
        {
          body: { yaw: -0.65, twist: -0.45, drop: 0.15, pz: -0.03 },
          far: { x: -0.06, z: -0.36, turn: -0.85 },
          racket: { at: [-0.2, 1.55, -0.35], up: [-0.45, 0.75, 0.3] },
          left: { on: 0.27 },
        },
      ],
      [
        19,
        {
          body: { yaw: -0.7, twist: -0.5, drop: 0.18 },
          near: { x: 0.2, z: 0.04, turn: -0.5 },
          racket: { at: [0.05, 1.15, -0.75], up: [-0.35, 0.35, -0.85] },
        },
      ],
      [
        23,
        {
          body: { px: 0.06, lean: 0.28, yaw: -0.4, twist: -0.25, drop: 0.19, head: 0.15 },
          racket: { at: [0.5, 0.85, -0.7], up: [0.0, 0.3, -1], n: [-0.75, -0.66, 0], strict: true },
          left: { at: [-0.25, 1.15, -0.35], palm: [0, -1, 0], d: [-1, -0.1, -0.2] },
          hand: 'open',
        },
        'in',
      ],
      [
        30,
        {
          body: { yaw: -0.3, twist: -0.15, drop: 0.17 },
          racket: { at: [0.78, 0.85, -0.5], up: [0.3, 0.15, -0.95], n: [-0.15, -0.98, 0] },
        },
        'out',
      ],
      [40, { racket: { grip: [0.32, 1.0, 0.1], up: up45 }, left: { on: 0.27 }, hand: 'throat' }],
      [53, READY],
    ],
  }),
);

// --- at the net --------------------------------------------------------------------------------
def(() =>
  keyed('volleyForehand', {
    folder: NET,
    tags: ['swing', 'volley'],
    frames: 36,
    active: [14, 16],
    keys: [
      [0, READY],
      // a short turn, the racket head up by the shoulder, face open
      [
        7,
        {
          body: { yaw: 0.35, twist: 0.2, drop: 0.14 },
          racket: { grip: [0.18, 1.25, 0.45], up: [-0.15, 0.95, 0.2], n: [0.6, 0.2, -0.7] },
          left: { at: [0.42, 1.2, 0.05], palm: [0, -0.4, 1], d: [1, 0.1, 0.1] },
          hand: 'open',
        },
      ],
      // the punch, stepping in with the far foot
      [
        15,
        {
          body: { px: 0.1, lean: 0.3, yaw: 0.1, twist: 0.0, drop: 0.15, head: 0.1 },
          far: { x: 0.32, z: -0.22, turn: 0.1 },
          racket: { at: [0.65, 1.2, 0.62], up: [0.05, 0.55, 0.85], n: [0.95, 0.25, 0], strict: true },
          left: { at: [0.25, 1.15, -0.3] },
        },
        'out',
      ],
      [
        21,
        {
          body: { yaw: 0.05, drop: 0.14 },
          racket: { at: [0.82, 1.12, 0.45], up: [0.2, 0.5, 0.85], n: [0.9, 0.4, 0] },
        },
        'out',
      ],
      [35, { ...READY, far: { ...READY.far, x: 0.1 } }],
    ],
  }),
);

def(() =>
  keyed('volleyBackhand', {
    folder: NET,
    tags: ['swing', 'volley'],
    frames: 36,
    active: [14, 16],
    keys: [
      [0, READY],
      [
        7,
        {
          body: { yaw: -0.4, twist: -0.3, drop: 0.14 },
          racket: { grip: [0.15, 1.2, -0.3], up: [-0.15, 0.95, -0.25] },
          left: { on: 0.27 },
        },
      ],
      [
        15,
        {
          body: { px: 0.1, lean: 0.3, yaw: -0.2, twist: -0.1, drop: 0.15, head: 0.1 },
          near: { x: 0.3, z: 0.15, turn: -0.2 },
          racket: { at: [0.65, 1.2, -0.55], up: [0.05, 0.55, -0.85], n: [-0.95, -0.25, 0], strict: true },
          left: { at: [-0.1, 1.2, -0.4], palm: [0, -1, 0], d: [-1, 0, -0.3] },
          hand: 'open',
        },
        'out',
      ],
      [
        21,
        {
          body: { yaw: -0.15 },
          racket: { at: [0.82, 1.12, -0.38], up: [0.2, 0.5, -0.85] },
        },
        'out',
      ],
      [28, { racket: { grip: [0.32, 1.0, 0.1], up: up45 }, left: { on: 0.27 }, hand: 'throat' }],
      [35, { ...READY, near: { ...READY.near, x: 0.1 } }],
    ],
  }),
);

def(() =>
  keyed('volleyLowF', {
    folder: NET,
    tags: ['swing', 'volley', 'low'],
    frames: 42,
    active: [17, 19],
    keys: [
      [0, READY],
      [
        8,
        {
          body: { yaw: 0.3, twist: 0.15, drop: 0.25, lean: 0.3 },
          racket: { grip: [0.2, 0.85, 0.45], up: [-0.1, 0.6, 0.75], n: [0.6, 0.6, -0.3] },
          left: { at: [0.42, 1.0, 0.0], palm: [0, -0.4, 1], d: [1, 0.1, 0.1] },
          hand: 'open',
        },
      ],
      // down low, the knee near the court, the racket head still above the wrist
      [
        18,
        {
          body: { px: 0.12, lean: 0.42, bend: 0.1, yaw: 0.1, twist: 0, drop: 0.36, head: 0.25 },
          far: { x: 0.45, z: -0.22, turn: 0.1 },
          near: { heel: 0.1 },
          racket: { at: [0.55, 0.55, 0.55], up: [0.15, 0.5, 0.85], n: [0.85, 0.5, 0], strict: true },
          left: { at: [0.2, 0.95, -0.35] },
        },
        'out',
      ],
      [
        25,
        {
          body: { drop: 0.33 },
          racket: { at: [0.7, 0.58, 0.38], up: [0.3, 0.45, 0.84], n: [0.7, 0.7, 0] },
        },
        'out',
      ],
      [41, { ...READY, far: { ...READY.far, x: 0.12 } }],
    ],
  }),
);

def(() =>
  keyed('volleyLowB', {
    folder: NET,
    tags: ['swing', 'volley', 'low'],
    frames: 42,
    active: [17, 19],
    keys: [
      [0, READY],
      [
        8,
        {
          body: { yaw: -0.35, twist: -0.25, drop: 0.25, lean: 0.3 },
          racket: { grip: [0.15, 0.85, -0.3], up: [-0.1, 0.6, -0.75] },
          left: { on: 0.27 },
        },
      ],
      [
        18,
        {
          body: { px: 0.12, lean: 0.42, bend: 0.1, yaw: -0.2, twist: -0.1, drop: 0.36, head: 0.25 },
          near: { x: 0.42, z: 0.12, turn: -0.2 },
          far: { heel: 0.1 },
          racket: { at: [0.55, 0.55, -0.5], up: [0.15, 0.5, -0.85], n: [-0.85, -0.5, 0], strict: true },
          left: { at: [-0.15, 0.95, -0.42], palm: [0, -1, 0], d: [-1, 0, -0.3] },
          hand: 'open',
        },
        'out',
      ],
      [
        25,
        {
          body: { drop: 0.33 },
          racket: { at: [0.7, 0.58, -0.35], up: [0.3, 0.45, -0.84] },
        },
        'out',
      ],
      // rising out of the crouch, the racket back in front
      [
        33,
        {
          body: { drop: 0.18, lean: 0.26, bend: 0.04, yaw: -0.1, twist: -0.05, head: 0.1 },
          racket: { grip: [0.4, 0.88, 0.04], up: up45 },
          left: { on: 0.27 },
          hand: 'throat',
        },
      ],
      [41, { ...READY, near: { ...READY.near, x: 0.12 } }],
    ],
  }),
);

def(() =>
  keyed('smash', {
    folder: NET,
    tags: ['swing', 'smash', 'overhead'],
    frames: 72,
    active: [32, 34],
    keys: [
      [0, READY],
      // side-on at once, the free arm pointing up at the ball, the racket up behind the head
      [
        16,
        {
          body: { yaw: 0.95, twist: 0.25, drop: 0.12, px: -0.04, lean: 0.0, roll: 0.15, head: -0.45 },
          near: { x: -0.15, z: 0.32, turn: 1.3 },
          far: { x: 0.12, z: -0.18, turn: 0.6 },
          racket: { grip: [-0.25, 1.62, 0.38], up: [0.05, 0.95, -0.15] },
          left: { at: [0.4, 2.05, 0.1], palm: [0.5, 0.3, 0.6], d: [0.3, 1, 0] },
          hand: 'open',
        },
      ],
      [
        22,
        {
          body: { drop: 0.14, lean: -0.08, roll: 0.22, head: -0.5 },
          racket: { grip: [-0.25, 1.7, 0.32], up: [0.0, 0.95, -0.25] },
        },
      ],
      // the head tips back over the shoulder...
      [26, { body: { roll: 0.15 }, racket: { grip: [-0.2, 1.76, 0.32], up: [-0.9, 0.15, -0.3] } }],
      // ...and drops behind the back, legs driving up
      [
        29,
        {
          body: { yaw: 0.6, twist: 0.1, drop: 0.06, lean: 0.0, roll: 0.05, head: -0.45 },
          near: { heel: 0.05 },
          racket: { grip: [-0.1, 1.8, 0.3], up: [-0.45, -0.88, -0.15] },
          left: { at: [0.3, 1.45, -0.1] },
        },
      ],
      // the arm reaching up, the head coming up behind it
      [31, { racket: { grip: [0.05, 2.0, 0.3], up: [-0.85, 0.2, -0.1] } }],
      // contact up and in front, hitting down
      [
        33,
        {
          body: { yaw: 0.15, twist: -0.05, drop: 0.03, lean: 0.12, roll: -0.18, head: -0.35 },
          near: { heel: 0.08 },
          racket: { at: [0.48, 2.45, 0.26], up: [0.25, 0.96, 0.05], n: [0.97, -0.25, 0], strict: true },
          left: { at: [0.1, 1.3, -0.3] },
        },
        'in',
      ],
      // pronated, down across to the far hip
      [
        45,
        {
          body: { px: 0.06, yaw: -0.35, twist: -0.3, drop: 0.12, lean: 0.35, roll: 0, head: 0.1 },
          near: { x: 0.0, z: 0.3, heel: 0.06, turn: 0.3 },
          racket: { at: [0.25, 0.7, -0.5], up: [-0.1, -0.7, -0.7] },
          left: { at: [-0.05, 1.1, -0.35] },
        },
        'out',
      ],
      [56, { racket: { grip: [0.32, 1.0, 0.1], up: up45 }, left: { on: 0.3 }, hand: 'throat', near: { heel: 0 } }],
      [71, READY],
    ],
  }),
);

// --- the serve -----------------------------------------------------------------------------------
def(() =>
  keyed('bounceBall', {
    folder: SERVE,
    tags: ['serve', 'release=14', 'catch=40'],
    frames: 60,
    keys: [
      [0, SERVE_STANCE],
      // the ball out in front, palm down
      [
        8,
        {
          body: { lean: 0.2, drop: 0.06, twist: 0.25 },
          left: { at: [0.32, 1.05, -0.02], palm: [0, -1, 0], d: [1, -0.2, 0.1] },
          racket: { grip: [0.1, 0.95, 0.3], up: [0.7, -0.5, 0], n: [0, 0, -1] },
        },
      ],
      // pushed down: it leaves the hand
      [14, { body: { lean: 0.26, drop: 0.08 }, left: { at: [0.34, 0.92, -0.02], palm: [0, -1, 0], d: [1, -0.3, 0.1] } }, 'in'],
      [26, { body: { lean: 0.28 }, left: { at: [0.34, 0.86, -0.02], palm: [0, -1, 0], d: [1, -0.3, 0.1] } }],
      // and caught again coming up
      [40, { body: { lean: 0.26 }, left: { at: [0.34, 0.92, -0.02], palm: [0, -1, 0], d: [1, -0.25, 0.1] } }],
      [59, SERVE_STANCE],
    ],
  }),
);

def(() =>
  keyed('serve', {
    folder: SERVE,
    tags: ['serve', 'release=34', 'travel=0.45,0,66,100'],
    frames: 120,
    active: [65, 67],
    travel: { f: 0.45, s: 0, from: 66 / FPS, to: 100 / FPS },
    keys: [
      [0, SERVE_STANCE],
      // rock back, both arms down together
      [
        14,
        {
          body: { px: -0.07, pz: 0.05, drop: 0.05, lean: 0.05 },
          far: { heel: 0.04 },
          racket: { grip: [0.02, 0.92, 0.32], up: [0.6, -0.65, -0.2] },
          left: { at: [0.12, 0.9, 0.02], palm: [0.3, 1, 0], d: [1, 0.2, 0] },
        },
      ],
      // the toss: the arm straight up, the ball let go above the head; the racket rises behind
      [
        34,
        {
          body: { px: 0.04, pz: 0.03, drop: 0.08, lean: 0.0, roll: 0.15, head: -0.35 },
          far: { heel: 0 },
          racket: { grip: [-0.3, 1.2, 0.5], up: [-0.35, 0.35, 0.85] },
          left: { at: [0.32, 2.0, 0.12], palm: [0.2, 1, 0], d: [0.15, 1, 0] },
          hand: 'open',
        },
        'out',
      ],
      // the trophy: knees bent, hips forward, the back arched, shoulder over shoulder
      [
        50,
        {
          body: { px: 0.14, pz: 0.0, drop: 0.2, lean: -0.12, bend: -0.08, roll: 0.28, yaw: 0.95, twist: 0.25, head: -0.5 },
          near: { heel: 0.05, turn: 1.2 },
          racket: { grip: [-0.25, 1.62, 0.38], up: [0.05, 0.95, -0.15] },
          left: { at: [0.38, 2.02, 0.1], palm: [0.5, 0.3, 0.6], d: [0.3, 1, 0] },
        },
      ],
      // the head tips back over the shoulder...
      [55, { body: { yaw: 0.8, roll: 0.22 }, racket: { grip: [-0.2, 1.72, 0.32], up: [-0.9, 0.1, -0.3] } }],
      // ...and drops down the back as the legs drive up
      [
        60,
        {
          body: { px: 0.18, drop: 0.04, lean: 0.0, bend: 0, roll: 0.12, yaw: 0.6, twist: 0.1, head: -0.5 },
          near: { heel: 0.09 },
          far: { heel: 0.07 },
          racket: { grip: [-0.08, 1.82, 0.3], up: [0.1, -0.95, -0.15] },
          left: { at: [0.3, 1.55, -0.05] },
        },
      ],
      // the arm reaching up, the head coming up behind it
      [63, { racket: { grip: [0.12, 2.02, 0.3], up: [-0.85, 0.25, -0.1] } }],
      // contact at full stretch, off the ground
      [
        66,
        {
          body: { px: 0.22, drop: -0.06, lean: 0.12, roll: -0.2, yaw: 0.15, twist: -0.05, head: -0.4 },
          near: { x: -0.1, y: 0.08, heel: 0, point: 0.7, turn: 1.0 },
          far: { y: 0.06, heel: 0, point: 0.6 },
          racket: { at: [0.5, 2.6, 0.3], up: [0.15, 0.98, 0.05], n: [1, -0.05, 0], strict: true },
          left: { at: [0.18, 1.3, -0.25] },
        },
        'in',
      ],
      // pronation and the landing on the front foot, inside the court; the back leg kicks up
      [
        76,
        {
          body: { px: 0.5, drop: 0.12, lean: 0.4, roll: 0, yaw: -0.2, twist: -0.25, head: 0.1 },
          far: { x: 0.55, z: -0.05, y: 0, turn: 0.2 },
          near: { x: 0.05, y: 0.32, z: 0.2, point: 0.8 },
          racket: { at: [0.75, 1.25, 0.25], up: [0.4, -0.6, -0.65] },
          left: { at: [0.3, 1.15, -0.35] },
        },
        'out',
      ],
      // the finish by the far hip, the back foot coming through
      [
        92,
        {
          body: { px: 0.55, drop: 0.12, lean: 0.3, yaw: -0.3, twist: -0.25, head: 0 },
          near: { x: 0.72, z: 0.25, y: 0, turn: 0.3 },
          racket: { at: [0.25, 0.65, -0.55], up: [-0.4, -0.6, -0.65] },
          left: { at: [0.35, 1.05, -0.3] },
          hand: 'relax',
        },
      ],
      [
        119,
        merge(READY, {
          body: { px: 0.47 },
          near: { x: 0.45 },
          far: { x: 0.47 },
          racket: { ...READY.racket, grip: [0.79, 0.98, 0.12] },
        }),
      ],
    ],
  }),
);

// --- stretch shots ------------------------------------------------------------------------------
def(() =>
  keyed('lunge', {
    folder: G,
    tags: ['swing', 'stretch'],
    frames: 72,
    active: [22, 24],
    keys: [
      [0, READY],
      // pushing off the far foot, the racket going back as the body turns
      [
        8,
        {
          body: { pz: 0.12, drop: 0.14, yaw: 0.5, twist: 0.4, roll: -0.05 },
          near: { x: 0.05, z: 0.6, y: 0.08, point: 0.1, turn: 0.9 },
          racket: { grip: [-0.05, 1.15, 0.65], up: [-0.4, 0.8, 0.4] },
          left: { at: [0.3, 1.2, 0.2], palm: [0, -0.4, 1], d: [1, 0.1, 0.1] },
          hand: 'open',
        },
      ],
      // the long last step lands, the knee deep over it
      [
        16,
        {
          body: { pz: 0.42, drop: 0.32, yaw: 0.35, twist: 0.2, lean: 0.32, roll: -0.15 },
          near: { x: 0.25, z: 1.05, y: 0, turn: 1.0 },
          far: { heel: 0.06, turn: 0.2 },
          racket: { grip: [0.0, 0.95, 1.05], up: [-0.6, -0.5, 0.6] },
          left: { at: [0.1, 1.05, -0.1] },
        },
      ],
      // the reach: arm and racket at full stretch, the face a little open
      [
        23,
        {
          body: { px: 0.05, pz: 0.5, drop: 0.38, yaw: 0.15, twist: 0.05, lean: 0.38, roll: -0.2, head: 0.25 },
          racket: { at: [0.45, 0.72, 1.45], up: [-0.15, 0.25, 0.96], n: [0.95, 0.3, 0.1], strict: true },
          left: { at: [-0.25, 1.1, 0.0], palm: [0, -1, 0], d: [-1, 0, -0.3] },
        },
        'in',
      ],
      [
        32,
        {
          body: { pz: 0.45, drop: 0.34, yaw: -0.15, twist: -0.15 },
          racket: { at: [0.6, 1.2, 0.75], up: [0.4, 0.6, -0.7] },
        },
        'out',
      ],
      // pushing back to the middle
      [
        50,
        {
          body: { pz: 0.15, drop: 0.16, yaw: 0, twist: 0, roll: 0, lean: 0.26 },
          near: { x: 0.08, z: 0.6, y: 0.06, point: 0.2 },
          far: { heel: 0 },
          left: { on: 0.3 },
          hand: 'throat',
          racket: { grip: [0.4, 1.0, 0.35], up: up45, n: [0, 0, -1] },
        },
      ],
      [71, READY],
    ],
  }),
);

def(() =>
  keyed('lungeBackhand', {
    folder: G,
    tags: ['swing', 'stretch', 'one-handed'],
    frames: 72,
    active: [23, 25],
    keys: [
      [0, READY],
      // turning, the right foot crossing over
      [
        8,
        {
          body: { pz: -0.1, drop: 0.14, yaw: -0.6, twist: -0.45, roll: 0.05 },
          near: { x: 0.12, z: 0.0, y: 0.1, point: 0.1, turn: -0.7 },
          racket: { grip: [0.0, 1.2, -0.4], up: [-0.4, 0.8, -0.4] },
          left: { on: 0.27 },
        },
      ],
      [
        17,
        {
          body: { pz: -0.4, drop: 0.32, yaw: -0.55, twist: -0.35, lean: 0.32, roll: 0.15 },
          near: { x: 0.3, z: -0.85, y: 0, turn: -1.1 },
          far: { heel: 0.06, turn: -0.2 },
          racket: { grip: [-0.05, 1.1, -0.85], up: [-0.55, 0.3, -0.7] },
        },
      ],
      // the reach out to the side, one-handed, face open
      [
        24,
        {
          body: { px: 0.05, pz: -0.48, drop: 0.38, yaw: -0.4, twist: -0.25, lean: 0.38, roll: 0.2, head: 0.25 },
          racket: { at: [0.45, 0.72, -1.38], up: [-0.15, 0.25, -0.96], n: [-0.92, -0.35, -0.1], strict: true },
          left: { at: [-0.3, 1.1, -0.3], palm: [0, -1, 0], d: [-1, 0, -0.3] },
          hand: 'open',
        },
        'in',
      ],
      [
        33,
        {
          body: { pz: -0.45, drop: 0.34, yaw: -0.3, twist: -0.15 },
          racket: { at: [0.85, 1.05, -1.0], up: [0.6, 0.45, -0.65] },
        },
        'out',
      ],
      [
        50,
        {
          body: { pz: -0.12, drop: 0.16, yaw: 0, twist: 0, roll: 0, lean: 0.26 },
          near: { x: 0.08, z: 0.0, y: 0.06, point: 0.2, turn: 0 },
          far: { heel: 0 },
          left: { on: 0.3 },
          hand: 'throat',
          racket: { grip: [0.38, 1.0, -0.05], up: up45, n: [0, 0, -1] },
        },
      ],
      [71, READY],
    ],
  }),
);

// --- reactions -----------------------------------------------------------------------------------
/** Standing easy, the racket hanging from the hand. */
const EASY = {
  body: { px: 0, pz: 0, drop: 0.02, lean: 0.04, bend: 0.02, yaw: 0, twist: 0, head: 0, roll: 0, upperRoll: 0, hipTilt: 0 },
  near: { x: 0, z: 0.16, turn: 0.2, heel: 0, y: 0 },
  far: { x: 0.02, z: -0.16, turn: -0.2, heel: 0, y: 0 },
  racket: { grip: [0.08, 0.86, 0.3], up: [0.8, -0.55, -0.1], n: [0, 0, -1] },
  left: { at: [0.02, 0.84, -0.27], twist: 1.5, flex: 0.15 },
  hand: 'relax',
};

def(() =>
  keyed('celebrate', {
    folder: REACT,
    tags: ['react', 'cheer'],
    frames: 96,
    keys: [
      [0, READY],
      // standing up, the free fist drawn up
      [14, { ...EASY, body: { ...EASY.body, drop: 0.06, head: -0.15 }, left: { at: [0.2, 1.45, -0.3], twist: 1.6, flex: 0.6, swivel: -0.8 }, hand: 'fist' }],
      // the pump: fist pulled down hard, knees bent, a shout at the court
      [
        22,
        {
          body: { drop: 0.2, lean: 0.35, bend: 0.15, head: 0.3, twist: -0.15, pz: -0.03 },
          near: { z: 0.28 },
          far: { z: -0.28 },
          left: { at: [0.18, 0.95, -0.22], twist: 1.6, flex: 0.5, swivel: -0.4 },
        },
        'in',
      ],
      [32, { body: { drop: 0.12, lean: 0.2, head: 0 }, left: { at: [0.2, 1.4, -0.3], twist: 1.6, flex: 0.6, swivel: -0.8 } }, 'out'],
      [40, { body: { drop: 0.2, lean: 0.35, head: 0.3 }, left: { at: [0.18, 0.95, -0.22], twist: 1.6, flex: 0.5, swivel: -0.4 } }, 'in'],
      // then up straight, the racket raised to the crowd
      [62, { ...EASY, body: { ...EASY.body, head: -0.2, roll: 0.05 }, racket: { grip: [0.1, 1.95, 0.45], up: [0.15, 0.95, 0.15] }, left: { at: [0.05, 0.86, -0.27], twist: 1.5, flex: 0.15 }, hand: 'relax' }],
      [80, { racket: { grip: [0.1, 1.95, 0.45], up: [0.15, 0.95, 0.15] } }],
      [95, EASY],
    ],
  }),
);

def(() =>
  keyed('dejected', {
    folder: REACT,
    tags: ['react', 'dejected'],
    frames: 120,
    keys: [
      [0, READY],
      // up out of the stance, shoulders dropping
      [24, { ...EASY, body: { ...EASY.body, bend: 0.25, head: 0.35 } }],
      // head down, the racket hanging, a slow shake (shoulders turning)
      [48, { body: { bend: 0.35, head: 0.5, twist: 0.12, lean: 0.08 }, left: { at: [0.1, 1.05, -0.12], twist: 0.3, flex: 0.3 } }],
      [66, { body: { twist: -0.12 } }],
      [84, { body: { twist: 0.08 } }],
      [119, { ...EASY, body: { ...EASY.body, bend: 0.3, head: 0.45, lean: 0.06 } }],
    ],
  }),
);

def(() =>
  keyed('bow', {
    folder: REACT,
    tags: ['react', 'bow'],
    frames: 108,
    keys: [
      [0, READY],
      [20, { ...EASY, near: { ...EASY.near, z: 0.12 }, far: { ...EASY.far, z: -0.12 } }],
      // the bow, the free hand across the waist
      [
        46,
        {
          body: { lean: 0.55, bend: 0.25, head: 0.25, px: -0.1, drop: 0.04 },
          left: { at: [0.32, 0.98, 0.05], palm: [-0.3, 0, 1], d: [0.2, 0, 1] },
          racket: { grip: [0.25, 0.62, 0.3], up: [0.7, -0.7, -0.1], n: [0, 0, -1] },
        },
      ],
      [70, {}],
      [100, { ...EASY, near: { ...EASY.near, z: 0.12 }, far: { ...EASY.far, z: -0.12 } }],
      [107, {}],
    ],
  }),
);

// --- build -----------------------------------------------------------------------------------
export const PROJECT_FOLDERS = ['Locomotion', 'Groundstrokes', 'Net', 'Serve', 'Reactions'];

const t0 = Date.now();
const built = [];
for (const make of MOVES_DEF) {
  const t = Date.now();
  const m = make();
  if (!m) continue;
  built.push(m);
  console.log(`  ${m.name}: ${m.keys.length} keys (${((Date.now() - t) / 1000).toFixed(1)} s)`);
}
const out = fileURLToPath(new URL('../netcord.rig.json', import.meta.url));
const project = existsSync(out) ? R.parseProject(JSON.parse(readFileSync(out, 'utf8'))) : R.newProject('Netcord', []);
for (const move of built) {
  const i = project.moves.findIndex(m => m.name === move.name);
  if (i >= 0) project.moves[i] = move;
  else project.moves.push(move);
}
project.name = 'Netcord';
project.folders = [...new Set([...PROJECT_FOLDERS, ...(project.folders ?? [])])];
project.fps = FPS;
project.proportions = PROPS;
writeFileSync(out, R.serialize(project));
const keys = built.reduce((n, m) => n + m.keys.length, 0);
console.log(`${built.length} moves, ${keys} keys → ${out} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
for (const i of issues) console.log(`  ! ${i}`);
if (REPORT) {
  for (const m of built) {
    console.log(`${m.name}: ${m.length} frames, ${m.keys.length} keys`);
  }
}
if (!args.includes('--no-pack')) {
  const { pack } = await import('./rig-pack.mjs');
  await pack();
}
