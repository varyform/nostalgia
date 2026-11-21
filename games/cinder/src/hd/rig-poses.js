// The fighters' moves as made in the rig editor (rig-moves.json, from tools/rig-moves.mjs), played
// through @nostalgia/rig and read back as poses.js's flat poses, so the renderer blends and
// dresses them as it always has. A rig move's joints are side-on (x forward, y up, the near side
// +z): the lead limbs are the far side, the rear ones the near. What the editor has no move for
// (a foe's chained kick, the run stance's idle, the teacher) is left to poses.js: null.
import { createJointBuffer, Joint, JOINT_STRIDE, lerpPose, parseProject, REST_POSE, resolveKeys, sampleMove, solvePose } from '@nostalgia/rig';
import { BONE } from './rig.js';
import data from './rig-moves.json' with { type: 'json' };

const project = parseProject(data);
const props = project.proportions;
const FPS = project.fps;
const MOVE = new Map(project.moves.map(m => [m.name, m]));
const WHO = { hero: 'Wren', footman: 'Footman', brawler: 'Brawler', adept: 'Adept', regent: 'Regent' };
// The game's ankles stand 0.08 over the ground; the rig's y = 0 is ankle height.
const ANKLE = 0.08;
// The game hangs each hip a little fore (lead) or aft (rear) of the body's line; the rig doesn't.
const HIP = 0.025;
// The idle's breath (poses.js breathe): sin(t · 2.1 + x).
const BREATH = 2.1;
const DEG = 180 / Math.PI;
const words = id => id.replace(/[A-Z]/g, c => ` ${c.toLowerCase()}`);
const SPECIALS = {
  uppercut: 'Uppercut', roundhouse: 'Roundhouse', spinKick: 'Spin kick', sideKick: 'Side kick', backKick: 'Back kick',
  sweep: 'Sweep', backflip: 'Backflip', sway: 'Sway', cartwheel: 'Cartwheel', getup: 'Get up', spun: 'Spun',
};

const buf = createJointBuffer();
const at = j => [buf[j * JOINT_STRIDE], buf[j * JOINT_STRIDE + 1] + ANKLE];
const rest = solvePose(REST_POSE, props, createJointBuffer());
// The foot standing flat, which the game's foot tilt 0 is.
const FLAT = Math.atan2(
  rest[Joint.ballNear * JOINT_STRIDE + 1] - rest[Joint.ankleNear * JOINT_STRIDE + 1],
  rest[Joint.ballNear * JOINT_STRIDE] - rest[Joint.ankleNear * JOINT_STRIDE],
);
const resolved = new Map();
const keysOf = m => {
  let r = resolved.get(m);
  if (!r) resolved.set(m, (r = resolveKeys(m)));
  return r;
};
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

/** The rig move and frame for what the fighter is doing, or null. */
function pick(f, kind, ctx) {
  const who = WHO[kind];
  if (!who) return null;
  const m = f.move ?? 'idle';
  const T = (f.moveT ?? 0) * FPS;
  const named = (name, frame) => (MOVE.has(name) ? [MOVE.get(name), frame] : null);
  // the specials (tools/rig-specials.mjs): a kind's own where it has one, else the shared one
  const special = SPECIALS[m];
  if (special) return named(`${who} ${special.toLowerCase()}`, T) ?? named(special, T);
  // knocked down: the KO's fall, lying at its end
  if (m === 'fall') return named(`${who} KO`, T);
  if (m.startsWith('punch')) return named(`${who} ${words(m)}${f.arm === 1 ? ' (lead arm)' : ''}`, T);
  // A held kick kicks again (sim.js CHAIN): Wren's second and third have moves of their own.
  if (m.startsWith('kick')) return named(`${who} ${words(m)}${f.chain ? ` ${f.chain + 1}` : ''}`, T);
  if (m === 'duck' && f.stance === 'run') return kind === 'hero' ? named('Wren duck (running)', 0) : null;
  switch (m) {
    case 'hit': {
      // a blow to the face or the middle: the clips' reactions (tools/rig-specials.mjs), shared
      const h = ctx.hitH ?? 'high';
      return named(`Hit ${h}`, T) ?? named(`${who} hit ${h}`, T);
    }
    case 'palm':
    case 'ko':
      return named(`${who} ${m === 'ko' ? 'KO' : 'palm'}`, T);
    case 'block':
    case 'blockLow':
    case 'duck':
      return named(`${who} ${words(m)}`, 0);
    case 'walk': {
      // the step (tools/rig-specials.mjs: Walking's legs under the guard), else the walk
      const move = MOVE.get(`${who} step`) ?? MOVE.get(`${who} walk`);
      return move ? [move, (f.phase ?? 0) * move.length] : null;
    }
    case 'run': {
      // Running (tools/rig-specials.mjs), else the run made from poses.js
      const move = kind === 'hero' && (MOVE.get('Wren run') ?? MOVE.get('Run'));
      return move ? [move, (f.phase ?? 0) * move.length] : null;
    }
    case 'stance':
      return named(`${who} to ${f.stance === 'run' ? 'run' : 'guard'}`, T);
    case 'bow':
      return kind === 'hero' ? named('Bow', T) : null;
    case 'cheer':
      return kind === 'hero' ? named('Wren cheer', T) : null;
    case 'idle': {
      const move = f.stance !== 'run' && (MOVE.get(`${who} fight idle`) ?? MOVE.get(`${who} idle`));
      if (!move) return null;
      const turn = ((ctx.t ?? 0) * BREATH + (f.x ?? 0)) / (2 * Math.PI);
      return [move, (turn - Math.floor(turn)) * move.length];
    }
    default:
      return null;
  }
}

/** The rig pose for what a fighter is doing, or null where the editor has no move for it. */
export function rigPose(f, kind, ctx) {
  const got = pick(f, kind, ctx);
  if (!got) return null;
  const [move, frame] = got;
  const fr = move.loop ? frame - Math.floor(frame / move.length) * move.length : Math.min(Math.max(frame, 0), move.length - 1);
  return sampleMove(move, fr, keysOf(move));
}
/** Blends two rig poses, the first's whole turns (yaw, pitch, bank) matched to the second's so
 *  a move that ends a spin or a flip round doesn't unwind into the next. */
export function blendRig(a, b, q) {
  const near = (v, to) => (v ?? 0) + Math.round(((to ?? 0) - (v ?? 0)) / (2 * Math.PI)) * 2 * Math.PI;
  return lerpPose({ ...a, yaw: near(a.yaw, b.yaw), pitch: near(a.pitch, b.pitch), bank: near(a.bank, b.bank) }, b, q);
}
/** A move's pose by its name and frame (tools and checks), or null. */
export function poseOf(name, frame) {
  const move = MOVE.get(name);
  return move ? sampleMove(move, Math.min(Math.max(frame, 0), move.length - 1), keysOf(move)) : null;
}
/** The rig moves by name. */
export const rigMoves = MOVE;

// The view: side-on, the near side (+z) toward the camera, with a slight oblique so a turning
// body's near and far sides part (each point slides forward by OBLIQUE of its depth).
const OBLIQUE = 0.1;
const STRIDE = JOINT_STRIDE;
const p3 = j => [buf[j * STRIDE], buf[j * STRIDE + 1], buf[j * STRIDE + 2]];
const view = ([x, y, z]) => [x + z * OBLIQUE, y + ANKLE];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = v => Math.hypot(v[0], v[1]);
const unit = (v, k = 1) => { const l = len(v) || 1e-6; return [(v[0] / l) * k, (v[1] / l) * k]; };
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1e-6; return [v[0] / l, v[1] / l, v[2] / l]; };
// rig.js's angles: from straight down, + forward
const fromDown = v => Math.atan2(v[0], -v[1]);

/**
 * rig.js's skeleton for a rig pose, drawn from the rig's own joints in 3D, so turns, spins and
 * flips read: limbs foreshorten, the near and far sides swap as the body turns (`la` / `ll` are
 * whichever arm and leg are further, `ra` / `rl` the nearer), and a body turned away draws
 * mirrored (`hand` −1). `prev` is the last one drawn, to hold the facing through face-on.
 */
export function skeletonOf(pose, prev) {
  solvePose(pose, props, buf);
  const H3 = p3(Joint.pelvis), S3 = p3(Joint.chest);
  const H = view(H3), S = view(S3);
  const upV = sub(S, H);
  // The torso is drawn its own length (BONE.torso): `up` stretches it to the chest.
  const up = [upV[0] / BONE.torso, upV[1] / BONE.torso];
  // The way the chest faces: up the spine across the shoulders (near minus far).
  const fwd = norm3(cross(norm3(sub3(S3, H3)), sub3(p3(Joint.shoulderNear), p3(Joint.shoulderFar))));
  const side = [up[1], -up[0]];
  const along = fwd[0] * side[0] + fwd[1] * side[1];
  const hand = Math.abs(along) > 0.2 ? Math.sign(along) : (prev?.hand ?? 1);
  const fr = unit(side, hand);
  const headV = sub(view(p3(Joint.head)), S);
  const hu = len(headV) > 1e-3 ? unit(headV) : unit(upV);
  const C = [S[0] + hu[0] * (BONE.neck + BONE.head), S[1] + hu[1] * (BONE.neck + BONE.head)];
  const hf = [hu[1] * hand, -hu[0] * hand];
  const arm = s => {
    const sh = view(p3(Joint[`shoulder${s}`])), e = view(p3(Joint[`elbow${s}`])), w = view(p3(Joint[`wrist${s}`]));
    return { s: sh, e, w, a: fromDown(sub(e, sh)), b: fromDown(sub(w, e)), z: (p3(Joint[`elbow${s}`])[2] + p3(Joint[`wrist${s}`])[2]) / 2 };
  };
  const leg = s => {
    const a3 = p3(Joint[`ankle${s}`]), b3 = p3(Joint[`ball${s}`]);
    const a = view(a3), d = sub(view(b3), a);
    const full = Math.hypot(...sub3(b3, a3)) || 1e-6;
    // the foot as rig.js draws it: along its sole, turned from the ankle-to-ball line
    const c = Math.cos(-FLAT), sn = Math.sin(-FLAT), u = unit(d);
    return {
      h: view(p3(Joint[`hip${s}`])), k: view(p3(Joint[`knee${s}`])), a,
      f: [u[0] * c - u[1] * sn, u[0] * sn + u[1] * c], fl: Math.max(0.35, Math.min(1, len(d) / full)),
      z: (p3(Joint[`knee${s}`])[2] + a3[2]) / 2,
    };
  };
  const [n, f] = [arm('Near'), arm('Far')];
  const [ln, lf] = [leg('Near'), leg('Far')];
  const [ra, la] = n.z >= f.z ? [n, f] : [f, n];
  const [rl, ll] = ln.z >= lf.z ? [ln, lf] : [lf, ln];
  const curl = pose.curl?.indexNear ?? 1.45;
  return {
    H, S, C, up, fr, t: Math.atan2(upV[0], upV[1]), hf, hu, hand, op: Math.min(1, Math.max(0, (1.45 - curl) / 1.35)),
    // face-on, the body is as wide as the shoulders
    wide: 1 + 0.35 * Math.abs(fwd[2]),
    la, ra, ll, rl, laFront: la.z > S3[2] + 0.05,
  };
}

/** poses.js's pose for a fighter from its rig move, or null where there's none. */
export function rigPoseFor(f, kind, ctx) {
  const pose = rigPose(f, kind, ctx);
  if (!pose) return null;
  solvePose(pose, props, buf);
  const H = at(Joint.pelvis), S = at(Joint.chest);
  const t = Math.atan2(S[0] - H[0], S[1] - H[1]);
  const up = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);
  // rig.js's dirDown: an angle from straight down, + forward.
  const down = (a, b) => Math.atan2(b[0] - a[0], -(b[1] - a[1]));
  const arm = side => {
    const s = at(Joint[`shoulder${side}`]), e = at(Joint[`elbow${side}`]), w = at(Joint[`wrist${side}`]);
    const A = down(s, e);
    return [(A + t) * DEG, wrap(down(e, w) - A) * DEG];
  };
  const leg = (side, aft) => {
    const a = at(Joint[`ankle${side}`]), b = at(Joint[`ball${side}`]);
    // The game's ankle, from its hip set fore or aft along the torso's forward line.
    const k = aft * HIP;
    return [a[0] + Math.cos(t) * k, a[1] - Math.sin(t) * k, wrap(FLAT - Math.atan2(b[1] - a[1], b[0] - a[0])) * DEG];
  };
  const [la, le] = arm('Far'), [ra, re] = arm('Near');
  const [lx, ly, lf] = leg('Far', 1), [rx, ry, rf] = leg('Near', -1);
  const curl = pose.curl?.indexNear ?? 1.45;
  return {
    hx: H[0], hy: H[1], t: t * DEG, n: (up(at(Joint.neck), at(Joint.head)) - t) * DEG,
    la, le, ra, re, lx, ly, rx, ry, lf, rf,
    op: Math.min(1, Math.max(0, (1.45 - curl) / 1.35)),
  };
}
