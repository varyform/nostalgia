// The three scenes: their floors, stairs, the sweetheart's walk, the glove's spot, the scene's
// trick (a crane crate, a bouncy awning, a sandbag swing) and its pests, plus how each loop
// speeds things up. Coordinates are the 1920 × 1080 reference frame the renderer draws in;
// a floor's y is where feet stand.
//
//   floors[f].segs  walkable spans [x0, x1] (multiples of 40); walking off an end drops you
//                   to the floor below. `wrap` floors join their screen edges.
//   stairs          { f, xb, xt }: from x = xb on floor f + 1 up to x = xt on floor f.
export const W = 1920, H = 1080;
export const FLOOR_Y = [250, 470, 690, 910];
export const WATER_Y = 972; // a keepsake that gets this low floats, then sinks
export const FLOORS = FLOOR_Y.length;
export const BOTTOM = FLOORS - 1;

export const SCENES = [
  {
    id: 'harbour', name: 'Harbour Lane', keep: 'heart', keepName: 'paper hearts', quota: 14,
    blurb: 'Clementine folds paper hearts on the top balcony',
    fall: { vy: 82, amp: [30, 70], freq: [1.4, 2.2] },
    floors: [
      { segs: [[320, 1600]] },
      { segs: [[0, 840], [1080, 1920]], wrap: true },
      { segs: [[120, 1800]] },
      { segs: [[0, 1920]], wrap: true },
    ],
    stairs: [
      { f: 0, xb: 540, xt: 400 }, { f: 0, xb: 1380, xt: 1520 },
      { f: 1, xb: 960, xt: 1180 }, { f: 1, xb: 240, xt: 80 },
      { f: 2, xb: 600, xt: 440 }, { f: 2, xb: 1500, xt: 1660 },
    ],
    sweet: [380, 1540],
    glove: { f: 2, x: 1740 },
    gimmick: { kind: 'crate', f: 1, x: 680 },
    thrower: { x: 1858, y: 352, dir: -1 },
    bird: false,
    hero: { f: 3, x: 900 }, brute: { f: 1, x: 1700 },
  },
  {
    id: 'park', name: 'Bandstand Park', keep: 'note', keepName: 'music notes', quota: 14,
    blurb: 'Clementine plays her tin whistle from the bandstand roof',
    fall: { vy: 70, amp: [60, 110], freq: [1.0, 1.6] },
    floors: [
      { segs: [[240, 1680]] },
      { segs: [[0, 720], [920, 1920]] },
      { segs: [[0, 1920]], wrap: true },
      { segs: [[0, 1920]], wrap: true },
    ],
    stairs: [
      { f: 0, xb: 420, xt: 280 }, { f: 0, xb: 1500, xt: 1640 },
      { f: 1, xb: 760, xt: 600 }, { f: 1, xb: 1180, xt: 1340 },
      { f: 2, xb: 300, xt: 140 }, { f: 2, xb: 1620, xt: 1780 },
    ],
    sweet: [300, 1620],
    glove: { f: 1, x: 70 },
    gimmick: { kind: 'spring', f: 3, x: 960, to: 1 },
    thrower: null,
    bird: true,
    hero: { f: 3, x: 640 }, brute: { f: 1, x: 1760 },
  },
  {
    id: 'roofs', name: 'Lamplight Roofs', keep: 'star', keepName: 'falling stars', quota: 12,
    blurb: 'Clementine catches stars from the ridge; light up her constellation',
    fall: { vy: 104, amp: [12, 34], freq: [1.6, 2.6] },
    floors: [
      { segs: [[400, 1520]] },
      { segs: [[0, 1920]], wrap: true },
      { segs: [[0, 600], [760, 1160], [1320, 1920]] },
      { segs: [[0, 1920]], wrap: true },
    ],
    stairs: [
      { f: 0, xb: 560, xt: 420 }, { f: 0, xb: 1360, xt: 1500 },
      { f: 1, xb: 300, xt: 140 }, { f: 1, xb: 1060, xt: 1220 }, { f: 1, xb: 1620, xt: 1780 },
      { f: 2, xb: 320, xt: 480 }, { f: 2, xb: 660, xt: 820 }, { f: 2, xb: 1280, xt: 1440 },
    ],
    sweet: [460, 1460],
    glove: { f: 0, x: 1490 },
    gimmick: { kind: 'swing', f: 1, px: 240, py: 96, len: 250 },
    thrower: { x: 62, y: 572, dir: 1 },
    bird: true,
    hero: { f: 3, x: 960 }, brute: { f: 1, x: 1700 },
  },
];

// how a scene plays on a given loop (0 = first time round)
export function params(scene, loop) {
  const k = Math.min(loop, 4), sc = SCENES[scene], q = 1 - 0.07 * k;
  return {
    bruteV: 215 + 20 * k + (scene === 2 ? 12 : 0),
    fallV: sc.fall.vy * (1 + 0.06 * k),
    float: Math.max(3.4, 6 - 0.5 * k),
    gap: [2.5 * q, 4.3 * q],
    maxLive: k >= 2 || scene === 2 ? 3 : 2,
    throwGap: [4.6 * q, 7.2 * q],
    birdGap: [6.5 * q, 10.5 * q],
    birdV: 540 + 40 * k,
    power: Math.max(5, 7.5 - 0.5 * k),
    swipeWind: Math.max(0.22, 0.32 - 0.02 * k),
    think: Math.max(0.16, 0.32 - 0.03 * k),
    flex: Math.max(0.04, 0.12 - 0.02 * k), // chance per look that he stops to show off when far away
    throwAt: k >= 1 || scene === 2 ? 0.35 : 0.2, // the brute's own bottle, chance per long look
  };
}

// ---------- floor geometry, shared by the sim, the autopilot and the tools ----------
export const mod = (x, m) => ((x % m) + m) % m;
export function segAt(sc, f, x) {
  const segs = sc.floors[f].segs;
  for (let i = 0; i < segs.length; i++) if (x >= segs[i][0] && x <= segs[i][1]) return i;
  return -1;
}
// a walkable piece of floor: segments joined across the screen edge on a wrap floor are one
export function pieceAt(sc, f, x) {
  const fl = sc.floors[f], i = segAt(sc, f, x);
  if (i < 0 || !fl.wrap) return i;
  const last = fl.segs.length - 1;
  return i === last && fl.segs[last][1] >= W && fl.segs[0][0] <= 0 ? 0 : i;
}
// signed shortest x offset from a to b on floor f (across the edge on a wrap floor)
export function dxOn(sc, f, a, b) {
  let d = b - a;
  if (sc.floors[f].wrap) d = mod(d + W / 2, W) - W / 2;
  return d;
}
// the walking direction from x to tx along floor f without dropping through a gap, and its
// length; dir 0 when no such way exists
export function walkWay(sc, f, x, tx) {
  const fl = sc.floors[f];
  let best = { dir: 0, dist: Infinity };
  for (const dir of [-1, 1]) {
    let d = dir * (tx - x);
    if (fl.wrap) d = mod(d, W);
    else if (d < 0) continue;
    let ok = true;
    for (let s = 20; s < d; s += 20) {
      const px = fl.wrap ? mod(x + dir * s, W) : x + dir * s;
      if (segAt(sc, f, px) < 0) { ok = false; break; }
    }
    if (ok && d < best.dist) best = { dir, dist: d };
  }
  return best;
}
export function stairPos(sc, s, p) {
  const st = sc.stairs[s];
  return { x: st.xb + (st.xt - st.xb) * p, y: FLOOR_Y[st.f + 1] + (FLOOR_Y[st.f] - FLOOR_Y[st.f + 1]) * p };
}
export const stairLen = st => Math.hypot(st.xt - st.xb, FLOOR_Y[st.f + 1] - FLOOR_Y[st.f]);
// the first floor below floor f (or below height y) with ground at x
export function floorBelow(sc, f, x) {
  for (let k = f + 1; k < FLOORS; k++) if (segAt(sc, k, x) >= 0) return k;
  return -1;
}
