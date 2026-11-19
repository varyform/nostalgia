import { Exact, clamp, lerp, smoothstep, vec3, type Vec2, type Vec3 } from "./math.ts";
import { solveTwoBone3 } from "./ik.ts";
import {
  BALL,
  FINGER_SHAPE,
  fingerJoints,
  FINGERS,
  Joint,
  JOINT_STRIDE,
  SIDES,
  type Finger,
  type JointIndex,
  type Proportions,
  type Side,
} from "./skeleton.ts";

/** An IK target: x forward, y up, z sideways toward the near side (defaults to 0). */
export type Target = Vec2 & { z?: number };

/** The four IK chains, named after what they reach with: hands and feet. */
export type LimbName = "handNear" | "handFar" | "footNear" | "footFar";

export const LIMBS: readonly LimbName[] = ["handNear", "handFar", "footNear", "footFar"];

export type HandName = "handNear" | "handFar";
export const HANDS: readonly HandName[] = ["handNear", "handFar"];
export type FootName = "footNear" | "footFar";
export const FEET: readonly FootName[] = ["footNear", "footFar"];

/** A finger of one hand, e.g. "indexNear". */
export type FingerName = `${Finger}${Side}`;
export const FINGER_NAMES: readonly FingerName[] = SIDES.flatMap((s) =>
  FINGERS.map((f) => `${f}${s}` as const),
);

export const isArm = (limb: LimbName): boolean => limb === "handNear" || limb === "handFar";

/** +1 for the near side, -1 for the far one. */
export const sideOf = (limb: LimbName): 1 | -1 => (limb.endsWith("Near") ? 1 : -1);

/**
 * A pose is a set of IK targets in the figure's body space: +x points the way
 * the body faces, +y is up, +z is the near side, and the origin is the ground
 * under the figure (the root). `yaw` turns the whole body space about the
 * vertical axis through the root, so turned, spinning and back-turned poses
 * are authored exactly like side-on ones.
 */
export interface Pose {
  /**
   * Pelvis position relative to the root: forward, up, and (z, 0 if left
   * out) sideways toward the near side. The feet keep their places as it
   * moves; the hips go with it.
   */
  pelvis: Target;
  /** Angle of the lower spine from vertical, radians; positive leans toward facing. */
  lean: number;
  /** Extra head tilt on top of the spine's angle. */
  headTilt: number;
  /** Wrist targets relative to each shoulder. */
  handNear: Target;
  handFar: Target;
  /** Ankle targets: x and y relative to the root, z relative to each hip. */
  footNear: Target;
  footFar: Target;
  /** Upper spine's bend on top of `lean`, radians; positive curls forward. */
  bend?: number;
  /**
   * Body rotation about the vertical axis, radians. 0 = side-on; positive
   * turns the chest toward the camera (the far arm and leg come forward),
   * π = back to the camera's right. Whole turns are spins.
   */
  yaw?: number;
  /** Spine side-bend toward the near side, radians. */
  roll?: number;
  /** The upper spine's side-bend on top of `roll`, curling up it as `bend` does `lean`. */
  upperRoll?: number;
  /**
   * The chest turning against the hips, about the top of the spine,
   * radians, the same way as `yaw` (positive brings the far shoulder
   * forward): the shoulders, the neck and head and the elbows' bend turn
   * with it.
   */
  spineTwist?: number;
  /**
   * The hip line's tilt about the way the body faces, radians, turning the
   * same way as `roll` (positive drops the near hip): a high kick lifts the
   * kicking side's hip. The feet keep their places.
   */
  hipTilt?: number;
  /**
   * Whole-body rotation about the pelvis in the side plane, radians:
   * positive tips the head toward the facing direction, negative tips it
   * back (−2π is a backflip). Applied before yaw.
   */
  pitch?: number;
  /** Rotates a knee or elbow about its root→target line, radians; positive swings it toward the near side. */
  swivel?: Partial<Record<LimbName, number>>;
  /**
   * Wrist and ankle angles, radians. A hand at 0 carries on along the forearm
   * and positive curls it the way the elbow bends. A foot at 0 is square to
   * the shin, toes forward, and positive points the toes.
   */
  flex?: Partial<Record<LimbName, number>>;
  /**
   * Turns a hand about the forearm, radians: 0 has the palm facing the way
   * the elbow points away from (forward, with the arm hanging), and positive
   * turns the palm in, then back (π/2 faces the thigh), for either hand.
   */
  twist?: Partial<Record<HandName, number>>;
  /**
   * The collarbones: each shoulder raised (positive) or dropped about the
   * top of the spine, radians, as a shrug lifts it, and brought forward
   * (positive) or drawn back, as a reach rounds it. The arm goes with it.
   */
  shrug?: Partial<Record<HandName, number>>;
  reach?: Partial<Record<HandName, number>>;
  /** Bend at each of a finger's three joints, radians: 0 straight, positive toward the palm. */
  curl?: Partial<Record<FingerName, number>>;
  /** Fans a hand's fingers apart (positive) or together, radians; the thumb swings out with it. */
  spread?: Partial<Record<HandName, number>>;
  /** Bends the toes at the ball of the foot, radians: 0 in line with the foot, positive up (as in pushing off). */
  toes?: Partial<Record<FootName, number>>;
}

/** A relaxed stand: arms down, feet under the hips. */
export const REST_POSE: Pose = {
  pelvis: { x: 0, y: 0.76 },
  lean: 0.03,
  headTilt: 0,
  handNear: { x: 0.04, y: -0.54, z: 0.02 },
  handFar: { x: -0.02, y: -0.54, z: -0.02 },
  footNear: { x: 0.06, y: 0 },
  footFar: { x: -0.06, y: 0 },
  twist: { handNear: Math.PI / 2, handFar: Math.PI / 2 },
  curl: Object.fromEntries(FINGER_NAMES.map((f) => [f, f.startsWith("thumb") ? 0.15 : 0.3])),
};

const cloneTarget = (t: Target): Target => ({ x: t.x, y: t.y, z: t.z ?? 0 });

export const clonePose = (p: Pose): Pose => ({
  pelvis: { ...p.pelvis },
  lean: p.lean,
  headTilt: p.headTilt,
  handNear: cloneTarget(p.handNear),
  handFar: cloneTarget(p.handFar),
  footNear: cloneTarget(p.footNear),
  footFar: cloneTarget(p.footFar),
  bend: p.bend ?? 0,
  yaw: p.yaw ?? 0,
  roll: p.roll ?? 0,
  upperRoll: p.upperRoll ?? 0,
  spineTwist: p.spineTwist ?? 0,
  hipTilt: p.hipTilt ?? 0,
  pitch: p.pitch ?? 0,
  swivel: { ...p.swivel },
  flex: { ...p.flex },
  twist: { ...p.twist },
  shrug: { ...p.shrug },
  reach: { ...p.reach },
  curl: { ...p.curl },
  spread: { ...p.spread },
  toes: { ...p.toes },
});

/**
 * Below this reach (m) a limb's end is too close to its root for its angle to
 * mean much: blending fades from a swing to a straight line by half of it.
 */
const SWING_MIN_REACH = 0.24;
/** A foot raised this high (m) at either end swings fully; one on the floor slides. */
const SWING_LIFT = 0.2;

/**
 * Blends a hand or foot target the way a limb moves: swung about its root
 * (`a0`/`b0`, the shoulder or hip in each pose) by blending its angle and
 * reach, not slid along the straight line between the two, so a kick sweeps
 * up in an arc and an uppercut scoops. Ends close to the root, where the
 * angle is unreliable, fall back to the straight line. z is linear.
 *
 * Feet (`grounded`) only swing as far as they leave the floor: a planted
 * foot still slides along it, and an arc never dips below the lower end.
 */
function swingTarget(
  a: Target,
  b: Target,
  t: number,
  a0: Vec2,
  b0: Vec2,
  grounded = false,
): Target {
  const linear: Target = {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z ?? 0, b.z ?? 0, t),
  };
  const ax = a.x - a0.x;
  const ay = a.y - a0.y;
  const bx = b.x - b0.x;
  const by = b.y - b0.y;
  const ra = Exact.hypot(ax, ay);
  const rb = Exact.hypot(bx, by);
  let weight = clamp((Math.min(ra, rb) * 2) / SWING_MIN_REACH - 1, 0, 1);
  if (grounded) weight *= clamp(Math.max(a.y, b.y) / SWING_LIFT, 0, 1);
  if (weight === 0 || t <= 0 || t >= 1) return linear;
  const from = Exact.atan2(ay, ax);
  let turn = Exact.atan2(by, bx) - from;
  // The short way round.
  if (turn > Math.PI) turn -= 2 * Math.PI;
  else if (turn < -Math.PI) turn += 2 * Math.PI;
  const angle = from + turn * t;
  const reach = lerp(ra, rb, t);
  const x = lerp(a0.x, b0.x, t) + Exact.cos(angle) * reach;
  const y = lerp(a0.y, b0.y, t) + Exact.sin(angle) * reach;
  linear.x = lerp(linear.x, x, weight);
  linear.y = lerp(linear.y, y, weight);
  if (grounded) linear.y = Math.max(linear.y, Math.min(a.y, b.y));
  return linear;
}

/** Hands are relative to the shoulders: they swing about the origin. */
const SHOULDER: Vec2 = { x: 0, y: 0 };

function lerpRecord<K extends string>(
  keys: readonly K[],
  a: Partial<Record<K, number>> | undefined,
  b: Partial<Record<K, number>> | undefined,
  t: number,
): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const k of keys) {
    const from = a?.[k] ?? 0;
    const to = b?.[k] ?? 0;
    if (from !== 0 || to !== 0) out[k] = lerp(from, to, t);
  }
  return out;
}

/** The pelvis `t` of the way from `a` to `b`; sideways only where either is off to a side. */
export function lerpPelvis(a: Target, b: Target, t: number): Target {
  const out: Target = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  if (a.z || b.z) out.z = lerp(a.z ?? 0, b.z ?? 0, t);
  return out;
}

/** Plain lerp, yaw included: blending 0 → 2π is a full spin. */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    pelvis: lerpPelvis(a.pelvis, b.pelvis, t),
    lean: lerp(a.lean, b.lean, t),
    headTilt: lerp(a.headTilt, b.headTilt, t),
    handNear: swingTarget(a.handNear, b.handNear, t, SHOULDER, SHOULDER),
    handFar: swingTarget(a.handFar, b.handFar, t, SHOULDER, SHOULDER),
    // Feet are relative to the root: they swing about the hips (the pelvis).
    footNear: swingTarget(a.footNear, b.footNear, t, a.pelvis, b.pelvis, true),
    footFar: swingTarget(a.footFar, b.footFar, t, a.pelvis, b.pelvis, true),
    bend: lerp(a.bend ?? 0, b.bend ?? 0, t),
    yaw: lerp(a.yaw ?? 0, b.yaw ?? 0, t),
    roll: lerp(a.roll ?? 0, b.roll ?? 0, t),
    upperRoll: lerp(a.upperRoll ?? 0, b.upperRoll ?? 0, t),
    spineTwist: lerp(a.spineTwist ?? 0, b.spineTwist ?? 0, t),
    hipTilt: lerp(a.hipTilt ?? 0, b.hipTilt ?? 0, t),
    pitch: lerp(a.pitch ?? 0, b.pitch ?? 0, t),
    swivel: lerpRecord(LIMBS, a.swivel, b.swivel, t),
    flex: lerpRecord(LIMBS, a.flex, b.flex, t),
    twist: lerpRecord(HANDS, a.twist, b.twist, t),
    shrug: lerpRecord(HANDS, a.shrug, b.shrug, t),
    reach: lerpRecord(HANDS, a.reach, b.reach, t),
    curl: lerpRecord(FINGER_NAMES, a.curl, b.curl, t),
    spread: lerpRecord(HANDS, a.spread, b.spread, t),
    toes: lerpRecord(FEET, a.toes, b.toes, t),
  };
}

/** How far (fraction of a blend) the limbs trail the body. */
const LEAD_LAG = 0.3;

/** What `lead` easing runs ahead (the body's core); the rest trails. */
export const CORE: ReadonlySet<string> = new Set([
  "pelvis",
  "lean",
  "bend",
  "yaw",
  "roll",
  "upperRoll",
  "spineTwist",
  "hipTilt",
  "pitch",
]);

/** How far along a `lead` blend at `t` a part is: the core ahead, the rest behind (eased). */
export function leadTime(core: boolean, t: number, lag = LEAD_LAG): number {
  return smoothstep(clamp(core ? t / (1 - lag) : (t - lag) / (1 - lag), 0, 1));
}

/** One limb's target `t` of the way from `a`'s to `b`'s, as lerpPose blends it. */
export function lerpTarget(a: Pose, b: Pose, limb: LimbName, t: number): Target {
  return isArm(limb)
    ? swingTarget(a[limb], b[limb], t, SHOULDER, SHOULDER)
    : swingTarget(a[limb], b[limb], t, a.pelvis, b.pelvis, true);
}

/**
 * Overlapping action: the body leads and the limbs follow. The core
 * (pelvis, lean, bend, turn) runs ahead over the first `1 - lag` of the
 * blend, the hands, feet and head trail over the last `1 - lag`, each eased;
 * both arrive together at `t` = 1, so the end pose is exact.
 */
export function lerpPoseLead(a: Pose, b: Pose, t: number, lag = LEAD_LAG): Pose {
  const core = leadTime(true, t, lag);
  const limbs = lerpPose(a, b, leadTime(false, t, lag));
  limbs.pelvis = lerpPelvis(a.pelvis, b.pelvis, core);
  limbs.lean = lerp(a.lean, b.lean, core);
  limbs.bend = lerp(a.bend ?? 0, b.bend ?? 0, core);
  limbs.yaw = lerp(a.yaw ?? 0, b.yaw ?? 0, core);
  limbs.roll = lerp(a.roll ?? 0, b.roll ?? 0, core);
  limbs.hipTilt = lerp(a.hipTilt ?? 0, b.hipTilt ?? 0, core);
  limbs.upperRoll = lerp(a.upperRoll ?? 0, b.upperRoll ?? 0, core);
  limbs.spineTwist = lerp(a.spineTwist ?? 0, b.spineTwist ?? 0, core);
  limbs.pitch = lerp(a.pitch ?? 0, b.pitch ?? 0, core);
  return limbs;
}

// --- body space ----------------------------------------------------------

// Scratch vectors: the solver may run every frame for every figure.
const pelvis = vec3();
const belly = vec3();
const waist = vec3();
const ribs = vec3();
const chest = vec3();
const neck = vec3();
const head = vec3();
/** The chest's sideways axis (toward the near side), turned with the roll and the twist. */
const side = vec3();
/** The chest's up: along the spine's top bone. */
const chestUp = vec3();
/** What the elbows bend about: body z, turned with the spine's twist. */
const armHinge = vec3();
/** The hinge the knees bend about: body z. */
const LEG_HINGE: Vec3 = { x: 0, y: 0, z: 1 };
/** Each shoulder from the chest (near, far), on its collarbone. */
const collarNear = vec3();
const collarFar = vec3();
/** The hips' sideways axis, turned with the hip tilt. */
const hipSide = vec3();
const root = vec3();
const target = vec3();
const pole = vec3();
const mid = vec3();
const end = vec3();
const tip = vec3();
const world = vec3();
const axis = vec3();

/** Lays out the spine and head of `pose` in body space, into the scratch vectors. */
function layOutSpine(pose: Pose, props: Proportions): void {
  const roll = pose.roll ?? 0;
  const upperRoll = pose.upperRoll ?? 0;
  const twist = pose.spineTwist ?? 0;
  /** A direction at `angle` from vertical toward +x, side-bent by `r` toward +z. */
  const dir = (angle: number, r: number, into: Vec3): Vec3 => {
    const c = Exact.cos(angle);
    into.x = Exact.sin(angle);
    into.y = c * Exact.cos(r);
    into.z = c * Exact.sin(r);
    return into;
  };
  const put = (d: Vec3, length: number, from: Vec3, into: Vec3): void => {
    into.x = from.x + d.x * length;
    into.y = from.y + d.y * length;
    into.z = from.z + d.z * length;
  };
  // Four bones curving from `lean` at the bottom to lean + bend at the top, and from `roll`
  // to roll + upperRoll.
  const bend = pose.bend ?? 0;
  const upper = pose.lean + bend;
  const top = roll + upperRoll;
  pelvis.x = pose.pelvis.x;
  pelvis.y = pose.pelvis.y;
  pelvis.z = pose.pelvis.z ?? 0;
  put(dir(pose.lean, roll, axis), props.spineLower / 2, pelvis, belly);
  put(dir(pose.lean + bend / 3, roll + upperRoll / 3, axis), props.spineLower / 2, belly, waist);
  put(
    dir(pose.lean + (bend * 2) / 3, roll + (upperRoll * 2) / 3, axis),
    props.spineUpper / 2,
    waist,
    ribs,
  );
  put(dir(upper, top, chestUp), props.spineUpper / 2, ribs, chest);
  // The neck and head tilt in the chest's plane, turned with it.
  rotateAbout(dir(upper + pose.headTilt * 0.5, top, axis), chestUp, -twist);
  put(axis, props.neck, chest, neck);
  rotateAbout(dir(upper + pose.headTilt, top, axis), chestUp, -twist);
  put(axis, props.headRadius, neck, head);
  side.x = 0;
  side.y = -Exact.sin(top);
  side.z = Exact.cos(top);
  rotateAbout(side, chestUp, -twist);
  armHinge.x = 0;
  armHinge.y = 0;
  armHinge.z = 1;
  rotateAbout(armHinge, chestUp, -twist);
  // Each shoulder half the shoulders' width from the chest, raised toward the chest's up
  // by its shrug and swung toward its front (up × side) by its reach.
  const fx = chestUp.y * side.z - chestUp.z * side.y;
  const fy = chestUp.z * side.x - chestUp.x * side.z;
  const fz = chestUp.x * side.y - chestUp.y * side.x;
  for (const hand of HANDS) {
    const s = sideOf(hand);
    const into = s > 0 ? collarNear : collarFar;
    const half = props.shoulderWidth / 2;
    const up = pose.shrug?.[hand] ?? 0;
    const on = pose.reach?.[hand] ?? 0;
    const cu = Exact.cos(up) * half;
    const out = Exact.cos(on) * cu * s;
    const ahead = Exact.sin(on) * cu;
    const rise = Exact.sin(up) * half;
    into.x = side.x * out + fx * ahead + chestUp.x * rise;
    into.y = side.y * out + fy * ahead + chestUp.y * rise;
    into.z = side.z * out + fz * ahead + chestUp.z * rise;
  }
  const tilt = pose.hipTilt ?? 0;
  hipSide.x = 0;
  hipSide.y = -Exact.sin(tilt);
  hipSide.z = Exact.cos(tilt);
}

/** Where a limb's chain starts (shoulder or hip), body space; `layOutSpine` first. */
function limbRoot(limb: LimbName, props: Proportions, into: Vec3): void {
  const s = sideOf(limb);
  if (isArm(limb)) {
    const collar = s > 0 ? collarNear : collarFar;
    into.x = chest.x + collar.x;
    into.y = chest.y + collar.y;
    into.z = chest.z + collar.z;
  } else {
    const half = (s * props.hipWidth) / 2;
    into.x = pelvis.x;
    into.y = pelvis.y + hipSide.y * half;
    into.z = pelvis.z + hipSide.z * half;
  }
}

/** Where a limb's target is, body space; `layOutSpine` first. */
function limbTarget(pose: Pose, limb: LimbName, props: Proportions, into: Vec3): void {
  const t = pose[limb];
  if (isArm(limb)) {
    limbRoot(limb, props, into);
    into.x += t.x;
    into.y += t.y;
    into.z += t.z ?? 0;
  } else {
    into.x = t.x;
    into.y = t.y;
    into.z = (sideOf(limb) * props.hipWidth) / 2 + (t.z ?? 0);
  }
}

/** Where a figure stands and which way it faces, for placing body space in the world. */
export interface Placement {
  x: number;
  y: number;
  /** +1 faces +x, -1 mirrors x. */
  facing: 1 | -1;
}

const ORIGIN: Placement = { x: 0, y: 0, facing: 1 };

/** A body-space point in world space: pitched about the pelvis, turned by yaw, then placed. */
export function toWorld(pose: Pose, v: Vec3, at: Placement = ORIGIN, into: Vec3 = vec3()): Vec3 {
  const pitch = pose.pitch ?? 0;
  const yaw = pose.yaw ?? 0;
  const cp = Exact.cos(pitch);
  const sp = Exact.sin(pitch);
  const cy = Exact.cos(yaw);
  const sy = Exact.sin(yaw);
  const dx = v.x - pose.pelvis.x;
  const dy = v.y - pose.pelvis.y;
  const x = pose.pelvis.x + dx * cp + dy * sp;
  const y = pose.pelvis.y - dx * sp + dy * cp;
  const z = v.z;
  into.x = at.x + (x * cy - z * sy) * at.facing;
  into.y = at.y + y;
  into.z = x * sy + z * cy;
  return into;
}

/** The inverse of `toWorld`. */
export function toBody(pose: Pose, w: Vec3, at: Placement = ORIGIN, into: Vec3 = vec3()): Vec3 {
  const pitch = pose.pitch ?? 0;
  const yaw = pose.yaw ?? 0;
  const cp = Exact.cos(pitch);
  const sp = Exact.sin(pitch);
  const cy = Exact.cos(yaw);
  const sy = Exact.sin(yaw);
  const a = (w.x - at.x) * at.facing;
  const x = a * cy + w.z * sy;
  const z = -a * sy + w.z * cy;
  const dx = x - pose.pelvis.x;
  const dy = w.y - at.y - pose.pelvis.y;
  into.x = pose.pelvis.x + dx * cp - dy * sp;
  into.y = pose.pelvis.y + dx * sp + dy * cp;
  into.z = z;
  return into;
}

/** Where a limb's IK target sits in the world (it's where the wrist or ankle goes, if it can reach). */
export function targetInWorld(
  pose: Pose,
  props: Proportions,
  limb: LimbName,
  at: Placement = ORIGIN,
): Vec3 {
  layOutSpine(pose, props);
  limbTarget(pose, limb, props, target);
  return toWorld(pose, target, at);
}

/** The target that puts a limb's wrist or ankle at a world point. */
export function targetFromWorld(
  pose: Pose,
  props: Proportions,
  limb: LimbName,
  point: Vec3,
  at: Placement = ORIGIN,
): Target {
  layOutSpine(pose, props);
  const body = toBody(pose, point, at);
  if (isArm(limb)) {
    limbRoot(limb, props, root);
    return { x: body.x - root.x, y: body.y - root.y, z: body.z - root.z };
  }
  return { x: body.x, y: body.y, z: body.z - (sideOf(limb) * props.hipWidth) / 2 };
}

/**
 * The collarbone angles (shrug and reach) that point a shoulder from the
 * chest toward a world point, the rest of the pose as it is.
 */
export function collarFromWorld(
  pose: Pose,
  props: Proportions,
  hand: HandName,
  point: Vec3,
  at: Placement = ORIGIN,
): { shrug: number; reach: number } {
  layOutSpine(pose, props);
  const b = toBody(pose, point, at);
  const dx = b.x - chest.x;
  const dy = b.y - chest.y;
  const dz = b.z - chest.z;
  const s = sideOf(hand);
  const out = (dx * side.x + dy * side.y + dz * side.z) * s;
  const rise = dx * chestUp.x + dy * chestUp.y + dz * chestUp.z;
  // Forward: up × side.
  const ahead =
    dx * (chestUp.y * side.z - chestUp.z * side.y) +
    dy * (chestUp.z * side.x - chestUp.x * side.z) +
    dz * (chestUp.x * side.y - chestUp.y * side.x);
  return {
    shrug: Exact.atan2(rise, Exact.hypot(out, ahead)),
    reach: Exact.atan2(ahead, out),
  };
}

/** The pelvis position that puts the pelvis at a world point. */
export function pelvisFromWorld(pose: Pose, point: Vec3, at: Placement = ORIGIN): Target {
  // The body pitches about the pelvis, so only the yaw moves it.
  const yaw = pose.yaw ?? 0;
  const a = (point.x - at.x) * at.facing;
  const cy = Exact.cos(yaw);
  const sy = Exact.sin(yaw);
  const z = -a * sy + point.z * cy;
  return { x: a * cy + point.z * sy, y: point.y - at.y, ...(Math.abs(z) > 1e-9 ? { z } : {}) };
}

// --- solving --------------------------------------------------------------

/** Rotates `v` about the unit axis `k` by `angle` (Rodrigues), in place. */
function rotateAbout(v: Vec3, k: Vec3, angle: number): void {
  if (angle === 0) return;
  const c = Exact.cos(angle);
  const s = Exact.sin(angle);
  const dot = k.x * v.x + k.y * v.y + k.z * v.z;
  const cx = k.y * v.z - k.z * v.y;
  const cy = k.z * v.x - k.x * v.z;
  const cz = k.x * v.y - k.y * v.x;
  v.x = v.x * c + cx * s + k.x * dot * (1 - c);
  v.y = v.y * c + cy * s + k.y * dot * (1 - c);
  v.z = v.z * c + cz * s + k.z * dot * (1 - c);
}

/**
 * Bend direction for a limb from `from` to `target`: knees (+1) bend
 * forward/up and elbows (-1) down/back in the body's side plane (the hinge
 * axis is sideways, z), then `swivel` rotates the bend about the limb.
 */
function bendPole(from: Vec3, bend: 1 | -1, swivel: number, hinge: Vec3): void {
  axis.x = target.x - from.x;
  axis.y = target.y - from.y;
  axis.z = target.z - from.z;
  const len = Exact.hypot(axis.x, axis.y, axis.z) || 1;
  axis.x /= len;
  axis.y /= len;
  axis.z /= len;
  // hinge × limb direction (with the hinge z, the 2D "counter-clockwise" perpendicular).
  pole.x = (hinge.y * axis.z - hinge.z * axis.y) * bend;
  pole.y = (hinge.z * axis.x - hinge.x * axis.z) * bend;
  pole.z = (hinge.x * axis.y - hinge.y * axis.x) * bend;
  // A limb along the hinge has no bend plane: fall back to forward/down.
  if (Exact.hypot(pole.x, pole.y, pole.z) < 0.15) {
    pole.x = bend > 0 ? 1 : 0;
    pole.y = bend > 0 ? 0 : -1;
    pole.z = 0;
  }
  rotateAbout(pole, axis, swivel);
}

/**
 * The end segment (hand or foot) from `end`, `length` long, into `tip`. Its
 * direction is set in the limb's bend plane: from the last bone `mid` → `end`
 * and the bend side (the pole).
 */
function endSegment(arm: boolean, angle: number, length: number, twist = 0, toes = 0): void {
  let sx = end.x - mid.x;
  let sy = end.y - mid.y;
  let sz = end.z - mid.z;
  const sl = Exact.hypot(sx, sy, sz) || 1;
  sx /= sl;
  sy /= sl;
  sz /= sl;
  // The pole, square to the last bone.
  const along = pole.x * sx + pole.y * sy + pole.z * sz;
  let px = pole.x - along * sx;
  let py = pole.y - along * sy;
  let pz = pole.z - along * sz;
  const pl = Exact.hypot(px, py, pz);
  if (pl < 1e-6) {
    px = 1;
    py = 0;
    pz = 0;
  } else {
    px /= pl;
    py /= pl;
    pz /= pl;
  }
  if (twist !== 0) {
    back.x = px;
    back.y = py;
    back.z = pz;
    forearmAxis.x = sx;
    forearmAxis.y = sy;
    forearmAxis.z = sz;
    rotateAbout(back, forearmAxis, twist);
    px = back.x;
    py = back.y;
    pz = back.z;
  }
  const c = Exact.cos(angle);
  const s = Exact.sin(angle);
  // A hand carries on along the forearm and curls away from the elbow's point;
  // a foot starts square to the shin on the knee's side and points along it.
  const dx = arm ? c * sx - s * px : c * px + s * sx;
  const dy = arm ? c * sy - s * py : c * py + s * sy;
  const dz = arm ? c * sz - s * pz : c * pz + s * sz;
  tip.x = end.x + dx * length;
  tip.y = end.y + dy * length;
  tip.z = end.z + dz * length;
  if (!arm) {
    // The foot breaks at the ball: the toes turn up (away from the shin's
    // way down, rotated with the foot) by `toes`.
    ball.x = end.x + dx * length * BALL;
    ball.y = end.y + dy * length * BALL;
    ball.z = end.z + dz * length * BALL;
    const nx = -s * px + c * sx;
    const ny = -s * py + c * sy;
    const nz = -s * pz + c * sz;
    const ct = Exact.cos(toes);
    const st = Exact.sin(toes);
    const rest = length * (1 - BALL);
    tip.x = ball.x + (ct * dx - st * nx) * rest;
    tip.y = ball.y + (ct * dy - st * ny) * rest;
    tip.z = ball.z + (ct * dz - st * nz) * rest;
  }
  // The hand's frame, for the fingers: along it, and its back (the palm faces away).
  handDir.x = dx;
  handDir.y = dy;
  handDir.z = dz;
  back.x = arm ? c * px + s * sx : px;
  back.y = arm ? c * py + s * sy : py;
  back.z = arm ? c * pz + s * sz : pz;
}

const handDir = vec3();
const ball = vec3();
const back = vec3();
const forearmAxis = vec3();
const across = vec3();
const palm = vec3();
const fdir = vec3();
const fpalm = vec3();
const fside = vec3();
const joint = vec3();

/**
 * Lays out a hand's fingers from the wrist (`end`) and the hand's frame
 * (`handDir`, `back`; `endSegment` first), calling `put` for each joint.
 * Each finger leaves its base along the hand, fanned toward the thumb by its
 * rest angle plus the spread, then bends toward the palm by its curl at each
 * of its joints. The thumb leaves by the wrist, angled out across the palm,
 * and curls across it toward the little finger.
 */
function layOutFingers(
  pose: Pose,
  hand: HandName,
  length: number,
  put: (j: JointIndex, v: Vec3) => void,
): void {
  const side: Side = hand === "handNear" ? "Near" : "Far";
  // Toward the thumb: the near hand is a right hand, the far one a left.
  const k = side === "Near" ? 1 : -1;
  across.x = (back.y * handDir.z - back.z * handDir.y) * k;
  across.y = (back.z * handDir.x - back.x * handDir.z) * k;
  across.z = (back.x * handDir.y - back.y * handDir.x) * k;
  palm.x = -back.x;
  palm.y = -back.y;
  palm.z = -back.z;
  const spread = pose.spread?.[hand] ?? 0;
  for (const finger of FINGERS) {
    const shape = FINGER_SHAPE[finger];
    const joints = fingerJoints(finger, side);
    const curl = pose.curl?.[`${finger}${side}`] ?? 0;
    joint.x = end.x + (handDir.x * shape.along + across.x * shape.across) * length;
    joint.y = end.y + (handDir.y * shape.along + across.y * shape.across) * length;
    joint.z = end.z + (handDir.z * shape.along + across.z * shape.across) * length;
    let fan: number;
    if (finger === "thumb") {
      // Out across the palm's front, more so as the hand spreads.
      fan = shape.fan + spread;
      const lift = 0.5;
      fdir.x = handDir.x * Exact.cos(fan) + across.x * Exact.sin(fan) + palm.x * lift;
      fdir.y = handDir.y * Exact.cos(fan) + across.y * Exact.sin(fan) + palm.y * lift;
      fdir.z = handDir.z * Exact.cos(fan) + across.z * Exact.sin(fan) + palm.z * lift;
    } else {
      fan = shape.fan + spread * (shape.fan / FINGER_SHAPE.index.fan) * 0.5;
      fdir.x = handDir.x * Exact.cos(fan) + across.x * Exact.sin(fan);
      fdir.y = handDir.y * Exact.cos(fan) + across.y * Exact.sin(fan);
      fdir.z = handDir.z * Exact.cos(fan) + across.z * Exact.sin(fan);
    }
    let l = Exact.hypot(fdir.x, fdir.y, fdir.z) || 1;
    fdir.x /= l;
    fdir.y /= l;
    fdir.z /= l;
    // Which way it curls: toward the palm, or for the thumb, across it.
    if (finger === "thumb") {
      fpalm.x = palm.x - across.x;
      fpalm.y = palm.y - across.y;
      fpalm.z = palm.z - across.z;
    } else {
      fpalm.x = palm.x;
      fpalm.y = palm.y;
      fpalm.z = palm.z;
    }
    const along = fpalm.x * fdir.x + fpalm.y * fdir.y + fpalm.z * fdir.z;
    fpalm.x -= along * fdir.x;
    fpalm.y -= along * fdir.y;
    fpalm.z -= along * fdir.z;
    l = Exact.hypot(fpalm.x, fpalm.y, fpalm.z) || 1;
    fpalm.x /= l;
    fpalm.y /= l;
    fpalm.z /= l;
    // The axis it bends about.
    fside.x = fdir.y * fpalm.z - fdir.z * fpalm.y;
    fside.y = fdir.z * fpalm.x - fdir.x * fpalm.z;
    fside.z = fdir.x * fpalm.y - fdir.y * fpalm.x;
    put(joints[0], joint);
    for (let b = 0; b < 3; b++) {
      rotateAbout(fdir, fside, curl);
      const bone = shape.bones[b] * length;
      joint.x += fdir.x * bone;
      joint.y += fdir.y * bone;
      joint.z += fdir.z * bone;
      put(joints[b + 1], joint);
    }
  }
}

const LIMB_JOINTS = {
  handNear: [Joint.shoulderNear, Joint.elbowNear, Joint.wristNear, Joint.handNear],
  handFar: [Joint.shoulderFar, Joint.elbowFar, Joint.wristFar, Joint.handFar],
  footNear: [Joint.hipNear, Joint.kneeNear, Joint.ankleNear, Joint.toeNear],
  footFar: [Joint.hipFar, Joint.kneeFar, Joint.ankleFar, Joint.toeFar],
} as const satisfies Record<LimbName, readonly JointIndex[]>;

const BALL_JOINT: Record<FootName, JointIndex> = {
  footNear: Joint.ballNear,
  footFar: Joint.ballFar,
};

/**
 * Solves a pose into joint positions (x, y, z per joint): body space is
 * solved in 3D, pitched, turned by yaw, then x is mirrored by `facing` and
 * placed at the root.
 */
export function solvePose(
  pose: Pose,
  props: Proportions,
  out: Float32Array,
  at: Placement = ORIGIN,
): Float32Array {
  const put = (joint: JointIndex, v: Vec3): void => {
    toWorld(pose, v, at, world);
    const i = joint * JOINT_STRIDE;
    out[i] = world.x;
    out[i + 1] = world.y;
    out[i + 2] = world.z;
  };

  layOutSpine(pose, props);
  put(Joint.pelvis, pelvis);
  put(Joint.belly, belly);
  put(Joint.waist, waist);
  put(Joint.ribs, ribs);
  put(Joint.chest, chest);
  put(Joint.neck, neck);
  put(Joint.head, head);

  for (const limb of LIMBS) {
    const arm = isArm(limb);
    const [rootJ, midJ, endJ, tipJ] = LIMB_JOINTS[limb];
    limbRoot(limb, props, root);
    limbTarget(pose, limb, props, target);
    bendPole(root, arm ? -1 : 1, pose.swivel?.[limb] ?? 0, arm ? armHinge : LEG_HINGE);
    solveTwoBone3(
      root,
      target,
      arm ? props.upperArm : props.thigh,
      arm ? props.forearm : props.shin,
      pole,
      mid,
      end,
    );
    endSegment(
      arm,
      pose.flex?.[limb] ?? 0,
      arm ? props.hand : props.foot,
      arm ? -sideOf(limb) * (pose.twist?.[limb as HandName] ?? 0) : 0,
      arm ? 0 : (pose.toes?.[limb as FootName] ?? 0),
    );
    put(rootJ, root);
    put(midJ, mid);
    put(endJ, end);
    put(tipJ, tip);
    if (arm) layOutFingers(pose, limb as HandName, props.hand, put);
    else put(BALL_JOINT[limb as FootName], ball);
  }
  return out;
}
