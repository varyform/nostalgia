// Every shared mesh, in one buffer: the Gadfly (the player's tandem attack helicopter) with its
// rotors as separate parts, the Combine's Mantis gunship and Stiletto jet, the armour and the trucks, the air
// defences, the buildings, the trees, the stores in flight, the markers and the wrecks. Each
// mesh is a [first, count] range in the buffer. Mesh space: x right, y up, z back (the nose is
// −z), metres; ground units and buildings stand on y = 0, helicopters on their wheels or skids.
//
//   const M = buildMeshes();   // { data, ranges: { name: [first, count] } }
//   MOUNT.player.hub           // where the main rotor turns (mesh space), its radius, the tail's
//
// All designs are original: no real aircraft or vehicle is copied. Flat-shaded, a few hundred
// faces each; the trees a dozen or so, since thousands of them are drawn.
import { box, builder, cyl, fin, frustum, hexRGB, loft, plate } from '@nostalgia/gl';

const rgb = c => (Array.isArray(c) ? c : hexRGB(c).map(v => Math.round(v * 255)));
const mirror = pts => pts.map(([x, z, y]) => [-x, z, y]).reverse();
const PI = Math.PI;

/** where each helicopter's rotors turn: hub (mesh space), main radius, blades; tail rotor */
export const MOUNT = {
  player: { hub: [0, 3.55, -0.5], r: 6.9, blades: 4, tail: [-0.42, 3.95, 8.45], tr: 1.35, gun: [0, 0.58, -4.9], eye: [0, 2.95, -2.6], nose: [0, 1.05, -7.0] },
  mantis: { hub: [0, 3.7, -0.3], r: 7.2, blades: 3, coax: 0.85, tail: null, gun: [0.95, 1.05, -4.4] },
};
/** meshes drawn in the translucent pass */
export const GLASS = new Set(['disc', 'ring', 'tailDisc']);

// ---------- helicopters ----------
function gadfly(B) {
  const body = '#56624a', belly = '#6c7461', dark = '#2b3128', trim = '#b39648', metal = '#3b3f3a';
  // a faceted, six-sided hull: sensor nose, tandem stations, engines, a long boom
  loft(B, {}, [[-7.1, 0.16, 0.16, 1.3], [-6.3, 0.52, 0.55, 1.35], [-4.7, 0.74, 0.9, 1.55], [-2.4, 0.82, 1.12, 1.72], [-0.2, 0.98, 1.08, 1.75],
    [1.8, 0.78, 0.88, 1.85], [3.3, 0.38, 0.46, 2.0], [7.4, 0.22, 0.3, 2.15], [8.9, 0.17, 0.24, 2.3]], 6, body, 255, 0.85);
  // the belly keel and a sand stripe down the flank
  box(B, { at: [0, 0.78, -2.2] }, [0.9, 0.3, 6.4], belly);
  for (const s of [-1, 1]) box(B, { at: [s * 0.78, 1.72, -3.0], yaw: s * 0.02 }, [0.06, 0.16, 5.2], trim);
  // stepped tandem canopy: the gunner low in front, the pilot raised behind
  loft(B, {}, [[-5.9, 0.08, 0.08, 2.1], [-5.3, 0.5, 0.42, 2.25], [-4.1, 0.56, 0.48, 2.35], [-3.7, 0.3, 0.2, 2.45]], 6, '#1a2629');
  loft(B, {}, [[-3.75, 0.1, 0.1, 2.45], [-3.2, 0.56, 0.5, 2.6], [-1.9, 0.6, 0.52, 2.7], [-1.2, 0.32, 0.22, 2.75]], 6, '#1a2629');
  for (const z of [-4.15, -1.95]) box(B, { at: [0, 2.85 + (z > -3 ? 0.35 : 0), z] }, [0.1, 0.12, 0.12], dark);
  // engines on the shoulders, exhausts turned up and out
  for (const s of [-1, 1]) {
    loft(B, { at: [s * 1.05, 2.45, 0] }, [[-1.4, 0.05, 0.05, 0], [-1.1, 0.42, 0.4, 0], [1.6, 0.42, 0.4, 0], [2.3, 0.3, 0.3, 0.08]], 6, body);
    cyl(B, { at: [s * 1.15, 2.55, 2.25], pitch: PI / 2 - 0.5, roll: s * 0.4 }, 0.26, 0.3, 0.6, 6, dark);
  }
  // the transmission fairing, mast and hub
  frustum(B, { at: [0, 2.55, -0.5] }, [1.5, 0.7, 2.6], [0.9, 1.6], body);
  cyl(B, { at: [0, 3.15, -0.5] }, 0.22, 0.2, 0.42, 6, metal);
  cyl(B, { at: [0, 3.45, -0.5] }, 0.42, 0.3, 0.2, 8, dark);
  // the sensor ball on the nose and the chin gun
  cyl(B, { at: [0, 1.05, -6.85] }, 0.38, 0.3, 0.55, 8, dark);
  box(B, { at: [0, 1.38, -7.1] }, [0.5, 0.2, 0.06], '#7a2a22');
  cyl(B, { at: [0, 0.72, -4.9] }, 0.34, 0.3, 0.36, 6, dark);
  cyl(B, { at: [0, 0.58, -5.6], pitch: -PI / 2 }, 0.06, 0.05, 1.7, 4, metal);
  // stub wings with a slight droop, a rocket pod and a four-round missile rail on each
  const wing = [[0.9, -0.75], [3.15, -0.45], [3.15, 0.45], [0.9, 0.75]];
  plate(B, { at: [0, 1.75, -0.25] }, wing.map(([x, z]) => [x, z, -0.08 * (x - 0.9)]), 0.14, body);
  plate(B, { at: [0, 1.75, -0.25] }, mirror(wing.map(([x, z]) => [x, z, -0.08 * (x - 0.9)])), 0.14, body);
  for (const s of [-1, 1]) {
    box(B, { at: [s * 2.2, 1.52, -0.3] }, [0.12, 0.3, 0.5], dark);
    cyl(B, { at: [s * 2.2, 1.25, -1.2], pitch: -PI / 2 }, 0.28, 0.28, 1.9, 8, '#4a5242');
    cyl(B, { at: [s * 2.2, 1.25, -1.21], pitch: -PI / 2 }, 0.2, 0.2, 0.02, 8, '#1a1a18');
    box(B, { at: [s * 3.05, 1.45, -0.25] }, [0.12, 0.22, 1.6], dark);
    for (const [dx, dy] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, -0.42], [0.14, -0.42]])
      cyl(B, { at: [s * 3.05 + dx, 1.45 + dy, -1.0], pitch: -PI / 2 }, 0.11, 0.11, 1.45, 4, '#5a6152');
  }
  // the tail: swept fin with the rotor on its left, a stabiliser with end plates
  fin(B, { at: [0, 2.15, 0] }, [[6.9, 0], [8.7, 0], [9.3, 2.5], [8.5, 2.5]], 0.16, body);
  fin(B, { at: [0, 2.2, 0] }, [[7.9, 0], [8.8, 0], [8.9, -1.05], [8.4, -1.05]], 0.14, dark);
  const stab = [[0.15, 7.3], [1.5, 7.55], [1.5, 8.05], [0.15, 8.1]];
  plate(B, { at: [0, 2.2, 0] }, stab, 0.1, body);
  plate(B, { at: [0, 2.2, 0] }, mirror(stab), 0.1, body);
  for (const s of [-1, 1]) fin(B, { at: [s * 1.5, 1.95, 0] }, [[7.45, 0], [8.1, 0], [8.2, 0.55], [7.6, 0.55]], 0.06, body);
  cyl(B, { at: [-0.22, 3.95, 8.45], roll: PI / 2 }, 0.16, 0.12, 0.25, 6, metal);
  for (const z of [7.6, 8.2]) box(B, { at: [0, 2.9, z] }, [0.2, 0.06, 0.3], trim);
  // wheels: two mains on trailing legs, a tail wheel under the ventral fin
  for (const s of [-1, 1]) {
    box(B, { at: [s * 0.95, 0.75, -3.0], roll: s * -0.35 }, [0.14, 1.0, 0.18], metal);
    cyl(B, { at: [s * 1.12, 0.33, -3.0], roll: PI / 2 }, 0.33, 0.33, 0.24, 8, '#1c1c1a');
  }
  cyl(B, { at: [0.08, 0.18, 8.75], roll: PI / 2 }, 0.18, 0.18, 0.12, 6, '#1c1c1a');
}
// the enemy's heavy gunship: a bulky side-by-side cabin, coaxial rotors, twin booms of fins
function mantis(B) {
  const body = '#7a6648', dark = '#3b3326', band = '#c9b04a', glass = '#26302e';
  loft(B, {}, [[-5.6, 0.3, 0.3, 1.5], [-4.8, 1.0, 0.9, 1.55], [-3.0, 1.32, 1.3, 1.75], [0, 1.4, 1.38, 1.85], [2.2, 1.1, 1.1, 1.95], [3.6, 0.45, 0.5, 2.15], [8.2, 0.28, 0.32, 2.4]], 8, body, 255, 0.8);
  // a wide wrap-round windscreen
  loft(B, {}, [[-5.3, 0.2, 0.2, 1.9], [-4.6, 1.0, 0.6, 2.05], [-3.1, 1.15, 0.7, 2.35], [-2.4, 0.4, 0.2, 2.6]], 8, glass);
  box(B, { at: [0, 0.55, -1.0] }, [1.8, 0.35, 5.2], dark);
  // engines in one hump, the mast, the two hubs
  loft(B, { at: [0, 3.0, 0.4] }, [[-2.2, 0.2, 0.2, 0], [-1.6, 1.15, 0.5, 0], [1.6, 1.1, 0.48, 0], [2.6, 0.5, 0.3, 0]], 6, body);
  for (const s of [-1, 1]) box(B, { at: [s * 1.1, 3.1, 2.4] }, [0.5, 0.4, 0.6], dark);
  cyl(B, { at: [0, 3.35, -0.3] }, 0.24, 0.22, 1.35, 6, '#45483f');
  for (const y of [3.65, 4.5]) cyl(B, { at: [0, y - 0.1, -0.3] }, 0.45, 0.35, 0.22, 8, dark);
  // stub wings, two pods a side
  const wing = [[1.2, -0.8], [3.4, -0.6], [3.4, 0.6], [1.2, 0.8]];
  plate(B, { at: [0, 1.75, 0] }, wing, 0.16, body);
  plate(B, { at: [0, 1.75, 0] }, mirror(wing), 0.16, body);
  for (const s of [-1, 1]) for (const x of [2.0, 3.0]) cyl(B, { at: [s * x, 1.45, -1.1], pitch: -PI / 2 }, 0.3, 0.3, 2.0, 8, '#4f4635');
  // the nose cannon in a fixed blister
  box(B, { at: [0.95, 1.05, -3.6] }, [0.4, 0.4, 1.6], dark);
  cyl(B, { at: [0.95, 1.05, -4.4], pitch: -PI / 2 }, 0.07, 0.06, 1.8, 4, '#2a2a28');
  // a cross-tail: stabiliser with two end fins, and a tall upper fin
  const stab = [[0.2, 7.0], [2.0, 7.4], [2.0, 8.2], [0.2, 8.3]];
  plate(B, { at: [0, 2.35, 0] }, stab, 0.12, body);
  plate(B, { at: [0, 2.35, 0] }, mirror(stab), 0.12, body);
  for (const s of [-1, 1]) fin(B, { at: [s * 2.0, 1.9, 0] }, [[7.3, 0], [8.3, 0], [8.5, 1.2], [7.7, 1.2]], 0.1, body);
  fin(B, { at: [0, 2.4, 0] }, [[6.6, 0], [8.4, 0], [8.9, 1.9], [7.9, 1.9]], 0.14, body);
  box(B, { at: [0, 2.6, 5.5] }, [0.6, 0.7, 0.5], band);
  // fixed tricycle gear
  for (const s of [-1, 1]) cyl(B, { at: [s * 1.25, 0.32, 0.6], roll: PI / 2 }, 0.32, 0.32, 0.25, 8, '#1c1c1a');
  cyl(B, { at: [0, 0.25, -4.1], roll: PI / 2 }, 0.25, 0.25, 0.2, 6, '#1c1c1a');
}
/** main rotor blades, radius r, n blades, along mesh −z for blade 0 */
function blades(B, r, n, col = '#232622', chord = 0.5) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * PI * 2;
    box(B, { at: [Math.sin(a) * r * 0.52, 0, -Math.cos(a) * r * 0.52], yaw: -a }, [chord, 0.07, r * 0.96], col);
  }
}
/** a blurred rotor: a thin disc (drawn translucent) */
function disc(B, r, n = 28, col = '#2a2d2a', inner = 0) {
  const c = rgb(col), up = [0, 50, 0], dn = [0, -50, 0];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * PI * 2, a1 = ((i + 1) / n) * PI * 2;
    const p = (a, rr) => [Math.cos(a) * rr, 0, Math.sin(a) * rr];
    if (inner > 0) {
      B.quad(p(a0, inner), p(a1, inner), p(a1, r), p(a0, r), c, 255, dn);
      B.quad(p(a0, inner), p(a1, inner), p(a1, r), p(a0, r), c, 255, up);
    } else {
      B.tri([0, 0, 0], p(a0, r), p(a1, r), c, 255, dn);
      B.tri([0, 0, 0], p(a0, r), p(a1, r), c, 255, up);
    }
  }
}
/** a tail rotor in the y–z plane (its axis along x), radius r */
function tailBlades(B, r, n) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * PI * 2;
    box(B, { at: [0, Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5], pitch: a }, [0.04, r, 0.2], '#262824');
  }
}
function tailDisc(B, r) {
  const c = rgb('#30332f'), n = 14;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * PI * 2, a1 = ((i + 1) / n) * PI * 2, p = a => [0, Math.cos(a) * r, Math.sin(a) * r];
    B.tri([0, 0, 0], p(a0), p(a1), c, 255, [50, 0, 0]);
    B.tri([0, 0, 0], p(a0), p(a1), c, 255, [-50, 0, 0]);
  }
}

// ---------- the enemy's jet ----------
// a straight-winged ground-attack jet with engines in pods over the tail and twin fins
function stiletto(B) {
  const body = '#857a62', dark = '#4a4234', glass = '#22292a';
  loft(B, {}, [[-8.5, 0.05, 0.05, 0.1], [-7.2, 0.5, 0.55, 0.1], [-4.5, 0.85, 0.9, 0.2], [2.5, 0.85, 0.85, 0.2], [6.5, 0.45, 0.5, 0.35], [7.6, 0.2, 0.25, 0.45]], 8, body);
  loft(B, {}, [[-6.2, 0.05, 0.05, 0.8], [-5.4, 0.45, 0.4, 0.95], [-3.8, 0.5, 0.42, 1.0], [-2.8, 0.1, 0.1, 0.9]], 6, glass);
  const wing = [[0.7, -1.8], [8.2, -0.9], [8.2, 0.5], [0.7, 0.9]];
  plate(B, { at: [0, -0.1, 0] }, wing.map(([x, z]) => [x, z, 0.03 * x]), 0.25, body);
  plate(B, { at: [0, -0.1, 0] }, mirror(wing.map(([x, z]) => [x, z, 0.03 * x])), 0.25, body);
  for (const s of [-1, 1]) {
    loft(B, { at: [s * 1.25, 1.0, 0] }, [[1.2, 0.1, 0.1, 0], [1.6, 0.6, 0.6, 0], [5.0, 0.6, 0.6, 0], [5.8, 0.45, 0.45, 0]], 8, dark);
    fin(B, { at: [s * 1.9, 0.6, 0] }, [[5.6, 0], [7.6, 0], [8.0, 2.4], [6.9, 2.4]], 0.14, body);
    for (const x of [3.5, 6]) box(B, { at: [s * x, -0.5, -0.6] }, [0.25, 0.6, 1.8], '#3b3a33');
  }
  const tail = [[0.4, 6.0], [2.6, 6.8], [2.6, 7.6], [0.4, 7.6]];
  plate(B, { at: [0, 0.5, 0] }, tail, 0.12, body); plate(B, { at: [0, 0.5, 0] }, mirror(tail), 0.12, body);
}

// ---------- armour, trucks and air defences ----------
function tracks(B, L, w, gap, col = '#2a2820') {
  for (const s of [-1, 1]) {
    box(B, { at: [s * gap, 0.55, 0] }, [w, 0.9, L], col);
    for (let k = 0; k < 5; k++) cyl(B, { at: [s * (gap + w / 2 + 0.01), 0.42, -L / 2 + 0.6 + (k * (L - 1.2)) / 4], roll: PI / 2 }, 0.34, 0.34, 0.02, 6, '#1a1914', 255, false);
  }
}
function tank(B, col = '#646344') {
  tracks(B, 7.0, 0.7, 1.45);
  // a long hull, its glacis sloped back
  frustum(B, { at: [0, 0.75, 0.3] }, [3.0, 0.9, 6.0], [2.7, 5.4], col);
  frustum(B, { at: [0, 0.75, -3.0], pitch: -0.9 }, [3.0, 1.0, 0.6], [2.7, 0.05], col);
  box(B, { at: [0, 1.25, 3.0] }, [2.6, 0.5, 0.6], '#3d3c29');
  for (const s of [-1, 1]) box(B, { at: [s * 1.2, 1.7, 2.6] }, [0.5, 0.25, 1.0], '#4f4e36');
}
function tankTurret(B, col = '#5b5a3d') {
  // a low, wide hexagonal turret with a long gun (origin at the ring, on the hull's top)
  frustum(B, { yaw: PI / 6 }, [2.7, 0.75, 3.1], [2.1, 2.5], col);
  box(B, { at: [0, 0.4, 1.6] }, [1.8, 0.55, 0.8], '#4a4931');
  cyl(B, { at: [0.55, 0.75, 0.3] }, 0.3, 0.25, 0.3, 6, '#3a3a28');
  cyl(B, { at: [0, 0.42, -1.4], pitch: -PI / 2 }, 0.13, 0.11, 4.6, 6, '#3c3b2a');
  cyl(B, { at: [0, 0.42, -3.6], pitch: -PI / 2 }, 0.19, 0.19, 0.5, 6, '#3c3b2a');
}
function apc(B, col = '#6f6a4c') {
  // a six-wheeled box with a sloped nose and a small gun turret
  frustum(B, { at: [0, 0.55, 0.2] }, [2.8, 1.6, 6.4], [2.4, 5.8], col);
  frustum(B, { at: [0, 0.55, -3.2], pitch: -1.0 }, [2.8, 1.2, 0.6], [2.4, 0.05], col);
  for (const z of [-2.1, 0, 2.1]) for (const s of [-1, 1]) cyl(B, { at: [s * 1.3, 0.55, z], roll: PI / 2 }, 0.55, 0.55, 0.42, 8, '#1d1c18');
  cyl(B, { at: [0, 2.15, -0.4] }, 0.75, 0.6, 0.45, 6, '#55513a');
  cyl(B, { at: [0, 2.37, -1.4], pitch: -PI / 2 }, 0.06, 0.06, 1.6, 4, '#2c2b22');
  for (const s of [-1, 1]) box(B, { at: [s * 1.1, 1.55, 2.4] }, [0.1, 0.5, 1.0], '#2a2b24');
}
function truck(B, kind) {
  const cab = '#6c6a4e', bed = '#4b4837';
  box(B, { at: [0, 1.45, -2.75] }, [2.4, 1.7, 1.9], cab);
  frustum(B, { at: [0, 2.3, -2.95] }, [2.4, 0.5, 1.5], [2.3, 0.9], cab);
  box(B, { at: [0, 2.45, -3.55] }, [2.0, 0.45, 0.05], '#22292a');
  box(B, { at: [0, 0.75, 0.9] }, [2.4, 0.35, 5.6], bed);
  if (kind === 'fuel') {
    cyl(B, { at: [0, 1.85, -1.4], pitch: PI / 2 }, 1.05, 1.05, 4.9, 8, '#8c8f86');
    box(B, { at: [0, 2.95, 1.0] }, [0.6, 0.15, 2.2], '#55584f');
  } else {
    box(B, { at: [0, 2.0, 1.1] }, [2.4, 2.2, 5.0], '#7b7553');
    frustum(B, { at: [0, 3.1, 1.1] }, [2.4, 0.35, 5.0], [1.6, 5.0], '#6e6849');
  }
  for (const z of [-2.7, 0.5, 2.3]) for (const s of [-1, 1]) cyl(B, { at: [s * 1.08, 0.48, z], roll: PI / 2 }, 0.48, 0.48, 0.36, 8, '#1d1c18');
}
function aatrack(B) {
  tracks(B, 6.2, 0.6, 1.3);
  frustum(B, { at: [0, 0.75, 0] }, [2.7, 0.9, 5.8], [2.4, 5.2], '#6a6545');
}
function aa(B) {
  // a towed twin gun dug in behind a ring of sandbags
  for (let k = 0; k < 12; k++) { const a = (k / 12) * PI * 2; if (k === 3) continue; box(B, { at: [Math.cos(a) * 4.2, 0.45, Math.sin(a) * 4.2], yaw: -a }, [0.8, 0.9, 2.2], '#8d8160'); }
  cyl(B, {}, 1.2, 1.0, 0.5, 6, '#4c4a36');
  for (const s of [-1, 1]) box(B, { at: [s * 1.6, 0.15, 0], yaw: s * 0.5 }, [0.25, 0.25, 3.2], '#3a3a2e');
}
function aaGun(B) {
  // the static gun's mount: a seat, a shield, two long barrels (origin on the pivot)
  box(B, { at: [0, 0.7, 0.3] }, [1.4, 0.9, 1.4], '#5a573c');
  plate(B, { at: [0, 1.0, -0.5], pitch: PI / 2 - 0.2 }, [[-0.9, -0.6], [0.9, -0.6], [0.9, 0.6], [-0.9, 0.6]], 0.08, '#4d4b34');
  for (const s of [-0.3, 0.3]) cyl(B, { at: [s, 1.05, -0.6], pitch: -PI / 2 }, 0.06, 0.05, 3.2, 4, '#2a2920');
}
function aaTurret(B) {
  // a boxy turret with four cannon and a search dish on its back
  box(B, { at: [0, 0.6, 0] }, [2.3, 1.2, 2.4], '#5c583c');
  for (const s of [-1, 1]) {
    box(B, { at: [s * 1.35, 0.75, -0.2] }, [0.45, 0.6, 1.2], '#4a4731');
    for (const dy of [0.62, 0.92]) cyl(B, { at: [s * 1.35, dy, -0.8], pitch: -PI / 2 }, 0.05, 0.05, 2.6, 4, '#2a2920');
  }
  cyl(B, { at: [0, 1.2, 1.0] }, 0.08, 0.08, 0.9, 4, '#3a3a2e');
  plate(B, { at: [0, 2.1, 1.0], pitch: 0.25 }, [[-0.9, -0.15], [0.9, -0.15], [0.9, 0.15], [-0.9, 0.15]], 0.5, '#8f8d7c');
}
function samBase(B) {
  // a six-wheeled launcher chassis with a cab
  box(B, { at: [0, 1.15, 0.4] }, [2.6, 0.7, 7.0], '#66694a');
  box(B, { at: [0, 1.85, -2.6] }, [2.6, 1.4, 1.6], '#5c5f42');
  box(B, { at: [0, 2.2, -3.42] }, [2.1, 0.5, 0.04], '#22292a');
  for (const z of [-2.4, 1.0, 2.6]) for (const s of [-1, 1]) cyl(B, { at: [s * 1.15, 0.52, z], roll: PI / 2 }, 0.52, 0.52, 0.4, 8, '#1d1c18');
  cyl(B, { at: [0, 1.5, 1.6] }, 0.8, 0.8, 0.35, 8, '#4f5238');
}
function samRack(B) {
  // four canisters on a tilting rack (origin at the turntable)
  const T = { at: [0, 0.6, 0], pitch: 0.55 };
  box(B, T, [2.4, 0.25, 4.6], '#4c4f37');
  for (const [x, y] of [[-0.6, 0.35], [0.6, 0.35], [-0.6, 1.05], [0.6, 1.05]]) {
    const c = Math.cos(0.55), s = Math.sin(0.55);
    cyl(B, { at: [x, 0.6 + y * c + 2.0 * s, -2.0 * c + y * s], pitch: -PI / 2 + 0.55 }, 0.32, 0.32, 4.4, 6, '#7d806a');
  }
}
function radarBase(B) {
  // a trailer cabin with outriggers and a lattice mast
  box(B, { at: [0, 1.6, 0] }, [2.5, 2.2, 6.0], '#7a7c68');
  for (const z of [-2.0, 2.0]) for (const s of [-1, 1]) box(B, { at: [s * 1.9, 0.25, z], yaw: s * 0.3 }, [1.6, 0.2, 0.25], '#3a3b33');
  cyl(B, { at: [0, 2.7, 0.8] }, 0.35, 0.25, 4.2, 4, '#5a5c50');
  box(B, { at: [-0.8, 3.0, -2.2] }, [0.4, 0.6, 0.4], '#4a4c40');
}
function radarDish(B) {
  // a slotted array, turning about y (origin at its pivot)
  box(B, { at: [0, 0.2, 0] }, [0.5, 0.6, 0.5], '#4a4c40');
  for (let i = -3; i <= 3; i++) box(B, { at: [i * 0.85, 1.2 - Math.abs(i) * 0.06, Math.abs(i) * Math.abs(i) * 0.04], yaw: -i * 0.07 }, [0.86, 1.6, 0.16], '#d2d3c8');
}

// ---------- buildings and props ----------
/** a house: walls w × d × h with a gabled roof along x, origin at the ground's middle */
export function house(B, w, d, h, wall, roof) {
  box(B, { at: [0, h / 2, 0] }, [w, h, d], wall);
  frustum(B, { at: [0, h, 0] }, [w + 0.6, d * 0.5, d + 0.8], [w + 0.6, 0.08], roof);
  box(B, { at: [w * 0.25, h * 0.45, -d / 2 - 0.02] }, [w * 0.18, h * 0.32, 0.05], '#2c2f30');
  box(B, { at: [-w * 0.25, h * 0.45, -d / 2 - 0.02] }, [w * 0.18, h * 0.32, 0.05], '#2c2f30');
  box(B, { at: [w * 0.28, h + d * 0.32, 0.6] }, [0.7, d * 0.4, 0.7], '#6b5a4c');
}
function barn(B) {
  box(B, { at: [0, 3.0, 0] }, [9, 6, 16], '#7c3a2c');
  frustum(B, { at: [0, 6.0, 0] }, [10, 2.4, 16.6], [6.4, 16.6], '#4b4a46');
  frustum(B, { at: [0, 8.4, 0] }, [6.4, 1.6, 16.6], [0.3, 16.6], '#4b4a46');
  box(B, { at: [0, 2.2, -8.05] }, [4, 4.4, 0.1], '#5a2a20');
  cyl(B, { at: [7.5, 0, 4] }, 2.2, 2.2, 12, 8, '#9b9a90');
  cyl(B, { at: [7.5, 12, 4] }, 2.3, 0.2, 1.8, 8, '#6e6e66');
}
function chapel(B) {
  box(B, { at: [0, 3.5, 0] }, [7, 7, 14], '#d7d0bf');
  frustum(B, { at: [0, 7, 0] }, [7.8, 3.6, 14.6], [0.2, 14.6], '#5a4a44');
  box(B, { at: [0, 6, -8.2] }, [3.6, 12, 3.6], '#d0c9b8');
  frustum(B, { at: [0, 12, -8.2] }, [4, 6, 4], [0.1, 0.1], '#4a3f3a');
}
function depot(B) {
  // fuel bladders and drums behind an earth berm, a supply tent
  frustum(B, {}, [26, 1.6, 20], [23, 17], '#6b5d43');
  for (const [x, z] of [[-6, -3], [-6, 4], [4, -3]]) cyl(B, { at: [x, 1.6, z], pitch: PI / 2, yaw: 0 }, 1.8, 1.8, 5.5, 8, '#525849');
  for (let k = 0; k < 6; k++) cyl(B, { at: [3 + (k % 3) * 1.3, 1.6, 3 + ((k / 3) | 0) * 1.3] }, 0.6, 0.6, 1.3, 6, '#5a6a50');
  frustum(B, { at: [0, 1.6, 8.5] }, [8, 2.8, 4], [0.3, 4], '#5d6a4a');
}
function command(B) {
  // a command post: two camouflaged tents, a generator, a whip mast
  frustum(B, {}, [10, 3.4, 7], [0.4, 7], '#59603f');
  frustum(B, { at: [9, 0, 2], yaw: 0.6 }, [7, 2.6, 5], [0.4, 5], '#4f5638');
  box(B, { at: [-6, 0.6, 3] }, [1.6, 1.2, 1.0], '#3b3d33');
  cyl(B, { at: [-6, 0, -2] }, 0.07, 0.04, 11, 4, '#2d2d27');
  for (let k = 0; k < 8; k++) box(B, { at: [-3 + k * 1.1, 0.35, -5], yaw: 0 }, [1.1, 0.7, 0.6], '#8d8160');
}
function bunker(B) {
  frustum(B, {}, [16, 3.2, 14], [11, 9], '#7c7a6e');
  box(B, { at: [0, 1.4, -7.2] }, [6, 1.0, 1.0], '#2a2a26');
  for (let k = 0; k < 10; k++) box(B, { at: [-9 + k * 2, 0.4, -9.5] }, [1.9, 0.8, 0.8], '#8f8467');
}
/** a bridge deck of half-length hl along z, its top at y 0, piers down to −depth */
export function bridge(B, hl, depth = 12, w = 9) {
  box(B, { at: [0, -0.6, 0] }, [w, 1.2, hl * 2], '#7d776c');
  for (const s of [-1, 1]) {
    box(B, { at: [s * (w / 2 - 0.2), 0.6, 0] }, [0.3, 0.5, hl * 2], '#5b5750');
    for (let z = -hl + 4; z <= hl - 4; z += 12) box(B, { at: [s * (w / 2 - 0.2), 0.25, z] }, [0.2, 0.5, 0.2], '#5b5750');
  }
  const n = Math.max(1, Math.round(hl / 18));
  for (let k = 1; k < n * 2; k++) box(B, { at: [0, -depth / 2 - 0.6, -hl + (k * hl) / n] }, [6, depth, 2.2], '#8a847a');
}
/** the landing-zone mark: a broken ring and an H, laid flat just over the ground */
export function lzMark(B, colour = '#e8e4d4') {
  const c = rgb(colour), n = 20, R0 = 10.5, R1 = 12, y = 0.12;
  for (let i = 0; i < n; i++) {
    if (i % 2) continue;
    const a0 = (i / n) * PI * 2, a1 = ((i + 1) / n) * PI * 2;
    const p = (a, r) => [Math.cos(a) * r, y, Math.sin(a) * r];
    B.quad(p(a0, R0), p(a1, R0), p(a1, R1), p(a0, R1), c, 255, [0, -10, 0]);
  }
  for (const [x, z, w, d] of [[-2.6, 0, 1.2, 8], [2.6, 0, 1.2, 8], [0, 0, 4.0, 1.2]]) {
    const q = [[x - w / 2, y, z - d / 2], [x + w / 2, y, z - d / 2], [x + w / 2, y, z + d / 2], [x - w / 2, y, z + d / 2]];
    B.quad(q[0], q[1], q[2], q[3], c, 255, [0, -10, 0]);
  }
}
/** the downed crew: a signal panel, a spilled canopy and two figures waving */
function survivor(B) {
  const panel = [[-1.6, -1.6], [1.6, -1.6], [1.6, 1.6], [-1.6, 1.6]];
  plate(B, { at: [0, 0.05, 0], yaw: 0.4 }, panel, 0.05, '#ff6a1c');
  plate(B, { at: [0, 0.09, 0], yaw: 0.4 }, [[-0.3, -1.3], [0.3, -1.3], [0.3, 1.3], [-0.3, 1.3]], 0.04, '#f2efe4');
  cyl(B, { at: [4, 0, 2.5] }, 3.2, 1.2, 1.0, 8, '#e9e3cf');
  cyl(B, { at: [4, 1, 2.5] }, 1.2, 0.01, 0.6, 8, '#e9e3cf');
  for (const [x, z, arm] of [[-2.4, 0.6, 1], [-1.5, -1.4, -1]]) {
    box(B, { at: [x, 0.5, z] }, [0.4, 1.0, 0.3], '#3d4a3a');
    box(B, { at: [x, 1.35, z] }, [0.45, 0.7, 0.32], '#56634e');
    box(B, { at: [x, 1.85, z] }, [0.26, 0.28, 0.26], '#d6b08a');
    box(B, { at: [x + 0.32, 2.0, z], roll: arm * 0.4 }, [0.14, 0.8, 0.14], '#56634e');
    box(B, { at: [x - 0.32, 2.0, z], roll: -arm * 0.4 }, [0.14, 0.8, 0.14], '#56634e');
  }
}
export function padStores(B) {
  // the forward arming and refuelling point: a bladder, ammo crates, a wind sock
  cyl(B, { at: [0, 0, 0], pitch: PI / 2 }, 1.6, 1.6, 6, 8, '#4c5440');
  for (let k = 0; k < 4; k++) box(B, { at: [4 + k * 1.3, 0.4, 2] }, [1.2, 0.8, 0.8], '#7d8160');
  cyl(B, { at: [-5, 0, -3] }, 0.06, 0.06, 5, 4, '#cfcfc8');
  cyl(B, { at: [-5, 4.7, -3], roll: PI / 2 - 0.15 }, 0.35, 0.15, 1.6, 6, '#ff7a2a');
}
function wreck(B, r = 1) {
  for (const [x, z, sx, sy, sz, yaw] of [[0, 0, 3.2, 1.0, 5, 0.3], [2.2, -2.6, 1.6, 0.7, 1.4, 1], [-2.4, 1.6, 1.3, 1.2, 1.8, 0.7], [1.2, 2.8, 2.0, 0.5, 1.2, 2]])
    box(B, { at: [x * r, (sy * r) / 2, z * r], yaw }, [sx * r, sy * r, sz * r], '#2a2622');
}
function heliWreck(B) {
  loft(B, { roll: 0.5, at: [0, 0.6, 0] }, [[-5, 0.4, 0.4, 0], [-3, 0.9, 0.9, 0], [1, 0.9, 0.8, 0], [3, 0.4, 0.4, 0.1]], 6, '#2c2a26');
  box(B, { at: [1.5, 0.3, 5], yaw: 0.6 }, [0.4, 0.4, 4.5], '#262420');
  for (const [a, l] of [[0.3, 6], [2.1, 4], [4, 5.2]]) box(B, { at: [Math.sin(a) * l * 0.5, 0.15, Math.cos(a) * l * 0.5], yaw: a, roll: 0.2 }, [0.45, 0.06, l], '#1f1f1c');
}

// ---------- trees (unit size: 1 wide, 1 tall; each instance scales and tints them) ----------
// shapes as theatres.js names them: 'cone' (pine, spruce, larch), 'round' (beech, canopy),
// 'tall' (birch, poplar), 'palm'; built per theatre in its own colours (terrain.js)
function cone(B, col, trunk) {
  cyl(B, {}, 0.05, 0.04, 0.22, 3, trunk, 255, false);
  for (const [y, r, h, yaw] of [[0.1, 0.5, 0.45, 0], [0.38, 0.37, 0.4, 0.5], [0.62, 0.24, 0.38, 1.1]]) cyl(B, { at: [0, y, 0], yaw }, r, 0, h, 6, col, 255, false);
}
/** a crown of rings through heights ys with radii rs, n sides, pointed at both ends */
function crown(B, ys, rs, n, col, twist = 0.4) {
  const c = typeof col === 'string' ? rgb(col) : col;
  const ring = (k) => Array.from({ length: n }, (_, i) => { const a = (i / n) * PI * 2 + k * twist; return [Math.cos(a) * rs[k], ys[k], Math.sin(a) * rs[k]]; });
  const rings = ys.map((_, k) => ring(k)), bot = [0, ys[0] - 0.08, 0], topP = [0, ys[ys.length - 1] + 0.12, 0];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    B.tri(bot, rings[0][j], rings[0][i], c, 255, [0, ys[0], 0]);
    for (let k = 0; k + 1 < rings.length; k++) B.quad(rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i], c, 255, [0, (ys[k] + ys[k + 1]) / 2, 0]);
    B.tri(rings[rings.length - 1][i], rings[rings.length - 1][j], topP, c, 255, [0, ys[ys.length - 1], 0]);
  }
}
function round(B, col, trunk) {
  cyl(B, {}, 0.06, 0.05, 0.36, 3, trunk, 255, false);
  crown(B, [0.42, 0.8], [0.5, 0.36], 5, col);
}
function tall(B, col, trunk) {
  cyl(B, {}, 0.05, 0.035, 0.5, 3, trunk, 255, false);
  crown(B, [0.5, 0.82], [0.4, 0.3], 5, col);
}
function palm(B, col, trunk) {
  // a curved trunk of three segments, a crown of drooping fronds
  let x = 0, y = 0;
  for (const [l, lean] of [[0.32, 0.05], [0.3, 0.14], [0.28, 0.24]]) { cyl(B, { at: [x, y, 0], roll: -lean }, 0.045, 0.035, l + 0.02, 3, trunk, 255, false); x += Math.sin(lean) * l; y += Math.cos(lean) * l; }
  const c = rgb(col), d = c.map(v => Math.round(v * 0.75));
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05, dx = Math.cos(a) * 0.5, dz = Math.sin(a) * 0.5, px = -Math.sin(a) * 0.1, pz = Math.cos(a) * 0.1;
    const top = [x, y + 0.04, 0], mid = [x + dx * 0.55, y + 0.06, dz * 0.55];
    B.tri(top, [mid[0] + px, mid[1], mid[2] + pz], [mid[0] - px, mid[1], mid[2] - pz], i % 2 ? c : d, 255, [x, y - 5, 0]);
    B.tri([mid[0] + px, mid[1], mid[2] + pz], [x + dx, y - 0.2, dz], [mid[0] - px, mid[1], mid[2] - pz], i % 2 ? c : d, 255, [x, y - 5, 0]);
  }
}
/** one tree kind, near (full) or far (a few faces) */
export function tree(B, shape, col, trunk, far = false) {
  if (far) {
    if (shape === 'cone') cyl(B, { at: [0, 0.06, 0] }, 0.5, 0, 0.94, 4, col, 255, false);
    else if (shape === 'palm') crown(B, [0.8], [0.55], 4, col);
    else crown(B, [0.55], [shape === 'tall' ? 0.4 : 0.5], 4, col);
    return;
  }
  if (shape === 'cone') cone(B, col, trunk);
  else if (shape === 'tall') tall(B, col, trunk);
  else if (shape === 'palm') palm(B, col, trunk);
  else round(B, col, trunk);
}

// ---------- stores in flight ----------
function atgm(B) {
  cyl(B, { pitch: -PI / 2, at: [0, 0, 0.8] }, 0.09, 0.09, 1.4, 6, '#dedcd0');
  cyl(B, { pitch: -PI / 2, at: [0, 0, -0.6] }, 0.09, 0.02, 0.25, 6, '#c33a2a');
  for (const r of [PI / 4, (3 * PI) / 4]) plate(B, { roll: r, at: [0, 0, 0.6] }, [[-0.3, -0.1], [0.3, -0.1], [0, 0.2]], 0.02, '#a8a69a');
}
function rocket(B) {
  cyl(B, { pitch: -PI / 2, at: [0, 0, 0.6] }, 0.05, 0.05, 1.1, 4, '#8a8e80');
  cyl(B, { pitch: -PI / 2, at: [0, 0, -0.5] }, 0.05, 0.005, 0.2, 4, '#5a5e50');
}
function samMissile(B) {
  cyl(B, { pitch: -PI / 2, at: [0, 0, 1.6] }, 0.18, 0.18, 2.8, 6, '#e4e2d8');
  cyl(B, { pitch: -PI / 2, at: [0, 0, -1.2] }, 0.18, 0.01, 0.5, 6, '#c9c7bb');
  for (const r of [0, PI / 2]) plate(B, { roll: r, at: [0, 0, 1.2] }, [[-0.5, -0.1], [0.5, -0.1], [0, 0.4]], 0.03, '#a8a69a');
}

/** every shared mesh in one buffer: { data, ranges: { name: [first, count] } } */
export function buildMeshes() {
  const B = builder(65536), ranges = {};
  const add = (name, fn) => { const s = B.n; fn(B); ranges[name] = [s, B.n - s]; };
  add('player', gadfly);
  add('mantis', mantis);
  add('blades4', B => blades(B, MOUNT.player.r, 4));
  add('blades3', B => blades(B, MOUNT.mantis.r, 3, '#2d2a22', 0.55));
  add('disc', B => disc(B, 1, 28, '#2b2e2b'));
  add('ring', B => disc(B, 1, 28, '#3a3d38', 0.9));
  add('tail4', B => tailBlades(B, 1, 4));
  add('tailDisc', B => tailDisc(B, 1));
  add('stiletto', stiletto);
  add('tank', B => tank(B));
  add('tankTurret', B => tankTurret(B));
  add('apc', B => apc(B));
  add('ally', B => apc(B, '#56685e'));
  add('truck', B => truck(B, 'cargo'));
  add('fueler', B => truck(B, 'fuel'));
  add('aa', aa);
  add('aaGun', aaGun);
  add('aatrack', aatrack);
  add('aaTurret', aaTurret);
  add('sam', samBase);
  add('samRack', samRack);
  add('radar', radarBase);
  add('radarDish', radarDish);
  add('depot', depot);
  add('command', command);
  add('bunker', bunker);
  add('barn', barn);
  add('chapel', chapel);
  add('lz', lzMark);
  add('survivor', survivor);
  add('farp', padStores);
  add('wreck', B => wreck(B));
  add('wreckBig', B => wreck(B, 2.4));
  add('heliWreck', heliWreck);
  add('atgm', atgm);
  add('rocket', rocket);
  add('samMissile', samMissile);
  return { data: B.data(), ranges };
}
