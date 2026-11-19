/**
 * The rig runtime: everything a game needs to play moves made in the editor.
 * The folder has no imports from outside itself, so a game can copy
 * `src/rig/` as it is (leave out the tests) and read the files the same way
 * the editor does:
 *
 *     const project = parseProject(await (await fetch("moves.rig.json")).text());
 *     const punch = project.moves.find((m) => m.name === "Punch")!;
 *     const joints = jointsAt(punch, frame, project.proportions);
 *     // joints[Joint.handNear * 3 + 0..2] is the near hand's x, y, z.
 *
 * The maths is deterministic (see `Exact`), so replays agree across browsers.
 */
import { solvePose, type Placement } from "./pose.ts";
import { createJointBuffer, DEFAULT_PROPORTIONS, type Proportions } from "./skeleton.ts";
import { resolveKeys, sampleMove, type Move } from "./timeline.ts";

export * from "./format.ts";
export * from "./pose.ts";
export * from "./skeleton.ts";
export * from "./timeline.ts";

/**
 * The joint positions of `move` at `frame` (fractions blend), x, y, z per
 * joint. Pass `out` to reuse a buffer, and `at` to place and mirror the figure.
 */
export function jointsAt(
  move: Move,
  frame: number,
  props: Proportions = DEFAULT_PROPORTIONS,
  out: Float32Array = createJointBuffer(),
  at?: Placement,
): Float32Array {
  return solvePose(sampleMove(move, frame, resolved(move)), props, out, at);
}

/** Resolved keys per move, until its keys change (a game's moves don't). */
const cache = new WeakMap<Move, { keys: Move["keys"]; poses: ReturnType<typeof resolveKeys> }>();

function resolved(move: Move) {
  const hit = cache.get(move);
  if (hit && hit.keys === move.keys) return hit.poses;
  const poses = resolveKeys(move);
  cache.set(move, { keys: move.keys, poses });
  return poses;
}
