import { LIMBS, REST_POSE, type Pose, type Target } from "./pose.ts";
import { DEFAULT_PROPORTIONS, JOINT_NAMES, type JointName, type Proportions } from "./skeleton.ts";
import {
  CHANNELS,
  EASINGS,
  fromCarryOver,
  mergePose,
  setCurve,
  setsChannel,
  type Channel,
  GROUPS,
  type ActiveRange,
  type Easing,
  type Group,
  type Key,
  type Move,
} from "./timeline.ts";

/**
 * The file format: JSON with a `format` tag and a `version`. A whole project
 * and a single exported move are the same shape (a move file has one move).
 *
 * Versions:
 * 1. The 12-joint rig: limbs grow from one point on the spine, which is
 *    straight, and there are no hands or feet past the wrists and ankles.
 * 2. Shoulders and hips with a width, a spine in two parts (`bend`), and
 *    hands and feet (`flex`).
 * 3. A spine of four bones, fingers (`curl`, `spread`), hands that turn
 *    (`twist`) and feet that break at the ball (`toes`). The rest pose turns the palms in, so a move's first key
 *    keeps the old palms (twist 0) unless it sets its own.
 * 4. A channel a key leaves out passes through it, from the key before
 *    that sets it to the next, rather than holding from the key before:
 *    each channel keyed on its own, so a part can run on its own timing.
 * 5. Keys can put a channel on a curve of its own (`curves`, the graph
 *    editor's). Nothing changes shape, but an older reader would play
 *    such a move wrong, so it refuses it as newer instead.
 * 6. The pelvis can move sideways (`pelvis.z`), so a move can spin and
 *    drift at once. Refused by older readers for the same reason.
 * 7. The hip line can tilt (`hipTilt`), as a high kick lifts one hip.
 *    Refused by older readers for the same reason.
 * 8. The chest can turn against the hips (`spineTwist`) and the upper
 *    spine side-bend on its own (`upperRoll`). The same again.
 * 9. Collarbones: each shoulder shrugs and reaches (`shrug`, `reach`).
 *    The same again.
 * 10. The whole body can turn about the way it faces (`bank`), as a
 *    cartwheel does. The same again.
 */
export const FORMAT = "rig-editor";
export const VERSION = 10;

export interface Project {
  format: typeof FORMAT;
  version: typeof VERSION;
  name: string;
  /** Frames per second the moves play at. */
  fps: number;
  proportions: Proportions;
  moves: Move[];
  /**
   * The editor's rest pose for this project: what new moves start from and
   * Reset pose returns to. Left out, it's the built-in one. Only the editor
   * reads it (a move's unset channels are still `REST_POSE`'s), so it went
   * in without a version bump.
   */
  rest?: Pose;
}

export class FormatError extends Error {}

export const newProject = (name = "Untitled rig", moves: Move[] = []): Project => ({
  format: FORMAT,
  version: VERSION,
  name,
  fps: 60,
  proportions: { ...DEFAULT_PROPORTIONS },
  moves,
});

/** A file holding one move, with the project's rig. */
export const moveFile = (project: Project, move: Move): Project => ({
  ...newProject(move.name, [move]),
  fps: project.fps,
  proportions: { ...project.proportions },
});

export const serialize = (project: Project): string => JSON.stringify(project, null, 2);

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const int = (v: unknown, fallback: number, min = 0): number =>
  Math.max(min, Math.round(num(v, fallback)));

/** Each version's file, turned into the next version's. */
const MIGRATIONS: Record<number, (file: Raw) => Raw> = {
  1(file) {
    // Limbs grew from the chest and pelvis, their rest positions spread out
    // to each side: the shoulders and hips now sit there instead, so poses
    // keep their numbers.
    const p = isObject(file.proportions) ? file.proportions : {};
    const d = DEFAULT_PROPORTIONS;
    const spine = num(p.spine, d.spineLower + d.spineUpper);
    const proportions: Proportions = {
      spineLower: spine / 2,
      spineUpper: spine / 2,
      neck: num(p.neck, d.neck),
      headRadius: num(p.headRadius, d.headRadius),
      shoulderWidth: num(p.armSpread, d.shoulderWidth / 2) * 2,
      hipWidth: num(p.legSpread, d.hipWidth / 2) * 2,
      upperArm: num(p.upperArm, d.upperArm),
      forearm: num(p.forearm, d.forearm),
      hand: d.hand,
      thigh: num(p.thigh, d.thigh),
      shin: num(p.shin, d.shin),
      foot: d.foot,
      limbWidth: num(p.limbWidth, d.limbWidth),
    };
    return { ...file, version: 2, proportions };
  },
  2(file) {
    const moves = (Array.isArray(file.moves) ? file.moves : []).map((move) => {
      if (!isObject(move) || !Array.isArray(move.keys) || !isObject(move.keys[0])) return move;
      const [first, ...rest] = move.keys as Raw[];
      const pose = isObject(first.pose) ? first.pose : {};
      const twist = { handNear: 0, handFar: 0, ...(isObject(pose.twist) ? pose.twist : {}) };
      return { ...move, keys: [{ ...first, pose: { ...pose, twist } }, ...rest] };
    });
    return { ...file, version: 3, moves };
  },
  3(file) {
    // A channel a key left out held from the key before; now it passes
    // through to the next key that sets it. Keys set what they showed.
    const moves = (Array.isArray(file.moves) ? file.moves : []).map((move) =>
      isObject(move) ? (fromCarryOver(readMove(move)) as unknown as Raw) : move,
    );
    return { ...file, version: 4, moves };
  },
  4(file) {
    // Curves are new; nothing to change.
    return { ...file, version: 5 };
  },
  5(file) {
    // The pelvis's z is new: 0 where it's left out.
    return { ...file, version: 6 };
  },
  6(file) {
    // The hip tilt is new: level where it's left out.
    return { ...file, version: 7 };
  },
  7(file) {
    // The spine's twist and upper side-bend are new: none where left out.
    return { ...file, version: 8 };
  },
  8(file) {
    // The collarbones are new: at rest where left out.
    return { ...file, version: 9 };
  },
  9(file) {
    // The whole-body bank is new: none where left out.
    return { ...file, version: 10 };
  },
};

/** Reads a project or move file of any version, migrating it to the current one. */
export function parseProject(data: unknown): Project {
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      throw new FormatError("This isn't a JSON file.");
    }
  }
  if (!isObject(data) || data.format !== FORMAT) {
    throw new FormatError("This isn't a rig editor file.");
  }
  let file = data;
  let version = num(file.version, 0);
  if (version > VERSION) {
    throw new FormatError(`This file is from a newer editor (version ${version}).`);
  }
  while (version < VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) throw new FormatError(`Unknown file version ${version}.`);
    file = migrate(file);
    version = num(file.version, 0);
  }
  const base = newProject();
  return {
    ...base,
    name: typeof file.name === "string" && file.name ? file.name : base.name,
    fps: int(file.fps, base.fps, 1),
    proportions: readProportions(file.proportions),
    moves: Array.isArray(file.moves) ? file.moves.filter(isObject).map(readMove) : [],
    ...(isObject(file.rest) ? { rest: mergePose(REST_POSE, readPose(file.rest)) } : {}),
  };
}

/** The most a move's Simplify may be (m); the editor's slider goes this far. */
const MAX_SIMPLIFY = 0.1;

/** Legs (thigh + shin, m) a rig may have; past these it was measured in other units. */
const LEGS = { min: 0.1, max: 4 };

/**
 * The file's bone lengths. A rig far outside a person's size (bones taken
 * from a model in centimetres, say) is scaled whole to the default legs,
 * keeping its build.
 */
function readProportions(raw: unknown): Proportions {
  const p = isObject(raw) ? raw : {};
  const out = { ...DEFAULT_PROPORTIONS };
  const keys = Object.keys(out) as (keyof Proportions)[];
  for (const k of keys) out[k] = Math.max(0, num(p[k], out[k]));
  const legs = out.thigh + out.shin;
  if (legs < LEGS.min || legs > LEGS.max) {
    const k = (DEFAULT_PROPORTIONS.thigh + DEFAULT_PROPORTIONS.shin) / (legs || 1);
    for (const key of keys) out[key] = legs ? out[key] * k : DEFAULT_PROPORTIONS[key];
  }
  return out;
}

function readMove(raw: Raw): Move {
  const keys = (Array.isArray(raw.keys) ? raw.keys : [])
    .filter(isObject)
    .map(readKey)
    .sort((a, b) => a.frame - b.frame)
    // One key per frame.
    .filter((k, i, all) => i === 0 || all[i - 1].frame !== k.frame);
  if (!keys.length) keys.push({ frame: 0, pose: {} });
  const length = Math.max(int(raw.length, 30, 1), keys.at(-1)!.frame + 1);
  const move: Move = {
    name: typeof raw.name === "string" && raw.name ? raw.name : "Move",
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === "string") : [],
    length,
    loop: raw.loop === true,
    keys,
  };
  const active = readActive(raw.active, length);
  if (active) move.active = active;
  if (typeof raw.simplify === "number" && raw.simplify >= 0) {
    move.simplify = Math.min(raw.simplify, MAX_SIMPLIFY);
  }
  return move;
}

function readKey(raw: Raw): Key {
  const key: Key = { frame: int(raw.frame, 0), pose: readPose(raw.pose) };
  if (EASINGS.includes(raw.ease as Easing)) key.ease = raw.ease as Easing;
  if (isObject(raw.curves)) {
    for (const [ch, c] of Object.entries(raw.curves)) {
      // Only a channel the key sets has a curve into it; time runs forward.
      if (!CHANNELS.includes(ch as Channel) || !setsChannel(key.pose, ch as Channel)) continue;
      if (!Array.isArray(c) || c.length !== 4 || !c.every((v) => Number.isFinite(v))) continue;
      const [x1, y1, x2, y2] = c as number[];
      setCurve(key, ch as Channel, [clamp01(x1), y1, clamp01(x2), y2]);
    }
  }
  return key;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function readActive(raw: unknown, length: number): ActiveRange | undefined {
  if (!isObject(raw)) return undefined;
  const from = Math.min(int(raw.from, 0), length - 1);
  return {
    from,
    to: Math.min(Math.max(int(raw.to, from), from), length - 1),
    joint: JOINT_NAMES.includes(raw.joint as JointName) ? (raw.joint as JointName) : "handNear",
    radius: Math.max(0, num(raw.radius, 0.08)),
  };
}

const NUMBERS = [
  "lean",
  "headTilt",
  "bend",
  "yaw",
  "pitch",
  "bank",
  "roll",
  "upperRoll",
  "spineTwist",
  "hipTilt",
] as const;

/** The parts of a (partial) pose that are well formed. */
function readPose(raw: unknown): Partial<Pose> {
  if (!isObject(raw)) return {};
  const pose: Partial<Pose> = {};
  for (const k of NUMBERS) if (typeof raw[k] === "number") pose[k] = num(raw[k], 0);
  if (isObject(raw.pelvis)) {
    pose.pelvis = { x: num(raw.pelvis.x, 0), y: num(raw.pelvis.y, 0) };
    const z = num(raw.pelvis.z, 0);
    if (z) pose.pelvis.z = z;
  }
  for (const limb of LIMBS) {
    const t = raw[limb];
    if (!isObject(t)) continue;
    const target: Target = { x: num(t.x, 0), y: num(t.y, 0) };
    if (typeof t.z === "number") target.z = num(t.z, 0);
    pose[limb] = target;
  }
  for (const group of Object.keys(GROUPS) as Group[]) {
    const r = raw[group];
    if (!isObject(r)) continue;
    const out: Record<string, number> = {};
    for (const part of GROUPS[group]) if (typeof r[part] === "number") out[part] = num(r[part], 0);
    if (Object.keys(out).length) (pose as Record<string, unknown>)[group] = out;
  }
  return pose;
}
