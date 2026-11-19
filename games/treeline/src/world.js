// The ground of a theatre: a seeded, deterministic height field on a 256 × 256 grid of 50 m cells
// (12.8 km square, centred on the origin), shaped by the theatre (theatres.js), cut by its rivers,
// smoothed under its roads and flattened under its sites; then the cover of every cell (water,
// mud, grass, field, forest, town, road, rock, snow, pad), the trees of its forests, the canopy
// that hides a helicopter, and the houses of its towns. Shared by the sim (collisions, landing,
// line-of-sight masking), the autopilot, the renderer and the tools. DOM-free.
//
//   const w = createWorld(0);              // theatre index → cached world
//   w.heightAt(x, z)                       // the surface, water included, exactly as drawn (the cell's
//                                          //   two triangles split along a–d: k → k + V + 1)
//   w.groundAt(x, z)                       // the same without the water (the river bed)
//   w.normalAt(x, z) → [nx, ny, nz]        // the ground's normal (ny = 1 is flat)
//   w.raw[k], w.h[k]                       // vertex heights, k = j * V + i: ground, and drawn (≥ water)
//   w.water, w.wet(x, z)                   // the water line; is (x, z) over water?
//   w.cover[c], w.coverAt(x, z)            // cell cover, c = j * N + i (COVER below)
//   w.tone[c]                              // 0..3: which field colour (land.field[tone]) a FIELD cell is
//   w.trees                                // Float32Array, TREE = 6 floats per tree:
//                                          //   x, y (ground under it), z, h (height), r (crown radius), kind
//                                          //   (index into theatre.trees); sorted by chunk
//   w.chunkTrees[2 * q], [2 * q + 1]       // tree index range [start, end) of chunk q = cj * NC + ci
//                                          //   (CHUNK × CHUNK cells, 800 m square; chunk ci covers
//                                          //   x from −HALF + ci * 800)
//   w.canopy[c]                            // the masking top of a forest cell (absolute y), 0 = open;
//                                          //   every FOREST cell masks up to its trees' mean top − 2 m
//   w.topAt(x, z)                          // max(heightAt, canopy): what hides things
//   w.clear(ax, ay, az, bx, by, bz)        // line of sight: no ground and no canopy between a and b
//                                          //   (the first and last 55 m are not tested, so a tank in
//                                          //   a wood's edge still sees out, and is seen)
//   w.houses                               // Float32Array, HOUSE = 7 floats: x, y, z, w, d, h, dir
//                                          //   (dir radians, 0 = long side east–west); never mask
//   w.towns, w.rivers, w.roads             // from the theatre: [{ x, z, r, label, n }], [{ pts, w }],
//                                          //   [{ name, pts, w }] (roads by name: w.road('levee'))
//   w.bridges → [{ x, z, dx, dz, len, w, y, road }]   // where a road crosses a river: centre,
//                                          //   road direction, span, width, deck height (y)
//   w.deckAt(x, z)                         // what a vehicle drives on: a bridge deck, else heightAt
//   w.sites, w.site(name) → { name, label, x, y, z, r, pad, kind }   // y: the flattened ground
//   w.landable(x, z) → true | 'slope' | 'trees' | 'water' | 'house'   // can a helicopter set down?
//   w.T                                    // the theatre (sky, land palette, tree kinds…)
//
// World axes: x east, y up, z south (so north is −z, heading 0). Metres.
import { hash2, lerp, polyAt, polyDist, smooth } from '@nostalgia/gl/noise';
import { THEATRES } from './theatres.js';

export { fbm, hash2, lerp, polyAt, polyDist, polyLen, ridged, smooth } from '@nostalgia/gl/noise';

export const CELL = 50, N = 256, SIZE = CELL * N, HALF = SIZE / 2, V = N + 1, CHUNK = 16, NC = N / CHUNK;
export const TREE = 6, HOUSE = 7;
export const COVER = { GRASS: 0, FIELD: 1, FOREST: 2, TOWN: 3, ROAD: 4, WATER: 5, ROCK: 6, SNOW: 7, MUD: 8, PAD: 9 };

const worlds = new Map();
export function createWorld(index) {
  if (worlds.has(index)) return worlds.get(index);
  const T = THEATRES[index], water = T.water, seed = T.seed;
  const raw = new Float32Array(V * V), h = new Float32Array(V * V);
  const base = (x, z) => lerp(T.shape(x, z), T.edge, smooth(HALF - 900, HALF, Math.max(Math.abs(x), Math.abs(z))));
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) raw[j * V + i] = base(-HALF + i * CELL, -HALF + j * CELL);

  // sites: flat pads at the ground they stand on, never under water
  const sites = {};
  for (const [name, s] of Object.entries(T.sites)) {
    const y = Math.max(water + 1.5, s.h ?? base(s.x, s.z));
    sites[name] = { name, label: s.label ?? name, r: 0, pad: false, kind: 'area', ...s, y };
  }
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const x = -HALF + i * CELL, z = -HALF + j * CELL, k = j * V + i;
    let y = raw[k];
    // roads: the ground across them levelled to the height along them
    for (const R of T.roads) {
      const q = polyDist(R.pts, x, z);
      if (q.d > R.w / 2 + 70) continue;
      const p = polyAt(R.pts, q.along), ry = Math.max(water + 1.5, base(p.x, p.z));
      y = lerp(y, ry, smooth(R.w / 2 + 70, R.w / 2 + 6, q.d));
    }
    // rivers: a bed below the water line, banks rising to the land
    for (const Rv of T.rivers) {
      const d = polyDist(Rv.pts, x, z).d;
      if (d > Rv.w / 2 + 90) continue;
      const bed = water - 3.5;
      y = Math.min(y, bed + (Math.max(y, bed) - bed) * smooth(Rv.w * 0.42, Rv.w / 2 + 90, d));
    }
    for (const s of Object.values(sites)) if (s.r) y = lerp(y, s.y, smooth(s.r * 1.9, s.r, Math.hypot(x - s.x, z - s.z)));
    raw[k] = y;
    h[k] = Math.max(y, water);
  }
  const tri = (g, x, z) => {
    const gx = (x + HALF) / CELL, gz = (z + HALF) / CELL;
    if (gx < 0 || gz < 0 || gx >= N || gz >= N) return Math.max(T.edge, g === h ? water : -Infinity);
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * V + i;
    const a = g[k], b = g[k + 1], c = g[k + V], d = g[k + V + 1];
    return fx > fz ? a + (b - a) * fx + (d - b) * fz : a + (d - c) * fx + (c - a) * fz;
  };
  const heightAt = (x, z) => tri(h, x, z);
  const groundAt = (x, z) => tri(raw, x, z);
  function normalAt(x, z) {
    const e = CELL * 0.5, dx = heightAt(x + e, z) - heightAt(x - e, z), dz = heightAt(x, z + e) - heightAt(x, z - e);
    const L = Math.hypot(dx, 2 * e, dz);
    return [-dx / L, (2 * e) / L, -dz / L];
  }
  const wet = (x, z) => groundAt(x, z) < water - 0.2;
  const cellOf = (x, z) => {
    const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL);
    return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
  };

  // ---------- cover ----------
  const cover = new Uint8Array(N * N), tone = new Uint8Array(N * N), forestF = new Float32Array(N * N);
  const roadD = (x, z) => T.roads.reduce((m, R) => Math.min(m, polyDist(R.pts, x, z).d - R.w / 2), Infinity);
  const fa = 0.35, fc = Math.cos(fa), fs = Math.sin(fa);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -HALF + (i + 0.5) * CELL, z = -HALF + (j + 0.5) * CELL, c = j * N + i;
    const y = groundAt(x, z), n = normalAt(x, z), rd = roadD(x, z);
    let cv = COVER.GRASS;
    const site = Object.values(sites).find(s => s.pad && Math.hypot(x - s.x, z - s.z) < s.r);
    const town = T.towns.find(t => Math.hypot(x - t.x, z - t.z) < t.r);
    if (y < water - 0.2) cv = COVER.WATER;
    else if (site) cv = COVER.PAD;
    else if (rd < 6) cv = COVER.ROAD;
    else if (y < water + 1.3) cv = COVER.MUD;
    else if (town) cv = COVER.TOWN;
    else if (index === 2 && y > 1470 + hash2(i, j, seed) * 110) cv = COVER.SNOW;
    else if (n[1] < 0.78 || (index === 2 && y > 1240 + hash2(i, j, seed + 1) * 90)) cv = COVER.ROCK;
    else {
      const near = Object.values(sites).some(s => s.r && Math.hypot(x - s.x, z - s.z) < s.r * 1.5 + 30)
        || T.towns.some(t => Math.hypot(x - t.x, z - t.z) < t.r + 40) || rd < 16;
      // fields: a patchwork of rotated plots
      const u = (x * fc + z * fs) / 240, v = (-x * fs + z * fc) / 170, pi = Math.floor(u), pj = Math.floor(v);
      const farm = T.farm ? T.farm(x, z, y) : 0, ph = hash2(pi, pj, seed + 7);
      const F = T.forest(x, z, y);
      forestF[c] = F;
      if (farm > 0 && ph < farm * 0.9 && n[1] > 0.93 && F < 0.75) { cv = COVER.FIELD; tone[c] = Math.floor(hash2(pi, pj, seed + 9) * 4); }
      else if (!near && F > 0.5) cv = COVER.FOREST;
    }
    cover[c] = cv;
  }
  const coverAt = (x, z) => { const c = cellOf(x, z); return c < 0 ? COVER.GRASS : cover[c]; };

  // ---------- trees, chunk by chunk ----------
  const list = [], chunkTrees = new Uint32Array(NC * NC * 2), canopy = new Float32Array(N * N);
  for (let cj = 0; cj < NC; cj++) for (let ci = 0; ci < NC; ci++) {
    const q = cj * NC + ci;
    chunkTrees[2 * q] = list.length / TREE;
    for (let j = cj * CHUNK; j < (cj + 1) * CHUNK; j++) for (let i = ci * CHUNK; i < (ci + 1) * CHUNK; i++) {
      const c = j * N + i, F = forestF[c];
      let n = 0;
      if (cover[c] === COVER.FOREST) n = 1 + (hash2(i, j, seed + 11) < F * 0.85 ? 1 : 0);
      else if (cover[c] === COVER.GRASS && hash2(i, j, seed + 13) < F * 0.16) n = 1;
      let tops = 0;
      for (let t = 0; t < n; t++) {
        const x = -HALF + (i + 0.12 + 0.76 * hash2(i * 3 + t, j, seed + 17)) * CELL, z = -HALF + (j + 0.12 + 0.76 * hash2(i, j * 3 + t, seed + 19)) * CELL;
        const y = heightAt(x, z), kind = T.treeKind(x, z, y, hash2(i + t * 7, j, seed + 23)), K = T.trees[kind];
        const th = lerp(K.h[0], K.h[1], hash2(i, j + t * 5, seed + 29)), tr = lerp(K.r[0], K.r[1], hash2(i + t, j + t, seed + 31));
        list.push(x, y, z, th, tr, kind);
        tops += y + th;
      }
      if (n && cover[c] === COVER.FOREST) canopy[c] = tops / n - 2;
    }
    chunkTrees[2 * q + 1] = list.length / TREE;
  }
  const trees = new Float32Array(list);
  const topAt = (x, z) => { const c = cellOf(x, z); return Math.max(heightAt(x, z), c < 0 ? 0 : canopy[c]); };

  // ---------- houses ----------
  const hl = [];
  T.towns.forEach((t, ti) => {
    for (let k = 0, tries = 0; k < t.n && tries < t.n * 8; tries++) {
      const a = hash2(ti, tries, seed + 41) * Math.PI * 2, d = Math.sqrt(hash2(tries, ti, seed + 43)) * t.r * 0.9;
      const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
      if (roadD(x, z) < 12 || groundAt(x, z) < water + 0.5) continue;
      const w = 9 + hash2(tries, 1, seed + 47) * 7, dd = 6 + hash2(tries, 2, seed + 47) * 4, hh = 5 + hash2(tries, 3, seed + 47) * 3;
      hl.push(x, heightAt(x, z), z, w, dd, hh, Math.round(hash2(tries, 4, seed + 47) * 4) * (Math.PI / 4) + a * 0.1);
      k++;
    }
  });
  const houses = new Float32Array(hl);

  // ---------- bridges: where a road crosses a river ----------
  const bridges = [];
  for (const R of T.roads) for (let a = 0; a + 1 < R.pts.length; a++) for (const Rv of T.rivers) for (let b = 0; b + 1 < Rv.pts.length; b++) {
    const [p0, p1] = [R.pts[a], R.pts[a + 1]], [q0, q1] = [Rv.pts[b], Rv.pts[b + 1]];
    const rx = p1[0] - p0[0], rz = p1[1] - p0[1], sx = q1[0] - q0[0], sz = q1[1] - q0[1], den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((q0[0] - p0[0]) * sz - (q0[1] - p0[1]) * sx) / den, u = ((q0[0] - p0[0]) * rz - (q0[1] - p0[1]) * rx) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) continue;
    const L = Math.hypot(rx, rz), dx = rx / L, dz = rz / L, x = p0[0] + rx * t, z = p0[1] + rz * t;
    const sin = Math.abs(dx * sz - dz * sx) / Math.hypot(sx, sz), len = Rv.w / Math.max(0.35, sin) + 60;
    const y = Math.max(water + 3, heightAt(x - dx * len / 2, z - dz * len / 2), heightAt(x + dx * len / 2, z + dz * len / 2));
    const twin = bridges.find(B => Math.hypot(B.x - x, B.z - z) < 60);
    if (twin) { if (len > twin.len) Object.assign(twin, { len, y }); continue; }
    bridges.push({ x, z, dx, dz, len, w: R.w + 2, y, road: R.name });
  }
  /** the surface a vehicle drives on: a bridge deck, or the ground */
  function deckAt(x, z) {
    for (const B of bridges) {
      const ex = x - B.x, ez = z - B.z, along = ex * B.dx + ez * B.dz, across = -ex * B.dz + ez * B.dx;
      if (Math.abs(along) < B.len / 2 && Math.abs(across) < B.w) return Math.max(B.y, heightAt(x, z));
    }
    return heightAt(x, z);
  }

  // ---------- line of sight ----------
  function clear(ax, ay, az, bx, by, bz) {
    const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 40);
    for (let k = 1; k < n; k++) {
      const t = k / n, s = t * L;
      if (s < 55 || L - s < 55) continue;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = ay + (by - ay) * t;
      if (heightAt(x, z) > y - 1) return false;
      const c = cellOf(x, z);
      if (c >= 0 && canopy[c] > y) return false;
    }
    return true;
  }
  function landable(x, z) {
    if (wet(x, z)) return 'water';
    const c = cellOf(x, z);
    if (c >= 0 && canopy[c] > 0) return 'trees';
    for (let k = 0; k < houses.length; k += HOUSE) if (Math.abs(houses[k] - x) < 14 && Math.abs(houses[k + 2] - z) < 14) return 'house';
    return normalAt(x, z)[1] > 0.96 ? true : 'slope';
  }

  const w = {
    index, T, raw, h, water, cover, tone, trees, chunkTrees, canopy, houses, sites, bridges,
    towns: T.towns, rivers: T.rivers, roads: T.roads,
    heightAt, groundAt, normalAt, wet, coverAt, topAt, clear, landable, deckAt,
    site: name => sites[name], road: name => T.roads.find(r => r.name === name),
  };
  worlds.set(index, w);
  return w;
}
