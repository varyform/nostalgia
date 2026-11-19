// Instance data for R.instances() / R.drawInstanced(): packing, grouping by chunk, culling.
// Pure and DOM-free. An instance is 9 floats: x y z yaw width height r g b — the mesh turned
// by yaw about +y (as a part's `yaw`), x and z scaled by width, y by height, its colour
// multiplied by (r, g, b).
import { sphereVisible, type Plane, type V3 } from './math.ts';

/** floats per instance */
export const INSTANCE_FLOATS = 9;

/** one instance, as instanceData() reads it; width and height default to s (1), the colour to white */
export interface Instance {
  x: number;
  y: number;
  z: number;
  yaw?: number;
  s?: number;
  w?: number;
  h?: number;
  r?: number;
  g?: number;
  b?: number;
}

/** pack instances into the 9-float layout */
export function instanceData(list: readonly Instance[]): Float32Array {
  const out = new Float32Array(list.length * INSTANCE_FLOATS);
  list.forEach((p, k) => {
    const o = k * INSTANCE_FLOATS,
      s = p.s ?? 1;
    out[o] = p.x;
    out[o + 1] = p.y;
    out[o + 2] = p.z;
    out[o + 3] = p.yaw ?? 0;
    out[o + 4] = p.w ?? s;
    out[o + 5] = p.h ?? s;
    out[o + 6] = p.r ?? 1;
    out[o + 7] = p.g ?? 1;
    out[o + 8] = p.b ?? 1;
  });
  return out;
}

/**
 * Sort instances into groups (e.g. the terrain chunk each stands in) so each group is one
 * contiguous run: draw group k with drawInstanced(buf, range, ib, first[k], count[k]).
 * `group(x, z)` returns 0..groups − 1, or −1 to drop the instance. Stable within a group.
 */
export function groupInstances(
  data: Float32Array,
  groups: number,
  group: (x: number, z: number) => number,
): { data: Float32Array; first: Int32Array; count: Int32Array } {
  const n = Math.floor(data.length / INSTANCE_FLOATS),
    key = new Int32Array(n),
    count = new Int32Array(groups);
  for (let k = 0; k < n; k++) {
    const g = group(data[k * INSTANCE_FLOATS], data[k * INSTANCE_FLOATS + 2]);
    key[k] = g >= 0 && g < groups ? g : -1;
    if (key[k] >= 0) count[key[k]]++;
  }
  const first = new Int32Array(groups);
  for (let g = 1; g < groups; g++) first[g] = first[g - 1] + count[g - 1];
  const total = groups ? first[groups - 1] + count[groups - 1] : 0,
    at = first.slice(),
    out = new Float32Array(total * INSTANCE_FLOATS);
  for (let k = 0; k < n; k++) {
    if (key[k] < 0) continue;
    out.set(data.subarray(k * INSTANCE_FLOATS, (k + 1) * INSTANCE_FLOATS), at[key[k]]++ * INSTANCE_FLOATS);
  }
  return { data: out, first, count };
}

/**
 * Copy the instances that are within `far` of the eye and inside the frustum planes (each as
 * a sphere of radius × its larger scale) into out; returns how many. For sets that move or
 * aren't grouped by chunk. out must hold as many floats as data.
 */
export function cullInstances(
  data: Float32Array,
  ps: readonly Plane[],
  eye: V3,
  far: number,
  radius: number,
  out: Float32Array,
): number {
  const n = Math.floor(data.length / INSTANCE_FLOATS),
    c = [0, 0, 0],
    f2 = far * far;
  let m = 0;
  for (let k = 0; k < n; k++) {
    const o = k * INSTANCE_FLOATS;
    c[0] = data[o];
    c[1] = data[o + 1];
    c[2] = data[o + 2];
    const dx = c[0] - eye[0],
      dy = c[1] - eye[1],
      dz = c[2] - eye[2];
    if (dx * dx + dy * dy + dz * dz > f2) continue;
    if (!sphereVisible(ps, c, radius * Math.max(data[o + 4], data[o + 5]))) continue;
    out.set(data.subarray(o, o + INSTANCE_FLOATS), m * INSTANCE_FLOATS);
    m++;
  }
  return m;
}
