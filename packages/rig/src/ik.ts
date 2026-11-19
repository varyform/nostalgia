import { Exact, clamp, type Vec2, type Vec3 } from "./math.ts";

/** +1 bends the middle joint counter-clockwise of root→target (knees forward), -1 clockwise (elbows down/back). */
export type BendDirection = 1 | -1;

/**
 * Analytic two-bone IK in 2D. Writes the middle joint (elbow/knee) and the
 * end effector (hand/foot) into `outMid` / `outEnd`. Unreachable targets are
 * clamped onto the reachable annulus along the root→target direction, so the
 * chain stretches toward them instead of snapping.
 */
export function solveTwoBone(
  root: Vec2,
  target: Vec2,
  upper: number,
  lower: number,
  bend: BendDirection,
  outMid: Vec2,
  outEnd: Vec2,
): void {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const rawDist = Exact.hypot(dx, dy);
  const minReach = Math.abs(upper - lower) + 1e-4;
  const maxReach = upper + lower - 1e-4;
  const dist = clamp(rawDist, minReach, maxReach);

  // Degenerate target on top of the root: point straight down.
  const base = rawDist < 1e-9 ? -Math.PI / 2 : Exact.atan2(dy, dx);
  const cosInner = clamp((upper * upper + dist * dist - lower * lower) / (2 * upper * dist), -1, 1);
  const angle = base + bend * Exact.acos(cosInner);

  outMid.x = root.x + Exact.cos(angle) * upper;
  outMid.y = root.y + Exact.sin(angle) * upper;
  outEnd.x = root.x + Exact.cos(base) * dist;
  outEnd.y = root.y + Exact.sin(base) * dist;
}

/**
 * Two-bone IK in 3D. The middle joint bends toward `pole` (any vector not
 * parallel to root→target; only its component perpendicular to that line
 * counts). Unreachable targets are clamped like the 2D solver.
 */
export function solveTwoBone3(
  root: Vec3,
  target: Vec3,
  upper: number,
  lower: number,
  pole: Vec3,
  outMid: Vec3,
  outEnd: Vec3,
): void {
  let ux = target.x - root.x;
  let uy = target.y - root.y;
  let uz = target.z - root.z;
  const rawDist = Exact.hypot(ux, uy, uz);
  if (rawDist < 1e-9) {
    ux = 0;
    uy = -1;
    uz = 0;
  } else {
    ux /= rawDist;
    uy /= rawDist;
    uz /= rawDist;
  }
  const dist = clamp(rawDist, Math.abs(upper - lower) + 1e-4, upper + lower - 1e-4);

  // Pole direction made perpendicular to the root→target line.
  const along = pole.x * ux + pole.y * uy + pole.z * uz;
  let px = pole.x - along * ux;
  let py = pole.y - along * uy;
  let pz = pole.z - along * uz;
  const len = Exact.hypot(px, py, pz);
  if (len < 1e-9) {
    // Pole along the limb: any perpendicular will do.
    px = -uy;
    py = ux;
    pz = 0;
  } else {
    px /= len;
    py /= len;
    pz /= len;
  }

  const x = (upper * upper - lower * lower + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, upper * upper - x * x));
  outMid.x = root.x + ux * x + px * h;
  outMid.y = root.y + uy * x + py * h;
  outMid.z = root.z + uz * x + pz * h;
  outEnd.x = root.x + ux * dist;
  outEnd.y = root.y + uy * dist;
  outEnd.z = root.z + uz * dist;
}
