// A theatre's static geometry, built once per theatre: the height field as flat-shaded faces
// coloured by height, slope and water depth (the mesh is exactly the surface heightAt() reads),
// its trees and rocks, the airfields' buildings, and the decals — runways and the road — that
// lie on it. Everything is cut into 16 × 16-cell chunks so the view can skip what's behind it.
//
//   const T = buildTerrain(world);   // { data, chunks: [{ first, count, c, r }], decals: { data, count } }
import { hash2 } from '../noise.js';
import { CELL, HALF, N, V } from '../world.js';
import { hexRGB } from './gl.js';
import { box, builder, cyl, frustum } from './meshes.js';

const C = 16; // cells per chunk side
const rgb = h => hexRGB(h).map(v => v * 255);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = t => Math.min(1, Math.max(0, t));
const round = c => c.map(v => Math.max(0, Math.min(255, Math.round(v))));

// trees and rocks, a handful of faces each
function palm(B, x, y, z, s, k) {
  const lean = (k - 0.5) * 0.5;
  cyl(B, { at: [x, y, z], s, roll: lean }, 0.45, 0.3, 11, 3, '#7a6346', 255, false);
  const tx = x - Math.sin(lean) * 11 * s, ty = y + Math.cos(lean) * 11 * s;
  const leaf = rgb('#3f8a3a'), dark = rgb('#2f6d2e');
  for (let i = 0; i < 5; i++) {
    const a = i * 1.257 + k * 3, dx = Math.cos(a) * 6 * s, dz = Math.sin(a) * 6 * s, px = -Math.sin(a) * 1.6 * s, pz = Math.cos(a) * 1.6 * s;
    const top = [tx, ty + 0.6 * s, z === z ? z : 0];
    top[2] = z;
    B.tri(top, [tx + dx + px, ty - 2.6 * s, z + dz + pz], [tx + dx - px, ty - 2.6 * s, z + dz - pz], i % 2 ? leaf : dark, 255, [tx, ty - 20, z]);
  }
}
function pine(B, x, y, z, s, k) {
  const g = k > 0.5 ? '#2c4a30' : '#34553a';
  cyl(B, { at: [x, y - 1, z], s }, 4.4, 0, 11, 4, g, 255, false);
  cyl(B, { at: [x, y + 6 * s, z], s }, 3, 0, 8, 4, g, 255, false);
}
function rock(B, x, y, z, s, k, col) {
  frustum(B, { at: [x, y - 1, z], s, yaw: k * 6 }, [9, 5 + k * 9, 7], [4 + k * 3, 3], col);
}

export function buildTerrain(W) {
  const T = W.T, L = T.land, h = W.h, raw = W.raw, water = W.water;
  let top = water + 1;
  for (let k = 0; k < h.length; k++) if (h[k] > top) top = h[k];
  const span = top - water;
  const col = Object.fromEntries(Object.entries(L).map(([k, v]) => [k, rgb(v)]));
  // the colour of a dry face: bands by height above the water, rock on steep faces
  function landColour(y, ny, n) {
    const e = (y - water) / span, j = (n - 0.5) * 0.09;
    let c;
    if (T.id === 'keys') {
      if (y - water < 7) c = col.sand;
      else if (e < 0.22) c = mix(col.low, col.mid, clamp01(e / 0.22 + j * 3));
      else if (e < 0.55) c = mix(col.mid, col.high, clamp01((e - 0.22) / 0.33 + j * 2));
      else c = mix(col.rock, col.top, clamp01((e - 0.55) / 0.45));
      if (ny < 0.8 && y - water > 7) c = mix(c, col.rock, clamp01((0.8 - ny) * 3));
    } else if (T.id === 'waste') {
      // strata on the mesas, salt pale on the flats
      const band = Math.floor((y - water) / 34) % 3;
      if (ny > 0.93) c = mix(col.low, col.top, clamp01(e * 1.4 + j * 4));
      else c = band === 0 ? col.mid : band === 1 ? col.high : col.rock;
      if (y - water < 5) c = col.sand;
    } else {
      if (y - water < 6) c = col.sand;
      else if (e < 0.12) c = mix(col.low, col.mid, clamp01(e / 0.12 + j * 3));
      else if (e < 0.42) c = mix(col.mid, col.high, clamp01((e - 0.12) / 0.3 + j * 2));
      else c = mix(col.high, col.rock, clamp01((e - 0.42) / 0.2));
      // snow on what's high and not too steep
      const snow = clamp01((e - 0.5 + j * 2) * 6) * clamp01((ny - 0.55) * 5);
      c = mix(c, col.top, snow);
    }
    const shade = 1 + j * 1.4;
    return round([c[0] * shade, c[1] * shade, c[2] * shade]);
  }
  const waterCol = depth => round(mix(col.shallow, col.deep, clamp01(Math.sqrt(Math.max(0, depth) / 70))));

  const B = builder(1 << 20), chunks = [];
  const P = (i, j) => [-HALF + i * CELL, h[j * V + i], -HALF + j * CELL];
  const wetV = (i, j) => raw[j * V + i] < water + 0.5;
  const face = (pa, pb, pc, wa, wb, wc, ia, ja, ib, jb, ic, jc, n) => {
    if (wa && wb && wc) {
      const cols = [waterCol(water - raw[ja * V + ia]), waterCol(water - raw[jb * V + ib]), waterCol(water - raw[jc * V + ic])];
      B.tri(pa, pb, pc, null, 128, null, cols);
      return;
    }
    const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2], vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, Ln = Math.hypot(nx, ny, nz);
    const y = (pa[1] + pb[1] + pc[1]) / 3;
    B.tri(pa, pb, pc, wa || wb || wc ? round(col.sand) : landColour(y, ny / Ln, n));
  };
  const props = T.props;
  const rockCol = props === 'rock' ? L.rock : L.high;
  const near = (x, z) => {
    for (const s of Object.values(W.sites)) {
      if (Math.hypot(x - s.x, z - s.z) < (s.r ?? 200) * 1.3 + 60) return true;
      const R = s.runway;
      if (R && Math.hypot(x - R.x, z - R.z) < R.len / 2 + 300) return true;
    }
    if (T.road) { /* keep the road clear */ }
    return false;
  };
  for (let cj = 0; cj < N / C; cj++) for (let ci = 0; ci < N / C; ci++) {
    const first = B.n;
    let lo = Infinity, hi = -Infinity;
    for (let j = cj * C; j < cj * C + C; j++) for (let i = ci * C; i < ci * C + C; i++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i, j + 1), d = P(i + 1, j + 1);
      const wa = wetV(i, j), wb = wetV(i + 1, j), wc = wetV(i, j + 1), wd = wetV(i + 1, j + 1);
      const n = hash2(i, j, T.seed);
      // the split along a–d, as heightAt() has it
      face(a, d, b, wa, wd, wb, i, j, i + 1, j + 1, i + 1, j, n);
      face(a, c, d, wa, wc, wd, i, j, i, j + 1, i + 1, j + 1, hash2(j, i, T.seed));
      for (const p of [a, b, c, d]) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
      // a prop or two
      const pr = hash2(i * 3 + 1, j * 7 + 2, T.seed + 9);
      const x = a[0] + hash2(i, j * 5, 3) * CELL, z = a[2] + hash2(i * 5, j, 4) * CELL;
      if (wa || wb || wc || wd) continue;
      const y = W.heightAt(x, z), e = (y - water) / span;
      const dens = props === 'palm' ? (y - water > 4 && e < 0.3 ? 0.22 : 0.03) : props === 'pine' ? (e > 0.02 && e < 0.4 ? 0.3 : 0) : 0.06;
      if (pr > dens || near(x, z)) continue;
      const s = 0.9 + hash2(j, i, 11) * 0.7, k = hash2(i + 7, j + 3, 5);
      if (props === 'palm') { if (e < 0.3) palm(B, x, y, z, s, k); else rock(B, x, y, z, s, k, rockCol); }
      else if (props === 'pine') pine(B, x, y, z, s, k);
      else rock(B, x, y, z, s * (1 + k), k, k > 0.5 ? L.high : L.rock);
    }
    const cx = -HALF + (ci + 0.5) * C * CELL, cz = -HALF + (cj + 0.5) * C * CELL;
    chunks.push({ first, count: B.n - first, c: [cx, (lo + hi) / 2, cz], r: Math.hypot(C * CELL * 0.71, (hi - lo) / 2 + 30) });
  }
  // buildings: the home base and the towns (static, never targets)
  const first = B.n;
  const home = W.site('home');
  if (home?.runway) {
    const R = home.runway, f = [Math.sin(R.dir), -Math.cos(R.dir)], r = [Math.cos(R.dir), Math.sin(R.dir)];
    const at = (al, ac) => [R.x + f[0] * al + r[0] * ac, home.y, R.z + f[1] * al + r[1] * ac];
    const yaw = -R.dir;
    box(B, { at: at(0, 160).map((v, i) => (i === 1 ? v + 9 : v)), yaw }, [8, 18, 8], '#c8c2b4');
    box(B, { at: at(0, 160).map((v, i) => (i === 1 ? v + 20 : v)), yaw }, [11, 4, 11], '#3c5f78');
    for (let k = -1; k <= 1; k++) {
      const p = at(-500 + k * 70, 170);
      const n = 7, Rr = 16, Ln = 40, pts = [];
      for (let q = 0; q <= n; q++) { const a = (q / n) * Math.PI; pts.push([Math.cos(a) * Rr, Math.sin(a) * Rr * 0.7]); }
      const c = Math.cos(yaw), s = Math.sin(yaw), w = ([x, y, z]) => [p[0] + x * c + z * s, p[1] + y, p[2] - x * s + z * c];
      for (let q = 0; q < n; q++) {
        const [x0, y0] = pts[q], [x1, y1] = pts[q + 1];
        B.quad(w([x0, y0, -Ln / 2]), w([x1, y1, -Ln / 2]), w([x1, y1, Ln / 2]), w([x0, y0, Ln / 2]), round(rgb('#7c8a7a')), 255, w([0, 0, 0]));
        B.tri(w([0, 0, Ln / 2]), w([x0, y0, Ln / 2]), w([x1, y1, Ln / 2]), round(rgb('#5f6b5e')), 255, w([0, 4, 0]));
        B.tri(w([0, 0, -Ln / 2]), w([x0, y0, -Ln / 2]), w([x1, y1, -Ln / 2]), round(rgb('#5f6b5e')), 255, w([0, 4, 0]));
      }
    }
    for (const k of [0, 1]) cyl(B, { at: at(500 + k * 40, 150) }, 9, 9, 8, 10, '#dad6cc');
  }
  for (const s of Object.values(W.sites)) {
    if (s.name !== 'town' && s.name !== 'copperwell' && s.name !== 'ember') continue;
    if (s.name === 'ember') continue;
    for (let k = 0; k < 26; k++) {
      const a = hash2(k, 1, 77) * Math.PI * 2, d = 60 + hash2(k, 2, 77) * (s.r ?? 400) * 0.8;
      const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d, y = W.heightAt(x, z), yaw = hash2(k, 3, 7) * 3;
      const w = 10 + hash2(k, 4, 7) * 10;
      box(B, { at: [x, y + 3, z], yaw }, [w, 6, 9], k % 3 ? '#d9cdb5' : '#c9b79a');
      frustum(B, { at: [x, y + 6, z], yaw }, [w + 1, 3.5, 10], [w + 1, 0.4], k % 2 ? '#8e3f2f' : '#6b5246');
    }
  }
  chunks.push({ first, count: B.n - first, c: [0, water, 0], r: HALF * 1.5, always: true });

  // decals on the ground: runways (asphalt, edge and centre lines) and the salt road
  const D = builder(16384);
  const dark = round(rgb('#3d3f42')), paint = round(rgb('#e8e8e0'));
  for (const s of Object.values(W.sites)) {
    const R = s.runway;
    if (!R) continue;
    const f = [Math.sin(R.dir), -Math.cos(R.dir)], r = [Math.cos(R.dir), Math.sin(R.dir)];
    const pt = (al, ac, y = 0.35) => [R.x + f[0] * al + r[0] * ac, s.y + y, R.z + f[1] * al + r[1] * ac];
    const rect = (a0, a1, c0, c1, colr, y) => D.quad(pt(a0, c0, y), pt(a0, c1, y), pt(a1, c1, y), pt(a1, c0, y), colr, 255, pt((a0 + a1) / 2, (c0 + c1) / 2, y - 10));
    rect(-R.len / 2, R.len / 2, -R.wid / 2, R.wid / 2, dark, 0.3);
    for (let a = -R.len / 2 + 80; a < R.len / 2 - 80; a += 60) rect(a, a + 30, -0.9, 0.9, paint, 0.45);
    for (const e of [-1, 1]) {
      rect(-R.len / 2, R.len / 2, e * R.wid / 2 - e * 1.6, e * R.wid / 2 - e * 0.4, paint, 0.45);
      for (let k = -3; k <= 3; k++) if (k) rect(e * (R.len / 2 - 50) - 25, e * (R.len / 2 - 50) + 25, k * 7 - 2, k * 7 + 2, paint, 0.45);
    }
    // the apron
    if (s.name === 'home') rect(-620, -380, R.wid / 2 + 40, R.wid / 2 + 150, round(rgb('#5a5c5c')), 0.3);
  }
  if (T.road) {
    const road = round(rgb('#86684c')), step = 50;
    const pts = T.road;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [x0, z0] = pts[k], [x1, z1] = pts[k + 1], Ls = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(Ls / step);
      const dx = (x1 - x0) / Ls, dz = (z1 - z0) / Ls, px = -dz * 6, pz = dx * 6;
      for (let q = 0; q < n; q++) {
        const xa = x0 + dx * q * step, za = z0 + dz * q * step, xb = x0 + dx * Math.min(Ls, (q + 1) * step), zb = z0 + dz * Math.min(Ls, (q + 1) * step);
        const ya = (x, z) => W.heightAt(x, z) + 0.5;
        const A = [xa - px, ya(xa - px, za - pz), za - pz], Bp = [xa + px, ya(xa + px, za + pz), za + pz];
        const Cp = [xb + px, ya(xb + px, zb + pz), zb + pz], Dp = [xb - px, ya(xb - px, zb - pz), zb - pz];
        D.quad(A, Bp, Cp, Dp, road, 255, [(xa + xb) / 2, ya(xa, za) - 10, (za + zb) / 2]);
      }
    }
  }
  return { data: B.data(), chunks, decals: { data: D.data(), count: D.n }, top };
}

/** a top-down picture of the theatre for the briefing map: w × w RGBA pixels */
export function mapImage(W, w = 256) {
  const T = W.T, L = T.land, out = new Uint8ClampedArray(w * w * 4), water = W.water;
  let top = water + 1;
  for (let k = 0; k < W.h.length; k++) if (W.h[k] > top) top = W.h[k];
  const deep = rgb(L.deep), shallow = rgb(L.shallow), lo = rgb(L.low), hi = rgb(T.id === 'spires' ? L.top : L.high), sand = rgb(L.sand);
  for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
    const x = -HALF + ((i + 0.5) / w) * HALF * 2, z = -HALF + ((j + 0.5) / w) * HALF * 2;
    const y = W.heightAt(x, z), gi = Math.round((x + HALF) / CELL), gj = Math.round((z + HALF) / CELL);
    const r = W.raw[Math.min(N, gj) * V + Math.min(N, gi)];
    let c;
    if (r < water + 0.5) c = mix(shallow, deep, clamp01(Math.sqrt((water - r) / 70)));
    else if (y - water < 6) c = sand;
    else c = mix(lo, hi, clamp01((y - water) / (top - water)));
    // relief shading from the north-west
    const sl = W.heightAt(x - 120, z - 120) - y;
    const sh = 1 - clamp01(sl / 90) * 0.35 + clamp01(-sl / 90) * 0.15;
    const o = (j * w + i) * 4;
    out[o] = c[0] * sh; out[o + 1] = c[1] * sh; out[o + 2] = c[2] * sh; out[o + 3] = 255;
  }
  return out;
}
