import { smoothstep } from "./math.ts";
import {
  FEET,
  FINGER_NAMES,
  HANDS,
  LIMBS,
  lerpPose,
  lerpPoseLead,
  REST_POSE,
  type FingerName,
  type FootName,
  type HandName,
  type LimbName,
  type Pose,
} from "./pose.ts";
import type { JointName } from "./skeleton.ts";

/**
 * How a key is reached from the key before it. `lead` is the game's blend:
 * the body leads and the limbs follow. `hold` keeps the previous pose and
 * snaps on the key's frame.
 */
export type Easing = "smooth" | "linear" | "in" | "out" | "lead" | "hold";

export const EASINGS: readonly Easing[] = ["smooth", "linear", "in", "out", "lead", "hold"];

export interface Key {
  /** Frame from the start of the move, 0 up to the move's length − 1. */
  frame: number;
  /**
   * What this key changes. Anything it leaves out carries over from the key
   * before it; the first key carries over from the rest pose.
   */
  pose: Partial<Pose>;
  /** How this key is reached from the one before; `smooth` if left out. */
  ease?: Easing;
}

/** The frames a move can hit on (both ends included), and with what. */
export interface ActiveRange {
  from: number;
  to: number;
  joint: JointName;
  /** Metres around the joint. */
  radius: number;
}

export interface Move {
  name: string;
  tags: string[];
  /** Frames in the move. */
  length: number;
  /** Loops back to the first key after the last frame, instead of holding the last key. */
  loop: boolean;
  /** Sorted by frame; at least one. */
  keys: Key[];
  active?: ActiveRange;
  /**
   * How far (m) the editor may let a joint stray when it exports the move
   * for a game with fewer keys and digits (its Simplify). The keys here are
   * kept as authored; games can ignore it. Left out or 0, it's off.
   */
  simplify?: number;
}

/** The parts of a pose that hold an angle per limb, hand or finger, and what they hold one for. */
export const GROUPS = {
  swivel: LIMBS,
  flex: LIMBS,
  twist: HANDS,
  curl: FINGER_NAMES,
  spread: HANDS,
  toes: FEET,
} as const satisfies Record<string, readonly string[]>;

export type Group = keyof typeof GROUPS;
const GROUP_NAMES = Object.keys(GROUPS) as Group[];
const isGroup = (k: string): k is Group => k in GROUPS;

type NumberRecord = Partial<Record<string, number>>;

/** `base` with what `over` sets. The groups (swivel, curl…) merge part by part. */
export function mergePose(base: Pose, over: Partial<Pose>): Pose {
  const out: Pose = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    (out as unknown as Record<string, unknown>)[k] = isGroup(k)
      ? { ...base[k], ...defined(v as NumberRecord) }
      : v;
  }
  return out;
}

const defined = (r: NumberRecord): NumberRecord =>
  Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined));

// --- channels -------------------------------------------------------------

/** A channel holding one angle of a group: a limb's swivel, a finger's curl… */
export type GroupChannel =
  | `swivel.${LimbName}`
  | `flex.${LimbName}`
  | `twist.${HandName}`
  | `curl.${FingerName}`
  | `spread.${HandName}`
  | `toes.${FootName}`;

/** One thing a key can set: a body value, a limb's target, or one angle of a group. */
export type Channel =
  | "pelvis"
  | "lean"
  | "bend"
  | "headTilt"
  | "yaw"
  | "pitch"
  | "roll"
  | LimbName
  | GroupChannel;

/** A channel that holds a single number. */
export type ScalarChannel = Exclude<Channel, "pelvis" | LimbName>;

export const CHANNELS: readonly Channel[] = [
  "pelvis",
  "lean",
  "bend",
  "headTilt",
  "yaw",
  "pitch",
  "roll",
  ...LIMBS,
  ...GROUP_NAMES.flatMap((g) => GROUPS[g].map((k) => `${g}.${k}` as GroupChannel)),
];

/** A group channel's group and part ("curl.indexNear" → curl, indexNear); null for the others. */
export function splitChannel(ch: Channel): [Group, string] | null {
  const dot = ch.indexOf(".");
  return dot < 0 ? null : [ch.slice(0, dot) as Group, ch.slice(dot + 1)];
}

const groupValue = (pose: Partial<Pose>, g: Group, k: string): number | undefined =>
  (pose[g] as NumberRecord | undefined)?.[k];

/** A single-number channel's value (0 where unset). */
export function scalarOf(pose: Partial<Pose>, ch: ScalarChannel): number {
  const split = splitChannel(ch);
  if (split) return groupValue(pose, ...split) ?? 0;
  return (pose[ch as keyof Pose] as number | undefined) ?? 0;
}

/** `pose` with one single-number channel set. */
export function withScalar<P extends Partial<Pose>>(pose: P, ch: ScalarChannel, v: number): P {
  const split = splitChannel(ch);
  if (split) {
    const [g, k] = split;
    return { ...pose, [g]: { ...pose[g], [k]: v } };
  }
  return { ...pose, [ch]: v };
}

/** Whether a key sets a channel itself (rather than carrying it over). */
export function setsChannel(over: Partial<Pose>, ch: Channel): boolean {
  const split = splitChannel(ch);
  if (split) return groupValue(over, ...split) !== undefined;
  return over[ch as keyof Pose] !== undefined;
}

/** Stops a key setting a channel, so it carries over from the key before. */
export function clearChannel(over: Partial<Pose>, ch: Channel): void {
  const split = splitChannel(ch);
  if (!split) {
    delete over[ch as keyof Pose];
    return;
  }
  const [group, part] = split;
  const record = over[group] as NumberRecord | undefined;
  if (!record) return;
  delete record[part];
  if (!Object.keys(record).length) delete over[group];
}

/** Copies one channel of `from` into `over`. */
function copyChannel(over: Partial<Pose>, from: Pose, ch: Channel): void {
  const split = splitChannel(ch);
  if (split) {
    const [group, part] = split;
    over[group] = { ...over[group], [part]: groupValue(from, group, part) ?? 0 };
  } else {
    const v = from[ch as keyof Pose];
    (over as Record<string, unknown>)[ch] = v && typeof v === "object" ? { ...v } : v;
  }
}

function sameChannel(a: Pose, b: Pose, ch: Channel): boolean {
  const split = splitChannel(ch);
  if (split) return near(groupValue(a, ...split) ?? 0, groupValue(b, ...split) ?? 0);
  const x = a[ch as keyof Pose];
  const y = b[ch as keyof Pose];
  if (typeof x === "object" || typeof y === "object") {
    const p = (x ?? {}) as { x: number; y: number; z?: number };
    const q = (y ?? {}) as { x: number; y: number; z?: number };
    return near(p.x, q.x) && near(p.y, q.y) && near(p.z ?? 0, q.z ?? 0);
  }
  return near((x as number | undefined) ?? 0, (y as number | undefined) ?? 0);
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

/** The channels where `pose` differs from `prev`: a key that turns `prev` into `pose`. */
export function diffPose(prev: Pose, pose: Pose): Partial<Pose> {
  const over: Partial<Pose> = {};
  for (const ch of CHANNELS) if (!sameChannel(prev, pose, ch)) copyChannel(over, pose, ch);
  return over;
}

/** Every channel of `pose`, as a key that sets them all. */
export function fullKey(pose: Pose): Partial<Pose> {
  const over: Partial<Pose> = {};
  for (const ch of CHANNELS) {
    const split = splitChannel(ch);
    if (split && groupValue(pose, ...split) === undefined) continue;
    copyChannel(over, pose, ch);
  }
  return over;
}

// --- sampling -------------------------------------------------------------

/** Each key as a whole pose, after carrying over what it leaves out. */
export function resolveKeys(move: Move, rest: Pose = REST_POSE): Pose[] {
  const out: Pose[] = [];
  let pose = rest;
  for (const key of move.keys) {
    pose = mergePose(pose, key.pose);
    out.push(pose);
  }
  return out;
}

function ease(kind: Easing, t: number): number {
  switch (kind) {
    case "linear":
      return t;
    case "in":
      return t * t;
    case "out":
      return 1 - (1 - t) * (1 - t);
    case "hold":
      return t >= 1 ? 1 : 0;
    default:
      return smoothstep(t);
  }
}

/** The pose at `frame` (fractions blend too). Looping moves wrap; others hold their ends. */
export function sampleMove(move: Move, frame: number, resolved = resolveKeys(move)): Pose {
  const { keys } = move;
  const n = keys.length;
  if (n === 1) return resolved[0];
  const f = move.loop ? ((frame % move.length) + move.length) % move.length : frame;
  let i = -1;
  while (i + 1 < n && keys[i + 1].frame <= f) i++;
  let a = i;
  let b = i + 1;
  let aFrame: number;
  let bFrame: number;
  if (i === -1) {
    if (!move.loop) return resolved[0];
    a = n - 1;
    b = 0;
    aFrame = keys[a].frame - move.length;
    bFrame = keys[0].frame;
  } else if (i === n - 1) {
    if (!move.loop) return resolved[n - 1];
    b = 0;
    aFrame = keys[a].frame;
    bFrame = keys[0].frame + move.length;
  } else {
    aFrame = keys[a].frame;
    bFrame = keys[b].frame;
  }
  const t = bFrame > aFrame ? (f - aFrame) / (bFrame - aFrame) : 1;
  const kind = keys[b].ease ?? "smooth";
  if (kind === "lead") return lerpPoseLead(resolved[a], resolved[b], t);
  return lerpPose(resolved[a], resolved[b], ease(kind, t));
}

/** Whether the move can hit on `frame`. */
export const isActive = (move: Move, frame: number): boolean =>
  !!move.active && frame >= move.active.from && frame <= move.active.to;

// --- editing --------------------------------------------------------------

/** The index of the key on `frame`, or -1. */
export const keyAt = (move: Move, frame: number): number =>
  move.keys.findIndex((k) => k.frame === frame);

/**
 * Adds a key on `frame` holding the pose the move has there, so nothing
 * changes until it's edited. Returns its index (an existing key's, if any).
 */
export function addKey(move: Move, frame: number, rest: Pose = REST_POSE): number {
  const existing = keyAt(move, frame);
  if (existing >= 0) return existing;
  const resolved = resolveKeys(move, rest);
  const pose = sampleMove(move, frame, resolved);
  const index = move.keys.findIndex((k) => k.frame > frame);
  const at = index < 0 ? move.keys.length : index;
  const prev = at > 0 ? resolved[at - 1] : rest;
  const ease = move.keys[at]?.ease;
  move.keys.splice(at, 0, {
    frame,
    pose: at === 0 ? fullKey(pose) : diffPose(prev, pose),
    ...(ease ? { ease } : {}),
  });
  return at;
}

/**
 * Removes a key; what it changed goes with it. The last key can't go. The
 * first key's whole pose passes to the next one, which becomes the first.
 */
export function removeKey(move: Move, index: number, rest: Pose = REST_POSE): boolean {
  if (move.keys.length <= 1) return false;
  if (index === 0) {
    const resolved = resolveKeys(move, rest);
    move.keys[1].pose = fullKey(resolved[1]);
  }
  move.keys.splice(index, 1);
  return true;
}

/**
 * Moves a key to another frame. Every key keeps the pose it shows, even
 * when keys swap order. Fails on a frame another key is on.
 */
export function moveKey(move: Move, index: number, frame: number, rest: Pose = REST_POSE): boolean {
  const f = Math.max(0, Math.min(move.length - 1, Math.round(frame)));
  const other = keyAt(move, f);
  if (other >= 0) return other === index;
  const resolved = resolveKeys(move, rest);
  const entries = move.keys.map((key, i) => ({ key, pose: resolved[i] }));
  entries[index].key.frame = f;
  entries.sort((a, b) => a.key.frame - b.key.frame);
  if (entries.every((e, i) => e.key === move.keys[i])) return true;
  move.keys = entries.map((e, i) => ({
    ...e.key,
    pose: i === 0 ? fullKey(e.pose) : diffPose(entries[i - 1].pose, e.pose),
  }));
  return true;
}

/** A key to put on a move: the whole pose it shows. */
export interface PutKey {
  frame: number;
  pose: Pose;
  ease?: Easing;
}

/**
 * Puts keys on frames, each showing its pose; a key already on one of
 * those frames gives way, and so do the keys at `remove` (indices). Every
 * other key keeps the pose it shows. Frames out of the move are left out.
 */
export function putKeys(
  move: Move,
  put: readonly PutKey[],
  remove: readonly number[] = [],
  rest: Pose = REST_POSE,
): void {
  const resolved = resolveKeys(move, rest);
  const gone = new Set(remove);
  const placed = put.filter(
    (p) => Number.isInteger(p.frame) && p.frame >= 0 && p.frame < move.length,
  );
  const taken = new Set(placed.map((p) => p.frame));
  const entries = [
    ...move.keys
      .map((key, i) => ({ key, pose: resolved[i], was: i }))
      .filter((e) => !gone.has(e.was) && !taken.has(e.key.frame)),
    ...placed.map((p) => ({
      key: { frame: p.frame, pose: {}, ...(p.ease ? { ease: p.ease } : {}) } as Key,
      pose: p.pose,
      was: -1,
    })),
  ].sort((a, b) => a.key.frame - b.key.frame);
  if (!entries.length) return;
  move.keys = entries.map((e, i) => {
    // A key after the same one as before still shows its pose as it is.
    const prev = entries[i - 1];
    if (e.was >= 0 && (i ? prev.was === e.was - 1 : e.was === 0)) return e.key;
    return { ...e.key, pose: i ? diffPose(prev.pose, e.pose) : fullKey(e.pose) };
  });
}

/** The shortest a move can be: up to its last key. */
export const minLength = (move: Move): number => (move.keys.at(-1)?.frame ?? 0) + 1;

/** A new move: one key at frame 0 holding `pose`. */
export function newMove(name: string, pose: Pose = REST_POSE, length = 30): Move {
  return { name, tags: [], length, loop: false, keys: [{ frame: 0, pose: fullKey(pose) }] };
}
