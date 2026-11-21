// The track as the race sees it from above, painted once per track and size into square chunks
// that are cached (least recently used go first) and painted on demand within a time budget, a
// whole-world low-resolution copy standing in for any chunk not painted yet. A chunk holds the
// theme's ground (sand and rock, harbour concrete, snowfields, city rooftops), the run-off and
// shoulders, the road (asphalt texture, wear, patches, lines, kerbs, the start line and grid),
// the surfaces (dirt, ice, oil, puddles, snow), the barriers along both edges, the props, the
// city's baked light pools and wet reflections, and the decals: skid marks and scorch marks are
// kept as a list in world metres and drawn into every cached chunk they touch, so they persist
// and come back when a chunk is painted again. Tall things that stand over the cars (crane
// booms, lamp heads, billboards) are drawn per frame by tops().
//
//   const W = createWorld(geo, P0);            // P0: pixels per metre at zoom 1
//   W.draw(g, view)   // view = { x, y (world centre), P (px/m now), cw, ch, sx, sy (shake px) }
//   W.skid(x0, y0, x1, y1, width, a, col)   W.scorch(x, y, r)   W.tops(g, view, t)
import { drawCar } from './cars.js';
import { TAU, alpha, canvas, hash, mix, rng, shadeOf, strHash } from './gfx.js';

// ---------- the four settings ----------
export const THEMES = {
  canyon: {
    ground: '#b4623c', ground2: '#9c4c2e', grain: ['#d68c5c', '#7a3420', '#c87448'], asphalt: '#5b5552', asGrain: ['#7a726c', '#3e3a38', '#6a5e56'],
    line: '#e6dccb', centre: '#d9a63a', shoulder: '#a8704a', gravel: '#b98a62', wall: 'rock', rock: ['#9a4428', '#6e2c1a', '#c06a40'],
    shadow: 'rgba(70,22,8,0.38)', dust: '#cf9466', kerb: ['#e8e2d6', '#c8321e'], light: 0,
  },
  docks: {
    ground: '#6e706d', ground2: '#5f625f', grain: ['#8a8c88', '#4a4c4a', '#7a6a58'], asphalt: '#3c3f43', asGrain: ['#55585c', '#2a2c30', '#4a4846'],
    line: '#d8d8cc', centre: '#e0b228', shoulder: '#575a5a', gravel: '#77736a', wall: 'jersey', rock: ['#6a6a66', '#4a4a48', '#8a8a84'],
    shadow: 'rgba(12,18,26,0.42)', dust: '#9a9c98', kerb: ['#e6e2d4', '#d8a81c'], light: 0, wet: 1,
  },
  pass: {
    ground: '#e4ebf2', ground2: '#cfdbe8', grain: ['#ffffff', '#b4c4d8', '#c8d6e6'], asphalt: '#4f555d', asGrain: ['#6a7078', '#363a40', '#8a929c'],
    line: '#f2f4f6', centre: '#e8c44a', shoulder: '#c4d0de', gravel: '#b4c0cc', wall: 'armco', rock: ['#6a6e76', '#4a4e56', '#8e949c'],
    shadow: 'rgba(40,64,110,0.32)', dust: '#f4f8ff', kerb: ['#f2f2f2', '#2a6ad0'], light: 0,
  },
  city: {
    ground: '#1d1c24', ground2: '#17161d', grain: ['#2c2a34', '#121117', '#26242e'], asphalt: '#1e1f25', asGrain: ['#2c2d34', '#131418', '#272830'],
    line: '#c9c9d2', centre: '#d0d0d8', shoulder: '#2e2c36', gravel: '#34323c', wall: 'neon', rock: ['#3a3844', '#2a2832', '#4a4854'],
    shadow: 'rgba(0,0,0,0.5)', dust: '#6a6a74', kerb: ['#d8d8de', '#e0287a'], light: 1, wet: 1, neon: ['#ff2f8f', '#22e4ff', '#ffb02a', '#9a5cff'],
  },
};
const TALL = new Set(['crane', 'lamp', 'billboard']);
const CPX = 512, PAD = 2; // chunk size in pixels and its bleed on each side

// ---------- tileable textures (seamless: anything near an edge is drawn again a tile over) ----------
function texture(base, grains, P0, { tile = 6, blot = 0.12, grit = 1, streak = 0, seed = 1 } = {}) {
  const px = Math.min(512, Math.max(32, Math.round(tile * P0))), c = canvas(px, px), g = c.getContext('2d'), R = rng(seed), s = px / tile;
  g.fillStyle = base; g.fillRect(0, 0, px, px);
  const wrap = fn => { for (const ox of [-px, 0, px]) for (const oy of [-px, 0, px]) fn(ox, oy); };
  // soft blotches of the grain colours
  for (let i = 0; i < 26; i++) {
    const x = R() * px, y = R() * px, r = (0.4 + R() * 1.4) * s, col = grains[i % grains.length], a = blot * (0.4 + R() * 0.6);
    wrap((ox, oy) => { const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); gr.addColorStop(0, alpha(col, a)); gr.addColorStop(1, alpha(col, 0)); g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2); });
  }
  // grit: specks of a centimetre or three
  const n = Math.round(px * px * 0.012 * grit);
  for (let i = 0; i < n; i++) {
    const x = R() * px, y = R() * px, r = Math.max(0.6, (0.01 + R() * 0.025) * s);
    g.fillStyle = alpha(grains[(R() * grains.length) | 0], 0.25 + R() * 0.45); g.fillRect(x, y, r, r);
  }
  if (streak) { // wind or plough streaks
    g.strokeStyle = alpha(grains[0], 0.12 * streak); g.lineWidth = Math.max(1, 0.04 * s);
    for (let i = 0; i < 14; i++) { const x = R() * px, y = R() * px, l = (0.6 + R() * 1.6) * s; wrap((ox, oy) => { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + l, y + oy + l * 0.1); g.stroke(); }); }
  }
  return c;
}

export function createWorld(geo, P0, { quality = 1 } = {}) {
  const def = geo.def, th = THEMES[def.theme] ?? THEMES.canyon, theme = def.theme in THEMES ? def.theme : 'canyon';
  const seed = strHash(def.id ?? def.name ?? 'track');
  const B = geo.bounds, len = geo.len;

  // ---------- the centreline, sampled every metre ----------
  const n = Math.max(16, Math.round(len)), step = len / n, S = [];
  for (let i = 0; i < n; i++) { const p = geo.at(i * step); S.push({ x: p.x, y: p.y, nx: -p.ty, ny: p.tx, w: p.w, k: p.curv ?? 0, d: i * step }); }
  // smoothed curvature, to find the corners
  const K = S.map((_, i) => { let s = 0; for (let j = -4; j <= 4; j++) s += S[(i + j + n) % n].k; return s / 9; });
  const off = (i, o) => { const p = S[(i + n) % n]; return [p.x + p.nx * o, p.y + p.ny * o]; };
  const loop = (fo, closed = true, i0 = 0, i1 = n) => {
    const path = new Path2D();
    for (let i = i0; i <= i1 - (closed ? 1 : 0); i++) { const [x, y] = off(i, fo(S[(i + n) % n], (i + n) % n)); if (i === i0) path.moveTo(x, y); else path.lineTo(x, y); }
    if (closed) path.closePath();
    return path;
  };
  const roadPath = loop(p => -p.w / 2); roadPath.addPath(loop(p => p.w / 2));
  // corner stretches (contiguous samples turning hard), with the side on their outside
  const corners = [];
  for (let i = 0, on = false, c = null; i < n * 2 && corners.length < 80; i++) {
    const hard = Math.abs(K[i % n]) > 1 / 42;
    if (hard && !on) { if (i >= n) break; c = { i0: i - 3, i1: i, dir: Math.sign(K[i % n]) }; on = true; }
    else if (hard) c.i1 = i;
    else if (on) { c.i1 += 4; corners.push(c); on = false; if (i >= n) break; }
  }
  const sharp = corners.filter(c => { let m = 0; for (let i = c.i0; i <= c.i1; i++) m = Math.max(m, Math.abs(K[(i + n) % n])); return m > 1 / 30; });

  // ---------- spatial lookups: samples by cell, distance from the road's edge ----------
  const CELL = 24, buckets = new Map();
  const bucket = (x, y) => Math.floor(x / CELL) + ',' + Math.floor(y / CELL);
  S.forEach((p, i) => { const k = bucket(p.x, p.y); (buckets.get(k) ?? buckets.set(k, []).get(k)).push(i); });
  function samplesIn(x0, y0, x1, y1) {
    const out = [];
    for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (const i of buckets.get(cx + ',' + cy) ?? []) out.push(i);
    return out.sort((a, b) => a - b);
  }
  const DG = 2, GX0 = B.x0 - 40, GY0 = B.y0 - 40, GW = Math.ceil((B.x1 - B.x0 + 80) / DG), GH = Math.ceil((B.y1 - B.y0 + 80) / DG);
  const dist = new Float32Array(GW * GH).fill(99);
  {
    const R = 34;
    for (const p of S) {
      const cx = (p.x - GX0) / DG, cy = (p.y - GY0) / DG, r = R / DG;
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(GH - 1, Math.ceil(cy + r)); y++)
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(GW - 1, Math.ceil(cx + r)); x++) {
          const d = Math.hypot(x * DG + GX0 - p.x, y * DG + GY0 - p.y) - p.w / 2, k = x + y * GW;
          if (d < dist[k]) dist[k] = d;
        }
    }
  }
  /** metres outside the road's edge (negative on the road) */
  const edge = (x, y) => { const gx = Math.round((x - GX0) / DG), gy = Math.round((y - GY0) / DG); return gx < 0 || gy < 0 || gx >= GW || gy >= GH ? 99 : dist[gx + gy * GW]; };

  // the props by cell, tall ones also kept apart for tops()
  const props = (def.props ?? []).map((p, i) => ({ ...p, i, R: hash(seed, i) }));
  const propIn = (x0, y0, x1, y1, m = 12) => props.filter(p => p.x > x0 - m && p.x < x1 + m && p.y > y0 - m && p.y < y1 + m);
  const tall = props.filter(p => TALL.has(p.kind));
  const lights = []; // city: [x, y, r, colour, strength]
  if (th.light) for (const p of props) {
    if (p.kind === 'lamp') lights.push({ x: p.x, y: p.y, r: 11, c: '#ffb868', k: 0.55, p });
    if (p.kind === 'billboard') lights.push({ x: p.x, y: p.y, r: 14, c: th.neon[p.i % th.neon.length], k: 0.5, p });
    if (p.kind === 'kiosk') lights.push({ x: p.x, y: p.y, r: 7, c: th.neon[(p.i + 1) % th.neon.length], k: 0.35, p });
  }

  // ---------- textures and patterns (pattern pixels are 1/P0 m: chunks draw in metres) ----------
  const T = {
    ground: texture(th.ground, th.grain, P0, { tile: 8, blot: 0.22, grit: theme === 'pass' ? 0.3 : 1.2, streak: theme === 'canyon' || theme === 'pass' ? 1 : 0, seed: seed + 1 }),
    asphalt: texture(th.asphalt, th.asGrain, P0, { tile: 6, blot: 0.1, grit: 2, seed: seed + 2 }),
    gravel: texture(th.gravel, [shadeOf(th.gravel, 0.3), shadeOf(th.gravel, -0.35), th.shoulder], P0, { tile: 4, blot: 0.15, grit: 5, seed: seed + 3 }),
    dirt: texture('#8a5a36', ['#b07a4a', '#5e3a20', '#9a6a40'], P0, { tile: 5, blot: 0.25, grit: 3, seed: seed + 4 }),
    snow: texture('#e8eef5', ['#ffffff', '#c2d0e0', '#d6e0ec'], P0, { tile: 6, blot: 0.3, grit: 0.4, streak: 1, seed: seed + 5 }),
  };
  const pats = {};
  const pat = (g, k) => {
    let p = pats[k];
    if (!p) { p = g.createPattern(T[k], 'repeat'); p.setTransform?.(new DOMMatrix().scale(1 / P0)); pats[k] = p; }
    return p;
  };

  // ---------- painting a chunk ----------
  const C = CPX / P0; // a chunk's size in metres
  // decals: [kind, …] in world metres
  const decals = [];
  function drawDecal(g, d) {
    if (d[0] === 0) { // a skid: a dark (or a surface's own) streak
      g.strokeStyle = d[7]; g.lineWidth = d[5];
      g.beginPath(); g.moveTo(d[1], d[2]); g.lineTo(d[3], d[4]); g.stroke();
    } else if (d[0] === 1) { // a scorch mark: a black star of soot
      const [, x, y, r, sd] = d, R = rng(sd);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(8,6,5,0.75)'); gr.addColorStop(0.5, 'rgba(12,8,6,0.45)'); gr.addColorStop(1, 'rgba(12,8,6,0)');
      g.fillStyle = gr; g.beginPath();
      for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU, rr = r * (0.55 + R() * 0.55); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      g.fill();
    }
  }

  function paint(g, X0, Y0, W, H, lod) {
    // g is set to world metres; [X0, Y0, W, H] the area to cover
    const X1 = X0 + W, Y1 = Y0 + H, R = rng(seed);
    g.fillStyle = pat(g, 'ground'); g.fillRect(X0, Y0, W, H);
    ground(g, X0, Y0, X1, Y1, lod);
    // gravel traps behind the barriers on the outside of the sharp corners
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const c of sharp) {
      const o = -c.dir;
      g.strokeStyle = pat(g, 'gravel'); g.lineWidth = 7;
      g.stroke(loop(p => o * (p.w / 2 + 4.2), false, c.i0 - 6, c.i1 + 6));
    }
    // shoulders right behind the barriers
    g.strokeStyle = th.shoulder; g.lineWidth = 4.4;
    g.stroke(roadPath);
    if (theme === 'pass') { g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 6.5; g.stroke(loop(p => -p.w / 2 - 1.2)); g.stroke(loop(p => p.w / 2 + 1.2)); }
    // props on the ground (their shadows first)
    const near = propIn(X0, Y0, X1, Y1);
    for (const p of near) prop(g, p, true);
    for (const p of near) prop(g, p, false);
    // the road
    g.fillStyle = pat(g, 'asphalt'); g.fill(roadPath, 'evenodd');
    if (!lod) roadDetail(g, X0, Y0, X1, Y1, R);
    lines(g, X0, Y0, X1, Y1);
    surfaces(g, X0, Y0, X1, Y1, lod);
    barriers(g, X0, Y0, X1, Y1, lod);
    if (th.light) glowPools(g, X0, Y0, X1, Y1);
    for (const d of decals) if (d[8] >= X0 - 2 && d[8] <= X1 + 2 && d[9] >= Y0 - 2 && d[9] <= Y1 + 2) drawDecal(g, d);
    g.lineCap = 'butt'; g.lineJoin = 'miter';
  }

  // the ground beyond the road: scattered by world cells, so chunks meet seamlessly
  function cells(X0, Y0, X1, Y1, size, m, fn) {
    for (let j = Math.floor((Y0 - m) / size); j <= Math.floor((Y1 + m) / size); j++)
      for (let i = Math.floor((X0 - m) / size); i <= Math.floor((X1 + m) / size); i++) fn(i, j, rng(seed * 7 + i * 92821 + j * 68917));
  }
  function ground(g, X0, Y0, X1, Y1, lod) {
    if (theme === 'canyon') {
      cells(X0, Y0, X1, Y1, 14, 10, (i, j, R) => { // darker drifts and pale sand
        const x = (i + R()) * 14, y = (j + R()) * 14, r = 5 + R() * 9;
        const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, alpha(R() < 0.5 ? th.ground2 : '#cf8a5a', 0.35)); gr.addColorStop(1, alpha(th.ground, 0));
        g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
      });
      if (lod) return;
      cells(X0, Y0, X1, Y1, 9, 6, (i, j, R) => { // outcrops of layered red rock, away from the road
        const x = (i + R()) * 9, y = (j + R()) * 9;
        if (R() < 0.5 || edge(x, y) < 9) return;
        outcrop(g, x, y, 2 + R() * 3.5, R);
      });
      cells(X0, Y0, X1, Y1, 4, 2, (i, j, R) => { // pebbles and scrub
        const x = (i + R()) * 4, y = (j + R()) * 4, e = edge(x, y);
        if (e < 3) return;
        if (R() < 0.3) scrub(g, x, y, 0.5 + R() * 0.6, R);
        else { g.fillStyle = alpha(th.rock[1], 0.5); g.beginPath(); g.ellipse(x, y, 0.15 + R() * 0.25, 0.1 + R() * 0.15, R() * 3, 0, TAU); g.fill(); }
      });
    } else if (theme === 'docks') {
      // concrete slabs: expansion joints every 6 m, a few slabs a shade apart, stains
      cells(X0, Y0, X1, Y1, 6, 0, (i, j, R) => {
        const v = R();
        if (v < 0.35) { g.fillStyle = v < 0.17 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)'; g.fillRect(i * 6, j * 6, 6, 6); }
      });
      g.strokeStyle = 'rgba(30,32,34,0.45)'; g.lineWidth = 0.06; g.beginPath();
      for (let x = Math.floor(X0 / 6) * 6; x <= X1; x += 6) { g.moveTo(x, Y0); g.lineTo(x, Y1); }
      for (let y = Math.floor(Y0 / 6) * 6; y <= Y1; y += 6) { g.moveTo(X0, y); g.lineTo(X1, y); }
      g.stroke();
      if (lod) return;
      cells(X0, Y0, X1, Y1, 10, 6, (i, j, R) => {
        const x = (i + R()) * 10, y = (j + R()) * 10, e = edge(x, y), v = R();
        if (e < 2.5) return;
        if (v < 0.35) { const r = 1 + R() * 2.5, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(10,10,12,0.4)'); gr.addColorStop(1, 'rgba(10,10,12,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
        else if (v < 0.55) { const r = 1.2 + R() * 2; g.fillStyle = 'rgba(122,70,36,0.22)'; g.beginPath(); g.ellipse(x, y, r, r * 0.6, R() * 3, 0, TAU); g.fill(); }
        else if (v < 0.75) puddle(g, x, y, 1 + R() * 2.4, R);
        else if (v < 0.85) { // painted bay lines
          g.save(); g.translate(x, y); g.rotate(Math.round(R() * 4) * Math.PI / 2); g.fillStyle = 'rgba(224,178,40,0.55)';
          for (let k = 0; k < 4; k++) g.fillRect(k * 2.6, 0, 0.12, 5); g.fillRect(0, 0, 7.92, 0.12); g.restore();
        } else { g.fillStyle = '#3e3e3c'; g.beginPath(); g.arc(x, y, 0.45, 0, TAU); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 0.05; g.stroke(); }
      });
      cells(X0, Y0, X1, Y1, 5, 3, (i, j, R) => { // hairline cracks
        const x = (i + R()) * 5, y = (j + R()) * 5;
        if (R() < 0.6) return;
        g.strokeStyle = 'rgba(20,20,22,0.35)'; g.lineWidth = 0.035; g.beginPath(); g.moveTo(x, y);
        let a = R() * TAU, px = x, py = y; for (let k = 0; k < 5; k++) { a += (R() - 0.5) * 1.2; px += Math.cos(a) * 0.6; py += Math.sin(a) * 0.6; g.lineTo(px, py); } g.stroke();
      });
    } else if (theme === 'pass') {
      cells(X0, Y0, X1, Y1, 12, 10, (i, j, R) => { // drifts: blue shade on one side, bright on the other
        const x = (i + R()) * 12, y = (j + R()) * 12, r = 3 + R() * 6, a = R() * 0.6;
        g.fillStyle = 'rgba(150,176,210,0.22)'; g.beginPath(); g.ellipse(x + r * 0.15, y + r * 0.2, r, r * 0.45, a, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.ellipse(x, y, r * 0.9, r * 0.38, a, 0, TAU); g.fill();
      });
      if (lod) return;
      cells(X0, Y0, X1, Y1, 8, 6, (i, j, R) => { // rocks poking through
        const x = (i + R()) * 8, y = (j + R()) * 8;
        if (R() < 0.55 || edge(x, y) < 4) return;
        outcrop(g, x, y, 0.8 + R() * 1.8, R, true);
      });
      cells(X0, Y0, X1, Y1, 3, 1, (i, j, R) => { // twigs and dark grit in the snow
        const x = (i + R()) * 3, y = (j + R()) * 3;
        if (R() < 0.6 || edge(x, y) < 2) return;
        g.strokeStyle = 'rgba(70,60,56,0.45)'; g.lineWidth = 0.04; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 0.8, y + (R() - 0.5) * 0.8); g.stroke();
      });
    } else if (theme === 'city') {
      // streets and blocks: rooftops on a 26 m grid wherever the road leaves room
      cells(X0, Y0, X1, Y1, 26, 0, (i, j, R) => {
        const x = i * 26, y = j * 26;
        const clear = [[0, 0], [26, 0], [0, 26], [26, 26], [13, 13]].every(([a, b]) => edge(x + a, y + b) > 6);
        if (!clear) return;
        building(g, x + 2.5, y + 2.5, 21, 21, R, lod);
      });
      if (lod) return;
      // lane paint on the side streets
      g.strokeStyle = 'rgba(200,200,210,0.12)'; g.lineWidth = 0.15; g.setLineDash([2, 2.5]); g.beginPath();
      for (let x = Math.floor(X0 / 26) * 26; x <= X1; x += 26) { g.moveTo(x + 0.2, Y0); g.lineTo(x + 0.2, Y1); }
      for (let y = Math.floor(Y0 / 26) * 26; y <= Y1; y += 26) { g.moveTo(X0, y + 0.2); g.lineTo(X1, y + 0.2); }
      g.stroke(); g.setLineDash([]);
    }
  }
  function outcrop(g, x, y, r, R, snow = false) {
    const pts = [], m = 7 + ((R() * 4) | 0);
    for (let k = 0; k < m; k++) { const a = (k / m) * TAU + R() * 0.4, rr = r * (0.7 + R() * 0.4); pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8]); }
    const poly = (dx, dy, s = 1) => { g.beginPath(); pts.forEach(([px, py], k) => (k ? g.lineTo : g.moveTo).call(g, x + (px - x) * s + dx, y + (py - y) * s + dy)); g.closePath(); };
    g.fillStyle = th.shadow; poly(r * 0.35, r * 0.45); g.fill();
    g.fillStyle = th.rock[1]; poly(0, 0); g.fill();
    g.fillStyle = th.rock[0]; poly(-r * 0.08, -r * 0.1, 0.8); g.fill();
    g.fillStyle = snow ? 'rgba(255,255,255,0.92)' : th.rock[2]; poly(-r * 0.18, -r * 0.2, snow ? 0.6 : 0.5); g.fill();
    if (!snow) { g.strokeStyle = alpha(th.rock[1], 0.6); g.lineWidth = 0.06; for (let k = 1; k < 3; k++) { g.beginPath(); g.ellipse(x - r * 0.05, y - r * 0.05, r * 0.3 * k, r * 0.24 * k, 0.3, 3.6, 5.6); g.stroke(); } }
  }
  function scrub(g, x, y, r, R) {
    g.fillStyle = th.shadow; g.beginPath(); g.arc(x + r * 0.3, y + r * 0.4, r, 0, TAU); g.fill();
    for (let k = 0; k < 6; k++) { g.fillStyle = k < 3 ? '#5c5a2a' : '#7c7a3a'; g.beginPath(); g.arc(x + (R() - 0.5) * r, y + (R() - 0.5) * r, r * (0.35 + R() * 0.3), 0, TAU); g.fill(); }
  }
  function puddle(g, x, y, r, R) {
    const pts = [], m = 9;
    for (let k = 0; k < m; k++) { const a = (k / m) * TAU, rr = r * (0.6 + R() * 0.5); pts.push([x + Math.cos(a) * rr * 1.3, y + Math.sin(a) * rr * 0.8]); }
    g.beginPath(); pts.forEach(([px, py], k) => { const q = pts[(k + 1) % m]; if (!k) g.moveTo((px + pts[m - 1][0]) / 2, (py + pts[m - 1][1]) / 2); g.quadraticCurveTo(px, py, (px + q[0]) / 2, (py + q[1]) / 2); }); g.closePath();
    const city = theme === 'city';
    g.fillStyle = city ? 'rgba(8,8,16,0.55)' : 'rgba(40,52,64,0.6)'; g.fill();
    g.strokeStyle = city ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.2)'; g.lineWidth = 0.1; g.stroke();
    // the sky (or the city's neon) caught in it
    g.save(); g.clip();
    const gr = g.createLinearGradient(x - r, y - r, x + r, y + r);
    if (city) { const c = th.neon[(R() * th.neon.length) | 0]; gr.addColorStop(0, alpha(c, 0.28)); gr.addColorStop(0.45, alpha(c, 0.04)); gr.addColorStop(0.7, 'rgba(160,180,255,0.1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); }
    else { gr.addColorStop(0, 'rgba(190,210,230,0.32)'); gr.addColorStop(0.5, 'rgba(190,210,230,0.06)'); gr.addColorStop(1, 'rgba(190,210,230,0.2)'); }
    g.fillStyle = gr; g.fillRect(x - r * 2, y - r * 2, r * 4, r * 4); g.restore();
  }
  function building(g, x, y, w, h, R, lod) {
    // the block split into one to three buildings of different heights; shadows fall down-right
    const parts = R() < 0.4 ? [[0, 0, w, h]] : R() < 0.5 ? [[0, 0, w * 0.55, h], [w * 0.58, 0, w * 0.42, h]] : [[0, 0, w, h * 0.45], [0, h * 0.48, w * 0.5, h * 0.52], [w * 0.53, h * 0.48, w * 0.47, h * 0.52]];
    for (const [px, py, pw, ph] of parts) {
      const hgt = 1.5 + R() * 4, bx = x + px, by = y + py;
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(bx + hgt * 0.5, by + hgt * 0.7, pw, ph);
      const roofs = ['#2a2933', '#302e3a', '#26252e', '#34323c', '#2d2a2a'];
      g.fillStyle = roofs[(R() * roofs.length) | 0]; g.fillRect(bx, by, pw, ph);
      g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 0.35; g.strokeRect(bx + 0.2, by + 0.2, pw - 0.4, ph - 0.4);
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.1; g.strokeRect(bx, by, pw, ph);
      if (lod) continue;
      for (let k = 0; k < 3 + R() * 4; k++) { // AC units, vents, skylights
        const ux = bx + 1 + R() * (pw - 3.5), uy = by + 1 + R() * (ph - 3.5), v = R();
        if (v < 0.5) { g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(ux + 0.3, uy + 0.4, 1.6, 1.2); g.fillStyle = '#4a4854'; g.fillRect(ux, uy, 1.6, 1.2); g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.05; g.beginPath(); g.arc(ux + 0.8, uy + 0.6, 0.4, 0, TAU); g.stroke(); }
        else if (v < 0.8) { const lit = R() < 0.5; g.fillStyle = lit ? 'rgba(255,200,120,0.55)' : 'rgba(120,150,190,0.35)'; g.fillRect(ux, uy, 2.2, 1.4); g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 0.08; g.strokeRect(ux, uy, 2.2, 1.4); }
        else { g.fillStyle = '#3a3844'; g.beginPath(); g.arc(ux + 0.5, uy + 0.5, 0.5, 0, TAU); g.fill(); }
      }
      if (R() < 0.5) { // light from the street below spilling over one edge
        const c = R() < 0.6 ? '#ffb868' : th.neon[(R() * th.neon.length) | 0], side = (R() * 4) | 0;
        const [lx, ly, lw, lh] = [[bx, by + ph - 1.6, pw, 1.6], [bx, by, pw, 1.6], [bx, by, 1.6, ph], [bx + pw - 1.6, by, 1.6, ph]][side];
        const gr = side === 0 ? g.createLinearGradient(0, ly + lh, 0, ly) : side === 1 ? g.createLinearGradient(0, ly, 0, ly + lh) : side === 2 ? g.createLinearGradient(lx, 0, lx + lw, 0) : g.createLinearGradient(lx + lw, 0, lx, 0);
        gr.addColorStop(0, alpha(c, 0.22)); gr.addColorStop(1, alpha(c, 0));
        g.fillStyle = gr; g.fillRect(lx, ly, lw, lh);
      }
      if (R() < 0.3) { // a water tank or a helipad ring
        const tx = bx + 2 + R() * (pw - 6), ty = by + 2 + R() * (ph - 6);
        if (R() < 0.6) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.arc(tx + 2.2, ty + 2.5, 1.6, 0, TAU); g.fill(); g.fillStyle = '#4a3a30'; g.beginPath(); g.arc(tx + 1.6, ty + 1.6, 1.6, 0, TAU); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 0.1; g.beginPath(); g.arc(tx + 1.6, ty + 1.6, 1.1, 0, TAU); g.stroke(); }
        else if (pw > 9 && ph > 9) { const hx = bx + pw / 2, hy = by + ph / 2; g.strokeStyle = 'rgba(230,230,240,0.35)'; g.lineWidth = 0.25; g.beginPath(); g.arc(hx, hy, 3.4, 0, TAU); g.stroke(); g.fillStyle = 'rgba(230,230,240,0.35)'; g.fillRect(hx - 1.3, hy - 1.6, 0.35, 3.2); g.fillRect(hx + 0.95, hy - 1.6, 0.35, 3.2); g.fillRect(hx - 1.3, hy - 0.18, 2.6, 0.36); for (let k = 0; k < 8; k++) { const an = (k / 8) * TAU; g.fillStyle = 'rgba(120,255,140,0.8)'; g.beginPath(); g.arc(hx + Math.cos(an) * 4, hy + Math.sin(an) * 4, 0.12, 0, TAU); g.fill(); } }
      }
      if (R() < 0.45) { // a rooftop neon sign along one edge, glowing
        const c = th.neon[(R() * th.neon.length) | 0], vert = R() < 0.5, sx = vert ? bx + 0.6 : bx + pw * 0.2, sy = vert ? by + ph * 0.2 : by + 0.6, sw = vert ? 0.25 : pw * 0.6, sh = vert ? ph * 0.6 : 0.25;
        g.globalCompositeOperation = 'lighter'; g.fillStyle = alpha(c, 0.18); g.fillRect(sx - 1.2, sy - 1.2, sw + 2.4, sh + 2.4); g.globalCompositeOperation = 'source-over';
        g.fillStyle = mix(c, '#ffffff', 0.5); g.fillRect(sx, sy, sw, sh);
      }
    }
  }
  // the road's wear: a rubbered racing line, repair patches, cracks, and (city) manhole covers
  function roadDetail(g, X0, Y0, X1, Y1) {
    const idx = samplesIn(X0 - 20, Y0 - 20, X1 + 20, Y1 + 20);
    if (!idx.length) return;
    g.strokeStyle = theme === 'pass' ? 'rgba(30,34,40,0.16)' : 'rgba(10,10,10,0.13)'; g.lineWidth = 3.2;
    g.stroke(racing);
    g.strokeStyle = 'rgba(10,10,10,0.06)'; g.lineWidth = 7; g.stroke(racing);
    for (const i of idx) {
      const p = S[i], h = hash(seed + 11, i);
      if (h < 0.02) { // a patch of newer asphalt, square to the road, its seams tarred
        const o = (hash(seed, i * 3) - 0.5) * p.w * 0.5, [x, y] = off(i, o), l = 1.5 + hash(i, 5) * 3, w = 1.2 + hash(i, 6) * 2;
        g.save(); g.translate(x, y); g.rotate(Math.atan2(p.ny, p.nx) - Math.PI / 2);
        g.fillStyle = 'rgba(14,14,16,0.1)'; g.fillRect(-l / 2, -w / 2, l, w); g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 0.07; g.strokeRect(-l / 2, -w / 2, l, w); g.restore();
      } else if (h < 0.09) { // a crack wandering across
        const R = rng(seed + i); let [x, y] = off(i, (R() - 0.5) * p.w * 0.8), a = R() * TAU;
        g.strokeStyle = 'rgba(8,8,8,0.42)'; g.lineWidth = 0.05; g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 7; k++) { a += (R() - 0.5) * 1.3; x += Math.cos(a) * 0.5; y += Math.sin(a) * 0.5; g.lineTo(x, y); } g.stroke();
      } else if (theme === 'city' && h < 0.1) {
        const [x, y] = off(i, (hash(i, 9) - 0.5) * p.w * 0.6);
        g.fillStyle = '#2c2c32'; g.beginPath(); g.arc(x, y, 0.45, 0, TAU); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 0.05; g.stroke();
      }
    }
  }
  // the racing line: the inside of each bend
  const racing = loop((p, i) => -Math.sign(K[i]) * Math.min(p.w * 0.28, Math.abs(K[i]) * 140));

  // ---------- surfaces: a stretch of the road's full width, ends feathered ----------
  // stretches by sample index; ones of a kind that meet are one stretch (no seam between them)
  const surfs = [];
  for (const s0 of [...(def.surfaces ?? [])].sort((a, b) => a.from - b.from)) {
    const a = Math.floor((((s0.from % len) + len) % len) / step), b = Math.ceil((((s0.to % len) + len) % len) / step);
    const span = (b - a + n) % n || n, last = surfs[surfs.length - 1];
    if (last && last.kind === s0.kind && a - last.i1 <= 2) last.i1 = Math.max(last.i1, a + span);
    else surfs.push({ kind: s0.kind, i0: a, i1: a + span });
  }
  function stretch(sf) {
    // the outline: along one edge, then back along the other, square across the ends (spill
    // blobs soften them where the kind spreads)
    const path = new Path2D(), L = [], Rt = [], m = 10;
    for (let i = sf.i0 + 2; i <= sf.i1 - 2; i++) { const p = S[i % n]; L.push(off(i, -p.w / 2)); Rt.push(off(i, p.w / 2)); }
    // each end a smooth wave across the road, ±2 m along it
    const cap = (i, from, dir) => {
      const p = S[(i + n) % n], out = [];
      for (let j = 0; j <= m; j++) {
        const q = j / m, o = (from + (-from * 2) * q) * p.w / 2, along = dir * (2 + Math.sin(q * 5.3 + i) * 1.1 + Math.sin(q * 11.7 + i * 0.3) * 0.5);
        out.push([p.x + p.nx * o + p.ny * along, p.y + p.ny * o - p.nx * along]);
      }
      return out;
    };
    const pts = [...L, ...cap(sf.i1 - 2, -1, 1), ...Rt.reverse(), ...cap(sf.i0 + 2, 1, -1)];
    pts.forEach(([x, y], k) => (k ? path.lineTo(x, y) : path.moveTo(x, y)));
    path.closePath();
    return path;
  }
  // a stretch's ragged ends: blobs strewn across the road just past each end
  function spill(g, sf, R, fill) {
    for (const [i, dir] of [[sf.i0, -1], [sf.i1, 1]]) {
      const p = S[(i + n) % n];
      for (let k = 0; k < 9; k++) {
        const along = dir * R() * 2.5, [x, y] = off(i + Math.round(along), (R() - 0.5) * p.w * 0.95), r = 0.5 + R() * 1.3;
        g.fillStyle = fill; g.beginPath(); g.ellipse(x, y, r * 1.4, r, R() * 3, 0, TAU); g.fill();
      }
    }
  }
  for (const sf of surfs) sf.path = stretch(sf);
  function surfaces(g, X0, Y0, X1, Y1, lod) {
    for (const sf of surfs) {
      const mid = S[((sf.i0 + sf.i1) >> 1) % n];
      if (!idxNear(sf, X0, Y0, X1, Y1)) continue;
      const R = rng(seed + sf.i0 * 13);
      if (sf.kind === 'dirt') {
        g.save(); g.globalAlpha = 0.9; g.fillStyle = pat(g, 'dirt'); g.fill(sf.path); spill(g, sf, R, pat(g, 'dirt')); g.restore();
        g.strokeStyle = 'rgba(70,40,20,0.35)'; g.lineWidth = 0.35;
        for (const o of [-2.4, -1.2, 1.2, 2.4]) g.stroke(loop(p => o + Math.sin(p.d * 0.1) * 0.3, false, sf.i0 + 3, sf.i1 - 3));
      } else if (sf.kind === 'snow') {
        g.fillStyle = pat(g, 'snow'); g.fill(sf.path); spill(g, sf, R, pat(g, 'snow'));
        g.strokeStyle = 'rgba(120,140,170,0.35)'; g.lineWidth = 0.32;
        for (const o of [-2.6, -1.0, 1.0, 2.6]) g.stroke(loop(p => o + Math.sin(p.d * 0.13 + o) * 0.25, false, sf.i0 + 2, sf.i1 - 2));
      } else if (sf.kind === 'ice') {
        g.fillStyle = 'rgba(196,226,246,0.62)'; g.fill(sf.path);
        g.save(); g.clip(sf.path);
        g.fillStyle = 'rgba(255,255,255,0.28)';
        for (let i = sf.i0; i < sf.i1; i += 3) { const [x, y] = off(i, (R() - 0.5) * mid.w); g.beginPath(); g.ellipse(x, y, 1.5 + R() * 3, 0.15 + R() * 0.3, R() * 0.6 - 0.3 + Math.atan2(S[i % n].ny, S[i % n].nx) + Math.PI / 2, 0, TAU); g.fill(); }
        if (!lod) { g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 0.04; for (let k = 0; k < (sf.i1 - sf.i0) / 2; k++) { const i = sf.i0 + R() * (sf.i1 - sf.i0); let [x, y] = off(Math.floor(i), (R() - 0.5) * mid.w), a = R() * TAU; g.beginPath(); g.moveTo(x, y); for (let j = 0; j < 4; j++) { a += (R() - 0.5) * 1.5; x += Math.cos(a) * 0.8; y += Math.sin(a) * 0.8; g.lineTo(x, y); } g.stroke(); } }
        g.restore();
        g.strokeStyle = 'rgba(230,245,255,0.5)'; g.lineWidth = 0.12; g.stroke(sf.path);
      } else if (sf.kind === 'oil') {
        g.save();
        for (let i = sf.i0; i <= sf.i1; i += 2) {
          const r = 1.0 + R() * 1.8, [x, y] = off(i, (R() - 0.5) * Math.max(0, S[i % n].w - r * 2.4));
          g.fillStyle = 'rgba(6,6,8,0.82)'; g.beginPath(); g.ellipse(x, y, r, r * (0.5 + R() * 0.4), R() * 3, 0, TAU); g.fill();
          const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.2, 0, x, y, r);
          gr.addColorStop(0, 'rgba(120,60,200,0.18)'); gr.addColorStop(0.4, 'rgba(40,200,170,0.12)'); gr.addColorStop(0.7, 'rgba(230,180,40,0.1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * 0.7, R() * 3, 0, TAU); g.fill();
        }
        g.restore();
      } else if (sf.kind === 'water') {
        for (let i = sf.i0 + 1; i <= sf.i1 - 1; i += 4) { const [x, y] = off(i, (R() - 0.5) * mid.w * 0.7); puddle(g, x, y, 1.2 + R() * 1.6, R); }
      }
    }
  }
  const idxNear = (sf, X0, Y0, X1, Y1) => {
    for (let i = sf.i0; i <= sf.i1; i += 2) { const p = S[i % n]; if (p.x > X0 - 25 && p.x < X1 + 25 && p.y > Y0 - 25 && p.y < Y1 + 25) return true; }
    return false;
  };

  // ---------- lines: edges, centre, kerbs on the corners, the start line and grid ----------
  const edgeL = loop(p => -p.w / 2 + 0.45), edgeR = loop(p => p.w / 2 - 0.45), centre = loop(() => 0);
  const kerbs = corners.map(c => [loop(p => -(p.w / 2 - 0.5), false, c.i0, c.i1), loop(p => p.w / 2 - 0.5, false, c.i0, c.i1)]);
  function lines(g, X0, Y0, X1, Y1) {
    g.lineCap = 'butt';
    g.strokeStyle = alpha(th.line, theme === 'city' ? 0.75 : 0.62); g.lineWidth = 0.16;
    g.stroke(edgeL); g.stroke(edgeR);
    if (theme === 'canyon' || theme === 'city') {
      g.strokeStyle = alpha(th.centre, theme === 'city' ? 0.55 : 0.45); g.lineWidth = 0.14; g.setLineDash(theme === 'city' ? [3, 4] : [2.5, 3.5]); g.stroke(centre); g.setLineDash([]);
    }
    if (theme === 'docks') { g.strokeStyle = alpha(th.centre, 0.35); g.lineWidth = 0.12; g.setLineDash([1, 1.4]); g.stroke(edgeL); g.stroke(edgeR); g.setLineDash([]); }
    // kerbs: a 0.9 m strip, white with red (theme) blocks
    for (const [a, b] of kerbs) for (const k of [a, b]) {
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.05; g.stroke(k);
      g.strokeStyle = th.kerb[0]; g.lineWidth = 0.9; g.stroke(k);
      g.strokeStyle = th.kerb[1]; g.setLineDash([1.1, 1.1]); g.stroke(k); g.setLineDash([]);
    }
    // the start line: a chequered band across the road, and the grid boxes behind it
    const st = geo.start;
    if (st && Math.abs(st.x - (X0 + X1) / 2) < (X1 - X0) / 2 + 20 && Math.abs(st.y - (Y0 + Y1) / 2) < (Y1 - Y0) / 2 + 20) {
      const w = geo.at(0).w;
      g.save(); g.translate(st.x, st.y); g.rotate(st.a);
      const sq = w / 16;
      for (let r = 0; r < 2; r++) for (let k = 0; k < 16; k++) { g.fillStyle = (r + k) % 2 ? '#111111' : '#f2f2ee'; g.fillRect(-r * sq - sq / 2 + sq, -w / 2 + k * sq, sq, sq); }
      g.restore();
      for (const s of geo.grid ?? []) {
        g.save(); g.translate(s.x, s.y); g.rotate(s.a); g.strokeStyle = alpha(th.line, 0.7); g.lineWidth = 0.16;
        g.beginPath(); g.moveTo(-2.8, -1.4); g.lineTo(3, -1.4); g.lineTo(3, 1.4); g.lineTo(-2.8, 1.4); g.stroke(); g.restore();
      }
    }
  }

  // ---------- barriers along both edges ----------
  const sides = [-1, 1];
  function barriers(g, X0, Y0, X1, Y1, lod) {
    const out = (o, side) => loop(p => side * (p.w / 2 + o));
    if (th.wall === 'rock') {
      // a broken wall of red boulders, the road's edge cut into the canyon side
      g.strokeStyle = th.shadow; g.lineWidth = 2.2; for (const s of sides) g.stroke(out(1.5, s));
      g.strokeStyle = th.rock[1]; g.lineWidth = 1.6; for (const s of sides) g.stroke(out(0.8, s));
      if (lod) return;
      for (const i of samplesIn(X0 - 6, Y0 - 6, X1 + 6, Y1 + 6)) if (i % 2 === 0) for (const s of sides) {
        const R = rng(seed + i * 2 + (s > 0 ? 1 : 0)), p = S[i], [x, y] = off(i, s * (p.w / 2 + 0.7 + R() * 0.5)), r = 0.6 + R() * 0.7;
        g.fillStyle = th.shadow; g.beginPath(); g.ellipse(x + 0.3, y + 0.4, r * 1.1, r * 0.9, R() * 3, 0, TAU); g.fill();
        g.fillStyle = mix(th.rock[1], th.rock[0], R()); g.beginPath(); g.ellipse(x, y, r * 1.1, r * 0.85, R() * 3, 0, TAU); g.fill();
        g.fillStyle = alpha(th.rock[2], 0.75); g.beginPath(); g.ellipse(x - r * 0.25, y - r * 0.25, r * 0.55, r * 0.4, R() * 3, 0, TAU); g.fill();
      }
      tyreStacks(g, X0, Y0, X1, Y1);
    } else if (th.wall === 'jersey') {
      // concrete blocks, 3 m each, with hazard stripes now and then
      g.strokeStyle = th.shadow; g.lineWidth = 1.3; for (const s of sides) g.stroke(loop(p => s * (p.w / 2 + 0.75) + 0.25));
      g.strokeStyle = '#8e8f8a'; g.lineWidth = 0.9; for (const s of sides) g.stroke(out(0.45, s));
      g.strokeStyle = '#b4b5ae'; g.lineWidth = 0.35; for (const s of sides) g.stroke(out(0.45, s));
      if (lod) return;
      for (const i of samplesIn(X0 - 6, Y0 - 6, X1 + 6, Y1 + 6)) for (const s of sides) {
        const p = S[i];
        if (i % 3 === 0) { const [a, b] = off(i, s * (p.w / 2)), [c, d] = off(i, s * (p.w / 2 + 0.9)); g.strokeStyle = 'rgba(40,40,40,0.6)'; g.lineWidth = 0.06; g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); }
        if (Math.floor(i / 3) % 7 === 0) { const [x, y] = off(i, s * (p.w / 2 + 0.45)); g.fillStyle = (i % 2) ? '#e0b228' : '#1a1a1a'; g.beginPath(); g.arc(x, y, 0.32, 0, TAU); g.fill(); }
      }
      tyreStacks(g, X0, Y0, X1, Y1);
    } else if (th.wall === 'armco') {
      // a steel guardrail on posts, snow heaped behind it
      g.strokeStyle = th.shadow; g.lineWidth = 0.7; for (const s of sides) g.stroke(loop(p => s * (p.w / 2 + 0.6) + 0.3));
      g.strokeStyle = '#7a828c'; g.lineWidth = 0.42; for (const s of sides) g.stroke(out(0.3, s));
      g.strokeStyle = '#c8d0d8'; g.lineWidth = 0.16; for (const s of sides) g.stroke(out(0.22, s));
      if (lod) return;
      for (const i of samplesIn(X0 - 6, Y0 - 6, X1 + 6, Y1 + 6)) if (i % 2 === 0) for (const s of sides) {
        const p = S[i], [x, y] = off(i, s * (p.w / 2 + 0.55));
        g.fillStyle = '#3a3e44'; g.fillRect(x - 0.1, y - 0.1, 0.2, 0.2);
        if (i % 6 === 0) { const [x2, y2] = off(i, s * (p.w / 2 + 0.3)); g.fillStyle = s > 0 ? '#e83a2a' : '#f2f2f2'; g.beginPath(); g.arc(x2, y2, 0.09, 0, TAU); g.fill(); }
      }
    } else { // the city: a concrete barrier with a neon tube along its top
      g.strokeStyle = th.shadow; g.lineWidth = 1.4; for (const s of sides) g.stroke(loop(p => s * (p.w / 2 + 0.7) + 0.2));
      g.strokeStyle = '#3c3c46'; g.lineWidth = 0.8; for (const s of sides) g.stroke(out(0.4, s));
      for (const s of sides) {
        const c = s < 0 ? th.neon[0] : th.neon[1];
        g.globalCompositeOperation = 'lighter';
        g.strokeStyle = alpha(c, 0.07); g.lineWidth = 5; g.stroke(out(0.2, s));
        g.strokeStyle = alpha(c, 0.12); g.lineWidth = 2; g.stroke(out(0.25, s));
        g.globalCompositeOperation = 'source-over';
        g.strokeStyle = mix(c, '#ffffff', 0.45); g.lineWidth = 0.12; g.stroke(out(0.4, s));
      }
      if (!lod) tyreStacks(g, X0, Y0, X1, Y1);
    }
  }
  // tyre walls on the outside of the sharp corners
  function tyreStacks(g, X0, Y0, X1, Y1) {
    for (const c of sharp) {
      const o = -c.dir;
      for (let i = c.i0; i <= c.i1; i++) {
        const p = S[(i + n) % n];
        if (p.x < X0 - 5 || p.x > X1 + 5 + p.w || p.y < Y0 - 5 - p.w || p.y > Y1 + 5 + p.w) continue;
        for (const r of [0, 1]) {
          const [x, y] = off(i, o * (p.w / 2 + 0.45 + r * 0.72));
          g.fillStyle = '#121212'; g.beginPath(); g.arc(x, y, 0.36, 0, TAU); g.fill();
          g.fillStyle = (i + r) % 4 === 0 ? th.kerb[1] : '#2c2c2c'; g.beginPath(); g.arc(x, y, 0.2, 0, TAU); g.fill();
          g.fillStyle = '#060606'; g.beginPath(); g.arc(x, y, 0.1, 0, TAU); g.fill();
        }
      }
    }
  }
  // city lights baked onto the ground: pools under lamps, neon spill, wet glints on the road
  function glowPools(g, X0, Y0, X1, Y1) {
    g.globalCompositeOperation = 'lighter';
    for (const L of lights) {
      if (L.x < X0 - L.r * 2 || L.x > X1 + L.r * 2 || L.y < Y0 - L.r * 2 || L.y > Y1 + L.r * 2) continue;
      const [hx, hy] = lampHead(L.p);
      const gr = g.createRadialGradient(hx, hy, 0, hx, hy, L.r);
      gr.addColorStop(0, alpha(L.c, 0.32 * L.k * 2)); gr.addColorStop(0.35, alpha(L.c, 0.14 * L.k * 2)); gr.addColorStop(1, alpha(L.c, 0));
      g.fillStyle = gr; g.fillRect(hx - L.r, hy - L.r, L.r * 2, L.r * 2);
      // a wet glint: the light smeared along the road, brighter in its middle
      const near = samplesIn(hx - 3, hy - 3, hx + 3, hy + 3)[0] ?? null, a = near != null ? Math.atan2(S[near].ny, S[near].nx) + Math.PI / 2 : 0;
      g.save(); g.translate(hx, hy); g.rotate(a);
      const gl = g.createRadialGradient(0, 0, 0, 0, 0, 6); gl.addColorStop(0, alpha(L.c, 0.3)); gl.addColorStop(1, alpha(L.c, 0));
      g.fillStyle = gl; g.scale(1, 0.22); g.beginPath(); g.arc(0, 0, 6, 0, TAU); g.fill(); g.restore();
    }
    g.globalCompositeOperation = 'source-over';
  }
  // where a tall prop's light hangs: a lamp's head reaches out over the road
  function lampHead(p) {
    if (p.kind !== 'lamp') return [p.x, p.y];
    const q = geo.nearest(p.x, p.y), c = geo.at(q.d), dx = c.x - p.x, dy = c.y - p.y, l = Math.hypot(dx, dy) || 1;
    return [p.x + (dx / l) * 2.6, p.y + (dy / l) * 2.6];
  }
  for (const L of lights) L.head = lampHead(L.p);

  // ---------- props ----------
  const SH = [0.45, 0.6]; // shadow offset per metre of height
  function prop(g, p, shadow) {
    const { x, y, r, a, kind } = p, R = rng(seed + p.i * 977);
    g.save(); g.translate(x, y);
    const sh = (h, fn) => { if (shadow) { g.save(); g.translate(SH[0] * h, SH[1] * h); g.fillStyle = th.shadow; fn(); g.restore(); } };
    switch (kind) {
      case 'rock': case 'boulder': if (shadow) break; g.translate(-x, -y); outcrop(g, x, y, r * 0.95, R, theme === 'pass'); break;
      case 'cactus': {
        const arms = [[0.5, -0.6, 0.7], [-0.45, 0.3, 0.6]];
        sh(2.4, () => { g.beginPath(); g.ellipse(0.6, 0.8, 0.35, 1.3, -0.6, 0, TAU); g.fill(); });
        if (shadow) break;
        g.rotate(a);
        for (const [ax, ay, l] of arms) { g.strokeStyle = '#3e6a2c'; g.lineWidth = 0.32; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, 0); g.lineTo(ax, ay * 0.3); g.lineTo(ax, ay * 0.3 + Math.sign(ay) * l); g.stroke(); }
        g.fillStyle = '#467a32'; g.beginPath(); g.arc(0, 0, 0.42, 0, TAU); g.fill();
        g.fillStyle = '#6a9e48'; g.beginPath(); g.arc(-0.1, -0.1, 0.24, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(20,40,10,0.5)'; g.lineWidth = 0.03; for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(k) * 0.42, Math.sin(k) * 0.42); g.stroke(); }
        break;
      }
      case 'scrub': if (!shadow) { g.translate(-x, -y); scrub(g, x, y, r * 0.8, R); } break;
      case 'bones': if (!shadow) { // a sun-bleached skeleton of something large
        g.rotate(a); g.strokeStyle = '#e8dcc4'; g.lineWidth = 0.1; g.lineCap = 'round';
        g.beginPath(); g.moveTo(-0.8, 0); g.lineTo(0.7, 0); for (let k = -3; k <= 3; k++) { g.moveTo(k * 0.2, -0.05); g.quadraticCurveTo(k * 0.2 + 0.1, -0.4, k * 0.2 - 0.05, -0.55); g.moveTo(k * 0.2, 0.05); g.quadraticCurveTo(k * 0.2 + 0.1, 0.4, k * 0.2 - 0.05, 0.55); } g.stroke();
        g.fillStyle = '#efe4cc'; g.beginPath(); g.ellipse(0.95, 0, 0.3, 0.18, 0, 0, TAU); g.fill();
      } break;
      case 'container': {
        const l = r * 1.7, w = r * 0.7;
        g.rotate(a);
        sh(2.6, () => g.fillRect(-l / 2, -w / 2, l, w));
        if (shadow) break;
        const cols = ['#a83a26', '#2a5a8a', '#3a7a4a', '#c88a24', '#5a5a62', '#8a3a6a'], c = cols[(p.i * 7) % cols.length];
        g.fillStyle = c; g.fillRect(-l / 2, -w / 2, l, w);
        g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 0.06; g.beginPath(); for (let k = -l / 2 + 0.3; k < l / 2; k += 0.3) { g.moveTo(k, -w / 2); g.lineTo(k, w / 2); } g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(-l / 2, -w / 2, l, w * 0.2);
        g.strokeStyle = shadeOf(c, -0.4); g.lineWidth = 0.12; g.strokeRect(-l / 2, -w / 2, l, w);
        g.fillStyle = 'rgba(122,64,30,0.35)'; for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse((R() - 0.5) * l, (R() - 0.5) * w, 0.4, 0.2, 0, 0, TAU); g.fill(); }
        break;
      }
      case 'crate': case 'pallet': case 'kiosk': {
        const s = kind === 'kiosk' ? r * 1.3 : r * 1.2;
        g.rotate(a);
        sh(kind === 'pallet' ? 0.2 : kind === 'kiosk' ? 2.4 : 1.1, () => g.fillRect(-s / 2, -s / 2, s, s));
        if (shadow) break;
        if (kind === 'kiosk') { // a street kiosk: a lit awning
          g.fillStyle = '#2e2c36'; g.fillRect(-s / 2, -s / 2, s, s);
          const c = th.neon ? th.neon[(p.i + 1) % th.neon.length] : '#c83a2a';
          for (let k = 0; k < 6; k++) { g.fillStyle = k % 2 ? mix(c, '#000000', 0.3) : '#d8d8d8'; g.fillRect(-s / 2 + (k * s) / 6, -s / 2, s / 6, s * 0.45); }
          g.fillStyle = 'rgba(255,220,160,0.5)'; g.fillRect(-s / 2 + 0.2, 0.1, s - 0.4, s * 0.3);
          break;
        }
        g.fillStyle = kind === 'pallet' ? '#8a6a44' : '#9a7444'; g.fillRect(-s / 2, -s / 2, s, s);
        g.strokeStyle = 'rgba(40,24,10,0.6)'; g.lineWidth = 0.06; g.beginPath();
        for (let k = 1; k < 4; k++) { g.moveTo(-s / 2, -s / 2 + (k * s) / 4); g.lineTo(s / 2, -s / 2 + (k * s) / 4); }
        if (kind === 'crate') { g.moveTo(-s / 2, -s / 2); g.lineTo(s / 2, s / 2); g.moveTo(s / 2, -s / 2); g.lineTo(-s / 2, s / 2); }
        g.stroke(); g.strokeStyle = 'rgba(30,18,8,0.7)'; g.lineWidth = 0.1; g.strokeRect(-s / 2, -s / 2, s, s);
        break;
      }
      case 'barrel': case 'bin': case 'hydrant': case 'bollard': case 'marker': {
        const rr = kind === 'marker' ? 0.12 : kind === 'hydrant' ? 0.22 : r * 0.9;
        sh(kind === 'marker' ? 1.6 : 1, () => { g.beginPath(); g.arc(0, 0, rr, 0, TAU); g.fill(); });
        if (shadow) break;
        const col = { barrel: ['#b8401e', '#2a6a9a', '#3a6a2a'][p.i % 3], bin: '#3a4a3c', hydrant: '#c8281e', bollard: '#2a2c2e', marker: '#e8541e' }[kind];
        const gr = g.createRadialGradient(-rr * 0.3, -rr * 0.3, 0, 0, 0, rr); gr.addColorStop(0, shadeOf(col, 0.3)); gr.addColorStop(1, shadeOf(col, -0.3));
        g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rr, 0, TAU); g.fill();
        if (kind === 'barrel') { g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 0.05; g.beginPath(); g.arc(0, 0, rr * 0.7, 0, TAU); g.stroke(); g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(rr * 0.35, 0, rr * 0.12, 0, TAU); g.fill(); }
        if (kind === 'bollard') { g.fillStyle = '#e0b228'; g.beginPath(); g.arc(0, 0, rr * 0.5, 0, TAU); g.fill(); }
        if (kind === 'marker') { g.fillStyle = '#f2f2f2'; g.beginPath(); g.arc(0, 0, rr * 0.5, 0, TAU); g.fill(); }
        break;
      }
      case 'pine': {
        sh(5, () => { g.beginPath(); g.ellipse(0.4, 0.6, r * 1.05, r * 0.9, 0.6, 0, TAU); g.fill(); });
        if (shadow) break;
        // a conifer from above: rings of needle points, darker outside, snow on the top
        g.rotate(a);
        const tiers = [[1, '#1e3a2c'], [0.78, '#264a36'], [0.55, '#2e5a40'], [0.32, '#386a4a']];
        for (const [k, c] of tiers) {
          g.fillStyle = c; g.beginPath();
          const m = 12, rr = r * k;
          for (let j = 0; j < m * 2; j++) { const an = (j / (m * 2)) * TAU, q = j % 2 ? rr * 0.72 : rr; g.lineTo(Math.cos(an) * q, Math.sin(an) * q); }
          g.fill();
          if (theme === 'pass') { g.fillStyle = 'rgba(250,252,255,0.8)'; for (let j = 0; j < 5; j++) { const an = -2.6 + j * 0.45 - a, q = rr * 0.62; g.beginPath(); g.ellipse(Math.cos(an) * q, Math.sin(an) * q, rr * 0.22, rr * 0.13, an, 0, TAU); g.fill(); } }
        }
        g.fillStyle = theme === 'pass' ? '#ffffff' : '#4a7a58'; g.beginPath(); g.arc(-r * 0.05, -r * 0.05, r * 0.12, 0, TAU); g.fill();
        break;
      }
      case 'snowbank': if (!shadow) {
        g.rotate(a);
        g.fillStyle = 'rgba(140,166,200,0.45)'; g.beginPath(); g.ellipse(r * 0.15, r * 0.2, r * 1.2, r * 0.6, 0, 0, TAU); g.fill();
        g.fillStyle = '#f4f8fc'; g.beginPath(); g.ellipse(0, 0, r * 1.15, r * 0.55, 0, 0, TAU); g.fill();
        g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(-r * 0.2, -r * 0.12, r * 0.7, r * 0.28, 0, 0, TAU); g.fill();
      } break;
      case 'car-wreck': if (!shadow) {
        // a burnt hulk from an earlier race, drawn by the car painter in pixels
        g.restore(); g.save();
        const m = g.getTransform(), k = Math.hypot(m.a, m.b);
        g.setTransform(1, 0, 0, 1, m.e + x * k, m.f + y * k);
        drawCar(g, ['dustpan', 'mongrel', 'kestrel', 'bulwark'][p.i % 4], '#555555', 0, 0, a, k, { wreck: true, shadowAlpha: 0.45 });
      } break;
      case 'tyres': {
        sh(0.8, () => { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill(); });
        if (shadow) break;
        for (let k = 0; k < 3; k++) { const an = a + k * 2.1, tx = Math.cos(an) * r * 0.45, ty = Math.sin(an) * r * 0.45; g.fillStyle = '#141414'; g.beginPath(); g.arc(tx, ty, r * 0.5, 0, TAU); g.fill(); g.fillStyle = '#2c2c2c'; g.beginPath(); g.arc(tx, ty, r * 0.25, 0, TAU); g.fill(); }
        break;
      }
      case 'crane': { // the base: four legs on rails; the boom is drawn over the cars (tops)
        g.rotate(a);
        const s = r * 0.8;
        sh(1, () => g.fillRect(-s, -s, s * 2, s * 2));
        if (shadow) { // the boom's long shadow on the ground
          g.save(); g.translate(SH[0] * 14, SH[1] * 14); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(-4, -0.9, 26, 1.8); g.restore();
          break;
        }
        g.strokeStyle = '#3a3a3a'; g.lineWidth = 0.25; for (const yy of [-s - 0.5, s + 0.5]) { g.beginPath(); g.moveTo(-s * 3, yy); g.lineTo(s * 3, yy); g.stroke(); }
        g.fillStyle = '#c8a020'; for (const [lx, ly] of [[-s, -s], [s, -s], [-s, s], [s, s]]) g.fillRect(lx - 0.45, ly - 0.45, 0.9, 0.9);
        g.strokeStyle = '#b08a18'; g.lineWidth = 0.3; g.beginPath(); g.moveTo(-s, -s); g.lineTo(s, s); g.moveTo(s, -s); g.lineTo(-s, s); g.stroke();
        break;
      }
      case 'lamp': {
        sh(0.5, () => { g.beginPath(); g.arc(0, 0, 0.3, 0, TAU); g.fill(); });
        if (!shadow) { g.fillStyle = '#4a4a52'; g.beginPath(); g.arc(0, 0, 0.25, 0, TAU); g.fill(); }
        break;
      }
      case 'billboard': {
        g.rotate(a);
        sh(4, () => g.fillRect(-r, -0.25, r * 2, 0.5));
        if (!shadow) { g.fillStyle = '#3a3a40'; g.fillRect(-r * 0.6, -0.2, 0.3, 0.4); g.fillRect(r * 0.6 - 0.3, -0.2, 0.3, 0.4); }
        break;
      }
      default: if (!shadow) { g.fillStyle = th.rock[1]; g.beginPath(); g.arc(0, 0, r * 0.8, 0, TAU); g.fill(); g.fillStyle = th.rock[0]; g.beginPath(); g.arc(-r * 0.15, -r * 0.15, r * 0.5, 0, TAU); g.fill(); }
    }
    g.restore();
  }

  // ---------- the chunk cache ----------
  const chunks = new Map();
  let maxChunks = 96;
  function paintChunk(cx, cy) {
    const cv = canvas(CPX + PAD * 2, CPX + PAD * 2), g = cv.getContext('2d');
    const X0 = cx * C, Y0 = cy * C, m = PAD / P0;
    g.setTransform(P0, 0, 0, P0, -X0 * P0 + PAD, -Y0 * P0 + PAD);
    paint(g, X0 - m, Y0 - m, C + m * 2, C + m * 2, false);
    const ch = { cv, g, cx, cy };
    chunks.set(cx + ',' + cy, ch);
    while (chunks.size > maxChunks) chunks.delete(chunks.keys().next().value);
    return ch;
  }
  // the whole world small: stands in for chunks not painted yet, and the mini-map's ground
  const OP = Math.min(4, 1400 / Math.max(B.x1 - B.x0 + 80, B.y1 - B.y0 + 80));
  const over = canvas((B.x1 - B.x0 + 80) * OP, (B.y1 - B.y0 + 80) * OP);
  {
    const g = over.getContext('2d');
    g.setTransform(OP, 0, 0, OP, -(B.x0 - 40) * OP, -(B.y0 - 40) * OP);
    paint(g, B.x0 - 40, B.y0 - 40, B.x1 - B.x0 + 80, B.y1 - B.y0 + 80, true);
  }

  let fresh = true;
  /** paint the visible ground: cached chunks, new ones within a budget (ms), the small copy for the rest */
  function draw(g, v, budget = quality > 0 ? 4 : 2) {
    const t0 = performance.now(), k = v.P / P0, hw = v.cw / v.P / 2, hh = v.ch / v.P / 2;
    const x0 = v.x - hw, y0 = v.y - hh, x1 = v.x + hw, y1 = v.y + hh;
    const c0 = Math.floor(x0 / C), c1 = Math.floor(x1 / C), r0 = Math.floor(y0 / C), r1 = Math.floor(y1 / C);
    maxChunks = Math.max(maxChunks, (c1 - c0 + 3) * (r1 - r0 + 3) + 16);
    const sx = X => Math.round((X - x0) * v.P + v.sx), sy = Y => Math.round((Y - y0) * v.P + v.sy);
    g.imageSmoothingEnabled = true;
    // the stand-in first, under everything (cheap: one image)
    let missing = false;
    const todo = [];
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const key = cx + ',' + cy;
      let ch = chunks.get(key);
      if (ch) { chunks.delete(key); chunks.set(key, ch); }
      else if (fresh || performance.now() - t0 < budget) ch = paintChunk(cx, cy);
      if (!ch) { missing = true; todo.push([cx, cy]); continue; }
      const X = sx(cx * C), Y = sy(cy * C), W = sx((cx + 1) * C) - X, H = sy((cy + 1) * C) - Y;
      g.drawImage(ch.cv, PAD, PAD, CPX, CPX, X, Y, W, H);
    }
    if (missing) for (const [cx, cy] of todo) {
      const X = sx(cx * C), Y = sy(cy * C), W = sx((cx + 1) * C) - X, H = sy((cy + 1) * C) - Y;
      g.drawImage(over, (cx * C - B.x0 + 40) * OP, (cy * C - B.y0 + 40) * OP, C * OP, C * OP, X, Y, W, H);
    }
    fresh = false;
    // look ahead: paint the ring around the view, the side we're heading to first
    if (!missing && v.vx != null) {
      const lx = Math.sign(v.vx) | 0, ly = Math.sign(v.vy) | 0, ring = [];
      for (let cy = r0 - 1; cy <= r1 + 1; cy++) for (let cx = c0 - 1; cx <= c1 + 1; cx++) {
        if (cx >= c0 && cx <= c1 && cy >= r0 && cy <= r1) continue;
        if (chunks.has(cx + ',' + cy)) continue;
        const pri = (cx < c0 ? -lx : cx > c1 ? lx : 0) + (cy < r0 ? -ly : cy > r1 ? ly : 0);
        ring.push([pri, cx, cy]);
      }
      ring.sort((a, b) => b[0] - a[0]);
      for (const [, cx, cy] of ring) { if (performance.now() - t0 > budget) break; paintChunk(cx, cy); }
    }
    void k;
  }
  // a decal goes into the list and into every cached chunk it touches
  function addDecal(d, r) {
    decals.push(d);
    if (decals.length > 24000) decals.splice(0, 4000);
    const x = d[8], y = d[9];
    for (let cy = Math.floor((y - r) / C); cy <= Math.floor((y + r) / C); cy++) for (let cx = Math.floor((x - r) / C); cx <= Math.floor((x + r) / C); cx++) {
      const ch = chunks.get(cx + ',' + cy);
      if (!ch) continue;
      ch.g.setTransform(P0, 0, 0, P0, -cx * C * P0 + PAD, -cy * C * P0 + PAD);
      ch.g.lineCap = 'round';
      drawDecal(ch.g, d);
    }
  }
  const skid = (x0, y0, x1, y1, w, col) => addDecal([0, x0, y0, x1, y1, w, 0, col, (x0 + x1) / 2, (y0 + y1) / 2], w + Math.hypot(x1 - x0, y1 - y0));
  const scorch = (x, y, r) => addDecal([1, x, y, r, (Math.random() * 1e9) | 0, 0, 0, 0, x, y], r);
  function reset() { // a new race on the same track: decals gone, chunks painted again
    decals.length = 0; chunks.clear(); fresh = true;
  }

  // ---------- what stands over the cars ----------
  function tops(g, v, t) {
    const hw = v.cw / v.P / 2 + 30, hh = v.ch / v.P / 2 + 30;
    for (const p of tall) {
      if (Math.abs(p.x - v.x) > hw || Math.abs(p.y - v.y) > hh) continue;
      const X = (p.x - v.x) * v.P + v.cw / 2 + v.sx, Y = (p.y - v.y) * v.P + v.ch / 2 + v.sy;
      g.save(); g.setTransform(v.P, 0, 0, v.P, X, Y);
      if (p.kind === 'crane') {
        // a gantry crane: the boom reaching out over the quay, its cab and counterweight
        g.rotate(p.a);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-4 + 1.2, -0.9 + 1.6, 26, 1.8);
        g.fillStyle = '#d0a82a'; g.fillRect(-4, -0.9, 26, 1.8);
        g.strokeStyle = '#8a6a10'; g.lineWidth = 0.12; g.beginPath();
        for (let k = -4; k < 22; k += 1.2) { g.moveTo(k, -0.9); g.lineTo(k + 1.2, 0.9); g.moveTo(k + 1.2, -0.9); g.lineTo(k, 0.9); }
        g.stroke(); g.strokeRect(-4, -0.9, 26, 1.8);
        g.fillStyle = '#5a5a5e'; g.fillRect(-6.5, -1.6, 3, 3.2);
        g.fillStyle = '#e8c23a'; g.fillRect(-1.6, -1.4, 2.8, 2.8);
        g.fillStyle = '#2a3a4a'; g.fillRect(0.6, -1.0, 0.6, 2);
        g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(-1.6, -1.4, 2.8, 0.4);
        const tx = 8 + Math.sin(t * 0.2 + p.i) * 6; // the trolley and its hook
        g.fillStyle = '#3a3a3e'; g.fillRect(tx - 0.8, -1.1, 1.6, 2.2);
        g.strokeStyle = '#202020'; g.lineWidth = 0.05; g.beginPath(); g.moveTo(tx, 0); g.lineTo(tx + 0.4, 0.5); g.stroke();
        if (Math.floor(t * 1.3 + p.i) % 2 === 0) { g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(255,60,40,0.8)'; g.beginPath(); g.arc(21.6, 0, 0.2, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,60,40,0.15)'; g.beginPath(); g.arc(21.6, 0, 1, 0, TAU); g.fill(); }
      } else if (p.kind === 'lamp') {
        const L = lights.find(l => l.p === p), [hx, hy] = L ? L.head : [p.x + 1, p.y];
        const dx = hx - p.x, dy = hy - p.y;
        g.strokeStyle = '#3a3a42'; g.lineWidth = 0.18; g.beginPath(); g.moveTo(0, 0); g.lineTo(dx, dy); g.stroke();
        g.fillStyle = '#2a2a30'; g.beginPath(); g.ellipse(dx, dy, 0.55, 0.3, Math.atan2(dy, dx), 0, TAU); g.fill();
        if (th.light) {
          g.globalCompositeOperation = 'lighter';
          const gr = g.createRadialGradient(dx, dy, 0, dx, dy, 2.2); gr.addColorStop(0, 'rgba(255,214,150,0.9)'); gr.addColorStop(0.2, 'rgba(255,184,104,0.35)'); gr.addColorStop(1, 'rgba(255,184,104,0)');
          g.fillStyle = gr; g.fillRect(dx - 2.2, dy - 2.2, 4.4, 4.4);
        }
      } else if (p.kind === 'billboard') {
        g.rotate(p.a);
        const r = p.r, c = th.neon ? th.neon[p.i % th.neon.length] : '#e83a2a';
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-r + 1.6, -0.25 + 2.2, r * 2, 0.5);
        g.fillStyle = '#26262c'; g.fillRect(-r, -0.3, r * 2, 0.6);
        g.fillStyle = mix(c, '#ffffff', 0.3); g.fillRect(-r + 0.1, -0.08, r * 2 - 0.2, 0.16);
        if (th.light) {
          const f = 0.8 + 0.2 * Math.sin(t * 3 + p.i) * (Math.sin(t * 17 + p.i * 3) > 0.92 ? 0 : 1);
          g.globalCompositeOperation = 'lighter';
          g.fillStyle = alpha(c, 0.22 * f); g.fillRect(-r - 0.6, -1.0, r * 2 + 1.2, 2);
          g.fillStyle = alpha(c, 0.1 * f); g.fillRect(-r - 1.5, -2.5, r * 2 + 3, 5);
        }
      }
      g.restore();
    }
  }

  // ---------- the mini-map: the road as a ribbon, fitted into a box of size px ----------
  function miniMap(size, col = '#f4efe6') {
    const w = B.x1 - B.x0, h = B.y1 - B.y0, s = (size * 0.86) / Math.max(w, h), cv = canvas(size, size), g = cv.getContext('2d');
    const ox = (size - w * s) / 2 - B.x0 * s, oy = (size - h * s) / 2 - B.y0 * s;
    g.setTransform(s, 0, 0, s, ox, oy);
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 9 / s + 10; g.stroke(centre);
    g.strokeStyle = alpha(col, 0.85); g.lineWidth = 4 / s + 6; g.stroke(centre);
    g.strokeStyle = 'rgba(20,16,14,0.7)'; g.lineWidth = 2 / s + 3; g.stroke(centre);
    // the start line
    const st = geo.start;
    if (st) { g.save(); g.translate(st.x, st.y); g.rotate(st.a); g.fillStyle = '#ffffff'; g.fillRect(-1.5 / s, -8 / s - 6, 3 / s, 16 / s + 12); g.restore(); }
    return { cv, map: (x, y) => [x * s + ox, y * s + oy], s };
  }

  return {
    theme, th, P0, C, draw, tops, skid, scorch, reset, miniMap, edge, lights, over,
    get chunkCount() { return chunks.size; },
  };
}
