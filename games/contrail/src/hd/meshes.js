// Geometry: every shared mesh (the aircraft, the ground units, the ordnance, the wrecks), built
// from @nostalgia/gl's low-poly parts. All of them go into one buffer; each mesh is a
// [first, count] range in it. Mesh space: x right, y up, z back (the nose is −z), metres.
import { box, builder, cyl, fin, frustum, hexRGB, loft, plate } from '@nostalgia/gl';

const rgb = c => (Array.isArray(c) ? c : hexRGB(c).map(v => Math.round(v * 255)));

const mirror = pts => pts.map(([x, z, y]) => [-x, z, y]).reverse();

// ---------- the aircraft ----------
function jet(B, { body, belly, trim, glass, size = 1 }) {
  const s = size;
  // fuselage: nose to tail
  loft(B, { s }, [[-8.4, 0.02, 0.02, 0.1], [-6.6, 0.45, 0.42, 0.1], [-4, 0.78, 0.7, 0.15], [-1, 0.95, 0.75, 0.1], [3, 1.1, 0.7, 0], [6.6, 0.9, 0.55, 0], [7.6, 0.62, 0.5, 0]], 8, body, 255, 0.8);
  loft(B, { s }, [[-5.2, 0.05, 0.05, 0.5], [-4.2, 0.42, 0.38, 0.62], [-2.2, 0.48, 0.42, 0.62], [-0.6, 0.2, 0.15, 0.55]], 6, glass);
  // intakes
  for (const side of [-1, 1]) box(B, { at: [side * 1.25 * s, -0.2 * s, 0.8 * s], s }, [0.7, 0.9, 5.2], belly);
  // delta wing with a little sweep at the root
  const wing = [[1.0, -2.6], [5.1, 3.6], [5.1, 5.2], [1.0, 5.6]];
  plate(B, { at: [0, -0.15 * s, 0], s }, wing, 0.22, body);
  plate(B, { at: [0, -0.15 * s, 0], s }, mirror(wing), 0.22, body);
  // canards
  const can = [[0.8, -4.6], [2.6, -3.5], [2.6, -3.0], [0.8, -3.2]];
  plate(B, { at: [0, 0.15 * s, 0], s }, can, 0.15, trim);
  plate(B, { at: [0, 0.15 * s, 0], s }, mirror(can), 0.15, trim);
  // twin canted fins
  for (const side of [-1, 1]) fin(B, { at: [side * 0.95 * s, 0.4 * s, 0], s, roll: side * -0.22 }, [[3.6, 0], [6.9, 0], [7.4, 2.9], [6.4, 2.9]], 0.18, trim);
  // nozzle
  cyl(B, { at: [0, 0, 7.4 * s], s, pitch: Math.PI / 2 }, 0.6, 0.55, 0.9, 8, '#3b3b3f');
}
function fighter(B, { body, trim, glass }) {
  loft(B, {}, [[-8, 0.02, 0.02, 0], [-5.8, 0.5, 0.5, 0], [-2.5, 0.95, 0.8, 0.05], [2, 1.15, 0.85, 0], [6.4, 0.95, 0.7, 0], [7.4, 0.7, 0.6, 0]], 8, body, 255, 0.85);
  loft(B, {}, [[-4.8, 0.05, 0.05, 0.55], [-3.6, 0.42, 0.42, 0.7], [-1.6, 0.45, 0.4, 0.7], [0.2, 0.15, 0.12, 0.6]], 6, glass);
  const wing = [[1.0, -1.4], [6.0, 3.2], [6.0, 4.2], [1.0, 4.4]];
  plate(B, { at: [0, -0.3, 0] }, wing.map(([x, z]) => [x, z, -0.05 * x]), 0.24, body);
  plate(B, { at: [0, -0.3, 0] }, mirror(wing.map(([x, z]) => [x, z, -0.05 * x])), 0.24, body);
  const tail = [[0.6, 4.8], [3.2, 6.8], [3.2, 7.4], [0.6, 7.4]];
  plate(B, { at: [0, 0, 0] }, tail, 0.16, body);
  plate(B, { at: [0, 0, 0] }, mirror(tail), 0.16, body);
  fin(B, { at: [0, 0.6, 0] }, [[3.4, 0], [7.2, 0], [7.6, 3.6], [6.2, 3.6]], 0.2, trim);
  for (const side of [-1, 1]) box(B, { at: [side * 1.2, -0.25, -0.5] }, [0.6, 0.9, 4], trim);
  cyl(B, { at: [0, 0, 7.3], pitch: Math.PI / 2 }, 0.62, 0.55, 0.8, 8, '#2e2e30');
}
function bomber(B) {
  const body = '#6f7563', dark = '#4d5246', glass = '#1d2a36';
  loft(B, {}, [[-18, 0.05, 0.05, 0.2], [-15.5, 1.5, 1.6, 0.2], [-11, 2.4, 2.4, 0], [8, 2.5, 2.5, 0], [14, 1.6, 2.0, 0.6], [18, 0.4, 0.6, 1.4]], 8, body);
  loft(B, {}, [[-16.8, 0.1, 0.1, 1.2], [-15.8, 1.2, 0.8, 1.5], [-13.2, 1.3, 0.7, 1.6], [-12, 0.2, 0.2, 1.6]], 6, glass);
  const wing = [[2, -3], [22, 1], [22, 4], [2, 5]];
  plate(B, { at: [0, 0.6, 0] }, wing.map(([x, z]) => [x, z, 0.04 * x]), 0.6, body);
  plate(B, { at: [0, 0.6, 0] }, mirror(wing.map(([x, z]) => [x, z, 0.04 * x])), 0.6, body);
  for (const x of [-13, -7, 7, 13]) loft(B, { at: [x, 0.1 + Math.abs(x) * 0.04, 0] }, [[-4, 0.3, 0.3, 0], [-3, 0.9, 0.9, 0], [2, 0.9, 0.9, 0], [3, 0.6, 0.6, 0]], 6, dark);
  const tail = [[1, 13], [8.5, 16.5], [8.5, 18], [1, 18]];
  plate(B, { at: [0, 1.2, 0] }, tail, 0.3, body);
  plate(B, { at: [0, 1.2, 0] }, mirror(tail), 0.3, body);
  fin(B, { at: [0, 2, 0] }, [[11, 0], [18, 0], [19, 7], [16, 7]], 0.3, dark);
}
function courier(B) {
  const body = '#e4e6e8', stripe = '#2f6fc0', glass = '#1d2a36';
  loft(B, {}, [[-14, 0.05, 0.05, 0], [-12, 1.4, 1.4, 0], [-8, 2.1, 2.1, 0.1], [7, 2.1, 2.1, 0.1], [12, 1.0, 1.4, 0.9], [14, 0.3, 0.4, 1.6]], 8, body);
  loft(B, {}, [[-12.6, 0.1, 0.1, 0.9], [-11.8, 1.1, 0.6, 1.2], [-10.2, 1.2, 0.6, 1.3], [-9.4, 0.2, 0.2, 1.3]], 6, glass);
  box(B, { at: [0, -0.2, -1] }, [4.3, 0.6, 12], stripe);
  const wing = [[1.5, -3], [16, -1.5], [16, 0.8], [1.5, 1.2]];
  plate(B, { at: [0, 2.1, 0] }, wing, 0.5, body);
  plate(B, { at: [0, 2.1, 0] }, mirror(wing), 0.5, body);
  for (const x of [-6.5, 6.5]) loft(B, { at: [x, 1.4, 0] }, [[-5, 0.3, 0.3, 0], [-4, 0.85, 0.85, 0], [1, 0.8, 0.8, 0], [2.5, 0.3, 0.3, 0]], 6, '#9aa3ac');
  fin(B, { at: [0, 1.8, 0] }, [[9, 0], [14, 0], [15, 5.5], [12.5, 5.5]], 0.3, stripe);
  const tail = [[0.3, 13.6], [5.5, 14.8], [5.5, 15.8], [0.3, 15.8]];
  plate(B, { at: [0, 7.2, 0] }, tail, 0.25, body);
  plate(B, { at: [0, 7.2, 0] }, mirror(tail), 0.25, body);
}

// ---------- ground units ----------
function radar(B) {
  frustum(B, {}, [14, 5, 14], [11, 11], '#8a8c86');
  box(B, { at: [0, 6, 0] }, [6, 2.5, 6], '#6e716b');
  cyl(B, { at: [0, 7, 0] }, 1, 0.8, 8, 6, '#a0a29c');
}
function dish(B) {
  // a curved bar dish, turning about y
  for (let i = -3; i <= 3; i++) box(B, { at: [i * 2.3, 1.5 - Math.abs(i) * 0.1, Math.abs(i) * Math.abs(i) * 0.12], yaw: -i * 0.08 }, [2.35, 5, 0.6], '#d8dad4');
  box(B, { at: [0, 0, 0] }, [2, 2, 2], '#6e716b');
}
function aa(B) {
  cyl(B, {}, 7, 6.5, 1.6, 8, '#8b7d5a');
  box(B, { at: [0, 1.6, 0] }, [3.6, 1.6, 3.6], '#5d6250');
  for (const x of [-0.7, 0.7]) box(B, { at: [x, 3.2, -2.4], pitch: 0.75 }, [0.35, 0.35, 5.4], '#33352f');
}
function sam(B) {
  box(B, { at: [0, 1, 0] }, [4.6, 2, 9], '#6d7356');
  box(B, { at: [0, 2.6, 3.2] }, [4.4, 1.6, 2.6], '#5a5f47');
  const T = { at: [0, 3.4, -0.6], pitch: 0.6 };
  box(B, T, [3.6, 0.6, 7.2], '#4a4e3b');
  for (const x of [-1.1, 1.1]) cyl(B, { at: [x, 3.95, 3.0], pitch: -Math.PI / 2 + 0.6 }, 0.42, 0.06, 7.4, 6, '#e8e6dc');
}
function depot(B) {
  cyl(B, {}, 11, 11, 9, 12, '#d6d8d2');
  cyl(B, { at: [0, 9, 0] }, 11, 3, 2.2, 12, '#c4c6c0');
  box(B, { at: [14, 1.2, 0] }, [8, 2.4, 2], '#7b7d78');
  cyl(B, { at: [-15, 0, 6] }, 5, 5, 6, 10, '#d6d8d2');
}
function hangar(B) {
  // a barrel roof along z
  const n = 7, R = 15, L = 46, P = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI; P.push([Math.cos(a) * R, Math.sin(a) * R * 0.75]); }
  for (let i = 0; i < n; i++) {
    const [x0, y0] = P[i], [x1, y1] = P[i + 1];
    B.quad([x0, y0, -L / 2], [x1, y1, -L / 2], [x1, y1, L / 2], [x0, y0, L / 2], rgb('#7d8288'), 255, [0, 0, 0]);
    B.tri([0, 0, -L / 2], [x0, y0, -L / 2], [x1, y1, -L / 2], rgb('#5c6066'), 255, [0, 4, 0]);
    B.tri([0, 0, L / 2], [x0, y0, L / 2], [x1, y1, L / 2], rgb('#5c6066'), 255, [0, 4, 0]);
  }
  box(B, { at: [0, 4.5, -L / 2 - 0.1] }, [18, 9, 0.4], '#2c2f33');
}
function bridge(B, hl) {
  // the deck runs along z (the actor's f), its top at y 0
  box(B, { at: [0, -1.5, 0] }, [14, 3, hl * 2], '#7a756c');
  for (const x of [-6.6, 6.6]) {
    box(B, { at: [x, 2.2, 0] }, [0.6, 0.6, hl * 2], '#5b5750');
    for (let z = -hl + 12; z < hl; z += 24) box(B, { at: [x, 1.1, z], pitch: 0.5 }, [0.5, 0.5, 7], '#5b5750');
  }
  for (const z of [-hl * 0.55, 0, hl * 0.55]) box(B, { at: [0, -45, z] }, [8, 84, 8], '#8a847a');
}
function ship(B, L, tender) {
  const hull = '#5d6670', deck = '#8b8e86', h = L / 2;
  loft(B, { at: [0, 0, 0] }, [[-h, 0.1, 0.4, 2], [-h * 0.75, L * 0.09, 2.4, 1.2], [h * 0.6, L * 0.1, 2.6, 1.1], [h, L * 0.08, 2.4, 1.2]], 8, hull, 255, 0.6);
  box(B, { at: [0, 3.3, 0] }, [L * 0.17, 0.4, L * 0.9], deck);
  box(B, { at: [0, 6, h * 0.25] }, [L * 0.12, 5.5, L * 0.18], '#c9ccc4');
  box(B, { at: [0, 10, h * 0.2] }, [L * 0.08, 3, L * 0.08], '#9fa39b');
  cyl(B, { at: [0, 11, h * 0.25] }, 0.3, 0.3, 8, 4, '#3a3d40');
  if (tender) {
    for (const z of [-h * 0.55, -h * 0.2]) box(B, { at: [0, 5, z] }, [L * 0.13, 3.2, L * 0.14], '#a5552c');
    box(B, { at: [0, 11, -h * 0.38], pitch: 0.6 }, [0.6, 0.6, 16], '#d8a530');
  } else {
    box(B, { at: [0, 4.4, -h * 0.55] }, [2.4, 1.6, 2.4], '#41454a');
    box(B, { at: [0, 4.8, -h * 0.75] }, [0.4, 0.4, 3.4], '#26282b');
  }
}
function truck(B, flak) {
  box(B, { at: [0, 1.4, -2.9] }, [2.5, 2.4, 2.2], '#6c6450');
  box(B, { at: [0, 0.8, 0.9] }, [2.5, 0.6, 5.6], '#4b4537');
  if (flak) {
    box(B, { at: [0, 1.8, 1.2] }, [1.8, 1.4, 1.8], '#5d6250');
    box(B, { at: [0, 2.8, 0.2], pitch: 0.8 }, [0.3, 0.3, 3.6], '#2a2b27');
  } else box(B, { at: [0, 2.2, 1] }, [2.5, 2.4, 5.2], '#8d7f5c');
  for (const z of [-2.6, 0, 2.4]) for (const x of [-1.25, 1.25]) box(B, { at: [x, 0.5, z] }, [0.5, 1, 1], '#1f1f1f');
}
function factory(B) {
  box(B, { at: [0, 8, 0] }, [56, 16, 66], '#7b4a3a');
  for (let i = 0; i < 5; i++) {
    const z = -26 + i * 13;
    frustum(B, { at: [0, 16, z] }, [56, 5, 12], [56, 1], '#5b3d33');
  }
  cyl(B, { at: [20, 0, 26] }, 2.6, 2, 42, 8, '#6a4a40');
  cyl(B, { at: [-18, 0, 30] }, 2.2, 1.8, 32, 8, '#6a4a40');
}
function bunker(B) {
  frustum(B, {}, [62, 11, 62], [40, 40], '#7e7e74');
  frustum(B, { at: [0, 11, 0] }, [18, 4, 18], [12, 12], '#6a6a62');
  box(B, { at: [0, 3.5, -27] }, [14, 7, 8], '#3a3a36');
  cyl(B, { at: [14, 11, 10] }, 0.4, 0.2, 16, 4, '#2e2e2c');
}
function wreck(B) {
  for (const [x, z, sx, sy, sz, yaw] of [[0, 0, 7, 1.6, 9, 0.3], [5, -6, 4, 1, 3, 1], [-6, 4, 3, 2.2, 4, 0.7], [3, 7, 5, 0.8, 3, 2]]) box(B, { at: [x, sy / 2, z], yaw }, [sx, sy, sz], '#2c2723');
}

// ---------- ordnance ----------
function missile(B) {
  cyl(B, { pitch: -Math.PI / 2 }, 0.32, 0.32, 3.4, 6, '#e8e8e2');
  cyl(B, { at: [0, 0, -3.4], pitch: -Math.PI / 2 }, 0.32, 0.01, 0.9, 6, '#cfcfc8');
  for (const r of [0, Math.PI / 2]) {
    plate(B, { roll: r }, [[-1.1, -0.2], [1.1, -0.2], [0, 0.9]].map(([x, z]) => [x, z]), 0.06, '#b0b0a8');
  }
}
function bomb(B) {
  loft(B, {}, [[-1.4, 0.05, 0.05, 0], [-1, 0.33, 0.33, 0], [0.6, 0.33, 0.33, 0], [1.2, 0.12, 0.12, 0]], 6, '#4e5543');
  plate(B, {}, [[-0.6, 0.9], [0.6, 0.9], [0.6, 1.4], [-0.6, 1.4]], 0.05, '#4e5543');
}

/** every shared mesh in one buffer: { buffer data, ranges: { name: [first, count] } } */
export function buildMeshes() {
  const B = builder(32768), ranges = {};
  const add = (name, fn) => { const s = B.n; fn(B); ranges[name] = [s, B.n - s]; };
  add('player', B => jet(B, { body: '#bfc6cc', belly: '#8e979f', trim: '#2f5e9c', glass: '#1b2c44' }));
  add('fighter', B => fighter(B, { body: '#8a7258', trim: '#a43a2a', glass: '#232a2e' }));
  add('ace', B => fighter(B, { body: '#2b2b31', trim: '#c4372a', glass: '#4a1d1a' }));
  add('bomber', bomber);
  add('courier', courier);
  add('radar', radar);
  add('dish', dish);
  add('aa', aa);
  add('sam', sam);
  add('depot', depot);
  add('hangar', hangar);
  add('bridge', B => bridge(B, 200));
  add('tender', B => ship(B, 96, true));
  add('gunboat', B => ship(B, 44, false));
  add('truck', B => truck(B, false));
  add('flaktruck', B => truck(B, true));
  add('factory', factory);
  add('bunker', bunker);
  add('wreck', wreck);
  add('missile', missile);
  add('bomb', bomb);
  return { data: B.data(), ranges };
}
