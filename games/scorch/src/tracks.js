// Scorch's eight roads, two in each setting. Each is drawn as a polygon of corners, each corner
// rounded off with an arc of its own radius (straights between, like a model railway), so the loop
// closes by itself; the lap starts `start` metres into the straight leaving the first corner. The
// corners carry the road's width from there on, and both a corner and the straight leaving it
// (`e`) can carry surfaces, obstacles on the road and pickup spots, placed by a fraction along
// the piece and a lateral offset (+ = right of travel). Scenery beside the road is strewn from a
// seed per track, kept clear of every part of it.
//
// Exports TRACKS: [{ id, name, theme, laps, pts: [[x, y, w], …], surfaces, props, pickups }]
// (see the contract); pts come every ~4 m along the laid path, in order of travel.

const R2D = Math.PI / 180;

// mulberry32, for the scenery
function rng(seed) {
  let s = seed | 0;
  return () => {
    let t = (s = (s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = str => [...str].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

// pieces laid end to end from (x, y) heading a: { dir: 0 straight | 1 right | -1 left, L, R, opts }
function walk(pieces, x, y, a) {
  let d = 0;
  return pieces.map(p => {
    const seg = { ...p, x, y, a, d };
    ({ x, y, a } = pose(seg, 1));
    d += p.L;
    return seg;
  });
}

// a point on a laid piece, f of the way along
function pose(seg, f) {
  const l = seg.L * f;
  if (!seg.dir) return { x: seg.x + Math.cos(seg.a) * l, y: seg.y + Math.sin(seg.a) * l, a: seg.a };
  // the arc's centre lies to the turning side: right normal (−sin a, cos a) × radius × dir
  const da = (l / seg.R) * seg.dir, cx = seg.x - Math.sin(seg.a) * seg.R * seg.dir, cy = seg.y + Math.cos(seg.a) * seg.R * seg.dir;
  const ox = seg.x - cx, oy = seg.y - cy, c = Math.cos(da), s = Math.sin(da);
  return { x: cx + ox * c - oy * s, y: cy + ox * s + oy * c, a: seg.a + da };
}

// a polygon of corners [x, y, radius, opts] → pieces from the start line round to it again
function piecesOf(id, corners, start) {
  const n = corners.length, P = k => corners[(k + n) % n];
  const dirTo = k => Math.atan2(P(k + 1)[1] - P(k)[1], P(k + 1)[0] - P(k)[0]);
  const turn = k => { const t = dirTo(k) - dirTo(k - 1); return Math.atan2(Math.sin(t), Math.cos(t)); };
  const tan = k => P(k)[2] * Math.tan(Math.abs(turn(k)) / 2); // how far the arc cuts into each side
  const out = [];
  for (let k = 0; k < n; k++) {
    const o = P(k)[3] || {}, th = turn(k);
    const arc = { dir: Math.sign(th), R: P(k)[2], L: P(k)[2] * Math.abs(th), opts: o, corner: k };
    const len = Math.hypot(P(k + 1)[0] - P(k)[0], P(k + 1)[1] - P(k)[1]) - tan(k) - tan(k + 1);
    if (len < 0) throw new Error(`${id}: corners ${k} and ${(k + 1) % n} overlap by ${(-len).toFixed(1)} m`);
    const st = { dir: 0, R: 0, L: len, opts: { ...o.e, w: undefined }, edge: k };
    if (arc.L > 0) out.push(arc);
    out.push(st);
  }
  // rotate so the lap begins `start` metres into the straight leaving corner 0 (split in two)
  const i = out.findIndex(p => p.edge === 0), e = out[i];
  if (!(start > 0 && start < e.L)) throw new Error(`${id}: start ${start} outside the first straight (${e.L.toFixed(1)} m)`);
  const fA = start / e.L;
  const rest = [...out.slice(i + 1), ...out.slice(0, i)];
  const head = { ...e, L: e.L - start, part: [fA, 1] }, tail = { ...e, L: start, part: [0, fA] };
  const k0 = P(0), dir0 = dirTo(0), sx = k0[0] + Math.cos(dir0) * (tan(0) + start), sy = k0[1] + Math.sin(dir0) * (tan(0) + start);
  const turns = out.reduce((t, p) => t + (p.dir ? p.dir * p.L / p.R : 0), 0);
  if (Math.abs(Math.abs(turns) - Math.PI * 2) > 1e-6) throw new Error(`${id}: the corners turn ${(turns / R2D).toFixed(1)}°, not one circle`);
  return { pieces: [head, ...rest, tail], x: sx, y: sy, a: dir0 };
}

function lay({ id, name, theme, laps, w: w0, scale = 1, start = 30, corners, scenery }) {
  corners = corners.map(([x, y, r, o]) => [x * scale, y * scale, r * scale, o]);
  const { pieces, x: X0, y: Y0, a: A0 } = piecesOf(id, corners, start);
  const segs = walk(pieces, X0, Y0, A0), len = segs.reduce((t, s) => t + s.L, 0);
  // a placement fraction on a straight that was split at the start line → the right half
  const where = (s, f) => (s.part ? (f >= s.part[0] && f <= s.part[1] ? (f - s.part[0]) / (s.part[1] - s.part[0]) : null) : f);

  // the width along the lap: set at a corner, carried on, blended in from the piece before over
  // its first 16 m
  // (twice round, so the first pieces carry on the width the lap ends with)
  const wOf = [];
  let w = w0;
  for (let k = 0; k < segs.length * 2; k++) { if (segs[k % segs.length].opts.w) w = segs[k % segs.length].opts.w; wOf[k % segs.length] = w; }
  const ws = segs.map((s, k) => [wOf[(k - 1 + segs.length) % segs.length], wOf[k]]);
  const widthAt = (k, l) => {
    const [a, b] = ws[k], t = Math.min(1, l / 16), e = t * t * (3 - 2 * t);
    return a + (b - a) * e;
  };
  const pts = [], n = Math.round(len / 4);
  for (let i = 0, k = 0; i < n; i++) {
    const d = (i * len) / n;
    while (k < segs.length - 1 && segs[k + 1].d <= d) k++;
    const p = pose(segs[k], (d - segs[k].d) / segs[k].L);
    pts.push([+p.x.toFixed(3), +p.y.toFixed(3), +widthAt(k, d - segs[k].d).toFixed(3)]);
  }
  const place = (k, f, off) => {
    const s = segs[k], p = pose(s, f), w = widthAt(k, s.L * f);
    return { x: p.x - Math.sin(p.a) * off, y: p.y + Math.cos(p.a) * off, a: p.a, w };
  };
  const surfaces = [], props = [], pickups = [];
  segs.forEach((s, k) => {
    const o = s.opts;
    if (o.surf) {
      const [kind, g0, g1] = typeof o.surf === 'string' ? [o.surf, 0, 1] : o.surf;
      // on a split straight, each half takes its share of the stretch
      const f0 = s.part ? Math.max(0, (g0 - s.part[0]) / (s.part[1] - s.part[0])) : g0;
      const f1 = s.part ? Math.min(1, (g1 - s.part[0]) / (s.part[1] - s.part[0])) : g1;
      if (f1 > f0) surfaces.push({ from: +(s.d + s.L * f0).toFixed(2), to: +(s.d + s.L * f1).toFixed(2), kind });
    }
    for (const [kind, f, off, r, solid = true] of o.props || []) {
      const g = where(s, f);
      if (g == null) continue;
      const p = place(k, g, off);
      props.push({ kind, x: +p.x.toFixed(2), y: +p.y.toFixed(2), r, a: +p.a.toFixed(3), solid });
    }
    for (const [f, off] of o.pick || []) {
      const g = where(s, f);
      if (g == null) continue;
      const p = place(k, g, off);
      pickups.push([+p.x.toFixed(2), +p.y.toFixed(2)]);
    }
  });

  // scenery: strewn beside the road on both sides, kept clear of every part of it
  const rand = rng(hash(id));
  const clear = (x, y, r) => pts.every(([px, py, pw]) => (px - x) ** 2 + (py - y) ** 2 > (pw / 2 + r + 1.2) ** 2);
  const { kinds, every = 22, near = 2, far = 18 } = scenery;
  for (let d = rand() * every; d < len; d += every * (0.6 + rand() * 0.8)) {
    const k = segs.findLastIndex(s => s.d <= d), l = d - segs[k].d;
    for (const side of [-1, 1]) {
      if (!segs[k].L) continue;
      if (rand() < 0.25) continue;
      const [kind, r, solid] = kinds[Math.floor(rand() * kinds.length)];
      const w = widthAt(k, l), off = side * (w / 2 + r + near + rand() * (far - near));
      const p = place(k, l / segs[k].L, off);
      if (clear(p.x, p.y, r)) props.push({ kind, x: +p.x.toFixed(2), y: +p.y.toFixed(2), r, a: +(rand() * Math.PI * 2).toFixed(3), solid });
    }
  }
  return { id, name, theme, laps, pts, surfaces, props, pickups };
}

// ---------------------------------------------------------------------------------------------
// scenery sets: [kind, radius, solid]
const CANYON = { kinds: [['rock', 2.2, true], ['rock', 3.4, true], ['cactus', 0.8, true], ['boulder', 4.5, true], ['scrub', 1.2, false], ['bones', 1.0, false]], every: 18 };
const DOCKS = { kinds: [['container', 3.5, true], ['crate', 1.2, true], ['barrel', 0.6, true], ['bollard', 0.4, true], ['crane', 6, true], ['pallet', 1.0, false]], every: 20 };
const PASS = { kinds: [['pine', 2.2, true], ['pine', 2.8, true], ['pine', 1.8, true], ['rock', 2.5, true], ['snowbank', 2.0, false], ['marker', 0.3, true]], every: 14 };
const CITY = { kinds: [['lamp', 0.4, true], ['billboard', 2.5, true], ['hydrant', 0.3, true], ['car-wreck', 2.3, true], ['bin', 0.6, true], ['kiosk', 2.0, true]], every: 16, near: 1, far: 10 };

// pickups: [f, off] along a piece; props on the road: [kind, f, off, r, solid]
export const TRACKS = [
  lay({
    // fast and open: a long sweeping descent into the one hairpin, then a climb through two bends
    id: 'redmesa', name: 'Red Mesa Run', theme: 'canyon', laps: 3, w: 16, scenery: CANYON, start: 25,
    corners: [
      [0, 0, 40, { e: { pick: [[0.75, -3]] } }],
      [250, 0, 60],
      [320, 150, 45, { e: { props: [['boulder', 0.5, 5.2, 1.8]], pick: [[0.25, -3]] } }],
      [230, 240, 35, { surf: 'dirt', e: { surf: ['dirt', 0, 0.4], pick: [[0.6, 3]] } }],
      [70, 250, 14, { w: 15 }],
      [70, 222, 14],
      [160, 200, 30, { w: 16, e: { pick: [[0.5, -2]] } }],
      [110, 100, 35, { e: { pick: [[0.5, 2]] } }],
    ],
  }),
  lay({
    // narrow and twisting: esses down the gulch, a dusty run along its floor, a hairpin and the
    // long climb back
    id: 'sidewinder', name: 'Sidewinder Gulch', theme: 'canyon', laps: 3, w: 13, scenery: CANYON, start: 30,
    corners: [
      [0, 0, 20, { e: { pick: [[0.8, 2]] } }],
      [160, 0, 30],
      [210, 60, 28, { e: { pick: [[0.5, 0]] } }],
      [170, 120, 28, { surf: 'dirt', e: { surf: 'dirt' } }],
      [220, 190, 18, { surf: ['dirt', 0, 0.5], e: { props: [['rock', 0.45, -4.4, 1.5]], pick: [[0.7, 2]] } }],
      [150, 250, 18, { e: { surf: ['dirt', 0.3, 0.8] } }],
      [40, 250, 14, { w: 14 }],
      [40, 222, 14],
      [100, 200, 22, { e: { pick: [[0.3, -2], [0.75, 2]] } }],
    ],
  }),
  lay({
    // the old container quay: square corners round the stacks, a chicane on the front straight,
    // an oil spill and a flooded corner
    id: 'rustwater', name: 'Rustwater Quay', theme: 'docks', laps: 3, w: 15, scenery: DOCKS, start: 35,
    corners: [
      [0, 0, 20, { e: { pick: [[0.7, 0]] } }],
      [100, 0, 25],
      [125, 14, 25],
      [150, 0, 25, { e: { pick: [[0.5, 3]] } }],
      [300, 0, 20, { e: { surf: ['oil', 0.4, 0.55], props: [['crate', 0.75, 5, 1.3]], pick: [[0.2, -2]] } }],
      [300, 180, 20, { e: { pick: [[0.5, 0]] } }],
      [180, 180, 16, { surf: 'water' }],
      [180, 110, 16, { e: { surf: ['water', 0.3, 0.45], pick: [[0.7, -3]] } }],
      [0, 110, 20, { e: { props: [['barrel', 0.5, -5.5, 0.7]] } }],
    ],
  }),
  lay({
    // the gantry crane run: flat out along the quay, a hairpin at the pier head, then a maze of
    // square turns back between the warehouses
    id: 'gantry', name: 'Gantry Row', theme: 'docks', laps: 3, w: 14, scenery: DOCKS, start: 30,
    corners: [
      [-30, 0, 18, { e: { pick: [[0.3, 3], [0.7, -3]] } }],
      [380, 0, 13, { surf: ['water', 0.2, 0.8] }],
      [380, -32, 13],
      [300, -32, 15, { e: { pick: [[0.5, 0]] } }],
      [300, -110, 15, { e: { surf: ['oil', 0.5, 0.65] } }],
      [190, -110, 15],
      [190, -60, 15],
      [-30, -60, 18, { e: { props: [['barrel', 0.6, 4.6, 0.7], ['barrel', 0.64, 4.9, 0.7]], pick: [[0.3, -2]] } }],
    ],
  }),
  lay({
    // switchbacks up the mountain: three hairpins stacked one over another, ice on the exits,
    // then the long fast drop back down the side
    id: 'frostbite', name: 'Frostbite Pass', theme: 'pass', laps: 3, w: 14, scenery: PASS, start: 25,
    corners: [
      [10, 0, 20, { e: { pick: [[0.6, 2]] } }],
      [150, 0, 16],
      [150, -40, 16, { e: { surf: ['ice', 0, 0.3], pick: [[0.6, 0]] } }],
      [30, -40, 16],
      [30, -80, 16, { e: { surf: ['ice', 0, 0.3] } }],
      [170, -80, 16, { e: { pick: [[0.5, -2]] } }],
      [170, -120, 16, { e: { surf: ['snow', 0.1, 0.35] } }],
      [-40, -120, 25, { e: { surf: ['ice', 0.45, 0.7], props: [['rock', 0.2, 4.5, 1.4]] } }],
      [-40, 50, 25, { e: { pick: [[0.5, 0]] } }],
      [10, 50, 20],
    ],
  }),
  lay({
    // the glacier road: long fast sweepers, but the bends are glazed with ice and the snow lies
    // deep on the inside
    id: 'glacier', name: 'Glacier Bend', theme: 'pass', laps: 3, w: 15, scale: 0.85, scenery: PASS, start: 25,
    corners: [
      [0, 0, 60, { e: { pick: [[0.5, -3]] } }],
      [250, -20, 80, { surf: ['ice', 0.3, 0.8] }],
      [380, 100, 60, { e: { pick: [[0.5, 3]] } }],
      [300, 220, 70, { surf: ['snow', 0.2, 0.6] }],
      [160, 180, 50, { e: { props: [['rock', 0.5, 4.8, 1.6]], pick: [[0.3, -2]] } }],
      [40, 260, 60, { surf: ['ice', 0.2, 0.7] }],
      [-80, 140, 60, { e: { surf: ['snow', 0.3, 0.5], pick: [[0.7, 0]] } }],
    ],
  }),
  lay({
    // downtown at night: a neon boulevard with a chicane, then square corners round the blocks
    // and a jog through the back streets
    id: 'neonmile', name: 'Neon Mile', theme: 'city', laps: 3, w: 16, scale: 0.8, scenery: CITY, start: 25,
    corners: [
      [0, 0, 18, { e: { pick: [[0.6, 2]] } }],
      [160, 0, 25],
      [185, -12, 25],
      [210, 0, 25, { e: { pick: [[0.5, -3]] } }],
      [380, 0, 18, { e: { surf: ['water', 0.3, 0.5], pick: [[0.7, 2]] } }],
      [380, 180, 18, { e: { props: [['car-wreck', 0.5, -5.2, 1.8]] } }],
      [240, 180, 16],
      [240, 110, 16, { e: { pick: [[0.5, 0]] } }],
      [120, 110, 16],
      [120, 180, 16, { e: { surf: ['oil', 0.3, 0.42] } }],
      [0, 180, 18, { e: { pick: [[0.4, -2]] } }],
    ],
  }),
  lay({
    // under the overpasses: short and tight, a hairpin, a dog-leg and a chicane on the way down
    id: 'underpass', name: 'Underpass Nine', theme: 'city', laps: 3, w: 13, scale: 0.8, scenery: CITY, start: 25,
    corners: [
      [-20, 0, 16, { e: { pick: [[0.5, 2]] } }],
      [200, 0, 14],
      [200, -30, 14, { surf: 'water' }],
      [110, -30, 16, { e: { pick: [[0.5, 0]] } }],
      [110, -90, 16],
      [220, -90, 18, { e: { props: [['barrier', 0.5, 3.8, 1.2]] } }],
      [220, -150, 18, { e: { pick: [[0.4, -2]], surf: ['oil', 0.6, 0.7] } }],
      [-20, -150, 18],
      [-20, -100, 20],
      [5, -60, 20, { e: { pick: [[0.5, 0]] } }],
      [5, -35, 20],
    ],
  }),
];
