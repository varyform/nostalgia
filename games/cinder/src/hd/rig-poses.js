// The fighters' moves as made in the rig editor (rig-moves.json, from tools/rig-moves.mjs), played
// through @nostalgia/rig and read back as poses.js's flat poses, so the renderer blends and
// dresses them as it always has. A rig move's joints are side-on (x forward, y up, the near side
// +z): the lead limbs are the far side, the rear ones the near. What the editor has no move for
// (a foe's chained kick, the run stance's idle, the teacher) is left to poses.js: null.
import { createJointBuffer, Joint, JOINT_STRIDE, parseProject, REST_POSE, resolveKeys, sampleMove, solvePose } from '@nostalgia/rig';
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
  if (m.startsWith('punch')) return named(`${who} ${words(m)}${f.arm === 1 ? ' (lead arm)' : ''}`, T);
  // A held kick kicks again (sim.js CHAIN): Wren's second and third have moves of their own.
  if (m.startsWith('kick')) return named(`${who} ${words(m)}${f.chain ? ` ${f.chain + 1}` : ''}`, T);
  if (m === 'duck' && f.stance === 'run') return kind === 'hero' ? named('Wren duck (running)', 0) : null;
  switch (m) {
    case 'palm':
    case 'hit':
    case 'ko':
      return named(`${who} ${m === 'hit' ? `hit ${ctx.hitH ?? 'high'}` : m === 'ko' ? 'KO' : 'palm'}`, T);
    case 'block':
    case 'blockLow':
    case 'duck':
      return named(`${who} ${words(m)}`, 0);
    case 'walk': {
      const move = MOVE.get(`${who} walk`);
      return move ? [move, (f.phase ?? 0) * move.length] : null;
    }
    case 'run': {
      const move = kind === 'hero' && MOVE.get('Run');
      return move ? [move, (f.phase ?? 0) * move.length] : null;
    }
    case 'stance':
      return named(`${who} to ${f.stance === 'run' ? 'run' : 'guard'}`, T);
    case 'bow':
      return kind === 'hero' ? named('Bow', T) : null;
    case 'cheer':
      return kind === 'hero' ? named('Wren cheer', T) : null;
    case 'idle': {
      const move = f.stance !== 'run' && MOVE.get(`${who} idle`);
      if (!move) return null;
      const turn = ((ctx.t ?? 0) * BREATH + (f.x ?? 0)) / (2 * Math.PI);
      return [move, (turn - Math.floor(turn)) * move.length];
    }
    default:
      return null;
  }
}

/** poses.js's pose for a fighter from its rig move, or null where there's none. */
export function rigPoseFor(f, kind, ctx) {
  const got = pick(f, kind, ctx);
  if (!got) return null;
  const [move, frame] = got;
  const fr = move.loop ? frame - Math.floor(frame / move.length) * move.length : Math.min(Math.max(frame, 0), move.length - 1);
  const pose = sampleMove(move, fr, keysOf(move));
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
