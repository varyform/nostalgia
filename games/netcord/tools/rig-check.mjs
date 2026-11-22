// Sanity checks on Netcord's moves as the game plays them (src/rig-moves.json through
// src/figure.js, MOVES from src/moves.js): every move the game names is there; loops close and
// their planted feet keep pace with the root; contact frames lie in the move and the racket's
// sweet spot is there where MOVES says; the face points where the shot goes and the swing runs
// the way the shot needs (low to high for topspin, high to low for slice); nothing goes
// through the court and the racket doesn't jump between frames. Prints PASS or FAIL.
//
//   mise exec -- node games/netcord/tools/rig-check.mjs [--verbose]
import { BONES, createFigure, isFingerJoint, Joint, JOINT_COUNT, MOVE_NAMES, newPose, RACKET, sampleLocal } from '../src/figure.js';
import { ballOf, BALL_JOINTS, contactAt, FIGURE, MOVES, RACKET_JOINTS, racketOf, newRacket } from '../src/moves.js';

const VERBOSE = process.argv.includes('--verbose');
const NEEDED = {
  loop: ['ready', 'run', 'shuffle', 'backpedal', 'walk'],
  swing: [
    'forehand', 'backhand', 'forehandSlice', 'backhandSlice', 'forehandLob', 'backhandLob', 'dropForehand',
    'dropBackhand', 'volleyForehand', 'volleyBackhand', 'volleyLowF', 'volleyLowB', 'smash', 'lunge', 'lungeBackhand',
  ],
  serve: ['serve', 'bounceBall'],
  react: ['split', 'celebrate', 'dejected', 'bow'],
};
// What each shot's face (the hitting side, body space f u s) and the racket head's way through
// contact must be: [min forward, min up, max up] of the face, and the head's rise (+1 up, −1
// down, 0 either).
const SHOTS = {
  forehand: [0.85, -0.2, 0.3, 1],
  backhand: [0.85, -0.2, 0.3, 1],
  forehandSlice: [0.6, 0.15, 0.65, -1],
  backhandSlice: [0.6, 0.15, 0.65, -1],
  forehandLob: [0.4, 0.45, 0.9, 1],
  backhandLob: [0.4, 0.45, 0.9, 1],
  dropForehand: [0.4, 0.35, 0.9, -1],
  dropBackhand: [0.4, 0.35, 0.9, -1],
  volleyForehand: [0.7, 0.05, 0.6, 0],
  volleyBackhand: [0.7, 0.05, 0.6, 0],
  volleyLowF: [0.5, 0.2, 0.8, 0],
  volleyLowB: [0.5, 0.2, 0.8, 0],
  smash: [0.8, -0.45, 0.2, 0],
  serve: [0.8, -0.4, 0.25, 0],
  lunge: [0.6, -0.1, 0.6, 0],
  lungeBackhand: [0.6, -0.1, 0.6, 0],
};
const BACKHANDS = new Set(['backhand', 'backhandSlice', 'backhandLob', 'dropBackhand', 'volleyBackhand', 'volleyLowB', 'lungeBackhand']);

const fails = [];
const notes = [];
const fail = (m, s) => fails.push(`${m}: ${s}`);
const note = (m, s) => notes.push(`${m}: ${s}`);
const N = JOINT_COUNT * 3;
const cm = v => `${(v * 100).toFixed(1)} cm`;
const deg = v => `${((v * 180) / Math.PI).toFixed(0)}°`;

// the joint indices moves.js hard-codes
for (const [k, j] of Object.entries(RACKET_JOINTS)) {
  const name = { wrist: 'wristNear', hand: 'handNear', index1: 'index1Near', pinky1: 'pinky1Near' }[k];
  if (Joint[name] !== j) fail('moves.js', `RACKET_JOINTS.${k} is ${j}, the rig's ${name} is ${Joint[name]}`);
}
for (const [k, j] of Object.entries(BALL_JOINTS)) {
  const name = { wrist: 'wristFar', hand: 'handFar', index1: 'index1Far', pinky1: 'pinky1Far' }[k];
  if (Joint[name] !== j) fail('moves.js', `BALL_JOINTS.${k} is ${j}, the rig's ${name} is ${Joint[name]}`);
}

for (const [kind, names] of Object.entries(NEEDED)) {
  for (const name of names) {
    if (!MOVE_NAMES.includes(name)) fail(name, 'not in rig-moves.json');
    else if (!MOVES[name]) fail(name, 'not in MOVES');
    else if (MOVES[name].kind !== kind) fail(name, `kind ${MOVES[name].kind}, wants ${kind}`);
  }
}
for (const name of MOVE_NAMES) if (!MOVES[name]) fail(name, 'in the rig but not in MOVES (re-pack)');

const FPS = FIGURE.fps;
const a = new Float32Array(N);
const b = new Float32Array(N);
const rk = newRacket();
const rk2 = newRacket();
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const angle = (p, q) => Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
const BALLS = [Joint.ballNear, Joint.ballFar];
const SOLES = new Set([Joint.ankleNear, Joint.ankleFar, Joint.ballNear, Joint.ballFar, Joint.toeNear, Joint.toeFar]);

for (const name of MOVE_NAMES) {
  const m = MOVES[name];
  if (!m) continue;
  const L = Math.round(m.dur * FPS);
  const loop = m.kind === 'loop';
  let worstTurn = 0;
  let worstJump = 0;
  let lowHead = Infinity;
  let under = 0;
  let maxStep = 0;
  for (let f = 0; f < L; f++) {
    sampleLocal(name, f, a);
    racketOf(a, rk);
    const head = [rk.head[0], rk.head[1] + FIGURE.ankle, rk.head[2]];
    // the head's lowest point (the frame's edge) over the court
    lowHead = Math.min(lowHead, head[1] - Math.abs(rk.up[1]) * RACKET.headLength * 0.5);
    for (let j = 0; j < JOINT_COUNT; j++) {
      if (SOLES.has(j) || isFingerJoint(j)) continue;
      under = Math.max(under, 0.03 - a[j * 3 + 1] - FIGURE.ankle);
    }
    if (f === 0 && !loop) continue;
    sampleLocal(name, f === 0 ? L - 1 : f - 1, b);
    racketOf(b, rk2);
    const inWindow = m.window && f / FPS >= m.window[0] - 3 / FPS && f / FPS <= m.window[1] + 3 / FPS;
    if (!inWindow) {
      worstTurn = Math.max(worstTurn, angle(rk.up, rk2.up), angle(rk.normal, rk2.normal) * 0.6);
      worstJump = Math.max(worstJump, dist(rk.head, rk2.head));
    }
    for (let i = 0; i < N; i += 3) {
      const d = Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]);
      if (f === 0) maxStep = Math.max(maxStep, d);
    }
  }
  if (lowHead < 0.0) fail(name, `the racket goes ${cm(-lowHead)} into the court`);
  if (under > 0) fail(name, `a joint (not a foot) comes within ${cm(0.03 - under)} of the court`);
  if (worstTurn > 0.8) fail(name, `the racket turns ${deg(worstTurn)} in a frame away from contact`);
  else if (worstTurn > 0.45) note(name, `the racket turns up to ${deg(worstTurn)} a frame`);
  if (worstJump > 0.45) fail(name, `the racket head jumps ${cm(worstJump)} in a frame away from contact`);

  if (loop) {
    // the wrap from the last frame to the first, no bigger than a frame's step elsewhere
    let typical = 0;
    for (let f = 1; f < L; f++) {
      sampleLocal(name, f, a);
      sampleLocal(name, f - 1, b);
      for (let i = 0; i < N; i += 3) typical = Math.max(typical, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]));
    }
    if (maxStep > typical * 1.5 + 0.005) fail(name, `the loop doesn't close: ${cm(maxStep)} at the wrap, ${cm(typical)} a frame elsewhere`);
    // a planted foot moves against the root as fast as the root goes: no skating
    const v = m.stride / L;
    const [df, ds] = m.dir;
    let slip = 0;
    let grounded = 0;
    for (let f = 0; f < L; f++) {
      sampleLocal(name, f, a);
      sampleLocal(name, (f + 1) % L, b);
      for (const j of BALLS) {
        if (a[j * 3 + 1] > 0.008 || b[j * 3 + 1] > 0.008) continue;
        grounded++;
        const dx = b[j * 3] - a[j * 3] + df * v;
        const dz = b[j * 3 + 2] - a[j * 3 + 2] + ds * v;
        slip = Math.max(slip, Math.hypot(dx, dz));
      }
    }
    if (m.stride > 0 && !grounded) fail(name, 'no foot is ever on the court');
    if (slip > 0.012) fail(name, `a planted foot skates ${cm(slip)} a frame (stride ${m.stride} m)`);
    else note(name, `feet slip ≤ ${cm(slip)} a frame; stride ${m.stride} m a ${m.dur} s cycle (${(m.stride / m.dur).toFixed(1)} m/s)`);
  }

  if (m.contact >= 0) {
    if (!(m.window[0] <= m.contact && m.contact <= m.window[1] && m.window[1] < m.dur)) fail(name, `contact ${m.contact} s outside its window ${m.window} or the move (${m.dur} s)`);
    // the figure at contact, played as the game does: the sweet spot where MOVES says
    const fig = createFigure();
    const out = newPose();
    const p = { x: 0, z: 0, yaw: 0, hand: 1, height: FIGURE.height, move: name, moveT: m.contact, phase: 0 };
    fig.pose(p, out);
    const want = [m.at.s, m.at.u, -m.at.f];
    const off = dist(out.racket.head, want);
    if (off > 0.01) fail(name, `sweet spot ${cm(off)} from MOVES.at`);
    // a left-hander mirrors it; a taller player reaches higher by contactAt
    const tall = { ...p, hand: -1, height: 1.95 };
    createFigure().pose(tall, out);
    const c = contactAt(name, 1.95);
    const off2 = dist(out.racket.head, [-c.s, c.u, -c.f]);
    if (off2 > 0.03) fail(name, `contactAt misses a 1.95 m left-hander's sweet spot by ${cm(off2)}`);
    const shot = SHOTS[name];
    if (shot) {
      const [f, u] = m.face;
      if (f < shot[0] || u < shot[1] || u > shot[2]) fail(name, `face [${m.face}] wants forward ≥ ${shot[0]}, up ${shot[1]}..${shot[2]}`);
      // the head's way through the window
      const c0 = Math.round(m.window[0] * FPS) - 1;
      const c1 = Math.round(m.window[1] * FPS) + 1;
      sampleLocal(name, c0, a);
      racketOf(a, rk);
      sampleLocal(name, c1, b);
      racketOf(b, rk2);
      const v = [rk2.head[0] - rk.head[0], rk2.head[1] - rk.head[1], rk2.head[2] - rk.head[2]];
      const speed = Math.hypot(...v) / ((c1 - c0) / FPS);
      if (v[0] <= 0) fail(name, `the racket head goes backward through contact`);
      if (shot[3] > 0 && v[1] <= 0) fail(name, 'a topspin swing that runs high to low');
      if (shot[3] < 0 && v[1] >= 0) fail(name, 'a slice or a hit down that runs low to high');
      const side = m.at.s;
      if (BACKHANDS.has(name) ? side > -0.2 : name !== 'smash' && name !== 'serve' && side < 0.2) fail(name, `contact on the wrong side (s ${side})`);
      note(name, `contact ${m.contact} s at f ${m.at.f} u ${m.at.u} s ${m.at.s}, face [${m.face}], head ${speed.toFixed(1)} m/s ${v[1] > 0 ? 'rising' : 'falling'}`);
    }
  }
  if (m.release) {
    sampleLocal(name, m.release.t * FPS, a);
    const p = ballOf(a, [0, 0, 0]);
    const off = dist([p[0], p[1] + FIGURE.ankle, p[2]], [m.release.at.f, m.release.at.u, m.release.at.s]);
    if (off > 0.01) fail(name, `release point ${cm(off)} off`);
  }
}

// the bones the renderer draws all join joints that exist
for (const [x, y] of BONES) if (!(x < JOINT_COUNT && y < JOINT_COUNT)) fail('BONES', `bone ${x}–${y} past the joints`);

if (VERBOSE || fails.length) for (const n of notes) console.log(`  ${n}`);
for (const f of fails) console.log(`  FAIL ${f}`);
console.log(fails.length ? `FAIL (${fails.length})` : `PASS (${MOVE_NAMES.length} moves)`);
process.exitCode = fails.length ? 1 : 0;
