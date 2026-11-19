import { cubicBezier, lerp, smoothstep } from "./math.ts";
import {
  CORE,
  FEET,
  FINGER_NAMES,
  HANDS,
  leadTime,
  LIMBS,
  lerpPose,
  lerpPelvis,
  lerpPoseLead,
  lerpTarget,
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

/**
 * How one channel reaches a key from the key before that sets it, as CSS's
 * cubic-bezier: (x1, y1, x2, y2), the handles of a curve from the old value
 * (0, 0) to the new (1, 1), time across. x1 and x2 are within 0..1; y may
 * overshoot. It's the graph editor's handles, and wins over the key's ease.
 */
export type Curve = readonly [number, number, number, number];

/** The eases that are cubic beziers (exactly: smoothstep is one), as curves to start from. */
export const EASE_CURVES: Readonly<Partial<Record<Easing, Curve>>> = {
  smooth: [1 / 3, 0, 2 / 3, 1],
  linear: [1 / 3, 1 / 3, 2 / 3, 2 / 3],
  in: [1 / 3, 0, 2 / 3, 1 / 3],
  out: [1 / 3, 2 / 3, 2 / 3, 1],
};

/** `t` along a curve. */
export const alongCurve = (c: Curve, t: number): number => cubicBezier(c[0], c[1], c[2], c[3], t);

export interface Key {
  /** Frame from the start of the move, 0 up to the move's length − 1. */
  frame: number;
  /**
   * The channels keyed here. A channel it leaves out passes through: it
   * blends from the key before that sets it to the next one that does (as
   * a curve passes a frame with no keyframe of its own), and holds before
   * its first key and after its last. A channel no key sets is the rest
   * pose's. (Before version 4, a left-out channel held from the key before:
   * `fromCarryOver` turns such keys into these.)
   */
  pose: Partial<Pose>;
  /** How the channels this key sets are reached from their keys before; `smooth` if left out. */
  ease?: Easing;
  /** Channels reached on a curve of their own (the graph editor's), in place of `ease`. */
  curves?: Partial<Record<Channel, Curve>>;
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
  shrug: HANDS,
  reach: HANDS,
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
  | `shrug.${HandName}`
  | `reach.${HandName}`
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
  | "upperRoll"
  | "spineTwist"
  | "hipTilt"
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
  "upperRoll",
  "spineTwist",
  "hipTilt",
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

/** Every channel there is, `pose`'s or 0 where it leaves one out, as a key. */
export function everyChannel(pose: Pose): Partial<Pose> {
  let over = fullKey(pose);
  for (const ch of CHANNELS) {
    if (!setsChannel(over, ch)) over = withScalar(over, ch as ScalarChannel, 0);
  }
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

/** For each of CHANNELS (by index), the keys that set it (by index). */
type Setters = readonly (readonly number[])[];
const SETTERS = new WeakMap<readonly Pose[], Setters>();
const PELVIS = CHANNELS.indexOf("pelvis");
const ALL = CHANNELS.map((_, c) => c);
const NOT_PELVIS = ALL.filter((c) => c !== PELVIS);

/** Each of CHANNELS split once (group and part, or null), since sampling reads them all, often. */
const SPLITS = CHANNELS.map((ch) => splitChannel(ch));

/** A channel's value in a (partial) pose, by index; undefined where it's not set. */
function valueAt(pose: Partial<Pose>, c: number): unknown {
  const split = SPLITS[c];
  const p = pose as unknown as Record<string, unknown>;
  return split ? (p[split[0]] as NumberRecord | undefined)?.[split[1]] : p[CHANNELS[c]];
}

function settersOf(keys: readonly Key[]): Setters {
  const out: number[][] = CHANNELS.map(() => []);
  keys.forEach((k, i) => {
    for (let c = 0; c < out.length; c++) if (valueAt(k.pose, c) !== undefined) out[c].push(i);
  });
  return out;
}

/** A pose to write channels into, sharing nothing it'd change with `p`. */
function clonePose(p: Pose): Pose {
  const out = { ...p };
  for (const g of GROUP_NAMES) if (p[g]) (out as Record<string, unknown>)[g] = { ...p[g] };
  return out;
}

/** Sets `out`'s channel (by index) to `from`'s; a group's part left out is 0. */
function takeChannel(out: Pose, from: Pose, c: number): void {
  const split = SPLITS[c];
  const o = out as unknown as Record<string, unknown>;
  if (!split) {
    o[CHANNELS[c]] = from[CHANNELS[c] as keyof Pose];
    return;
  }
  const v = valueAt(from, c);
  if (v !== undefined) ((o[split[0]] ??= {}) as NumberRecord)[split[1]] = v as number;
  else if (o[split[0]]) delete (o[split[0]] as NumberRecord)[split[1]];
}

/** Blends one channel (by index) `t` of the way from `a` to `b` into `out`, as lerpPose would. */
function blendChannel(out: Pose, a: Pose, b: Pose, t: number, kind: Easing, c: number): void {
  const ch = CHANNELS[c];
  const split = SPLITS[c];
  const e = kind === "lead" ? leadTime(CORE.has(ch), t) : ease(kind, t);
  const o = out as unknown as Record<string, unknown>;
  if (ch === "pelvis") {
    o.pelvis = lerpPelvis(a.pelvis, b.pelvis, e);
  } else if (!split && (LIMBS as readonly string[]).includes(ch)) {
    o[ch] = lerpTarget(a, b, ch as LimbName, e);
  } else {
    const from = (valueAt(a, c) as number | undefined) ?? 0;
    const to = (valueAt(b, c) as number | undefined) ?? 0;
    if (!split) o[ch] = lerp(from, to, e);
    else if (from !== 0 || to !== 0)
      ((o[split[0]] ??= {}) as NumberRecord)[split[1]] = lerp(from, to, e);
    else if (o[split[0]]) delete (o[split[0]] as NumberRecord)[split[1]];
  }
}

/**
 * Where `frame` falls among a channel's keys (`s`, by index): the keys either
 * side and how far from the first to the second, or one key twice where
 * the channel holds. Null: no key sets it.
 */
function spanOf(move: Move, s: readonly number[], frame: number): [number, number, number] | null {
  if (!s.length) return null;
  const { keys, length } = move;
  const f = move.loop ? ((frame % length) + length) % length : frame;
  // The last of them on or before `f` (-1: none), by halves.
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[s[mid]].frame <= f) lo = mid + 1;
    else hi = mid;
  }
  const j = lo - 1;
  const hold = (i: number): [number, number, number] => [i, i, 0];
  if (s.length === 1) return hold(s[0]);
  let a: number, b: number, aFrame: number, bFrame: number;
  if (j === -1) {
    if (!move.loop) return hold(s[0]);
    [a, b] = [s.at(-1)!, s[0]];
    [aFrame, bFrame] = [keys[a].frame - length, keys[b].frame];
  } else if (j === s.length - 1) {
    if (!move.loop) return hold(s[j]);
    [a, b] = [s[j], s[0]];
    [aFrame, bFrame] = [keys[a].frame, keys[b].frame + length];
  } else {
    [a, b] = [s[j], s[j + 1]];
    [aFrame, bFrame] = [keys[a].frame, keys[b].frame];
  }
  const t = bFrame > aFrame ? (f - aFrame) / (bFrame - aFrame) : 1;
  return t <= 0 ? hold(a) : [a, b, t];
}

/** Channels on the same two keys, the same way between them. */
interface Blend {
  a: number;
  b: number;
  t: number;
  chs: number[];
  /** A channel on a curve of its own: alone in its blend. */
  curve?: Curve;
}

/** The channels `chs` (indices) at `frame`, each between its own keys, in blends that share them. */
function blends(move: Move, setters: Setters, frame: number, chs: readonly number[]): Blend[] {
  const groups: Blend[] = [];
  let last: Blend | undefined;
  for (const c of chs) {
    const span = spanOf(move, setters[c], frame);
    if (!span) continue;
    const [a, b, t] = span;
    const curve = a === b ? undefined : move.keys[b].curves?.[CHANNELS[c]];
    if (curve) {
      groups.push({ a, b, t, chs: [c], curve });
      continue;
    }
    // Most channels share their keys with the channel before.
    const same = (g: Blend) => !g.curve && g.a === a && g.b === b && g.t === t;
    let g = last && same(last) ? last : groups.find(same);
    if (g) g.chs.push(c);
    else groups.push((g = { a, b, t, chs: [c] }));
    last = g;
  }
  return groups;
}

/** A blend's channels written into `out`, from the keys' whole poses. */
function apply(out: Pose, move: Move, poses: readonly Pose[], g: Blend): void {
  const { a, b, t, chs } = g;
  if (a === b) {
    for (const c of chs) takeChannel(out, poses[a], c);
    return;
  }
  if (g.curve) {
    const e = alongCurve(g.curve, t);
    for (const c of chs) blendChannel(out, poses[a], poses[b], e, "linear", c);
    return;
  }
  const kind = move.keys[b].ease ?? "smooth";
  // Many channels: blend the whole pose once; a few: just those.
  if (chs.length > 16) {
    const from =
      kind === "lead"
        ? lerpPoseLead(poses[a], poses[b], t)
        : lerpPose(poses[a], poses[b], ease(kind, t));
    for (const c of chs) takeChannel(out, from, c);
  } else {
    for (const c of chs) blendChannel(out, poses[a], poses[b], t, kind, c);
  }
}

/** Each key as a whole pose: what it sets, and where the channels it leaves out pass by. */
export function resolveKeys(move: Move, rest: Pose = REST_POSE): Pose[] {
  const setters = settersOf(move.keys);
  const out = move.keys.map((k) => clonePose(mergePose(rest, k.pose)));
  const sets = setters.map((s) => new Set(s));
  // The pelvis first: a foot swings about it, at both ends of its blend.
  for (const pass of [[PELVIS], NOT_PELVIS]) {
    move.keys.forEach((k, i) => {
      const chs = pass.filter((c) => !sets[c].has(i));
      for (const g of blends(move, setters, k.frame, chs)) apply(out[i], move, out, g);
    });
  }
  SETTERS.set(out, setters);
  return out;
}

/**
 * `resolved` (from `resolveKeys`) for keys that changed only in which
 * channels they set, other than the pelvis: no pose sampling reads has
 * changed (a channel is read only off the keys that set it, and the feet
 * read the pelvis everywhere), so only the keys' channels are read again.
 * Much quicker than resolving afresh, for trying many such changes.
 */
export function rekeyed(move: Move, resolved: readonly Pose[]): Pose[] {
  const out = resolved.slice();
  SETTERS.set(out, settersOf(move.keys));
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
  if (move.keys.length === 1) return resolved[0];
  const setters = SETTERS.get(resolved) ?? settersOf(move.keys);
  const groups = blends(move, setters, frame, ALL);
  // The blend most channels share, as a whole pose: the others go on top of it.
  const main = groups.reduce((x, g) => (g.chs.length > x.chs.length ? g : x));
  const whole = (g: Blend): Pose => {
    const { a, b, t } = g;
    if (a === b) return resolved[a];
    if (g.curve) return lerpPose(resolved[a], resolved[b], alongCurve(g.curve, t));
    const kind = move.keys[b].ease ?? "smooth";
    if (kind === "lead") return lerpPoseLead(resolved[a], resolved[b], t);
    return lerpPose(resolved[a], resolved[b], ease(kind, t));
  };
  if (groups.length === 1 && main.chs.length === ALL.length) return whole(main);
  // A held channel's pose is a key's own: copied before it's written over.
  const out = main.a === main.b ? clonePose(whole(main)) : whole(main);
  for (const g of groups) if (g !== main) apply(out, move, resolved, g);
  return out;
}

/**
 * A move whose keys were written the old way (before version 4: a channel a
 * key leaves out holds from the key before), as keys that play the same:
 * each sets what it showed, less what it shares with the keys either side.
 */
export function fromCarryOver(move: Move, rest: Pose = REST_POSE): Move {
  const keys = [...move.keys].sort((a, b) => a.frame - b.frame);
  let pose = rest;
  const out: Move = {
    ...move,
    keys: keys.map((k) => {
      pose = mergePose(pose, k.pose);
      // Every key sets everything, even what's still at 0 (left out of the pose): a channel
      // a key leaves out would blend through it toward the next key that sets it.
      return { ...k, pose: everyChannel(pose) };
    }),
  };
  compactKeys(out, rest);
  return out;
}

/**
 * Leaves out of each key the channels that are the same there as on the
 * keys either side that set them, which changes nothing: the channel
 * passes through at that value anyway. (A foot also needs the pelvis the
 * same there, since it swings about it.) A channel's first and last keys
 * keep it.
 */
export function compactKeys(move: Move, rest: Pose = REST_POSE): void {
  const resolved = resolveKeys(move, rest);
  for (const ch of CHANNELS) {
    const s = move.keys.flatMap((k, i) => (setsChannel(k.pose, ch) ? [i] : []));
    const foot = ch === "footNear" || ch === "footFar";
    const same = (p: number, q: number) =>
      sameChannel(resolved[p], resolved[q], ch) &&
      (!foot || sameChannel(resolved[p], resolved[q], "pelvis"));
    let prev = s[0];
    for (let x = 1; x < s.length - 1; x++) {
      const i = s[x];
      // The same value either side: any curve between them is flat too.
      if (same(prev, i) && same(i, s[x + 1])) {
        clearChannel(move.keys[i].pose, ch);
        dropCurve(move.keys[i], ch);
      } else prev = i;
    }
  }
}

/** Takes a channel's curve off a key (one it no longer sets). */
export function dropCurve(key: Key, ch: Channel): void {
  if (!key.curves?.[ch]) return;
  delete key.curves[ch];
  if (!Object.keys(key.curves).length) delete key.curves;
}

/** Puts a channel on a curve of its own into a key, or (null) back on the key's ease. */
export function setCurve(key: Key, ch: Channel, curve: Curve | null): void {
  if (!curve) return dropCurve(key, ch);
  key.curves = { ...key.curves, [ch]: curve };
}

/** Whether the move can hit on `frame`. */
export const isActive = (move: Move, frame: number): boolean =>
  !!move.active && frame >= move.active.from && frame <= move.active.to;

// --- editing --------------------------------------------------------------

/** The index of the key on `frame`, or -1. */
export const keyAt = (move: Move, frame: number): number =>
  move.keys.findIndex((k) => k.frame === frame);

/**
 * Adds a key on `frame` setting every channel to the pose the move has
 * there (pinning it), as Add key does. Returns its index (an existing
 * key's, if any).
 */
export function addKey(move: Move, frame: number, rest: Pose = REST_POSE): number {
  const existing = keyAt(move, frame);
  if (existing >= 0) return existing;
  const pose = sampleMove(move, frame, resolveKeys(move, rest));
  return insertKey(move, frame, everyChannel(pose));
}

/**
 * The key on `frame`, added if there's none, setting nothing yet: what an
 * edit then sets is keyed there, and the rest pass through as they did.
 */
export function ensureKey(move: Move, frame: number): number {
  const existing = keyAt(move, frame);
  return existing >= 0 ? existing : insertKey(move, frame, {});
}

function insertKey(move: Move, frame: number, pose: Partial<Pose>): number {
  const index = move.keys.findIndex((k) => k.frame > frame);
  const at = index < 0 ? move.keys.length : index;
  // Reached the way the key after it is, so a blend keeps its feel.
  const ease = move.keys[at]?.ease;
  move.keys.splice(at, 0, { frame, pose, ...(ease ? { ease } : {}) });
  return at;
}

/** Removes a key; the channels it set pass through it after. The last key can't go. */
export function removeKey(move: Move, index: number): boolean {
  if (move.keys.length <= 1) return false;
  move.keys.splice(index, 1);
  return true;
}

const byFrame = (a: Key, b: Key) => a.frame - b.frame;

/** Moves a key, with what it sets, to another frame. Fails on a frame another key is on. */
export function moveKey(move: Move, index: number, frame: number): boolean {
  const f = Math.max(0, Math.min(move.length - 1, Math.round(frame)));
  const other = keyAt(move, f);
  if (other >= 0) return other === index;
  move.keys[index].frame = f;
  move.keys.sort(byFrame);
  return true;
}

/**
 * Moves keys (by index) `by` frames, with what they set, past other keys if
 * need be. Fails if one would leave the move or land on a key not moving.
 */
export function shiftKeys(move: Move, indices: readonly number[], by: number): boolean {
  const moving = new Set(indices);
  const to = move.keys.map((k, i) => (moving.has(i) ? k.frame + by : k.frame));
  if (to.some((f) => f < 0 || f >= move.length) || new Set(to).size < to.length) return false;
  move.keys.forEach((k, i) => (k.frame = to[i]));
  move.keys.sort(byFrame);
  return true;
}

/**
 * Moves what keys (by index) set of `channels` (a body part's) `by` frames,
 * into the keys there (added where there's none), leaving the rest of each
 * key where it is: so one part can run ahead of or behind the others. A
 * key left setting nothing goes. Fails if a frame is out of the move, or
 * its key already sets one of the channels.
 */
export function moveChannels(
  move: Move,
  indices: readonly number[],
  channels: readonly Channel[],
  by: number,
): boolean {
  if (!by) return true;
  const keys = structuredClone(move.keys);
  const sources = indices.filter((i) => channels.some((ch) => setsChannel(keys[i].pose, ch)));
  const moved = sources.map((i) => {
    const part: Partial<Pose> = {};
    const curves: Partial<Record<Channel, Curve>> = {};
    for (const ch of channels) {
      if (!setsChannel(keys[i].pose, ch)) continue;
      copyChannel(part, keys[i].pose as Pose, ch);
      clearChannel(keys[i].pose, ch);
      const c = keys[i].curves?.[ch];
      if (c) curves[ch] = c;
      dropCurve(keys[i], ch);
    }
    return { frame: keys[i].frame + by, part, ease: keys[i].ease, curves };
  });
  if (moved.some((m) => m.frame < 0 || m.frame >= move.length)) return false;
  const emptied = new Set(sources.map((i) => keys[i]).filter((k) => !Object.keys(k.pose).length));
  for (const m of moved) {
    let key = keys.find((k) => k.frame === m.frame);
    if (key && !emptied.has(key) && channels.some((ch) => setsChannel(key!.pose, ch))) return false;
    if (!key) {
      key = { frame: m.frame, pose: {}, ...(m.ease ? { ease: m.ease } : {}) };
      keys.push(key);
    }
    emptied.delete(key);
    key.pose = mergePartial(key.pose, m.part);
    if (Object.keys(m.curves).length) key.curves = { ...key.curves, ...m.curves };
  }
  const kept = keys.filter((k) => !emptied.has(k));
  if (!kept.length) return false;
  move.keys = kept.sort(byFrame);
  return true;
}

/** `pose`'s values of some channels, as a key setting just those. */
export function pickChannels(pose: Pose, channels: readonly Channel[]): Partial<Pose> {
  const out: Partial<Pose> = {};
  for (const ch of channels) copyChannel(out, pose, ch);
  return out;
}

/** `over` with what `more` sets as well; the groups merge part by part. */
export function mergePartial(over: Partial<Pose>, more: Partial<Pose>): Partial<Pose> {
  const out: Record<string, unknown> = { ...over };
  for (const [k, v] of Object.entries(more)) {
    out[k] = isGroup(k) ? { ...(over[k] as NumberRecord), ...(v as NumberRecord) } : v;
  }
  return out as Partial<Pose>;
}

/** A key to put on a move: the whole pose it shows. */
export interface PutKey {
  frame: number;
  pose: Pose;
  ease?: Easing;
  curves?: Key["curves"];
}

/**
 * Puts keys on frames, each setting every channel to its pose; a key
 * already on one of those frames gives way, and so do the keys at `remove`
 * (indices). The other keys keep what they set. Frames out of the move are
 * left out.
 */
export function putKeys(move: Move, put: readonly PutKey[], remove: readonly number[] = []): void {
  const gone = new Set(remove);
  const placed = put.filter(
    (p) => Number.isInteger(p.frame) && p.frame >= 0 && p.frame < move.length,
  );
  const taken = new Set(placed.map((p) => p.frame));
  const keys = [
    ...move.keys.filter((k, i) => !gone.has(i) && !taken.has(k.frame)),
    ...placed.map((p): Key => ({
      frame: p.frame,
      pose: everyChannel(p.pose),
      ...(p.ease ? { ease: p.ease } : {}),
      ...(p.curves && Object.keys(p.curves).length ? { curves: structuredClone(p.curves) } : {}),
    })),
  ].sort(byFrame);
  if (keys.length) move.keys = keys;
}

/**
 * Makes a move play `factor` times as long: its keys spread over more
 * frames (or draw together, under 1), the hit window with them. Keys stay a
 * frame apart at least, so none merge.
 */
export function stretchMove(move: Move, factor: number): void {
  let last = -1;
  for (const k of move.keys) last = k.frame = Math.max(last + 1, Math.round(k.frame * factor));
  move.length = Math.max(Math.round(move.length * factor), last + 1);
  const a = move.active;
  if (a) {
    // The frames from..to are the span [from, to + 1): stretch that.
    a.from = Math.min(Math.round(a.from * factor), move.length - 1);
    a.to = Math.min(Math.max(a.from, Math.round((a.to + 1) * factor) - 1), move.length - 1);
  }
}

/** The shortest a move can be: up to its last key. */
export const minLength = (move: Move): number => (move.keys.at(-1)?.frame ?? 0) + 1;

/** A new move: one key at frame 0 holding `pose`. */
export function newMove(name: string, pose: Pose = REST_POSE, length = 30): Move {
  return { name, tags: [], length, loop: false, keys: [{ frame: 0, pose: everyChannel(pose) }] };
}
