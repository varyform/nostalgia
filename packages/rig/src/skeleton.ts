/**
 * Bone lengths in metres. Ratios follow the NX Play stair-climber figure
 * (thigh 6.5, shin 6.5, torso 8.5, neck 1.4, head r 3.3, arm 5.0 + 4.6,
 * stroke 2.2), scaled to a 1.8 m figure.
 */
export interface Proportions {
  /** Pelvis to waist, and waist to chest: the spine in two halves, each of two bones. */
  spineLower: number;
  spineUpper: number;
  neck: number;
  headRadius: number;
  /** Shoulder to shoulder, through the chest. */
  shoulderWidth: number;
  /** Hip to hip, through the pelvis. */
  hipWidth: number;
  upperArm: number;
  forearm: number;
  /** Wrist to the middle knuckle; the fingers scale with it (`FINGER_SHAPE`). */
  hand: number;
  thigh: number;
  shin: number;
  /** Ankle to the tip of the toes (`BALL` of it to the ball of the foot). */
  foot: number;
  /** Thickness of the limbs when drawn. */
  limbWidth: number;
}

const UNIT = 1.8 / 29.6;

export const DEFAULT_PROPORTIONS: Proportions = {
  spineLower: 4.25 * UNIT,
  spineUpper: 4.25 * UNIT,
  neck: 1.4 * UNIT,
  headRadius: 3.3 * UNIT,
  shoulderWidth: 4.8 * UNIT,
  hipWidth: 4 * UNIT,
  upperArm: 5.0 * UNIT,
  forearm: 4.6 * UNIT,
  hand: 1.6 * UNIT,
  thigh: 6.5 * UNIT,
  shin: 6.5 * UNIT,
  foot: 2.4 * UNIT,
  limbWidth: 2.2 * UNIT,
};

/** The fingers, thumb first. */
export const FINGERS = ["thumb", "index", "middle", "ring", "pinky"] as const;
export type Finger = (typeof FINGERS)[number];
export type Side = "Near" | "Far";
export const SIDES: readonly Side[] = ["Near", "Far"];

/**
 * A finger's joints, 1 at its base up to 4 at its tip (as Mixamo numbers
 * them). The thumb's 1 sits by the wrist; the others' 1 is the knuckle. The
 * middle finger's knuckle is the hand joint itself, so it has 2 to 4 only.
 */
export type FingerJointName =
  | `${Exclude<Finger, "middle">}${1 | 2 | 3 | 4}${Side}`
  | `middle${2 | 3 | 4}${Side}`;

const BODY_JOINTS = {
  pelvis: 0,
  /** Between the two parts of the spine. */
  waist: 1,
  /** Top of the spine, between the shoulders. */
  chest: 2,
  neck: 3,
  /** Centre of the head. */
  head: 4,
  shoulderNear: 5,
  elbowNear: 6,
  wristNear: 7,
  /** The hand's middle knuckle (the middle finger's base). */
  handNear: 8,
  shoulderFar: 9,
  elbowFar: 10,
  wristFar: 11,
  handFar: 12,
  hipNear: 13,
  kneeNear: 14,
  ankleNear: 15,
  /** Tip of the toes. */
  toeNear: 16,
  hipFar: 17,
  kneeFar: 18,
  ankleFar: 19,
  toeFar: 20,
  /** Halfway up the lower spine (pelvis → waist). */
  belly: 21,
  /** Halfway up the upper spine (waist → chest). */
  ribs: 22,
  /** The ball of the foot, where the toes bend. */
  ballNear: 23,
  ballFar: 24,
} as const;

/** How far along the foot (ankle → toe tip) the ball is. */
export const BALL = 0.7;

export type JointName = keyof typeof BODY_JOINTS | FingerJointName;
export type JointIndex = number;

/** A finger's joints, base to tip (the middle finger starts at the hand joint). */
export function fingerJoints(finger: Finger, side: Side): readonly JointIndex[] {
  const n = (k: number) => Joint[`${finger}${k}${side}` as JointName];
  return finger === "middle" ? [Joint[`hand${side}`], n(2), n(3), n(4)] : [n(1), n(2), n(3), n(4)];
}

/**
 * Joint indices into the flat `Float32Array` joint buffer (x, y, z per joint):
 * x is the way the figure faces, y is up and z is toward the "near" side (the
 * camera, when the figure stands side-on). The body comes first (0–22), then
 * each hand's fingers, near hand first.
 */
export const Joint: Readonly<Record<JointName, JointIndex>> = (() => {
  const out: Record<string, number> = { ...BODY_JOINTS };
  let next = Object.keys(BODY_JOINTS).length;
  for (const side of SIDES) {
    for (const finger of FINGERS) {
      for (let k = finger === "middle" ? 2 : 1; k <= 4; k++) out[`${finger}${k}${side}`] = next++;
    }
  }
  return out as Record<JointName, JointIndex>;
})();

export const JOINT_NAMES = Object.keys(Joint) as JointName[];
export const JOINT_COUNT = JOINT_NAMES.length;
export const JOINT_STRIDE = 3;

/** Whether a joint is part of a finger. */
export const isFingerJoint = (j: JointIndex): boolean => j >= Object.keys(BODY_JOINTS).length;

/** Every bone as the pair of joints it joins. The head is a ball around `head`. */
export const BONES: readonly (readonly [JointIndex, JointIndex])[] = [
  [Joint.pelvis, Joint.belly],
  [Joint.belly, Joint.waist],
  [Joint.waist, Joint.ribs],
  [Joint.ribs, Joint.chest],
  [Joint.chest, Joint.neck],
  ...SIDES.flatMap((s) => {
    const j = (name: string) => Joint[`${name}${s}` as JointName];
    const fingers = FINGERS.flatMap((f) => {
      const [a, b, c, d] = fingerJoints(f, s);
      return [
        [a, b],
        [b, c],
        [c, d],
      ] as const;
    });
    return [
      [Joint.chest, j("shoulder")],
      [j("shoulder"), j("elbow")],
      [j("elbow"), j("wrist")],
      [j("wrist"), j("hand")],
      ...fingers,
      [Joint.pelvis, j("hip")],
      [j("hip"), j("knee")],
      [j("knee"), j("ankle")],
      [j("ankle"), j("ball")],
      [j("ball"), j("toe")],
    ] as const;
  }),
];

/**
 * Where each finger sits on the hand and how long its bones are, as
 * fractions of the hand's length (wrist to middle knuckle). `base` is the
 * finger's first joint: `along` the hand from the wrist and `across` toward
 * the thumb's side; `bones` are its three bones, base to tip. `fan` is how far
 * it angles away from the middle finger at rest (radians, toward the thumb).
 */
export const FINGER_SHAPE: Readonly<
  Record<
    Finger,
    { along: number; across: number; bones: readonly [number, number, number]; fan: number }
  >
> = {
  thumb: { along: 0.18, across: 0.24, bones: [0.42, 0.33, 0.28], fan: 0.62 },
  index: { along: 0.97, across: 0.24, bones: [0.42, 0.25, 0.2], fan: 0.07 },
  middle: { along: 1, across: 0, bones: [0.46, 0.29, 0.21], fan: 0 },
  ring: { along: 0.95, across: -0.22, bones: [0.43, 0.27, 0.2], fan: -0.07 },
  pinky: { along: 0.86, across: -0.42, bones: [0.33, 0.2, 0.19], fan: -0.16 },
};

export const createJointBuffer = (): Float32Array => new Float32Array(JOINT_COUNT * JOINT_STRIDE);

export const jointX = (buf: Float32Array, j: JointIndex): number => buf[j * JOINT_STRIDE];
export const jointY = (buf: Float32Array, j: JointIndex): number => buf[j * JOINT_STRIDE + 1];
export const jointZ = (buf: Float32Array, j: JointIndex): number => buf[j * JOINT_STRIDE + 2];
