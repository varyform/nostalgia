// Scorch's road: a track's closed centreline (pts in order of travel, each with the road's width
// there) made smooth and measured once, for the sim and the renderer alike. Pure, no DOM.
//
// Metres, x to the right, y DOWN; headings clockwise on screen (atan2(dy, dx)); the normal points
// to the RIGHT of travel, so a positive lateral offset is right of the centreline. The road is
// walled along its edges (left, right): the sim keeps cars within |off| ≤ w / 2.
//
//   const geo = buildTrack(TRACKS[0]);
//   geo.at(120) → { x, y, tx, ty, nx, ny, w, curv }   ·   geo.nearest(x, y, hintD) → { d, off }
//
// The samples are also exposed as typed arrays (additive: n, step, xs, ys, ws, txs, tys, ks, surf)
// for the hot loops of the sim and the AI.

export const STEP = 1; // ≈ metres between samples
export const SURFACES = ['asphalt', 'dirt', 'ice', 'oil', 'water', 'snow'];
const SURF_CODE = Object.fromEntries(SURFACES.map((k, i) => [k, i]));

const wrapTo = (d, len) => ((d % len) + len) % len;

export function buildTrack(def) {
  const P = def.pts, m = P.length;
  // a dense polyline through the points (uniform Catmull-Rom: pts come evenly spaced, so it
  // neither overshoots nor loops), about every 0.5 m
  const raw = [];
  for (let i = 0; i < m; i++) {
    const p0 = P[(i - 1 + m) % m], p1 = P[i], p2 = P[(i + 1) % m], p3 = P[(i + 2) % m];
    const k = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.5));
    for (let j = 0; j < k; j++) {
      const t = j / k, t2 = t * t, t3 = t2 * t;
      const cr = c => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
      raw.push([cr(0), cr(1), p1[2] + (p2[2] - p1[2]) * t]);
    }
  }
  const R = raw.length, cum = new Float64Array(R + 1);
  for (let i = 0; i < R; i++) {
    const a = raw[i], b = raw[(i + 1) % R];
    cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const len = cum[R];
  // resampled evenly by arc length
  const n = Math.max(16, Math.round(len / STEP)), step = len / n;
  const xs = new Float64Array(n), ys = new Float64Array(n), ws = new Float64Array(n);
  for (let i = 0, j = 0; i < n; i++) {
    const d = i * step;
    while (cum[j + 1] < d) j++;
    const a = raw[j], b = raw[(j + 1) % R], f = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
    xs[i] = a[0] + (b[0] - a[0]) * f; ys[i] = a[1] + (b[1] - a[1]) * f; ws[i] = a[2] + (b[2] - a[2]) * f;
  }
  const txs = new Float64Array(n), tys = new Float64Array(n), ks = new Float64Array(n), head = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n, dx = xs[b] - xs[a], dy = ys[b] - ys[a], l = Math.hypot(dx, dy) || 1;
    txs[i] = dx / l; tys[i] = dy / l; head[i] = Math.atan2(dy, dx);
  }
  // signed curvature (1/m, + = turning right), from the heading over ±3 samples, then smoothed
  const kr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let da = head[(i + 3) % n] - head[(i - 3 + n) % n];
    da = Math.atan2(Math.sin(da), Math.cos(da));
    kr[i] = da / (6 * step);
  }
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -3; j <= 3; j++) s += kr[(i + j + n) % n];
    ks[i] = s / 7;
  }
  // surfaces, per sample, from the stretches of centreline distance in def.surfaces
  const surf = new Uint8Array(n);
  for (const { from, to, kind } of def.surfaces || []) {
    const code = SURF_CODE[kind] ?? 0, a = wrapTo(from, len), span = wrapTo(to - from, len) || len;
    for (let d = 0; d < span; d += step) surf[Math.floor(wrapTo(a + d, len) / step) % n] = code;
  }
  const left = [], right = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const h = ws[i] / 2, nx = -tys[i], ny = txs[i];
    left.push([xs[i] - nx * h, ys[i] - ny * h]);
    right.push([xs[i] + nx * h, ys[i] + ny * h]);
    x0 = Math.min(x0, xs[i] - h); y0 = Math.min(y0, ys[i] - h); x1 = Math.max(x1, xs[i] + h); y1 = Math.max(y1, ys[i] + h);
  }
  for (const p of def.props || []) {
    x0 = Math.min(x0, p.x - p.r); y0 = Math.min(y0, p.y - p.r); x1 = Math.max(x1, p.x + p.r); y1 = Math.max(y1, p.y + p.r);
  }
  // the world: the road and its scenery with a margin of ground around them
  const bounds = { x0: x0 - 30, y0: y0 - 30, x1: x1 + 30, y1: y1 + 30 };

  // a coarse grid of sample indices for lookups without a hint
  const CELL = 16, gx = Math.ceil((bounds.x1 - bounds.x0) / CELL), gy = Math.ceil((bounds.y1 - bounds.y0) / CELL);
  const cells = new Map();
  for (let i = 0; i < n; i++) {
    const key = Math.floor((xs[i] - bounds.x0) / CELL) + Math.floor((ys[i] - bounds.y0) / CELL) * gx;
    const c = cells.get(key);
    if (c) c.push(i); else cells.set(key, [i]);
  }

  function at(d) {
    d = wrapTo(d, len);
    const f0 = d / step, i = Math.floor(f0) % n, j = (i + 1) % n, f = f0 - Math.floor(f0);
    let tx = txs[i] + (txs[j] - txs[i]) * f, ty = tys[i] + (tys[j] - tys[i]) * f;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    return {
      x: xs[i] + (xs[j] - xs[i]) * f, y: ys[i] + (ys[j] - ys[i]) * f, tx, ty, nx: -ty, ny: tx,
      w: ws[i] + (ws[j] - ws[i]) * f, curv: ks[i] + (ks[j] - ks[i]) * f,
    };
  }
  const d2 = (i, x, y) => (xs[i] - x) ** 2 + (ys[i] - y) ** 2;
  // the nearest sample: with a hint, a walk from the hinted sample down to the local minimum
  // (cars and bullets move well under a sample's spacing… times a dozen per step); without one,
  // the grid cells around the point, then every sample
  function nearestIndex(x, y, hint) {
    if (hint != null && Number.isFinite(hint)) {
      let best = Math.floor(wrapTo(hint, len) / step) % n, bd = d2(best, x, y);
      for (;;) {
        let moved = false;
        for (let k = 1; k <= 6; k++) {
          for (const j of [(best + k) % n, (best - k + n) % n]) {
            const dj = d2(j, x, y);
            if (dj < bd) { bd = dj; best = j; moved = true; }
          }
          if (moved) break;
        }
        if (!moved) return best;
      }
    }
    const cx = Math.floor((x - bounds.x0) / CELL), cy = Math.floor((y - bounds.y0) / CELL);
    let best = -1, bd = Infinity;
    for (let r = 0; r <= 3 && (best < 0 || r <= 1); r++) {
      for (let yy = cy - r; yy <= cy + r; yy++) for (let xx = cx - r; xx <= cx + r; xx++) {
        if (Math.max(Math.abs(xx - cx), Math.abs(yy - cy)) !== r || xx < 0 || yy < 0 || xx >= gx || yy >= gy) continue;
        for (const i of cells.get(xx + yy * gx) || []) { const di = d2(i, x, y); if (di < bd) { bd = di; best = i; } }
      }
    }
    if (best < 0) for (let i = 0; i < n; i++) { const di = d2(i, x, y); if (di < bd) { bd = di; best = i; } }
    return best;
  }
  // distance along and signed offset, projected onto the segment either side of the nearest sample
  function nearest(x, y, hint) {
    const i = nearestIndex(x, y, hint), j = (i + 1) % n, h = (i - 1 + n) % n;
    const proj = (a, b) => {
      const ex = xs[b] - xs[a], ey = ys[b] - ys[a], l2 = ex * ex + ey * ey || 1;
      const f = Math.max(0, Math.min(1, ((x - xs[a]) * ex + (y - ys[a]) * ey) / l2));
      const px = xs[a] + ex * f, py = ys[a] + ey * f;
      return { a, f, q: (x - px) ** 2 + (y - py) ** 2 };
    };
    const A = proj(i, j), B = proj(h, i), s = A.q <= B.q ? A : B;
    const d = wrapTo((s.a + s.f) * step, len);
    const k = s.f < 0.5 ? s.a : (s.a + 1) % n;
    return { d, off: (x - xs[k]) * -tys[k] + (y - ys[k]) * txs[k], i: k };
  }
  function surfaceAt(x, y, hint) {
    const { off, i } = nearest(x, y, hint);
    return Math.abs(off) > ws[i] / 2 ? 'off' : SURFACES[surf[i]];
  }

  const s0 = at(0);
  const start = { x: s0.x, y: s0.y, a: Math.atan2(s0.ty, s0.tx) };
  // 2×2 behind the line: front row 7 m back, the second 15 m back, a quarter-width either side
  const grid = [[-7, -1], [-7, 1], [-15, -1], [-15, 1]].map(([d, side]) => {
    const p = at(d), o = side * p.w * 0.24;
    return { x: p.x + p.nx * o, y: p.y + p.ny * o, a: Math.atan2(p.ty, p.tx), d: wrapTo(d, len), off: o };
  });

  return { def, len, at, nearest, left, right, bounds, surfaceAt, start, grid, n, step, xs, ys, ws, txs, tys, ks, surf };
}
