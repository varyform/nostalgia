// The venue, as one static buffer of flat-shaded low-poly geometry (@nostalgia/gl): the court by
// surface (hard, clay, grass, indoor carpet) with its run-off, crisp lines, the net (posts, a cord
// that sags to the centre strap, a white band, strands over a see-through panel), the umpire's
// chair and umpire, benches, ball kids, boards with invented names in a 5 × 7 block font, the
// stands (stepped rows, with seats for the instanced crowd that render.js bobs when it applauds), and the
// surroundings: trees under a sky by day, floodlight pylons at night, a hall with a lit roof indoors.
//
//   const V = buildVenue(app.venue);  // { data, ranges: { ground, solid, net, props, glass }, seats, sky, look, colourAt, umpire }
//
// venue: { name, short, surface, colours: { court, surround, line, boards, accent, seats, stands }, roof, night }
//
// Court units: metres, origin at the centre of the net on the ground, x across, y up, z along the
// court (near baseline +11.885). Colours may be '#hex', 'rgb(…)'/'rgba(…)' or [r, g, b] 0..255;
// rgbOf() reads its own output and mix()'s, so mixed colours mix again.
import { box, builder, cyl, frustum } from '@nostalgia/gl';

export const C = {
  base: 11.885,
  single: 4.115,
  double: 5.485,
  service: 6.4,
  netH: 0.914,
  postH: 1.07,
  postX: 6.4,
  ballR: 0.0335,
  line: 0.05,
  baseLine: 0.1,
  // the run-off to the boards
  sideX: 10.2,
  endZ: 18.3,
};

// ---------- colours ----------
/** any colour → [r, g, b] 0..255 ('#rgb', '#rrggbb', 'rgb(…)', 'rgba(…)', arrays) */
export function rgbOf(c) {
  if (Array.isArray(c) || ArrayBuffer.isView(c)) return [c[0], c[1], c[2]];
  const s = String(c ?? '#888888').trim();
  if (s.startsWith('rgb')) {
    const m = (s.match(/[\d.]+/g) ?? []).map(Number);
    return [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0];
  }
  let h = s.replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).replace(/./g, d => d + d);
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [136, 136, 136];
}
/** a and b mixed by t (0: a), as [r, g, b] */
export const mix = (a, b, t) => {
  const A = rgbOf(a), B = rgbOf(b);
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
};
/** brighter (k > 1) or darker (k < 1), as [r, g, b] */
export const shade = (c, k) => rgbOf(c).map(v => Math.max(0, Math.min(255, v * k)));
/** a colour for a canvas */
export const css = (c, a = 1) => {
  const [r, g, b] = rgbOf(c).map(v => Math.round(Math.max(0, Math.min(255, v))));
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
};
const clampC = c => [Math.max(0, Math.min(255, Math.round(c[0]))), Math.max(0, Math.min(255, Math.round(c[1]))), Math.max(0, Math.min(255, Math.round(c[2])))];

// a small deterministic hash noise for the surfaces' grain
const hash = (x, z) => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const vnoise = (x, z) => {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const bump = (d, r) => (d >= r ? 0 : (1 - (d / r) ** 2) ** 2);

// ---------- surfaces ----------
const SURFACES = {
  hard: { court: '#2f62a3', surround: '#3e7d58', lines: '#f3f5f2', grain: 0.025 },
  clay: { court: '#c2643b', surround: '#b85c35', lines: '#f1ece2', grain: 0.07 },
  grass: { court: '#4f9140', surround: '#4b8a3b', lines: '#f6f7f1', grain: 0.04 },
  indoor: { court: '#2c6c5c', surround: '#6e2c3c', lines: '#f2f3ee', grain: 0.02 },
};
const SPONSORS = ['NETCORD', 'BRISA', 'KESTREL', 'TOPSPIN TEA', 'ORBITA', 'VELLUM', 'QUILL & CO', 'SUNMARE', 'HALCYON', 'FELTWORKS', 'MARLOW AIR', 'PIVOT'];

/** the venue's look: surface colours (overridable by venue.colours), stands, boards, sky */
export function lookOf(venue = {}) {
  const surface = SURFACES[venue.surface] ? venue.surface : 'hard';
  const S = SURFACES[surface], V = venue.colours ?? {};
  return {
    surface,
    court: rgbOf(V.court ?? S.court),
    surround: rgbOf(V.surround ?? S.surround),
    lines: rgbOf(V.line ?? V.lines ?? S.lines),
    grain: S.grain,
    accent: rgbOf(V.accent ?? '#4b2a7b'),
    boards: rgbOf(V.boards ?? '#0f3d2e'),
    seats: rgbOf(V.seats ?? V.stands ?? '#2e5a8a'),
    stands: rgbOf(V.stands ?? '#8b8f94'),
    // the boards and the run-off carry the short name (KESTREL), the HUD the full one
    name: String(venue.short ?? venue.name ?? 'NETCORD').toUpperCase(),
    roof: !!venue.roof,
    night: !!venue.night && !venue.roof,
  };
}

/** the ground's colour at (x, z): the surface, its grain, wear and stripes */
function groundColour(L, x, z, cellZ) {
  const inCourt = Math.abs(x) <= C.double && Math.abs(z) <= C.base;
  let c = inCourt ? L.court : L.surround;
  const az = Math.abs(z), ax = Math.abs(x);
  const n = vnoise(x * 1.7, z * 1.7) - 0.5, fine = hash(Math.round(x * 6), Math.round(z * 6)) - 0.5;
  let k = 1 + n * L.grain * 2 + fine * L.grain * 0.6;
  if (L.surface === 'grass') {
    // mown stripes across the court, worn to earth behind the baselines and down the middle
    // twenty bands down the court, two cells each, the net between two
    const stripe = Math.floor((cellZ + C.base) / ((2 * C.base) / 20) + 100) % 2 ? 1.07 : 0.95;
    k *= stripe;
    const wear = Math.max(
      bump(Math.hypot(x / 2.6, (az - 12.4) / 1.15), 1) * 0.9,
      bump(Math.hypot(x / 1.1, (az - 9.2) / 3.2), 1) * 0.35,
      bump(Math.hypot((ax - 2.4) / 1.4, (az - 7.4) / 1.2), 1) * 0.25,
    );
    c = mix(c, '#a39466', Math.min(0.85, wear * (0.75 + n)));
  } else if (L.surface === 'clay') {
    // brushed lighter in the lanes behind the baselines, scuffed where the points are played
    const lane = bump(Math.hypot(x / 3.4, (az - 12.6) / 1.6), 1);
    c = mix(c, shade(c, 1.12), lane * 0.6);
    k *= 1 + (vnoise(x * 5.3, z * 5.3) - 0.5) * 0.05;
  } else if (L.surface === 'hard') {
    // a little rubber where the players turn
    const scuff = bump(Math.hypot(x / 3.2, (az - 12.3) / 1.0), 1);
    c = mix(c, shade(c, 0.86), scuff * 0.35);
  } else {
    const seam = Math.abs(((x + 40) % 3.66) - 1.83) < 0.02 ? 0.97 : 1;
    k *= seam;
  }
  return shade(c, k);
}

// ---------- the 5 × 7 block font for the boards ----------
const FONT = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  '&': [12, 18, 20, 8, 21, 18, 13], '-': [0, 0, 0, 31, 0, 0, 0], '.': [0, 0, 0, 0, 0, 12, 12], "'": [4, 4, 8, 0, 0, 0, 0],
  '·': [0, 0, 0, 4, 0, 0, 0], '/': [1, 1, 2, 4, 8, 16, 16],
};
const glyph = ch => FONT[ch] ?? FONT[ch.normalize?.('NFD')[0]] ?? null;
/** the width of s in font pixels (5 + 1 per character) */
export const textCols = s => Math.max(0, [...s].length * 6 - 1);

/**
 * Block text on a plane: `o` the top-left corner, `r` the reading direction, `d` down the
 * letters, `n` the way the face looks (toward the viewer), `px` metres per font pixel.
 */
function blockText(B, s, o, r, d, n, px, col) {
  const c = clampC(rgbOf(col));
  const P = (cx, cy) => [o[0] + r[0] * cx * px + d[0] * cy * px, o[1] + r[1] * cx * px + d[1] * cy * px, o[2] + r[2] * cx * px + d[2] * cy * px];
  let x0 = 0;
  for (const ch of s) {
    const g = glyph(ch.toUpperCase());
    if (g) {
      for (let row = 0; row < 7; row++) {
        let run = -1;
        for (let col = 0; col <= 5; col++) {
          const on = col < 5 && (g[row] >> (4 - col)) & 1;
          if (on && run < 0) run = col;
          if (!on && run >= 0) {
            const a = P(x0 + run, row), b = P(x0 + col, row), cc = P(x0 + col, row + 1), dd = P(x0 + run, row + 1);
            const ref = [a[0] - n[0], a[1] - n[1], a[2] - n[2]];
            B.quad(a, b, cc, dd, c, 255, ref);
            run = -1;
          }
        }
      }
    }
    x0 += 6;
  }
}

// a flat quad on the ground (y), facing up
function groundQuad(B, x0, z0, x1, z1, y, col, k = 255) {
  const c = clampC(rgbOf(col));
  B.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], c, k, [(x0 + x1) / 2, y - 1, (z0 + z1) / 2]);
}
// a quad facing away from ref, both sides when two
function face(B, a, b, c, d, col, two = false, k = 255) {
  const cc = clampC(rgbOf(col));
  const m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
  // the quad's normal, to pick a ref behind it
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.hypot(nx, ny, nz) || 1;
  B.quad(a, b, c, d, cc, k, [m[0] - nx / L, m[1] - ny / L, m[2] - nz / L]);
  if (two) B.quad(a, b, c, d, cc, k, [m[0] + nx / L, m[1] + ny / L, m[2] + nz / L]);
}

/** the painted lines as rectangles [x0, z0, x1, z1]: boundary lines lie inside the court */
export const LINES = (() => {
  const w = C.line, out = [];
  for (const s of [-1, 1]) {
    out.push([-C.double, s > 0 ? C.base - C.baseLine : -C.base, C.double, s > 0 ? C.base : -C.base + C.baseLine]);
    out.push([s > 0 ? C.double - w : -C.double, -C.base, s > 0 ? C.double : -C.double + w, C.base]);
    out.push([s > 0 ? C.single - w : -C.single, -C.base, s > 0 ? C.single : -C.single + w, C.base]);
    out.push([-C.single, s > 0 ? C.service - w : -C.service, C.single, s > 0 ? C.service : -C.service + w]);
    // the centre mark on the baseline
    out.push([-w / 2, s > 0 ? C.base - C.baseLine - 0.1 : -C.base + C.baseLine, w / 2, s > 0 ? C.base - C.baseLine : -C.base + C.baseLine + 0.1]);
  }
  out.push([-w / 2, -C.service, w / 2, C.service]);
  return out;
})();
/** how far (x, z) is from the nearest painted line (0 on one) */
export function lineDistance(x, z) {
  let best = Infinity;
  for (const [x0, z0, x1, z1] of LINES) {
    const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

/** the cord's height across the court: 1.07 at the posts, 0.914 at the strap */
export const cordY = x => C.netH + (C.postH - C.netH) * Math.min(1, (x / C.postX) ** 2);

// ---------- building ----------
export function buildVenue(venue = {}) {
  const L = lookOf(venue);
  const B = builder(1 << 16);
  let seed = 9173;
  for (const ch of L.name + L.surface) seed = (seed * 31 + ch.charCodeAt(0)) % 2147483647;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const ranges = {};
  const mark = () => B.n;
  const close = (name, from) => (ranges[name] = [from, B.n - from]);

  // ---- the ground: the court and its run-off in cells, each with its own vertices ----
  let at = mark();
  const cell = (x0, z0, x1, z1) => {
    const cz = (z0 + z1) / 2, ref = [(x0 + x1) / 2, -1, cz];
    const cols = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => clampC(groundColour(L, x, z, cz)));
    const p = [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]];
    B.tri(p[0], p[1], p[2], null, 255, ref, [cols[0], cols[1], cols[2]]);
    B.tri(p[0], p[2], p[3], null, 255, ref, [cols[0], cols[2], cols[3]]);
  };
  const grid = (x0, z0, x1, z1, step, nz0 = 0) => {
    const nx = Math.max(1, Math.round((x1 - x0) / step)), nz = nz0 || Math.max(1, Math.round((z1 - z0) / step));
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) cell(x0 + ((x1 - x0) * i) / nx, z0 + ((z1 - z0) * j) / nz, x0 + ((x1 - x0) * (i + 1)) / nx, z0 + ((z1 - z0) * (j + 1)) / nz);
  };
  // the court in 40 rows (grass stripes are two rows wide), the run-off in rows of about that
  grid(-C.double, -C.base, C.double, C.base, 0.6, 40);
  for (const sx of [-1, 1]) {
    const xa = sx < 0 ? -C.sideX : C.double, xb = sx < 0 ? -C.double : C.sideX;
    grid(xa, -C.base, xb, C.base, 0.7, 40);
    grid(xa, C.base, xb, C.endZ, 0.7, 11);
    grid(xa, -C.endZ, xb, -C.base, 0.7, 11);
  }
  grid(-C.double, C.base, C.double, C.endZ, 0.7, 11);
  grid(-C.double, -C.endZ, C.double, -C.base, 0.7, 11);
  // beyond the boards: the stands' floor, and the land around
  const floorCol = L.roof ? '#2b2e33' : L.night ? '#1f2a22' : '#55734a';
  groundQuad(B, -C.sideX - 1.2, -C.endZ - 1.2, C.sideX + 1.2, C.endZ + 1.2, -0.01, shade(L.surround, 0.55));
  groundQuad(B, -260, -260, 260, 260, -0.04, floorCol);

  // the lines, a few millimetres up; boundary lines lie inside the court
  const LY = 0.004;
  for (const [x0, z0, x1, z1] of LINES) groundQuad(B, x0, z0, x1, z1, LY, L.lines);
  // the venue's name painted in the run-off behind each baseline, read from the near end
  {
    const px = 0.16, cols = textCols(L.name), wid = cols * px;
    const tc = mix(L.surround, '#ffffff', L.surface === 'clay' ? 0.28 : 0.22);
    for (const zc of [-16.2, 15.0]) blockText(B, L.name, [-wid / 2, 0.003, zc - 3.5 * px], [1, 0, 0], [0, 0, 1], [0, 1, 0], px, tc);
  }
  close('ground', at);

  // ---- the solid venue: boards, stands, surroundings ----
  at = mark();
  // boards around the run-off, panels sized to their names
  const boardH = 0.92, boardT = 0.06;
  let sp = Math.floor(rnd() * SPONSORS.length);
  const boardRun = (len, place) => {
    // place(u0, u1) → corners for the panel spanning u0..u1 along the run
    let u = 0, k = 0;
    while (u < len - 0.5) {
      const name = k % 3 === 1 ? L.name : SPONSORS[sp++ % SPONSORS.length];
      const px = name.length > 10 ? 0.075 : 0.09;
      let wpan = textCols(name) * px + 1.2;
      if (u + wpan > len) wpan = len - u;
      place(u, u + wpan, name, px, k);
      u += wpan;
      k++;
    }
  };
  const boardColours = [L.boards, L.accent, shade(L.boards, 0.8)];
  const textColours = ['#ffffff', '#e8f04a', '#ffffff'];
  const panel = (c0, c1, n, name, px, k) => {
    // c0, c1: the panel's ends on the ground (left and right as the court sees it); n: toward the court
    const dx = c1[0] - c0[0], dz = c1[2] - c0[2], len = Math.hypot(dx, dz), r = [dx / len, 0, dz / len];
    const mid = [(c0[0] + c1[0]) / 2, boardH / 2, (c0[2] + c1[2]) / 2];
    box(B, { at: mid, yaw: Math.atan2(-r[2], r[0]) }, [len - 0.02, boardH, boardT], boardColours[k % 3]);
    const cols = textCols(name), tw = cols * px;
    if (tw > len - 0.1) return;
    const o = [mid[0] - r[0] * (tw / 2) + n[0] * (boardT / 2 + 0.004), boardH / 2 + 3.5 * px, mid[2] - r[2] * (tw / 2) + n[2] * (boardT / 2 + 0.004)];
    blockText(B, name, o, r, [0, -1, 0], n, px, textColours[k % 3]);
  };
  const X = C.sideX, Z = C.endZ;
  // far end (faces +z; read left to right as +x), near end (faces −z; reads toward −x)
  boardRun(2 * X, (u0, u1, nm, px, k) => panel([-X + u0, 0, -Z], [-X + u1, 0, -Z], [0, 0, 1], nm, px, k));
  boardRun(2 * X, (u0, u1, nm, px, k) => panel([X - u0, 0, Z], [X - u1, 0, Z], [0, 0, -1], nm, px, k));
  // the sides: at +x facing −x (reads toward +z... seen from the court, toward −z is to the left)
  boardRun(2 * Z, (u0, u1, nm, px, k) => panel([X, 0, -Z + u0], [X, 0, -Z + u1], [-1, 0, 0], nm, px, k));
  boardRun(2 * Z, (u0, u1, nm, px, k) => panel([-X, 0, Z - u0], [-X, 0, Z - u1], [1, 0, 0], nm, px, k));

  // the stands: stepped rows behind each side, the crowd's seats recorded for the instances
  const seats = [];
  const ROW_D = 0.85, ROW_H = 0.45, ROWS_SIDE = 12, ROWS_END = 11, FRONT = 0.7;
  const concrete = L.stands, seatCol = L.seats;
  const stand = (o, r, n, len, rows, gapEvery) => {
    // o: the front-left corner on the ground; r along the stand; n away from the court (outward)
    for (let k = 0; k < rows; k++) {
      const y = FRONT + k * ROW_H, d0 = k * ROW_D, d1 = d0 + ROW_D;
      const c = [o[0] + r[0] * len / 2 + n[0] * (d0 + d1) / 2, 0, o[2] + r[2] * len / 2 + n[2] * (d0 + d1) / 2];
      const yaw = Math.atan2(-r[2], r[0]);
      box(B, { at: [c[0], y / 2, c[2]], yaw }, [len, y, ROW_D], k % 2 ? shade(concrete, 0.94) : concrete);
      // the seat row along the back of the step
      const sc = [c[0] + n[0] * 0.18, y + 0.2, c[2] + n[2] * 0.18];
      box(B, { at: sc, yaw }, [len, 0.4, 0.34], k % 2 ? seatCol : shade(seatCol, 0.9));
      // aisles every gapEvery m; spectators on the seats
      const nSeat = Math.floor(len / 0.56);
      for (let i = 0; i < nSeat; i++) {
        const u = (i + 0.5) * (len / nSeat);
        if (gapEvery && u % gapEvery < 0.9) continue;
        if (rnd() < 0.12) continue;
        seats.push({ x: o[0] + r[0] * u + n[0] * (d0 + 0.6), y: y + 0.4, z: o[2] + r[2] * u + n[2] * (d0 + 0.6), yaw: Math.atan2(n[0], n[2]) });
      }
    }
    // the back wall
    const top = FRONT + rows * ROW_H, dd = rows * ROW_D;
    const c = [o[0] + r[0] * len / 2 + n[0] * (dd + 0.2), 0, o[2] + r[2] * len / 2 + n[2] * (dd + 0.2)];
    box(B, { at: [c[0], (top + 1.6) / 2, c[2]], yaw: Math.atan2(-r[2], r[0]) }, [len, top + 1.6, 0.4], shade(concrete, 0.7));
    // the front wall's coloured face
    const f = [o[0] + r[0] * len / 2 - n[0] * 0.05, 0, o[2] + r[2] * len / 2 - n[2] * 0.05];
    box(B, { at: [f[0], FRONT / 2, f[2]], yaw: Math.atan2(-r[2], r[0]) }, [len, FRONT, 0.1], L.accent);
  };
  const SX = C.sideX + 1.1, SZ = C.endZ + 1.3, SL = 2 * (C.endZ + 1.0), EL = 2 * (C.sideX + 0.9);
  stand([SX, 0, -SL / 2], [0, 0, 1], [1, 0, 0], SL, ROWS_SIDE, 7.5);
  stand([-SX, 0, SL / 2], [0, 0, -1], [-1, 0, 0], SL, ROWS_SIDE, 7.5);
  stand([-EL / 2, 0, -SZ], [1, 0, 0], [0, 0, -1], EL, ROWS_END, 7);
  stand([EL / 2, 0, SZ], [-1, 0, 0], [0, 0, 1], EL, ROWS_END, 7);
  // the corners: towers, one carrying a dark scoreboard face with a glowing strip
  const sideD = ROWS_SIDE * ROW_D + 0.6, endD = ROWS_END * ROW_D + 0.6;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const cx = sx * (SX + sideD / 2), cz = sz * (SZ + endD / 2), h = FRONT + ROWS_END * ROW_H + 2.4;
      box(B, { at: [cx, h / 2, cz] }, [sideD, h, endD], shade(concrete, 0.62));
      if (sx < 0 && sz < 0) {
        box(B, { at: [cx, h + 2.2, cz] }, [6.4, 4.4, 0.5], '#16181c');
        box(B, { at: [cx, h + 2.2, cz + 0.27] }, [5.8, 3.6, 0.05], '#0d3a2a', 0);
        box(B, { at: [cx, h + 3.3, cz + 0.3] }, [5.0, 0.5, 0.05], '#e8f04a', 0);
      }
    }

  if (L.roof) {
    // the hall's walls (its roof is apart, below)
    const HX = 24, HZ = 32, HY = 17, wall = '#3a3f48';
    const inward = (a, b, c, d, col, k = 255) => {
      const m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
      B.quad(a, b, c, d, clampC(rgbOf(col)), k, [m[0] * 1.5, m[1], m[2] * 1.5]);
    };
    inward([-HX, 0, -HZ], [HX, 0, -HZ], [HX, HY, -HZ], [-HX, HY, -HZ], wall);
    inward([-HX, 0, HZ], [HX, 0, HZ], [HX, HY, HZ], [-HX, HY, HZ], wall);
    inward([-HX, 0, -HZ], [-HX, 0, HZ], [-HX, HY, HZ], [-HX, HY, -HZ], shade(wall, 0.9));
    inward([HX, 0, -HZ], [HX, 0, HZ], [HX, HY, HZ], [HX, HY, -HZ], shade(wall, 0.9));
  }
  close('solid', at);

  // ---- the roof, apart: the overhead camera looks down through it ----
  at = mark();
  if (L.roof) {
    const HX = 24, HZ = 32, HY = 17, roof = '#22262d';
    B.quad([-HX, HY, -HZ], [HX, HY, -HZ], [HX, HY, HZ], [-HX, HY, HZ], clampC(rgbOf(roof)), 255, [0, HY + 10, 0]);
    for (let z = -HZ + 4; z < HZ; z += 5.5) box(B, { at: [0, HY - 1.2, z] }, [2 * HX, 0.5, 0.5], '#3c424c');
    for (const x of [-7.5, 0, 7.5]) box(B, { at: [x, HY - 1.6, 0] }, [0.9, 0.18, 30], '#fff4dc', 0);
  }
  close('roof', at);
  // ---- outside: floodlight pylons at night, trees and hills by day ----
  at = mark();
  if (L.roof) {
    // under a roof there's no outside
  } else if (L.night) {
    // four pylons with banks of glowing lamps, turned to the court
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * 25, z = sz * 33, h = 26;
        cyl(B, { at: [x, 0, z] }, 0.55, 0.35, h, 8, '#596069');
        // local −z toward the court
        const yaw = Math.atan2(x, z);
        box(B, { at: [x, h + 1.3, z], yaw }, [5.2, 3.2, 0.5], '#2c3038');
        for (let i = 0; i < 4; i++)
          for (let j = 0; j < 2; j++) {
            const lx = (i - 1.5) * 1.15, ly = h + 0.6 + j * 1.35;
            const cx = x + Math.cos(yaw) * lx - Math.sin(yaw) * 0.3, cz = z - Math.sin(yaw) * lx - Math.cos(yaw) * 0.3;
            box(B, { at: [cx, ly, cz], yaw }, [0.9, 0.9, 0.12], '#fffbe8', 0);
          }
      }
  } else {
    // trees beyond the stands, and a few far hills
    for (let i = 0; i < 140; i++) {
      const a = rnd() * Math.PI * 2, rr = 44 + rnd() * 40;
      const x = Math.cos(a) * rr * 0.85, z = Math.sin(a) * rr * 1.1;
      if (Math.abs(x) < 28 && Math.abs(z) < 36) continue;
      const h = 7 + rnd() * 9, g = mix('#2f5a2c', '#4f7a3a', rnd());
      cyl(B, { at: [x, 0, z] }, 0.35, 0.25, h * 0.35, 5, '#5a4632', 255, false);
      cyl(B, { at: [x, h * 0.25, z], yaw: rnd() * 3 }, h * 0.28, 0, h * 0.85, 6, clampC(g));
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rnd(), rr = 210;
      frustum(B, { at: [Math.cos(a) * rr, -0.5, Math.sin(a) * rr], yaw: a }, [120, 22 + rnd() * 18, 60], [40, 20], clampC(mix('#6f8a7a', '#8aa39a', rnd())));
    }
  }
  close('outside', at);

  // ---- the net's solid parts (posts, cord, band, strap, strands): shadow casters too ----
  at = mark();
  const postCol = '#1f3d2f', SEG = 32;
  for (const s of [-1, 1]) {
    cyl(B, { at: [s * C.postX, 0, 0] }, 0.045, 0.045, C.postH + 0.04, 8, postCol);
    cyl(B, { at: [s * C.postX, C.postH + 0.04, 0] }, 0.055, 0.0, 0.04, 8, postCol);
    // the winder
    box(B, { at: [s * (C.postX + 0.06), 0.55, 0] }, [0.06, 0.08, 0.05], '#2a2d30');
  }
  const bandH = 0.065, bt = 0.006;
  for (let i = 0; i < SEG; i++) {
    const x0 = -C.postX + (2 * C.postX * i) / SEG, x1 = -C.postX + (2 * C.postX * (i + 1)) / SEG;
    const y0 = cordY(x0), y1 = cordY(x1);
    // the white band, both faces and its top
    for (const s of [-1, 1]) face(B, [x0, y0 - bandH, s * bt], [x1, y1 - bandH, s * bt], [x1, y1, s * bt], [x0, y0, s * bt], '#f4f4ee');
    face(B, [x0, y0, -bt], [x1, y1, -bt], [x1, y1, bt], [x0, y0, bt], '#ffffff');
  }
  // the centre strap
  for (const s of [-1, 1]) face(B, [-0.025, 0, s * (bt + 0.001)], [0.025, 0, s * (bt + 0.001)], [0.025, C.netH, s * (bt + 0.001)], [-0.025, C.netH, s * (bt + 0.001)], '#f4f4ee');
  // the strands: a coarse diamond-free square mesh, both sides
  const strand = '#141814', sw = 0.008;
  for (let x = -C.postX + 0.1; x < C.postX - 0.05; x += 0.16) {
    const top = cordY(x) - bandH;
    face(B, [x - sw / 2, 0.04, 0], [x + sw / 2, 0.04, 0], [x + sw / 2, top, 0], [x - sw / 2, top, 0], strand, true);
  }
  for (let y = 0.04; y < C.netH - bandH; y += 0.12) {
    for (let i = 0; i < 8; i++) {
      const x0 = -C.postX + (2 * C.postX * i) / 8, x1 = -C.postX + (2 * C.postX * (i + 1)) / 8;
      const t0 = Math.min(y, cordY(x0) - bandH), t1 = Math.min(y, cordY(x1) - bandH);
      face(B, [x0, t0 - sw / 2, 0], [x1, t1 - sw / 2, 0], [x1, t1 + sw / 2, 0], [x0, t0 + sw / 2, 0], strand, true);
    }
  }
  close('net', at);

  // ---- props: the umpire's chair and umpire, benches, ball kids ----
  at = mark();
  const CX = -(C.postX + 1.15), wood = '#2b4f3d', blazer = L.accent, skin = '#c99a78';
  for (const dz of [-0.35, 0.35])
    for (const dx of [-0.3, 0.3]) box(B, { at: [CX + dx, 0.95, dz] }, [0.06, 1.9, 0.06], wood);
  box(B, { at: [CX, 1.9, 0] }, [0.8, 0.08, 0.9], wood);
  box(B, { at: [CX - 0.38, 2.35, 0] }, [0.06, 0.9, 0.8], wood);
  for (let k = 0; k < 4; k++) box(B, { at: [CX + 0.34, 0.35 + k * 0.42, 0] }, [0.04, 0.04, 0.6], wood);
  box(B, { at: [CX - 0.02, 1.97, 0] }, [0.5, 0.06, 0.5], '#e9e6dc');
  // the umpire, sitting, facing the court (+x)
  box(B, { at: [CX - 0.05, 2.3, 0] }, [0.28, 0.6, 0.42], blazer);
  box(B, { at: [CX + 0.15, 2.05, 0.11] }, [0.42, 0.14, 0.14], '#2a2c33');
  box(B, { at: [CX + 0.15, 2.05, -0.11] }, [0.42, 0.14, 0.14], '#2a2c33');
  box(B, { at: [CX - 0.02, 2.75, 0] }, [0.2, 0.24, 0.19], skin);
  box(B, { at: [CX - 0.05, 2.86, 0] }, [0.21, 0.07, 0.2], '#3a2a20');
  box(B, { at: [CX + 0.16, 2.35, 0.2] }, [0.3, 0.09, 0.09], blazer);
  box(B, { at: [CX + 0.16, 2.35, -0.2] }, [0.3, 0.09, 0.09], blazer);
  // the players' benches and their cool boxes
  for (const s of [-1, 1]) {
    const z = s * 2.1, bx = -(C.sideX - 0.55);
    box(B, { at: [bx, 0.45, z] }, [0.5, 0.06, 1.7], '#e8e4da');
    box(B, { at: [bx - 0.22, 0.75, z] }, [0.06, 0.6, 1.7], '#e8e4da');
    for (const e of [-0.75, 0.75]) box(B, { at: [bx, 0.22, z + e] }, [0.45, 0.44, 0.06], '#9aa0a6');
    box(B, { at: [bx + 0.05, 0.2, z + s * 1.15] }, [0.4, 0.4, 0.36], L.accent);
  }
  // ball kids: crouched at the net posts and standing at the back corners
  const kid = (x, z, yaw, crouch) => {
    const T = xfLite(x, z, yaw);
    const shirt = L.accent, shorts = '#1d1f26';
    if (crouch) {
      box(B, { at: T(0, 0.38, 0), yaw }, [0.3, 0.42, 0.24], shirt);
      box(B, { at: T(0.12, 0.18, 0.09), yaw }, [0.36, 0.14, 0.12], shorts);
      box(B, { at: T(0.12, 0.18, -0.09), yaw }, [0.36, 0.14, 0.12], shorts);
      box(B, { at: T(0.04, 0.7, 0), yaw }, [0.17, 0.2, 0.16], skin);
    } else {
      box(B, { at: T(0, 1.0, 0), yaw }, [0.22, 0.5, 0.32], shirt);
      box(B, { at: T(0, 0.58, 0), yaw }, [0.2, 0.34, 0.3], shorts);
      box(B, { at: T(0, 0.22, 0.08), yaw }, [0.1, 0.44, 0.1], skin);
      box(B, { at: T(0, 0.22, -0.08), yaw }, [0.1, 0.44, 0.1], skin);
      box(B, { at: T(0, 1.38, 0), yaw }, [0.17, 0.21, 0.16], skin);
    }
  };
  kid(C.postX + 0.55, 0.5, Math.PI, true);
  kid(-(C.postX + 0.4), -0.9, 0, true);
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) kid(sx * 7.2, sz * (C.endZ - 0.45), sz > 0 ? -Math.PI / 2 : Math.PI / 2, false);
  close('props', at);

  // ---- see-through: the net's panel ----
  at = mark();
  const panelCol = clampC(rgbOf('#0c100c'));
  for (let i = 0; i < SEG; i++) {
    const x0 = -C.postX + (2 * C.postX * i) / SEG, x1 = -C.postX + (2 * C.postX * (i + 1)) / SEG;
    B.quad([x0, 0.03, 0], [x1, 0.03, 0], [x1, cordY(x1) - bandH, 0], [x0, cordY(x0) - bandH, 0], panelCol, 255, [0, 0.5, -1]);
  }
  close('glass', at);

  return {
    data: B.data(),
    ranges,
    look: L,
    seats,
    sky: skyOf(L),
    colourAt: (x, z) => groundColour(L, x, z, z),
    umpire: [CX, 2.75, 0],
  };
}

// a tiny placement helper for props: local (x, y, z) about (ox, oz) turned by yaw, as gl's xf
function xfLite(ox, oz, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return (x, y, z) => [ox + x * c + z * s, y, oz - x * s + z * c];
}

/** the sky and light for a venue: day sun, floodlights at night, a roof's even light indoors */
export function skyOf(L) {
  const norm = v => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  if (L.roof) return { zenith: '#1a1d23', horizon: '#2a2e36', haze: '#30343c', sunCol: '#fff4e0', sunN: norm([0.12, 1, 0.22]), ambient: 0.62, fog: 0.0016, shadow: 0.24 };
  if (L.night) return { zenith: '#04081a', horizon: '#1a2440', haze: '#222c48', sunCol: '#fff6e4', sunN: norm([0.22, 1, 0.34]), ambient: 0.56, fog: 0.0022, shadow: 0.3 };
  const S = { hard: [0.42, 0.78, 0.46], clay: [0.5, 0.7, 0.5], grass: [0.36, 0.82, 0.44], indoor: [0.3, 0.9, 0.3] }[L.surface];
  return { zenith: '#3a78c4', horizon: '#c9deec', haze: '#e6edf0', sunCol: '#fff3dc', sunN: norm(S), ambient: 0.5, fog: 0.0021, shadow: 0.42 };
}

/** the crowd's two instance meshes, built into B: a seated body (shirt) and a head (skin, hair) */
export function crowdMeshes(B) {
  const a = B.n;
  box(B, { at: [0, 0.27, 0] }, [0.4, 0.5, 0.26], '#ffffff');
  box(B, { at: [0, 0.02, -0.2] }, [0.36, 0.14, 0.4], '#c8c8c8');
  box(B, { at: [0.2, 0.22, -0.06] }, [0.09, 0.36, 0.1], '#ffffff');
  box(B, { at: [-0.2, 0.22, -0.06] }, [0.09, 0.36, 0.1], '#ffffff');
  const body = [a, B.n - a];
  const b = B.n;
  box(B, { at: [0, 0.66, 0] }, [0.18, 0.21, 0.19], '#ffffff');
  box(B, { at: [0, 0.77, 0.015] }, [0.19, 0.05, 0.2], '#5a4a3c');
  const head = [b, B.n - b];
  return { body, head };
}
