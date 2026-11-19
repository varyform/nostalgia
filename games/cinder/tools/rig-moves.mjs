// Cinder's moves (src/hd/poses.js) as a rig editor project (~/projects/rig-editor): every move is
// sampled per frame with the game's own poseFor, its 2D skeleton (rig.js solve) is laid out as
// the rig's joints (lead limbs on the far side, rear on the near side), and the frames are fitted
// and thinned to keys with the editor's own Import pipeline (fit.ts), within 1 cm of that.
// Open the result in the editor with Import.
//
//   node games/cinder/tools/rig-moves.mjs [out.rig.json]   (Node 24: it loads the editor's .ts)
import { fileURLToPath } from "node:url";
const CINDER = fileURLToPath(new URL("../src", import.meta.url));
const RIG = process.env.RIG_EDITOR ?? fileURLToPath(new URL("../../../../rig-editor/src", import.meta.url));

const { poseFor, lerpPose, KNEEL, READY } = await import(`${CINDER}/hd/poses.js`);
const { solve, BONE } = await import(`${CINDER}/hd/rig.js`);
const { MOVES } = await import(`${CINDER}/moves.js`);
const { fitPose, posesToMove } = await import(`${RIG}/editor/fit.ts`);
const { newProject, serialize } = await import(`${RIG}/rig/format.ts`);
const { solvePose, FINGER_NAMES, REST_POSE } = await import(`${RIG}/rig/pose.ts`);
const { createJointBuffer, DEFAULT_PROPORTIONS, Joint, JOINT_STRIDE } = await import(
  `${RIG}/rig/skeleton.ts`
);
import { writeFileSync } from "node:fs";

const FPS = 60;
// The game's figure: its torso, arms and legs (rig.js BONE). The game has no neck, head, hands,
// feet or widths of its own to go by, so those are the rig's, grown as much as its legs are.
const GROWN = (BONE.th + BONE.sh) / (DEFAULT_PROPORTIONS.thigh + DEFAULT_PROPORTIONS.shin);
const props = {
  ...Object.fromEntries(Object.entries(DEFAULT_PROPORTIONS).map(([k, v]) => [k, v * GROWN])),
  spineLower: BONE.torso / 2,
  spineUpper: BONE.torso / 2,
  upperArm: BONE.ua,
  forearm: BONE.fa,
  thigh: BONE.th,
  shin: BONE.sh,
};
const TORSO = props.spineLower + props.spineUpper;
// The game's ankles stand 0.08 over the ground; the rig's y = 0 is ankle height.
const ANKLE = 0.08;

/** The rig's joints for one of the game's poses. */
function joints(p) {
  const J = solve(p);
  const out = createJointBuffer().fill(Number.NaN);
  const put = (j, [x, y], z = 0) => out.set([x, y - ANKLE, z], j * JOINT_STRIDE);
  const along = (a, b, q) => [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q];
  const dir = (deg) => [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)];
  const step = (a, d, l) => [a[0] + d[0] * l, a[1] + d[1] * l];
  // The game's torso line, as long as the rig's: the arms and head hang from its top.
  const S = step(J.H, J.up, TORSO);
  put(Joint.pelvis, J.H);
  put(Joint.belly, along(J.H, S, 0.25));
  put(Joint.waist, along(J.H, S, 0.5));
  put(Joint.ribs, along(J.H, S, 0.75));
  put(Joint.chest, S);
  // The head as the rig carries it: the neck half the nod, the head all of it.
  const neck = step(S, dir(p.t + p.n / 2), props.neck);
  put(Joint.neck, neck);
  put(Joint.head, step(neck, dir(p.t + p.n), props.headRadius));
  // Lead limbs (la, ll) are the far side, rear (ra, rl) the near.
  for (const [arm, leg, side, s] of [
    [J.ra, J.rl, "Near", 1],
    [J.la, J.ll, "Far", -1],
  ]) {
    const j = (name) => Joint[`${name}${side}`];
    const zs = (s * props.shoulderWidth) / 2;
    const zh = (s * props.hipWidth) / 2;
    // The game sets each shoulder and hip a little fore or aft of the body's line for a
    // three-quarter look; the rig stands side-on, so each limb hangs from the line itself.
    const from = (root, to) => (q) => [q[0] + to[0] - root[0], q[1] + to[1] - root[1]];
    const a = from(arm.s, S);
    const l = from(leg.h, J.H);
    put(j("shoulder"), a(arm.s), zs);
    put(j("elbow"), a(arm.e), zs);
    put(j("wrist"), a(arm.w), zs);
    const fore = [arm.w[0] - arm.e[0], arm.w[1] - arm.e[1]];
    const fl = Math.hypot(fore[0], fore[1]) || 1;
    put(j("hand"), a(step(arm.w, [fore[0] / fl, fore[1] / fl], props.hand)), zs);
    const f = foot(l(leg.h), l(leg.k), l(leg.a), Math.atan2(-leg.f[1], leg.f[0]));
    put(j("hip"), l(leg.h), zh);
    put(j("knee"), f.knee, zh);
    put(j("ankle"), f.ankle, zh);
    put(j("ball"), f.ball, zh);
    put(j("toe"), f.toe, zh);
  }
  return out;
}

// The rig's foot standing flat (its ankle → ball → toe), which the game's foot angle 0 is.
const REST = solvePose(REST_POSE, props, createJointBuffer());
const restAt = (j) => [REST[j * JOINT_STRIDE], REST[j * JOINT_STRIDE + 1]];
const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add2 = (a, b) => [a[0] + b[0], a[1] + b[1]];
const REST_BALL = sub2(restAt(Joint.ballNear), restAt(Joint.ankleNear));
const REST_TOE = sub2(restAt(Joint.toeNear), restAt(Joint.ankleNear));
/** Turned toe-down (clockwise, x forward and y up) by `a` radians. */
const down = ([x, y], a) => [x * Math.cos(a) + y * Math.sin(a), -x * Math.sin(a) + y * Math.cos(a)];
const DEG = Math.PI / 180;
/** Counter-clockwise from a to b, in (−π, π]. */
const turn = (a, b) => {
  const d = Math.atan2(b[1], b[0]) - Math.atan2(a[1], a[0]);
  return Math.atan2(Math.sin(d), Math.cos(d));
};
/** The knee of a leg from hip to ankle, bending forward as the game's does (rig.js ik). */
function knee(hip, ankle) {
  const [L1, L2] = [props.thigh, props.shin];
  const d0 = Math.hypot(...sub2(ankle, hip));
  if (d0 > L1 + L2 - 1e-4) return null;
  const a = Math.atan2(ankle[1] - hip[1], ankle[0] - hip[0]);
  const al = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d0 * d0 - L2 * L2) / (2 * L1 * d0))));
  return [hip[0] + L1 * Math.cos(a + al), hip[1] + L1 * Math.sin(a + al)];
}
// How an ankle can bend: the foot from its shin's line (knee → ankle), counter-clockwise, from
// pointed straight on (0) to about 20° past square (standing is 90°).
const POINTED = 0;
const FLEXED = 110 * DEG;
const HEEL_LIFT_MAX = 75 * DEG;
const flexOf = (p) => turn(sub2(p.ankle, p.knee), sub2(p.ball, p.ankle));
// The balls of the feet on the ground, in the game's heights.
const FLOOR = ANKLE + REST_BALL[1];

/**
 * A leg's knee, ankle, ball and toe for the game's foot angle (toe-down, rad). The game's feet
 * are flat slabs that keep their angle however far the knee goes over them (or that point
 * up past the shin, kneeling); a foot can't. Bent up too far, the heel lifts: on the ground
 * the foot rolls up onto its ball (the ankle rises, the leg reaching down to it, the toes stay
 * down), in the air it points. Past pointed, it points straight on.
 */
function foot(hip, kn, ankle, f) {
  const flat = { knee: kn, ankle, ball: add2(ankle, down(REST_BALL, f)), toe: add2(ankle, down(REST_TOE, f)) };
  // From the end it's bent past (or the nearer, past both): back to there.
  let flex = flexOf(flat);
  if (flex < (POINTED + FLEXED) / 2 - Math.PI) flex += 2 * Math.PI;
  if (flex >= POINTED && flex <= FLEXED) {
    const q = planted(hip, flat, ankle);
    return q.ball[1] < FLOOR + 0.005 ? lifted(hip, q) : q;
  }
  const turned = (by) => ({
    ...flat,
    ball: add2(ankle, down(REST_BALL, f + by)),
    toe: add2(ankle, down(REST_TOE, f + by)),
  });
  const flexed = flex > FLEXED ? flex - FLEXED : flex + 2 * Math.PI - FLEXED;
  const pointed = flex < POINTED ? POINTED - flex : 2 * Math.PI - flex + POINTED;
  // Flexed back on the ground, the heel lifts; and a foot doesn't go through the floor, so a
  // kneel's feet (pointing up past the shin in the game) lie back along it instead.
  const grounded = flat.ball[1] < FLOOR + 0.03;
  const options = [
    { p: grounded ? lifted(hip, flat) : turned(flexed), by: flexed },
    { p: turned(-pointed), by: pointed },
  ];
  const under = ({ ball, toe }) =>
    Math.max(0, FLOOR - 0.01 - ball[1], FLOOR + REST_TOE[1] - REST_BALL[1] - 0.01 - toe[1]);
  const { p } = options.reduce((a, b) => (under(b.p) * 100 + b.by < under(a.p) * 100 + a.by ? b : a));
  const q = planted(hip, p, ankle);
  // Raised onto the ball, the ankle may bend past FLEXED again: roll on up.
  return q.ball[1] < FLOOR + 0.005 ? lifted(hip, q) : q;
}

/**
 * The game tips a standing foot toe-down with its ankle where it was, the toes in the
 * ground: here the ankle rises until the ball is on the floor (the leg reaching down to it),
 * and the toes bend to lie on it.
 */
function planted(hip, p, from) {
  const up = FLOOR - p.ball[1];
  if (up > 0) {
    const raised = [p.ankle[0], p.ankle[1] + up];
    const k = knee(hip, raised);
    if (k) p = { knee: k, ankle: raised, ball: add2(p.ball, [0, up]), toe: add2(p.toe, [0, up]) };
  }
  const floorToe = FLOOR + REST_TOE[1] - REST_BALL[1];
  if (p.toe[1] < floorToe) {
    p = { ...p, toe: add2(p.ball, sub2(REST_TOE, REST_BALL)) };
  }
  heel.max = Math.max(heel.max, Math.hypot(...sub2(p.ankle, from)));
  return p;
}

/** The foot rolled up onto its ball until the ankle bends no further than FLEXED. */
function lifted(hip, flat) {
  const over = (q) => {
    const v = flexOf(q);
    return (v < (POINTED + FLEXED) / 2 - Math.PI ? v + 2 * Math.PI : v) > FLEXED;
  };
  let p = flat;
  for (let lift = 0.5 * DEG; over(p) && lift <= HEEL_LIFT_MAX; lift += 0.5 * DEG) {
    const raised = add2(flat.ball, down(sub2(flat.ankle, flat.ball), lift));
    const k = knee(hip, raised);
    if (!k) break;
    p = { ...flat, knee: k, ankle: raised };
  }
  return p;
}
const heel = { max: 0 };

/** Fists (op 0) to open palms (op 1). */
const hands = (op) => ({
  curl: Object.fromEntries(
    FINGER_NAMES.map((f) => [f, f.startsWith("thumb") ? 0.7 - 0.65 * op : 1.45 - 1.35 * op]),
  ),
  spread: { handNear: -0.1 + 0.25 * op, handFar: -0.1 + 0.25 * op },
});


const worst = { move: "", err: 0 };
function build(spec) {
  const sources = Array.from({ length: spec.frames }, (_, f) => spec.at(f));
  const poses = [];
  for (const p of sources) {
    const fit = fitPose(joints(p), props, poses.at(-1));
    poses.push({ ...fit, ...hands(p.op ?? 0) });
  }
  // How far the fitted rig strays from the game's skeleton (the joints both have).
  const check = [
    "pelvis", "chest", "shoulderNear", "elbowNear", "wristNear", "shoulderFar", "elbowFar", "wristFar",
    "hipNear", "kneeNear", "ankleNear", "toeNear", "hipFar", "kneeFar", "ankleFar", "toeFar",
  ].map((n) => Joint[n]);
  let err = 0;
  poses.forEach((pose, f) => {
    const a = solvePose(pose, props, createJointBuffer());
    const b = joints(sources[f]);
    for (const j of check) {
      const i = j * JOINT_STRIDE;
      err = Math.max(err, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]));
    }
  });
  if (err > worst.err) Object.assign(worst, { move: spec.name, err });
  const move = posesToMove(spec.name, poses, props, 0.01);
  move.tags = spec.tags;
  move.loop = !!spec.loop;
  if (spec.active) move.active = { ...spec.active, ...striker(poses[Math.round((spec.active.from + spec.active.to) / 2)], spec.tags.some((t) => t.startsWith("kick"))) };
  return { move, err };
}

const KINDS = [
  ["hero", "Wren", 1.05],
  ["footman", "Footman", 0.85],
  ["brawler", "Brawler", 1.0],
  ["adept", "Adept", 1.0],
  ["regent", "Regent", 0.95],
];
const frames = (s) => Math.round(s * FPS) + 1;
const io = (q) => q * q * (3 - 2 * q);
const fighter = (o) => ({ x: 0, phase: 0, stance: "guard", arm: 0, chain: 0, ...o });
const timed = (kind, move, extra = {}, ctx = {}) => (f) =>
  poseFor(fighter({ move, moveT: f / FPS, ...extra }), kind, { t: 0, ...ctx });
const active = (move) => ({
  from: Math.round(MOVES[move].on * FPS),
  to: Math.round(MOVES[move].off * FPS) - 1,
});
// What an attack hits with: the game hits by distance alone, so here it's the fist or foot
// that reaches furthest forward mid-window (the lead arm's punches strike with the far hand;
// a low punch's lunge can put the front foot past the fist, so punches pick a hand).
const STRIKERS = [
  ["handNear", 0.08],
  ["handFar", 0.08],
  ["ballNear", 0.1],
  ["ballFar", 0.1],
];
function striker(pose, kick) {
  const j = solvePose(pose, props, createJointBuffer());
  const x = (name) => j[Joint[name] * JOINT_STRIDE];
  const [joint, radius] = STRIKERS.filter(([n]) => n.startsWith(kick ? "ball" : "hand")).reduce((a, b) => (x(b[0]) > x(a[0]) ? b : a));
  return { joint, radius };
}
const words = (id) => id.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);

/** @type {{ name: string, tags: string[], frames: number, loop?: boolean, at(f: number): object, active?: object }[]} */
const specs = [];
for (const [kind, who, walk] of KINDS) {
  const tag = who.toLowerCase();
  const breath = (2 * Math.PI) / 2.1;
  const idleFrames = Math.round(breath * FPS);
  specs.push({
    name: `${who} idle`,
    tags: [tag, "idle"],
    frames: idleFrames,
    loop: true,
    at: (f) => poseFor(fighter({ move: "idle" }), kind, { t: (f / idleFrames) * breath }),
  });
  const walkFrames = Math.round((0.7 / walk) * FPS);
  specs.push({
    name: `${who} walk`,
    tags: [tag, "walk"],
    frames: walkFrames,
    loop: true,
    at: (f) => poseFor(fighter({ move: "walk", phase: f / walkFrames }), kind, { t: 0 }),
  });
  // The stance switches, with the game's 0.12 s cross-fade from the stance before.
  const guard = poseFor(fighter({ move: "idle" }), kind, { t: 0 });
  for (const [to, from, label] of [
    ["guard", READY, "to guard"],
    ["run", guard, "to run"],
  ]) {
    specs.push({
      name: `${who} ${label}`,
      tags: [tag, "stance"],
      frames: frames(MOVES.stance.dur),
      at: (f) =>
        lerpPose(
          from,
          poseFor(fighter({ move: "stance", moveT: f / FPS, stance: to }), kind, { t: 0 }),
          io(Math.min(1, f / FPS / 0.12)),
        ),
    });
  }
  for (const id of ["punchHigh", "punchMid", "punchLow"]) {
    for (const arm of [0, 1]) {
      specs.push({
        name: `${who} ${words(id)}${arm ? " (lead arm)" : ""}`,
        tags: [tag, "attack", id],
        frames: frames(MOVES[id].dur),
        at: timed(kind, id, { arm }),
        active: active(id),
      });
    }
  }
  for (const id of ["kickHigh", "kickMid", "kickLow", ...(kind === "regent" ? ["palm"] : [])]) {
    specs.push({
      name: `${who} ${words(id)}`,
      tags: [tag, "attack", id],
      frames: frames(MOVES[id].dur),
      at: timed(kind, id),
      active: active(id),
    });
  }
  for (const id of ["block", "blockLow", "duck"]) {
    specs.push({ name: `${who} ${words(id)}`, tags: [tag, "held", id], frames: 1, loop: true, at: timed(kind, id) });
  }
  for (const h of ["high", "mid", "low"]) {
    specs.push({
      name: `${who} hit ${h}`,
      tags: [tag, "hit"],
      frames: frames(MOVES.hit.dur),
      at: timed(kind, "hit", {}, { hitH: h }),
    });
  }
  specs.push({ name: `${who} KO`, tags: [tag, "ko"], frames: frames(MOVES.ko.dur), at: timed(kind, "ko") });
}
// Kind-free: the run (READY-based), a duck on the run, the bow, Wren's cheer, Oriel kneeling.
const runFrames = Math.round((1.7 / 2.6) * FPS);
specs.push(
  {
    name: "Run",
    tags: ["run"],
    frames: runFrames,
    loop: true,
    at: (f) => poseFor(fighter({ move: "run", stance: "run", phase: f / runFrames }), "hero", { t: 0 }),
  },
  { name: "Wren duck (running)", tags: ["wren", "held", "duck"], frames: 1, loop: true, at: timed("hero", "duck", { stance: "run" }) },
  { name: "Bow", tags: ["bow"], frames: frames(MOVES.bow.dur), at: timed("hero", "bow", { stance: "run" }) },
  { name: "Wren cheer", tags: ["wren", "cheer"], frames: frames(MOVES.cheer.dur), at: timed("hero", "cheer", { stance: "run" }) },
  { name: "Oriel kneel", tags: ["oriel", "held"], frames: 1, loop: true, at: () => KNEEL },
);

const built = specs.map(build);
const project = newProject("Cinder", built.map((b) => b.move));
project.fps = FPS;
project.proportions = props;
const out = process.argv[2] ?? fileURLToPath(new URL("../cinder.rig.json", import.meta.url));
writeFileSync(out, serialize(project));
const keys = built.reduce((n, b) => n + b.move.keys.length, 0);
console.log(`${built.length} moves, ${keys} keys → ${out}`);
console.log(`heels lifted up to ${(heel.max * 100).toFixed(1)} cm`);
console.log(`worst fit: ${(worst.err * 100).toFixed(1)} cm (${worst.move})`);
for (const b of built.filter((b) => b.err > 0.02)) console.log(`  ${b.move.name}: ${(b.err * 100).toFixed(1)} cm`);
