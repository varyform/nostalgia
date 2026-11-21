// Cinder's special moves, into its rig editor project (cinder.rig.json), replacing any of the
// same name and keeping every other move as it is: kicks, a backflip, a sweep and hit reactions
// taken from Mixamo clips (tools/clips.rig.json: the clips run through the editor's Import onto
// Cinder's build), and the rest keyed by hand here. Then the game's copy is packed (tools/rig-pack.mjs).
//
// A clip is retimed so its strike lands in the game's hit window (moves.js on … off), turned so
// the strike goes forward (+x, at the foe), and set under the root: its drift over the move is
// taken out, as is any `travel` the sim gives the move (the sim carries the fighter instead).
// It eases in from Wren's guard and back out to it, a whole turn on where it spun round.
//
//   node games/cinder/tools/rig-specials.mjs     (Node 24: it loads the editor's .ts)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pack } from './rig-pack.mjs';

const CINDER = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const RIG = process.env.RIG_EDITOR ?? fileURLToPath(new URL('../../../../rig-editor/src', import.meta.url));
const R = await import(`${RIG}/rig/index.ts`);
const { fitPose, posesToMove } = await import(`${RIG}/editor/fit.ts`);
const { MOVES, travelAt } = await import(`${CINDER}/src/moves.js`);
const { P } = await import(`${CINDER}/src/sim.js`);
const { Joint, JOINT_STRIDE: S } = R;

const FILE = `${CINDER}/cinder.rig.json`;
const project = R.parseProject(JSON.parse(readFileSync(FILE, 'utf8')));
const clips = R.parseProject(JSON.parse(readFileSync(`${CINDER}/tools/clips.rig.json`, 'utf8')));
const props = project.proportions;
const FPS = project.fps;
const TAU = 2 * Math.PI;
const FOLDER = 'Specials';

const named = (p, name) => {
  const m = p.moves.find(m => m.name === name);
  if (!m) throw new Error(`no move ${name}`);
  return m;
};
const poseAt = (move, frame) => R.sampleMove(move, frame);
/** Wren's guard, and where her fall leaves her lying. */
const GUARD = poseAt(named(project, 'Wren idle'), 0);
const LYING = poseAt(named(project, 'Wren KO'), named(project, 'Wren KO').length - 1);
const frames = id => Math.round(MOVES[id].dur * FPS);
const smooth = q => q * q * (3 - 2 * q);
/** How much of a clip's drift is taken out by frame i: as the sim's travel goes, else evenly. */
const along = (id, i, n) => {
  const tr = MOVES[id].travel;
  return tr ? travelAt(id, i / FPS) / tr[0] : smooth(i / (n - 1));
};
/** A guard pose turned by whole turns, to blend to from a pose that spun round. */
const turned = (pose, like) => {
  const whole = v => Math.round((v ?? 0) / TAU) * TAU;
  return { ...pose, yaw: whole(like.yaw), pitch: whole(like.pitch), bank: whole(like.bank) };
};
const active = (id, joint) => {
  const M = MOVES[id];
  return M.reach ? { from: Math.round(M.on * FPS), to: Math.round(M.off * FPS), joint, radius: 0.12 } : undefined;
};
const jointAt = (buf, j) => [buf[j * S], buf[j * S + 1], buf[j * S + 2]];

/**
 * A move from a clip. `at` [start, strike, end] are the clip's frames that land on the move's
 * first frame, the middle of its hit window and its last (or, with no hit window, its middle);
 * `striker` the joint that strikes, whose way at the strike turns the clip to face +x.
 */
function fromClip({ name, clip, id, at: [a, hit, b], striker, blendIn = 6, blendOut = 10, tags = [] }) {
  const src = named(clips, clip);
  const M = MOVES[id];
  const n = frames(id);
  const mid = M.on != null ? Math.round(((M.on + M.off) / 2) * FPS) : Math.round(n / 2);
  const clipFrame = i => (i <= mid ? a + ((hit - a) * i) / mid : hit + ((b - hit) * (i - mid)) / (n - 1 - mid));
  const buf = R.createJointBuffer();
  const solve = f => R.solvePose(poseAt(src, f), clips.proportions, buf);
  // The turn: the striker's way from the pelvis at the strike, onto +x.
  let turn = 0;
  if (striker) {
    solve(hit);
    const p = jointAt(buf, Joint.pelvis), s = jointAt(buf, Joint[striker]);
    turn = Math.atan2(s[2] - p[2], s[0] - p[0]);
  }
  const c = Math.cos(turn), sn = Math.sin(turn);
  const rot = ([x, y, z]) => [x * c + z * sn, y, -x * sn + z * c];
  // The drift: the pelvis from where it starts to where it ends, taken out along the way.
  solve(a);
  const p0 = rot(jointAt(buf, Joint.pelvis));
  solve(b);
  const p1 = rot(jointAt(buf, Joint.pelvis));
  const poses = [];
  for (let i = 0; i < n; i++) {
    solve(clipFrame(i));
    const q = along(id, i, n);
    const dx = p0[0] + (p1[0] - p0[0]) * q;
    const dz = p0[2] + (p1[2] - p0[2]) * q;
    const out = R.createJointBuffer();
    for (let j = 0; j < buf.length / S; j++) {
      const [x, y, z] = rot(jointAt(buf, j));
      out.set([x - dx, y, z - dz], j * S);
    }
    poses.push(fitPose(out, props, poses.at(-1)));
  }
  // In from the guard, out to it.
  const first = poses[0], last = poses[n - 1], end = turned(GUARD, last);
  for (let i = 0; i < blendIn; i++) poses[i] = R.lerpPose(GUARD, first, smooth(i / blendIn));
  for (let i = 0; i < blendOut; i++) poses[n - 1 - i] = R.lerpPose(end, last, smooth(i / blendOut));
  for (const p of poses) Object.assign(p, { curl: GUARD.curl, spread: GUARD.spread });
  const move = posesToMove(name, poses, props, 0.01);
  return finish(move, id, striker, tags);
}

/** A move keyed by hand: [frame, what the key sets, ease]; the first and last set everything. */
function keyed({ name, id, keys, striker, tags = [] }) {
  const n = frames(id);
  const move = R.newMove(name, GUARD, n);
  move.keys = keys.map(([frame, pose, ease]) => ({
    frame: frame < 0 ? n + frame : frame,
    pose: pose.pelvis && pose.footNear && pose.handNear ? R.fullKey(pose) : pose,
    ...(ease ? { ease } : {}),
  }));
  R.compactKeys(move);
  return finish(move, id, striker, tags);
}

function finish(move, id, striker, tags = []) {
  move.tags = ['special', id, ...tags];
  move.folder = FOLDER;
  const a = striker && active(id, striker);
  if (a) move.active = a;
  else delete move.active;
  return move;
}

const G = GUARD;
const specials = [
  // The finisher of three punches: a dip, then the rear fist driven up from the legs.
  keyed({
    name: 'Uppercut', id: 'uppercut', striker: 'handNear',
    keys: [
      [0, G],
      [9, { pelvis: { x: 0.02, y: 0.58 }, lean: 0.3, bend: 0.12, spineTwist: 0.4, headTilt: 0.15, handNear: { x: 0.02, y: -0.32, z: 0.04 }, handFar: { x: 0.28, y: 0.02, z: 0 } }, 'out'],
      [17, { pelvis: { x: 0.12, y: 0.78 }, lean: -0.12, bend: -0.06, spineTwist: -0.55, headTilt: -0.12, handNear: { x: 0.26, y: 0.4, z: -0.06 }, handFar: { x: 0.2, y: -0.14, z: 0 } }, 'in'],
      [23, { pelvis: { x: 0.12, y: 0.8 }, handNear: { x: 0.24, y: 0.46, z: -0.06 } }, 'out'],
      [-1, G],
    ],
  }),
  // Down on the lead leg and round, the rear leg out straight along the floor.
  keyed({
    name: 'Sweep', id: 'sweep', striker: 'ankleNear',
    keys: [
      [0, G],
      [7, { pelvis: { x: 0.08, y: 0.34 }, lean: 0.8, headTilt: -0.3, yaw: 0.5, footFar: { x: 0.12, y: 0 }, footNear: { x: -0.5, y: 0 }, handNear: { x: 0.22, y: -0.5, z: 0.05 }, handFar: { x: 0.34, y: -0.46, z: 0 } }, 'in'],
      [16, { yaw: 2.0, pelvis: { x: 0.05, y: 0.26 }, lean: 0.9, footNear: { x: -0.86, y: 0.02 } }, 'linear'],
      [24, { yaw: 3.1 }, 'linear'],
      [31, { yaw: 3.95 }, 'linear'],
      [40, { yaw: 5.5, footNear: { x: -0.45, y: 0 }, pelvis: { x: 0.06, y: 0.42 }, lean: 0.55 }, 'out'],
      [-1, turned(G, { yaw: TAU })],
    ],
  }),
  // A half turn on the lead foot, the rear leg chambered and driven straight back at the foe.
  keyed({
    name: 'Back kick', id: 'backKick', striker: 'ankleNear',
    keys: [
      [0, G],
      [9, { yaw: 1.2, pelvis: { x: 0.08, y: 0.64 }, footFar: { x: 0.12, y: 0 }, footNear: { x: -0.35, y: 0.04 }, lean: 0.05 }],
      [18, { yaw: 2.75, pelvis: { x: 0.08, y: 0.7 }, footNear: { x: -0.05, y: 0.42 }, lean: 0.25, handNear: { x: 0.2, y: 0, z: 0 }, handFar: { x: 0.25, y: 0.05, z: 0 } }, 'linear'],
      [25, { yaw: 3.14, pelvis: { x: 0.06, y: 0.74 }, lean: 0.8, headTilt: -0.4, footNear: { x: -0.98, y: 0.62 }, handNear: { x: 0.1, y: -0.3, z: 0 }, handFar: { x: 0.35, y: -0.1, z: 0 } }, 'out'],
      [31, { yaw: 3.2, footNear: { x: -1.0, y: 0.64 } }],
      [39, { yaw: 4.4, footNear: { x: -0.25, y: 0.3 }, lean: 0.2, headTilt: 0, pelvis: { x: 0.05, y: 0.7 } }],
      [-1, turned(G, { yaw: TAU })],
    ],
  }),
  // Leaning back out of reach, the feet where they were.
  keyed({
    name: 'Sway', id: 'sway',
    keys: [
      [0, G],
      [6, { pelvis: { x: -0.22, y: 0.62 }, lean: -0.75, bend: -0.3, headTilt: -0.2, handNear: { x: 0.2, y: 0.1, z: 0 }, handFar: { x: 0.3, y: 0.15, z: 0 } }, 'out'],
      [20, { pelvis: { x: -0.25, y: 0.6 }, lean: -0.8 }],
      [-1, G],
    ],
  }),
  // Away over the hands, face-on: a whole turn about the way the body faces.
  keyed({
    name: 'Cartwheel', id: 'cartwheel',
    keys: [
      [0, G],
      [8, { yaw: Math.PI / 2, bank: 0, pelvis: { x: 0, y: 0.78 }, lean: 0, bend: 0, handNear: { x: 0, y: 0.55, z: 0.12 }, handFar: { x: 0, y: 0.55, z: -0.12 }, footNear: { x: 0, y: 0, z: 0.25 }, footFar: { x: 0, y: 0.12, z: -0.2 } }, 'in'],
      [18, { bank: 1.6, pelvis: { x: 0, y: 0.95 }, footNear: { x: 0, y: 0.2, z: 0.45 }, footFar: { x: 0, y: 0.2, z: -0.45 } }, 'linear'],
      [27, { bank: Math.PI, pelvis: { x: 0, y: 1.02 } }, 'linear'],
      [36, { bank: 4.7, pelvis: { x: 0, y: 0.95 } }, 'linear'],
      [45, { bank: TAU, pelvis: { x: 0, y: 0.75 }, footNear: { x: 0, y: 0, z: 0.25 }, footFar: { x: 0, y: 0.05, z: -0.2 } }, 'out'],
      [-1, { ...G, bank: TAU }],
    ],
  }),
  // Up off the floor: sit up, feet under, rise into the guard.
  keyed({
    name: 'Get up', id: 'getup',
    keys: [
      [0, LYING],
      [10, { pelvis: { x: -0.82, y: 0.1 }, lean: -0.6, headTilt: 0.3, footNear: { x: -0.45, y: 0 }, footFar: { x: -0.5, y: 0.05 }, handNear: { x: -0.25, y: -0.35, z: 0 }, handFar: { x: -0.2, y: -0.35, z: 0 } }, 'out'],
      [22, { pelvis: { x: -0.5, y: 0.38 }, lean: 0.55, headTilt: 0.1, footNear: { x: -0.62, y: 0 }, footFar: { x: -0.35, y: 0 }, handNear: { x: 0.2, y: -0.3, z: 0 }, handFar: { x: 0.3, y: -0.2, z: 0 } }],
      [34, { pelvis: { x: -0.2, y: 0.62 }, lean: 0.15 }],
      [-1, G],
    ],
  }),
  fromClip({ name: 'Roundhouse', clip: 'Martelo', id: 'roundhouse', at: [0, 33, 77], striker: 'toeFar' }),
  fromClip({ name: 'Brawler roundhouse', clip: 'Roundhouse Kick', id: 'roundhouse', at: [24, 60, 128], striker: 'toeNear' }),
  fromClip({ name: 'Spin kick', clip: 'Armada', id: 'spinKick', at: [0, 76, 98], striker: 'toeFar' }),
  fromClip({ name: 'Side kick', clip: 'Side Kick', id: 'sideKick', at: [6, 46, 96], striker: 'toeNear' }),
  fromClip({ name: 'Spun', clip: 'Shoved Reaction With Spin', id: 'spun', at: [60, 100, 140], blendOut: 16 }),
  // the crouch and the flip; the landing is the blend into the guard, a whole turn on (past
  // the clip's frame 108 the fit reads the turn the other way round, which won't blend)
  fromClip({ name: 'Backflip', clip: 'Backflip', id: 'backflip', at: [44, 90, 108], blendIn: 4, blendOut: 16 }),
  // a hook sweep standing, for the Footman's drill (the others keep the low spinning one)
  fromClip({ name: 'Footman sweep', clip: 'Leg Sweep', id: 'sweep', at: [16, 52, 100], striker: 'toeNear' }),
  // hit reactions for every fighter, in place of the ones made from poses.js: the head snapped
  // back by a blow to the face, and the body doubling over one to the middle
  fromClip({ name: 'Hit high', clip: 'Receive Punch To The Face', id: 'hit', at: [0, 22, 60], blendIn: 2, blendOut: 6 }),
  fromClip({ name: 'Hit mid', clip: 'Taking Punch', id: 'hit', at: [0, 31, 70], blendIn: 2, blendOut: 6 }),
];

// Every fighter's guard and step, with a clip's life laid over it: the guard bobs and shifts as
// Fight Idle does, and the step takes Walking's legs, shortened to the game's stride (a foot set
// down then moves back as fast as the fighter goes, so it doesn't slide). What's added is the
// clip's motion about its own middle, onto the fighter's own idle from poses.js, so each keeps
// its stance and the blends into its other moves don't change.
{
  /** The numbers of a pose, as [path, value] pairs. */
  const flat = (o, at = '') =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === 'number' ? [[at + k, v]] : v && typeof v === 'object' ? flat(v, `${at}${k}.`) : []));
  const put = (o, path, v) => {
    const ks = path.split('.');
    let x = o;
    for (const k of ks.slice(0, -1)) x = x[k];
    x[ks.at(-1)] = v;
  };
  /**
   * A clip's pose at frame f of its cycle. Mixamo's last frame is its first again, the root back
   * where it started, and not always quite where the frame before leads (Running's near foot
   * jumps 15 cm sideways onto it): so the cycle is length − 1 frames, the last of them carried
   * on from the two before it in place of the clip's own.
   */
  const cycleAt = (src, f) => {
    const L = src.length - 2;
    if (f <= L) return poseAt(src, f);
    const a = poseAt(src, L - 1), b = structuredClone(poseAt(src, L));
    for (const [k, v] of flat(b)) put(b, k, v + (f - L) * (v - flat(a).find(([j]) => j === k)[1]));
    return b;
  };
  /** How far a clip's pelvis goes in its cycle. */
  const driftOf = src => cycleAt(src, src.length - 1).pelvis.x - poseAt(src, 0).pelvis.x;
  /**
   * A clip's poses over one cycle, n of them, made to loop: what the cycle's end misses its
   * start by (the drift forward, and any seam) taken out along the way.
   */
  const cycle = (clip, n) => {
    const src = named(clips, clip);
    const P = src.length - 1;
    const start = new Map(flat(poseAt(src, 0)));
    // (a channel the first frame leaves out, the pelvis's sideways z, is 0 there)
    const miss = new Map(flat(cycleAt(src, P)).map(([k, v]) => [k, v - (start.get(k) ?? 0)]));
    return Array.from({ length: n }, (_, i) => {
      const f = (i / n) * P;
      const p = structuredClone(cycleAt(src, f));
      for (const [k, v] of flat(p)) put(p, k, v - (miss.get(k) ?? 0) * (f / P));
      return p;
    });
  };
  /** Layers a clip cycle's motion onto a move: how much of each channel (`gain` by path, else 1). */
  const layer = (base, clipPoses, name, gain, still = false) => {
    const n = clipPoses.length;
    const mid = new Map();
    for (const p of clipPoses) for (const [k, v] of flat(p)) mid.set(k, (mid.get(k) ?? 0) + v / n);
    // a foot's height from where it's set down, not its middle, so it never sinks into the floor
    for (const k of ['footNear.y', 'footFar.y']) mid.set(k, Math.min(...clipPoses.map(p => p[k.split('.')[0]].y)));
    const poses = clipPoses.map((c, i) => {
      const p = structuredClone(poseAt(base, still ? 0 : (i / n) * base.length));
      const cv = new Map(flat(c));
      for (const [k, v] of flat(p)) {
        const g = gain(k);
        if (g && cv.has(k)) put(p, k, v + g * (cv.get(k) - mid.get(k)));
      }
      return p;
    });
    poses.push(poses[0]);
    const move = posesToMove(name, poses, props, 0.005);
    move.length = n;
    move.loop = true;
    move.keys = move.keys.filter(k => k.frame < n);
    move.tags = ['clip', ...(base.tags ?? [])];
    move.folder = base.folder;
    return move;
  };

  const gainOf = rules => k => {
    for (const [re, g] of rules) if (re.test(k)) return g;
    return 1;
  };
  const IDLE = gainOf([[/^foot/, 0], [/^(curl|spread|toes)/, 0], [/^hand/, 1.4], [/./, 1.4]]);
  const walkK = P.strideWalk / driftOf(named(clips, 'Walking')); // the game's stride (sim.js P.strideWalk) over Walking's
  const STEP = gainOf([
    [/^(pelvis|foot(Near|Far))\.x$/, walkK],
    [/^foot(Near|Far)\.y$/, 0.6],
    [/^foot(Near|Far)\.z$/, 0.3],
    [/^pelvis/, 0.8],
    [/^hand/, 0.2],
    [/^(curl|spread|toes)/, 0],
    [/^(yaw|spineTwist|lean|bend|roll|upperRoll|headTilt)$/, 0.5],
  ]);
  const idle = cycle('Fight Idle', 180);
  for (const who of ['Wren', 'Footman', 'Brawler', 'Adept', 'Regent']) {
    const base = project.moves.find(m => m.name === `${who} idle`);
    if (base) specials.push(layer(base, idle, `${who} fight idle`, IDLE));
    // the step: the guard's stance (the idle's first frame) with Walking's legs, a walk cycle long
    const walk = project.moves.find(m => m.name === `${who} walk`);
    if (base && walk) specials.push(layer(base, cycle('Walking', walk.length), `${who} step`, STEP, true));
  }
  // Wren's run: Running whole, its stride brought to the sim's (P.strideRun: the sim moves her a
  // stride a cycle), a cycle as long as she takes to run it.
  {
    const src = named(clips, 'Running');
    const k = P.strideRun / driftOf(src);
    const n = Math.round((P.strideRun / P.run) * FPS);
    const poses = cycle('Running', n).map(p => {
      for (const part of [p.pelvis, p.footNear, p.footFar]) part.x *= k;
      return p;
    });
    poses.push(poses[0]);
    const move = posesToMove('Wren run', poses, props, 0.005);
    move.length = n;
    move.loop = true;
    move.keys = move.keys.filter(key => key.frame < n);
    move.tags = ['clip', 'run'];
    move.folder = 'Wren';
    specials.push(move);
  }
}

for (const m of specials) {
  const i = project.moves.findIndex(x => x.name === m.name);
  if (i >= 0) project.moves[i] = m;
  else project.moves.push(m);
}
project.folders = [...new Set([...(project.folders ?? []), FOLDER])];
writeFileSync(FILE, R.serialize(project));
console.log(`${specials.length} specials, ${specials.reduce((n, m) => n + m.keys.length, 0)} keys → ${FILE}`);
await pack();
