// A theatre's static geometry, built once per theatre from world.js:
// - the ground: the height field as flat-shaded faces (exactly the surface heightAt() reads),
//   coloured by each cell's cover (grass, fields, mud, rock, snow, pads) and water by depth;
// - the forest canopy: a lumpy lid over every FOREST cell at its masking height (w.canopy), its
//   open edges skirted down to the ground and its corners cut, so a wood reads as a solid mass
//   from 10–50 m up — and hides exactly what the sim says it hides;
// - the houses, the bridges and the sites' fixtures (pads, the FARP's stores);
// - the decals lying on the ground: roads and landing marks;
// - the trees themselves, exactly w.trees, as instances (x y z yaw width height r g b) grouped
//   by chunk and kind, with the theatre's own tree meshes (near and far) in a small buffer.
// The ground is cut into the world's 800 m chunks so the view can skip what's behind it.
//
//   const T = buildTerrain(world);
//   T.data, T.chunks[q] = { first, count, c, r }           // ground + canopy + houses, per chunk
//   T.decals = { data, count }                              // drawn with a polygon offset
//   T.props = { data, ranges }                              // tree meshes near/far, bridges
//   T.inst (Float32Array, 9 floats each), T.groups[q] = [{ kind, first, count }]
import { builder, hexRGB } from '@nostalgia/gl';
import { CELL, CHUNK, COVER, HALF, HOUSE, N, NC, TREE, V, hash2 } from '../world.js';
import { bridge, house, lzMark, padStores, tree } from './meshes.js';

const rgb = h => hexRGB(h).map(v => v * 255);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = t => Math.min(1, Math.max(0, t));
const round = c => c.map(v => Math.max(0, Math.min(255, Math.round(v))));
const shade = (c, k) => round([c[0] * k, c[1] * k, c[2] * k]);

/** a builder that places what's built into it: offset and yaw (about y) */
export function placed(B, at, yaw = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = p => [at[0] + p[0] * c + p[2] * s, at[1] + p[1], at[2] - p[0] * s + p[2] * c];
  return {
    tri: (a, b, cc, col, k, ref, cols) => B.tri(P(a), P(b), P(cc), col, k, ref ? P(ref) : null, cols),
    quad: (a, b, cc, d, col, k, ref) => B.quad(P(a), P(b), P(cc), P(d), col, k, ref ? P(ref) : null),
    get n() { return B.n; },
  };
}

export function buildTerrain(W) {
  const T = W.T, L = T.land, h = W.h, raw = W.raw, water = W.water, seed = T.seed;
  const col = {};
  for (const [k, v] of Object.entries(L)) col[k] = Array.isArray(v) ? v.map(rgb) : rgb(v);
  let top = water + 1;
  for (let k = 0; k < h.length; k++) if (h[k] > top) top = h[k];
  const span = top - water;
  const waterCol = depth => round(mix(col.shallow, col.deep, clamp01(Math.sqrt(Math.max(0, depth) / 6))));
  const kinds = T.trees.map(K => ({ col: rgb(K.col), trunk: rgb(K.trunk) }));

  // the canopy's colour per cell: the mean colour of the trees in it and the cells around it,
  // so mixed woods blend and stands of one kind show as soft patches, not a checkerboard
  const sum = new Float32Array(N * N * 4);
  for (let t = 0; t < W.trees.length; t += TREE) {
    const i = Math.floor((W.trees[t] + HALF) / CELL), j = Math.floor((W.trees[t + 2] + HALF) / CELL);
    if (i < 0 || j < 0 || i >= N || j >= N) continue;
    const c = kinds[W.trees[t + 5]]?.col ?? kinds[0].col, o = (j * N + i) * 4;
    sum[o] += c[0]; sum[o + 1] += c[1]; sum[o + 2] += c[2]; sum[o + 3]++;
  }
  const canopyCol = (i, j) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, c = j + dj;
      if (a < 0 || c < 0 || a >= N || c >= N) continue;
      const o = (c * N + a) * 4, w = di || dj ? 1 : 3;
      r += sum[o] * w; g += sum[o + 1] * w; b += sum[o + 2] * w; n += sum[o + 3] * w;
    }
    return n ? [r / n, g / n, b / n] : kinds[0].col;
  };

  // the colour of a cell's face by its cover, height and slope
  function ground(c, y, ny, half, i, j) {
    const n = hash2(i * 2 + half, j, seed) - 0.5, e = (y - water) / span;
    let k = W.cover[c], base;
    switch (k) {
      case COVER.FIELD: base = col.field[W.tone[c]]; break;
      case COVER.FOREST: base = col.forest; break;
      case COVER.TOWN: base = mix(col.town, col.grass, 0.35 + n * 0.5); break;
      case COVER.ROCK: base = mix(col.rock, col.grass, clamp01((ny - 0.7) * 2.5) * 0.4); break;
      case COVER.SNOW: base = col.snow; break;
      case COVER.MUD: base = col.mud; break;
      case COVER.PAD: base = col.pad; break;
      default: {
        // grass, darker in hollows and paler high up; roads lie on it as decals
        base = mix(col.grass, col.rock, clamp01((e - 0.55) * 1.6) * 0.5);
        if (k === COVER.ROAD) base = mix(base, col.road, 0.25);
        k = COVER.GRASS;
      }
    }
    const slope = 1 - clamp01((0.97 - ny) * 1.6) * 0.22;
    const j1 = k === COVER.FIELD ? n * 0.05 : n * 0.12;
    return shade(base, slope * (1 + j1));
  }

  const B = builder(1 << 20), chunks = [];
  const P = (i, j) => [-HALF + i * CELL, h[j * V + i], -HALF + j * CELL];
  const wetV = (i, j) => raw[j * V + i] < water - 0.05;
  const canopy = W.canopy;
  const forest = (i, j) => i >= 0 && j >= 0 && i < N && j < N && canopy[j * N + i] > 0;
  // the lid's corner heights: the mean of the forest cells around a grid point, under the
  // treetops so the crowns stand out of it, rough, and lower along the wood's edge
  const lidY = (i, j) => {
    let s = 0, n = 0;
    for (const [a, b] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) if (forest(a, b)) { s += canopy[b * N + a]; n++; }
    const y = s / n - 4 + (hash2(i, j, seed + 3) - 0.5) * 4.5;
    if (n === 4) return y;
    const gy = h[Math.min(N, j) * V + Math.min(N, i)];
    return gy + (y - gy) * 0.55;
  };

  function cell(i, j) {
    const a = P(i, j), b = P(i + 1, j), c = P(i, j + 1), d = P(i + 1, j + 1), cc = j * N + i;
    const wa = wetV(i, j), wb = wetV(i + 1, j), wc = wetV(i, j + 1), wd = wetV(i + 1, j + 1);
    // the two faces, split along a–d as heightAt() has it
    for (const [p, q, r, wp, wq, wr, ip, jp, iq, jq, ir, jr, half] of [[a, d, b, wa, wd, wb, i, j, i + 1, j + 1, i + 1, j, 0], [a, c, d, wa, wc, wd, i, j, i, j + 1, i + 1, j + 1, 1]]) {
      if (wp && wq && wr) {
        const cols = [waterCol(water - raw[jp * V + ip]), waterCol(water - raw[jq * V + iq]), waterCol(water - raw[jr * V + ir])];
        B.tri(p, q, r, null, 128, null, cols);
        continue;
      }
      const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, Ln = Math.hypot(nx, ny, nz);
      const y = (p[1] + q[1] + r[1]) / 3;
      B.tri(p, q, r, wp || wq || wr ? shade(col.mud, 1 + (hash2(i, j, seed + 5) - 0.5) * 0.1) : ground(cc, y, ny / Ln, half, i, j));
    }
    if (canopy[cc] > 0) lid(i, j);
  }

  // ---------- the canopy lid of one forest cell ----------
  function lid(i, j) {
    const col = canopyCol(i, j);
    const x0 = -HALF + i * CELL, z0 = -HALF + j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
    const A = [x0, lidY(i, j), z0], Bp = [x1, lidY(i + 1, j), z0], C = [x0, lidY(i, j + 1), z1], D = [x1, lidY(i + 1, j + 1), z1];
    const oN = !forest(i, j - 1), oS = !forest(i, j + 1), oW = !forest(i - 1, j), oE = !forest(i + 1, j);
    // pick the split that lets an open corner be cut off
    let faces;
    if (oN && oE && !(oS && oW)) faces = [[A, C, D, 'S', 'W', 'diag']]; // NE corner gone
    else if (oS && oW && !(oN && oE)) faces = [[A, D, Bp, 'N', 'E', 'diag']]; // SW corner gone
    else if (oN && oW && !(oS && oE)) faces = [[Bp, C, D, 'S', 'E', 'diag2']]; // NW corner gone
    else if (oS && oE && !(oN && oW)) faces = [[A, C, Bp, 'N', 'W', 'diag2']]; // SE corner gone
    else faces = [[A, C, D], [A, D, Bp]];
    const n1 = hash2(i, j, seed + 7), n2 = hash2(j, i, seed + 7);
    faces.forEach(([p, q, r], f) => {
      const k = 0.84 + (f ? n2 : n1) * 0.3;
      B.tri(p, q, r, shade(col, k), 255, [(p[0] + q[0] + r[0]) / 3, -1e4, (p[2] + q[2] + r[2]) / 3]);
    });
    // skirts down the open sides (and across a cut corner)
    const dark = shade(col, 0.55), ctr = [(x0 + x1) / 2, (A[1] + D[1]) / 2, (z0 + z1) / 2];
    const gy = (x, z) => W.heightAt(x, z) - 1;
    const skirt = (p, q) => B.quad(p, q, [q[0], gy(q[0], q[2]), q[2]], [p[0], gy(p[0], p[2]), p[2]], dark, 255, ctr);
    const cut = faces.length === 1 ? faces[0] : null;
    if (oN && (!cut || cut.includes('N'))) skirt(A, Bp);
    if (oS && (!cut || cut.includes('S'))) skirt(C, D);
    if (oW && (!cut || cut.includes('W'))) skirt(A, C);
    if (oE && (!cut || cut.includes('E'))) skirt(Bp, D);
    if (cut?.includes('diag')) skirt(A, D);
    if (cut?.includes('diag2')) skirt(Bp, C);
  }

  for (let cj = 0; cj < NC; cj++) for (let ci = 0; ci < NC; ci++) {
    const first = B.n;
    let lo = Infinity, hi = -Infinity;
    for (let j = cj * CHUNK; j < (cj + 1) * CHUNK; j++) for (let i = ci * CHUNK; i < (ci + 1) * CHUNK; i++) {
      cell(i, j);
      const y = h[j * V + i];
      lo = Math.min(lo, y); hi = Math.max(hi, y + (canopy[j * N + i] > 0 ? canopy[j * N + i] - y : 0));
    }
    const cx = -HALF + (ci + 0.5) * CHUNK * CELL, cz = -HALF + (cj + 0.5) * CHUNK * CELL;
    chunks.push({ first, count: B.n - first, c: [cx, (lo + hi) / 2, cz], r: Math.hypot(CHUNK * CELL * 0.71, (hi - lo) / 2 + 30) });
  }

  // ---------- houses, the sites' fixtures: into the chunk they stand in ----------
  const extra = Array.from({ length: NC * NC }, () => []);
  const chunkOf = (x, z) => {
    const ci = Math.max(0, Math.min(NC - 1, Math.floor((x + HALF) / (CHUNK * CELL)))), cj = Math.max(0, Math.min(NC - 1, Math.floor((z + HALF) / (CHUNK * CELL))));
    return cj * NC + ci;
  };
  const roofs = ['#8e4a36', '#5b4b44', '#9b5a3a', '#4f4f4a', '#6e3a30'], walls = ['#d9d0bb', '#cfc7b4', '#e2dccb', '#bdb6a2', '#c9b89a'];
  const Hs = W.houses;
  for (let k = 0; k < Hs.length; k += HOUSE) {
    const x = Hs[k], y = Hs[k + 1], z = Hs[k + 2], n = hash2(k, 1, seed);
    extra[chunkOf(x, z)].push(Bx => house(placed(Bx, [x, y - 0.4, z], Hs[k + 6]), Hs[k + 3], Hs[k + 4], Hs[k + 5] + 0.4, walls[(n * 5) | 0], roofs[(hash2(k, 2, seed) * 5) | 0]));
  }
  for (const s of Object.values(W.sites)) {
    if (s.kind === 'farp') extra[chunkOf(s.x, s.z)].push(Bx => padStores(placed(Bx, [s.x + s.r * 0.55, s.y, s.z - s.r * 0.3], 0.3)));
  }
  // a static chunk's extras are appended to a second range per chunk
  const extras = [];
  extra.forEach((list, q) => {
    if (!list.length) return;
    const first = B.n;
    for (const fn of list) fn(B);
    extras.push({ first, count: B.n - first, c: chunks[q].c, r: chunks[q].r });
  });

  // ---------- decals: roads, landing marks ----------
  const D = builder(32768);
  const road = round(col.road), verge = shade(col.road, 0.82);
  const pads = Object.values(W.sites).filter(s => s.pad);
  for (const R of W.roads) {
    const pts = R.pts, step = 25, hw = R.w / 2;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [x0, z0] = pts[k], [x1, z1] = pts[k + 1], Ls = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(Ls / step);
      const dx = (x1 - x0) / Ls, dz = (z1 - z0) / Ls;
      for (let q = 0; q < n; q++) {
        const a0 = q * step, a1 = Math.min(Ls, (q + 1) * step + (k + 2 < pts.length || q + 1 < n ? 1.5 : 0));
        const xa = x0 + dx * a0, za = z0 + dz * a0, xb = x0 + dx * a1, zb = z0 + dz * a1;
        // a road ends at a pad's edge: the landing mark stays clear
        if (pads.some(s => Math.hypot((xa + xb) / 2 - s.x, (za + zb) / 2 - s.z) < s.r * 0.8)) continue;
        for (const [w0, w1, c] of [[-hw - 1.5, -hw, verge], [-hw, hw, road], [hw, hw + 1.5, verge]]) {
          const y = (x, z) => W.deckAt(x, z) + 0.25;
          const p = (x, z, w) => [x - dz * w, y(x - dz * w, z + dx * w), z + dx * w];
          D.quad(p(xa, za, w0), p(xa, za, w1), p(xb, zb, w1), p(xb, zb, w0), c, 255, [(xa + xb) / 2, -1e4, (za + zb) / 2]);
        }
      }
    }
  }
  for (const s of pads) lzMark(placed(D, [s.x, s.y + 0.15, s.z], 0), s.kind === 'farp' ? '#e8e4d4' : '#f0c040');

  // ---------- the theatre's own meshes: tree kinds (near, far) and bridges ----------
  const Pr = builder(8192), ranges = {};
  const addP = (name, fn) => { const s = Pr.n; fn(Pr); ranges[name] = [s, Pr.n - s]; };
  T.trees.forEach((K, k) => {
    addP(`tree${k}`, B2 => tree(B2, K.shape, K.col, K.trunk, false));
    addP(`far${k}`, B2 => tree(B2, K.shape, K.col, K.trunk, true));
  });
  (W.bridges ?? []).forEach((br, k) => addP(`bridge${k}`, B2 => bridge(B2, br.len / 2, Math.max(6, br.y - water + 4), br.w)));

  // ---------- tree instances, grouped by chunk then kind ----------
  const nT = W.trees.length / TREE, inst = new Float32Array(nT * 9), groups = [];
  let o = 0;
  for (let q = 0; q < NC * NC; q++) {
    const s = W.chunkTrees[2 * q], e = W.chunkTrees[2 * q + 1], g = [];
    for (let kind = 0; kind < T.trees.length; kind++) {
      const first = o / 9;
      for (let t = s; t < e; t++) {
        const b = t * TREE;
        if (W.trees[b + 5] !== kind) continue;
        const x = W.trees[b], y = W.trees[b + 1], z = W.trees[b + 2], th = W.trees[b + 3], tr = W.trees[b + 4];
        const n = hash2(t, 3, seed), m = hash2(t, 5, seed);
        inst[o++] = x; inst[o++] = y - 0.5; inst[o++] = z; inst[o++] = n * Math.PI * 2;
        inst[o++] = tr * 2; inst[o++] = th + 0.5;
        const v = 0.86 + m * 0.26;
        inst[o++] = v * (0.97 + n * 0.06); inst[o++] = v; inst[o++] = v * (1.03 - n * 0.06);
      }
      if (o / 9 > first) g.push({ kind, first, count: o / 9 - first });
    }
    groups.push(g);
  }

  return { data: B.data(), chunks, extras, decals: { data: D.data(), count: D.n }, props: { data: Pr.data(), ranges }, inst, groups, top };
}

/** a top-down picture of the theatre for the briefing map: w × w RGBA pixels */
export function mapImage(W, w = 256) {
  const T = W.T, L = T.land, out = new Uint8ClampedArray(w * w * 4), water = W.water;
  const c = {};
  for (const [k, v] of Object.entries(L)) c[k] = Array.isArray(v) ? v.map(rgb) : rgb(v);
  let top = water + 1;
  for (let k = 0; k < W.h.length; k++) if (W.h[k] > top) top = W.h[k];
  for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
    const x = -HALF + ((i + 0.5) / w) * HALF * 2, z = -HALF + ((j + 0.5) / w) * HALF * 2;
    const y = W.heightAt(x, z), cv = W.coverAt(x, z);
    let p;
    if (cv === COVER.WATER) p = c.shallow;
    else if (cv === COVER.FOREST) p = shade(rgb(T.trees[0].col), 0.75);
    else if (cv === COVER.FIELD) p = c.field[W.tone[Math.floor((z + HALF) / CELL) * N + Math.floor((x + HALF) / CELL)]];
    else if (cv === COVER.ROCK) p = c.rock;
    else if (cv === COVER.SNOW) p = c.snow;
    else if (cv === COVER.TOWN) p = c.town;
    else if (cv === COVER.MUD) p = c.mud;
    else if (cv === COVER.PAD) p = c.pad;
    else p = c.grass;
    // relief shading from the north-west, and a little height tint
    const sl = W.heightAt(x - 60, z - 60) - y;
    const sh = (1 - clamp01(sl / 40) * 0.4 + clamp01(-sl / 40) * 0.2) * (0.85 + 0.25 * ((y - water) / (top - water)));
    const o = (j * w + i) * 4;
    out[o] = p[0] * sh; out[o + 1] = p[1] * sh; out[o + 2] = p[2] * sh; out[o + 3] = 255;
  }
  return out;
}
