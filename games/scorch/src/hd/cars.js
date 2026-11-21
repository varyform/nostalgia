// The cars, seen from above: one silhouette per career model, painted in the car's colour with
// rounded-body shading, glass and roof highlights, panel lines, lamps, guns and each model's own
// kit (roof rack, pickup bed, scoop and stripes, wing, armour). The body is painted once per
// model, colour, damage step and size into a sprite (dents, scratches, cracked glass, soot; a
// burnt hulk for a wreck) with a blurred shadow beside it; a frame only rotates the sprites and
// adds what moves: the wheels turning with the steering, lit lamps, brake lights, the turbo
// flame and a hit flash. Headlight beams are a separate, additive pass (drawBeams).
//
//   drawCar(g, model, colour, x, y, a, scale, { damage, boost, brake, lights, wreck, steer, flash, t, shadow })
//   — x, y and scale (px per metre) in g's current units; a = heading (0 = +x, clockwise on screen)
import { TAU, alpha, canvas, clamp, mix, puff, rng, roundPoly, shadeOf, strHash } from './gfx.js';

// ---------- the silhouettes ----------
// Car-local metres: x forward, y to the right. Outlines list the right half from the nose's
// centre to the tail's ([x, y, corner radius?]) and are mirrored. f/r: wheel axles, ty: half
// track, tl/tw: tyre length and width. head/tail: lamp lenses [x, y, length, width] (right).
// gun: muzzle [x, y] pairs; pipe: exhausts [x, y]; spot: extra lamps. kit: the model's own parts.
const SHAPES = {
  // the starting junker: a boxy, tired hatchback with a rack on the roof and a scavenged gun
  junker: {
    L: 3.9, W: 1.76, r: 0.24,
    body: [[1.95, 0, 0], [1.94, 0.6], [1.74, 0.86, 0.3], [-1.72, 0.88, 0.22], [-1.95, 0.78, 0.16], [-1.95, 0, 0]],
    cabin: [[0.82, 0, 0], [0.72, 0.7, 0.24], [-1.56, 0.75, 0.16], [-1.8, 0.66, 0.1], [-1.8, 0, 0]],
    roof: [[0.38, 0, 0], [0.32, 0.62, 0.14], [-1.38, 0.65, 0.14], [-1.56, 0.6, 0.08], [-1.56, 0, 0]],
    f: 1.22, rr: -1.2, ty: 0.77, tl: 0.58, tw: 0.24,
    head: [[1.87, 0.58, 0.12, 0.22]], tail: [[-1.91, 0.66, 0.08, 0.2]],
    gun: [[1.25, 0]], pipe: [[-1.98, 0.5]], kit: 'junker', bumper: 0.12,
  },
  // a heavy pickup: bull bar, roll bar of spotlights, a ribbed bed with a gun on a post
  pickup: {
    L: 4.9, W: 1.98, r: 0.2,
    body: [[2.45, 0, 0], [2.43, 0.72], [2.26, 0.97, 0.24], [-2.36, 0.99, 0.12], [-2.45, 0.92, 0.08], [-2.45, 0, 0]],
    cabin: [[1.02, 0, 0], [0.92, 0.82, 0.2], [-0.48, 0.86, 0.1], [-0.56, 0, 0]],
    roof: [[0.56, 0, 0], [0.5, 0.75, 0.12], [-0.38, 0.77, 0.08], [-0.42, 0, 0]],
    f: 1.52, rr: -1.52, ty: 0.9, tl: 0.8, tw: 0.33,
    head: [[2.34, 0.66, 0.12, 0.26]], tail: [[-2.42, 0.86, 0.07, 0.14]],
    gun: [[2.1, 0]], pipe: [[-2.5, 0.7]], spot: [[-0.62, 0.62], [-0.62, 0.22]], kit: 'pickup', bumper: 0.14,
  },
  // a long-hooded muscle coupe: hips over the rear wheels, scoop, stripes, twin hood guns
  muscle: {
    L: 4.8, W: 1.94, r: 0.26,
    body: [[2.4, 0, 0], [2.38, 0.6], [2.2, 0.86, 0.3], [1.4, 0.9, 0.4], [0.3, 0.88, 0.6], [-1.2, 0.97, 0.5], [-2.2, 0.92, 0.3], [-2.4, 0.72, 0.18], [-2.4, 0, 0]],
    cabin: [[0.25, 0, 0], [0.14, 0.74, 0.26], [-1.18, 0.78, 0.3], [-1.76, 0.58, 0.2], [-1.82, 0, 0]],
    roof: [[-0.2, 0, 0], [-0.24, 0.64, 0.15], [-0.98, 0.66, 0.2], [-1.06, 0, 0]],
    f: 1.45, rr: -1.4, ty: 0.83, tl: 0.7, tw: 0.32,
    head: [[2.3, 0.62, 0.12, 0.2], [2.32, 0.36, 0.1, 0.16]], tail: [[-2.37, 0.62, 0.07, 0.26]],
    gun: [[2.42, 0.3], [2.42, -0.3]], pipe: [[-2.45, 0.42], [-2.45, -0.42]], kit: 'muscle', stripe: true, bumper: 0.1,
  },
  // a low wedge: knife nose, cab-forward glass bubble, louvred engine cover, a big wing
  wedge: {
    L: 4.5, W: 1.98, r: 0.2,
    body: [[2.25, 0, 0], [2.22, 0.34, 0.15], [1.9, 0.8, 0.4], [0.6, 0.98, 0.6], [-1.6, 0.99, 0.3], [-2.2, 0.9, 0.15], [-2.25, 0, 0]],
    cabin: [[0.98, 0, 0], [0.7, 0.62, 0.4], [-0.6, 0.69, 0.4], [-1.0, 0.42, 0.2], [-1.05, 0, 0]],
    roof: [[0.34, 0, 0], [0.24, 0.5, 0.25], [-0.44, 0.54, 0.25], [-0.6, 0, 0]],
    f: 1.36, rr: -1.36, ty: 0.86, tl: 0.66, tw: 0.33,
    head: [[1.98, 0.58, 0.16, 0.14]], tail: [[-2.18, 0.66, 0.06, 0.3]],
    gun: [[2.05, 0.62], [2.05, -0.62]], pipe: [[-2.3, 0.18], [-2.3, -0.18]], kit: 'wedge', bumper: 0.06,
  },
  // the champion's interceptor: hard-edged armour, slit glass, a ram, a roof turret
  interceptor: {
    L: 5.1, W: 2.08, r: 0.05,
    body: [[2.55, 0, 0], [2.55, 0.52], [2.3, 0.98], [1.2, 1.04], [-1.8, 1.04], [-2.5, 0.9], [-2.55, 0.5], [-2.55, 0, 0]],
    cabin: [[0.6, 0, 0], [0.5, 0.66, 0.06], [-1.0, 0.7, 0.06], [-1.2, 0.5], [-1.2, 0, 0]],
    roof: [[0.36, 0, 0], [0.28, 0.56, 0.04], [-0.88, 0.6, 0.04], [-1.02, 0.42], [-1.02, 0, 0]],
    f: 1.6, rr: -1.6, ty: 0.9, tl: 0.76, tw: 0.34,
    head: [[2.44, 0.7, 0.08, 0.26]], tail: [[-2.52, 0.62, 0.05, 0.3]],
    gun: [[1.5, 0.16], [1.5, -0.16]], pipe: [[-2.6, 0.62], [-2.6, 0.38], [-2.6, -0.38], [-2.6, -0.62]], kit: 'interceptor', bumper: 0,
  },
};
const ORDER = ['junker', 'pickup', 'wedge', 'muscle', 'interceptor'];
// career.js's MODELS (in its order) → silhouettes; an unknown id still gets a car
const BY_ID = { dustpan: 'junker', mongrel: 'pickup', kestrel: 'wedge', bulwark: 'muscle', nightjar: 'interceptor' };
export const shapeOf = model => SHAPES[BY_ID[model] ?? model] ?? (typeof model === 'number' ? SHAPES[ORDER[model % 5]] : SHAPES[ORDER[strHash(String(model)) % 4]]);

// the sim gives every car one 4.4 m body: the silhouettes keep their differences, but squeezed
// toward that, so a bump looks like one
const fit = S => (4.4 + (S.L - 4.4) * 0.35) / S.L;
const mirror = half => {
  const out = half.map(p => p.slice());
  for (let i = half.length - 1; i >= 0; i--) if (half[i][1] !== 0) out.push([half[i][0], -half[i][1], half[i][2]]);
  return out;
};
const outlines = new WeakMap();
function outline(S) {
  let o = outlines.get(S);
  if (!o) { o = { body: mirror(S.body), cabin: mirror(S.cabin), roof: mirror(S.roof) }; outlines.set(S, o); }
  return o;
}
// a crumpled copy: corners pushed in, more at the nose and tail
function crumple(pts, amt, R) {
  return pts.map(([x, y, r]) => {
    const end = Math.abs(x) > 1.2 ? 1 : 0.3;
    return [x - Math.sign(x) * amt * end * 0.25 * R(), y * (1 - amt * end * 0.08 * R()), r];
  });
}

// ---------- the sprite ----------
const SPR = new Map();
const MARGIN = 1.3; // metres around the body: wing, bull bar and guns stick out
function sprite(S, colour, dmg, wreck, q, kind) {
  const key = `${S.kit}|${colour}|${dmg}|${wreck ? 1 : 0}|${q}|${kind}`;
  let c = SPR.get(key);
  if (c) return c;
  if (SPR.size > 160) SPR.delete(SPR.keys().next().value);
  const w = (S.L + MARGIN * 2) * q, h = (S.W + MARGIN * 2) * q;
  c = canvas(w, h);
  const g = c.getContext('2d');
  g.setTransform(q, 0, 0, q, c.width / 2, c.height / 2);
  if (kind === 'shadow') paintShadow(g, S, q, dmg);
  else if (kind === 'flash') { g.fillStyle = '#ffffff'; g.beginPath(); roundPoly(g, outline(S).body, S.r); g.fill(); }
  else paintBody(g, S, colour, dmg, wreck);
  SPR.set(key, c);
  return c;
}
// the shadow: the body's silhouette, blurred (through shadowBlur, which every browser has)
function paintShadow(g, S, q) {
  const far = 4000;
  g.save();
  g.shadowColor = 'rgba(0,0,0,1)'; g.shadowBlur = 0.32 * q; g.shadowOffsetX = far * q;
  g.translate(-far, 0);
  g.beginPath(); roundPoly(g, outline(S).body.map(([x, y, r]) => [x * 1.02, y * 1.08, r]), S.r); g.fillStyle = '#000'; g.fill();
  g.restore();
}

function paintBody(g, S, colour, dmg, wreck) {
  const O = outline(S), R = rng(strHash(S.kit + colour) + dmg * 7);
  const base = wreck ? '#2a2420' : colour;
  const dark = shadeOf(base, -0.55), lite = shadeOf(base, wreck ? 0.08 : 0.32), trim = wreck ? '#141110' : '#1b1d20';
  const body = dmg >= 3 || wreck ? crumple(O.body, wreck ? 1 : 0.7, R) : O.body;
  const path = p => { g.beginPath(); roundPoly(g, p, S.r); };
  const hw = S.W / 2, hl = S.L / 2;

  // bumpers: dark trim strips that sit proud of the nose and tail
  if (S.bumper) {
    g.fillStyle = trim;
    g.beginPath(); g.roundRect(hl - S.bumper * 1.4, -hw * 0.82, S.bumper * 1.6, hw * 1.64, 0.08); g.fill();
    g.beginPath(); g.roundRect(-hl - S.bumper * 0.2, -hw * 0.8, S.bumper * 1.6, hw * 1.6, 0.08); g.fill();
  }
  kitUnder(g, S, base, trim, wreck);
  // the body: its colour, then shading across it (a rounded top) and toward the nose and tail
  path(body); g.fillStyle = base; g.fill();
  g.save(); path(body); g.clip();
  let gr = g.createLinearGradient(0, -hw, 0, hw);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.16, 'rgba(0,0,0,0.12)'); gr.addColorStop(0.36, 'rgba(255,255,255,0.10)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.04)'); gr.addColorStop(0.7, 'rgba(0,0,0,0.04)'); gr.addColorStop(0.86, 'rgba(0,0,0,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = gr; g.fillRect(-hl - 1, -hw - 1, S.L + 2, S.W + 2);
  gr = g.createLinearGradient(-hl, 0, hl, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0.35)'); gr.addColorStop(0.1, 'rgba(0,0,0,0)'); gr.addColorStop(0.9, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.3)');
  g.fillStyle = gr; g.fillRect(-hl - 1, -hw - 1, S.L + 2, S.W + 2);
  // a stripe pair (muscle) or the junker's mismatched primer door
  if (S.stripe && !wreck) { g.fillStyle = alpha(mix(colour, '#f4efe6', 0.85), 0.9); g.fillRect(-hl, -0.3, S.L, 0.16); g.fillRect(-hl, 0.14, S.L, 0.16); }
  if (S.kit === 'junker' && !wreck) { g.fillStyle = 'rgba(120,118,108,0.85)'; g.fillRect(-0.55, 0.45, 1.2, 0.6); g.fillStyle = 'rgba(150,80,40,0.55)'; for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(-hl + R() * S.L, (R() - 0.5) * S.W, 0.05 + R() * 0.12, 0.03 + R() * 0.08, R() * 3, 0, TAU); g.fill(); } }
  // panel lines: the hood's seam, the doors, the boot
  g.strokeStyle = 'rgba(0,0,0,0.38)'; g.lineWidth = 0.025;
  const cf = S.cabin[0][0], cr = S.cabin[S.cabin.length - 1][0];
  g.beginPath();
  g.moveTo(cf + 0.12, -hw * 0.86); g.quadraticCurveTo(cf + 0.2, 0, cf + 0.12, hw * 0.86);
  for (const sy of [-1, 1]) { g.moveTo(cf - 0.1, sy * hw * 0.93); g.lineTo(cf - 0.1, sy * hw * 0.8); g.moveTo((cf + cr) / 2 - 0.1, sy * hw * 0.95); g.lineTo((cf + cr) / 2 - 0.1, sy * hw * 0.8); }
  if (S.kit !== 'pickup' && S.kit !== 'junker') { g.moveTo(cr - 0.12, -hw * 0.8); g.quadraticCurveTo(cr - 0.2, 0, cr - 0.12, hw * 0.8); }
  g.stroke();
  // the light catching the hood's crown
  gr = g.createLinearGradient(0, -hw, 0, hw * 0.2);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, wreck ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(cf + 0.2, -hw, hl - cf - 0.3, hw * 1.2);
  g.restore();
  // a hard dark rim where the body turns under
  path(body); g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.04; g.stroke();
  g.strokeStyle = alpha(lite, 0.35); g.lineWidth = 0.02; g.beginPath(); roundPoly(g, body.map(([x, y, r]) => [x * 0.97, y * 0.9, r]), S.r); g.stroke();

  kitOver(g, S, base, lite, dark, trim, wreck, R);

  // the glass: dark, a sky gradient, a sheen across the windscreen
  path(O.cabin);
  if (wreck) { g.fillStyle = '#0c0a09'; g.fill(); }
  else {
    gr = g.createLinearGradient(cf, -hw, cr, hw);
    gr.addColorStop(0, '#5f7d96'); gr.addColorStop(0.35, '#1f2c38'); gr.addColorStop(0.7, '#141c25'); gr.addColorStop(1, '#3a5064');
    g.fillStyle = gr; g.fill();
    g.save(); path(O.cabin); g.clip();
    g.fillStyle = 'rgba(220,240,255,0.22)';
    g.beginPath(); g.moveTo(cf + 0.1, -hw * 0.9); g.lineTo(cf - 0.15, -hw * 0.9); g.lineTo(cf - 0.45, hw); g.lineTo(cf - 0.25, hw); g.fill();
    g.fillStyle = 'rgba(220,240,255,0.1)';
    g.beginPath(); g.moveTo(cr + 0.5, -hw); g.lineTo(cr + 0.38, -hw); g.lineTo(cr + 0.1, hw); g.lineTo(cr + 0.22, hw); g.fill();
    g.restore();
  }
  // pillars and the roof, highest and so the most lit
  path(O.roof);
  const roofCol = wreck ? '#1c1816' : mix(base, '#ffffff', 0.08);
  g.fillStyle = roofCol; g.fill();
  g.save(); path(O.roof); g.clip();
  const rf = S.roof[0][0], rr = S.roof[S.roof.length - 1][0], rw = S.roof[1][1];
  gr = g.createLinearGradient(0, -rw, 0, rw);
  gr.addColorStop(0, 'rgba(0,0,0,0.3)'); gr.addColorStop(0.3, wreck ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.22)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = gr; g.fillRect(rr - 1, -rw - 1, rf - rr + 2, rw * 2 + 2);
  if (S.stripe && !wreck) { g.fillStyle = alpha(mix(colour, '#f4efe6', 0.85), 0.9); g.fillRect(rr - 1, -0.3, rf - rr + 2, 0.16); g.fillRect(rr - 1, 0.14, rf - rr + 2, 0.16); }
  g.restore();
  path(O.roof); g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.025; g.stroke();
  // A-pillars from the roof to the glass's front corners
  g.strokeStyle = roofCol; g.lineWidth = 0.07;
  const c1 = S.cabin[1], r1 = S.roof[1];
  g.beginPath(); for (const sy of [-1, 1]) { g.moveTo(r1[0], sy * r1[1]); g.lineTo(c1[0] - 0.04, sy * (c1[1] - 0.02)); } g.stroke();
  // mirrors
  if (S.kit !== 'interceptor') { g.fillStyle = wreck ? trim : dark; for (const sy of [-1, 1]) { g.beginPath(); g.ellipse(c1[0] - 0.12, sy * (hw + 0.06), 0.1, 0.06, sy * 0.4, 0, TAU); g.fill(); } }

  lamps(g, S, wreck);
  kitTop(g, S, base, lite, dark, trim, wreck);
  if (dmg > 0 || wreck) damage(g, S, body, dmg, wreck, R, cf, cr);
}

function lamps(g, S, wreck) {
  for (const [x, y, l, w] of S.head) for (const sy of [-1, 1]) {
    g.fillStyle = '#0d0f12'; g.beginPath(); g.roundRect(x - l / 2 - 0.02, sy * y - w / 2 - 0.02, l + 0.04, w + 0.04, 0.04); g.fill();
    g.fillStyle = wreck ? '#191512' : '#dfe6ea'; g.beginPath(); g.roundRect(x - l / 2, sy * y - w / 2, l, w, 0.03); g.fill();
    if (!wreck) { g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(x - l * 0.1, sy * y - w * 0.3, l * 0.35, w * 0.25); }
  }
  for (const [x, y, l, w] of S.tail) for (const sy of [-1, 1]) {
    g.fillStyle = wreck ? '#1a0f0c' : '#6a0c0a'; g.beginPath(); g.roundRect(x - l / 2, sy * y - w / 2, l, w, 0.02); g.fill();
    if (!wreck) { g.fillStyle = 'rgba(255,120,100,0.5)'; g.fillRect(x - l * 0.2, sy * y - w * 0.35, l * 0.3, w * 0.3); }
  }
}

// parts below the body's outline (they stick out at the sides or ends)
function kitUnder(g, S, base, trim, wreck) {
  const hl = S.L / 2;
  if (S.kit === 'pickup') { // the bull bar: a tubular frame ahead of the grille
    g.strokeStyle = wreck ? '#2a2420' : '#8a8e92'; g.lineWidth = 0.07; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(hl - 0.1, -0.86); g.lineTo(hl + 0.18, -0.7); g.lineTo(hl + 0.22, 0.7); g.lineTo(hl - 0.1, 0.86); g.moveTo(hl + 0.2, -0.3); g.lineTo(hl - 0.05, -0.3); g.moveTo(hl + 0.2, 0.3); g.lineTo(hl - 0.05, 0.3); g.stroke();
  }
  if (S.kit === 'interceptor') { // the ram: a steel wedge across the nose
    g.fillStyle = wreck ? '#1e1a18' : '#4a4d52';
    g.beginPath(); g.moveTo(hl - 0.1, -1.0); g.lineTo(hl + 0.3, -0.6); g.lineTo(hl + 0.38, 0); g.lineTo(hl + 0.3, 0.6); g.lineTo(hl - 0.1, 1.0); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 0.025; g.beginPath(); g.moveTo(hl + 0.3, -0.6); g.lineTo(hl + 0.38, 0); g.lineTo(hl + 0.3, 0.6); g.stroke();
  }
  if (S.kit === 'wedge') { // the rear wing's end plates hang out past the tail
    g.fillStyle = trim; g.fillRect(-hl - 0.28, -1.02, 0.52, 0.08); g.fillRect(-hl - 0.28, 0.94, 0.52, 0.08);
  }
  if (S.kit === 'muscle') { // side pipes along the sills, a toothed ram blade across the nose
    g.fillStyle = wreck ? '#2a2420' : '#b9bcc0';
    for (const sy of [-1, 1]) { g.beginPath(); g.roundRect(-0.9, sy * 0.98 - 0.05, 1.5, 0.1, 0.05); g.fill(); }
    g.fillStyle = wreck ? '#1e1a18' : '#55585d';
    g.beginPath(); g.moveTo(hl - 0.15, -1.04); g.lineTo(hl + 0.2, -0.95);
    for (let k = 0; k <= 6; k++) { const y = -0.95 + k * 0.317; g.lineTo(hl + 0.3 + (k % 2) * 0.1, y); }
    g.lineTo(hl + 0.2, 0.95); g.lineTo(hl - 0.15, 1.04); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 0.025; g.beginPath(); g.moveTo(hl + 0.25, -0.95); g.lineTo(hl + 0.25, 0.95); g.stroke();
  }
  void base;
}
// parts on the body, under the glass
function kitOver(g, S, base, lite, dark, trim, wreck, R) {
  const hl = S.L / 2, hw = S.W / 2;
  if (S.kit === 'pickup') { // the bed: walls, a ribbed floor, a gun on a post
    const x0 = -0.68, x1 = -hl + 0.12;
    g.fillStyle = wreck ? '#100d0c' : mix(base, '#000000', 0.55); g.fillRect(x1, -hw + 0.12, x0 - x1, S.W - 0.24);
    g.strokeStyle = wreck ? '#1a1614' : 'rgba(255,255,255,0.1)'; g.lineWidth = 0.05; g.beginPath();
    for (let y = -hw + 0.3; y < hw - 0.2; y += 0.22) { g.moveTo(x1 + 0.05, y); g.lineTo(x0 - 0.05, y); } g.stroke();
    g.strokeStyle = wreck ? '#2c2622' : lite; g.lineWidth = 0.08; g.strokeRect(x1, -hw + 0.12, x0 - x1, S.W - 0.24);
    if (!wreck) { // a lashed crate and a jerrycan in the bed
      g.fillStyle = '#6a5236'; g.fillRect(-2.05, -0.72, 0.5, 0.5); g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 0.03; g.strokeRect(-2.05, -0.72, 0.5, 0.5);
      g.fillStyle = '#3e5a2c'; g.fillRect(-2.1, 0.35, 0.3, 0.4);
    }
  }
  if (S.kit === 'pickup' && !wreck) { // plated in salvaged road signs
    const sign = (x, y, w, h, bg, rim, mark) => {
      g.fillStyle = rim; g.fillRect(x - w / 2, y - h / 2, w, h); g.fillStyle = bg; g.fillRect(x - w / 2 + 0.03, y - h / 2 + 0.03, w - 0.06, h - 0.06);
      g.fillStyle = mark; g.fillRect(x - w * 0.3, y - 0.025, w * 0.6, 0.05);
      g.fillStyle = 'rgba(0,0,0,0.5)'; for (const dx of [-1, 1]) g.fillRect(x + dx * (w / 2 - 0.06) - 0.015, y - 0.015, 0.03, 0.03);
    };
    sign(0.25, -hw + 0.16, 0.9, 0.24, '#e8c02a', '#1a1a1a', '#1a1a1a');
    sign(-1.1, hw - 0.16, 1.0, 0.22, '#f2f0ea', '#c42a20', '#c42a20');
    sign(-1.8, -hw + 0.16, 0.7, 0.22, '#2a5ab0', '#e8e8e8', '#e8e8e8');
  }
  if (S.kit === 'muscle') { // bolted plates over the doors
    for (const sy of [-1, 1]) {
      g.fillStyle = wreck ? 'rgba(40,36,34,0.9)' : alpha(mix(base, '#7a7e84', 0.6), 0.95); g.fillRect(-1.0, sy * hw * 0.92 - 0.12, 1.3, 0.24);
      g.fillStyle = 'rgba(255,255,255,0.35)'; for (let x = -0.92; x < 0.3; x += 0.3) { g.beginPath(); g.arc(x, sy * hw * 0.92, 0.025, 0, TAU); g.fill(); }
    }
  }
  if (S.kit === 'muscle') { // the hood scoop
    g.fillStyle = mix(base, '#000000', 0.25); g.beginPath(); g.roundRect(0.85, -0.34, 0.85, 0.68, 0.12); g.fill();
    g.fillStyle = '#0b0b0c'; g.fillRect(1.52, -0.26, 0.14, 0.52);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0.9, -0.3, 0.6, 0.06);
  }
  if (S.kit === 'wedge') { // louvres over the engine and intakes at the sides
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 0.06; g.beginPath();
    for (let x = -1.25; x > -1.95; x -= 0.12) { g.moveTo(x, -0.52); g.lineTo(x, 0.52); } g.stroke();
    g.fillStyle = '#0b0b0c'; for (const sy of [-1, 1]) { g.beginPath(); g.moveTo(-0.55, sy * 0.98); g.lineTo(-0.95, sy * 0.98); g.lineTo(-0.8, sy * 0.78); g.closePath(); g.fill(); }
  }
  if (S.kit === 'interceptor') { // armour plates, bolted, and a red line down each flank
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 0.03;
    for (const [x0, x1] of [[0.85, 2.3], [-2.4, -1.35]]) { g.strokeRect(x0, -0.8, x1 - x0, 1.6); g.beginPath(); g.moveTo(x0, 0); g.lineTo(x1, 0); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.3)';
    for (const [x0, x1] of [[0.85, 2.3], [-2.4, -1.35]]) for (const x of [x0 + 0.08, x1 - 0.08]) for (const y of [-0.72, -0.08, 0.08, 0.72]) { g.beginPath(); g.arc(x, y, 0.025, 0, TAU); g.fill(); }
    if (!wreck) { g.fillStyle = '#b3121a'; g.fillRect(-2.3, -0.98, 4.4, 0.05); g.fillRect(-2.3, 0.93, 4.4, 0.05); }
    g.fillStyle = 'rgba(0,0,0,0.5)'; for (const sy of [-1, 1]) for (let x = 1.9; x > 0.95; x -= 0.18) g.fillRect(x, sy * 0.92 - 0.04, 0.1, 0.08);
  }
  void dark; void trim; void R;
}
// parts above the glass: racks, roll bars, guns, wings, turrets
function kitTop(g, S, base, lite, dark, trim, wreck) {
  const hl = S.L / 2, metal = wreck ? '#1a1614' : '#2a2d31', hi = wreck ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.22)';
  const barrel = (x0, x1, y, w = 0.07) => { g.fillStyle = metal; g.fillRect(x0, y - w / 2, x1 - x0, w); g.fillStyle = hi; g.fillRect(x0, y - w / 2, x1 - x0, w * 0.3); g.fillStyle = '#050505'; g.fillRect(x1 - 0.03, y - w * 0.3, 0.03, w * 0.6); };
  if (S.kit === 'junker') { // a roof rack, a spare tyre lashed on it, a small gun on the windscreen's frame
    g.strokeStyle = wreck ? '#1a1614' : '#3a3c40'; g.lineWidth = 0.05; g.beginPath();
    for (const y of [-0.52, 0.52]) { g.moveTo(0.2, y); g.lineTo(-1.35, y); }
    for (const x of [0.05, -0.55, -1.2]) { g.moveTo(x, -0.56); g.lineTo(x, 0.56); }
    g.stroke();
    g.fillStyle = '#121212'; g.beginPath(); g.arc(-0.7, 0.05, 0.36, 0, TAU); g.fill();
    g.fillStyle = wreck ? '#141210' : '#2c2c2e'; g.beginPath(); g.arc(-0.7, 0.05, 0.2, 0, TAU); g.fill();
    g.strokeStyle = wreck ? '#2a2420' : '#6a4a2a'; g.lineWidth = 0.04; g.beginPath(); g.moveTo(-0.7, -0.5); g.lineTo(-0.7, 0.56); g.stroke();
    g.fillStyle = metal; g.beginPath(); g.roundRect(0.5, -0.12, 0.32, 0.24, 0.05); g.fill();
    barrel(0.8, 1.25, 0, 0.06);
  }
  if (S.kit === 'pickup') { // roll bar with spotlights, the bed gun on its post
    g.fillStyle = wreck ? '#1a1614' : '#2a2c30'; g.fillRect(-0.7, -0.86, 0.14, 1.72);
    for (const [x, y] of S.spot) for (const sy of [-1, 1]) { g.fillStyle = '#0c0c0c'; g.beginPath(); g.arc(x, sy * y, 0.1, 0, TAU); g.fill(); g.fillStyle = wreck ? '#1a1614' : '#e8e2c8'; g.beginPath(); g.arc(x + 0.02, sy * y, 0.065, 0, TAU); g.fill(); }
    g.fillStyle = metal; g.beginPath(); g.arc(-1.3, 0, 0.24, 0, TAU); g.fill();
    g.fillStyle = wreck ? '#141210' : '#3a3d42'; g.beginPath(); g.roundRect(-1.45, -0.16, 0.6, 0.32, 0.06); g.fill();
    barrel(-0.9, 2.1, 0, 0.08); // over the cab's roof to the nose
  }
  if (S.kit === 'muscle') { // twin guns on the hood, a ducktail
    for (const sy of [-1, 1]) { g.fillStyle = metal; g.beginPath(); g.roundRect(1.4, sy * 0.3 - 0.1, 0.45, 0.2, 0.05); g.fill(); barrel(1.8, 2.42, sy * 0.3, 0.06); }
    g.fillStyle = wreck ? '#1a1614' : mix(base, '#000000', 0.3); g.fillRect(-hl + 0.02, -0.82, 0.18, 1.64);
  }
  if (S.kit === 'wedge') { // the rear wing, gun pods in the nose
    g.fillStyle = wreck ? '#1c1816' : mix(base, '#000000', 0.2); g.beginPath(); g.roundRect(-hl - 0.25, -1.0, 0.45, 2.0, 0.05); g.fill();
    g.fillStyle = hi; g.fillRect(-hl - 0.2, -0.95, 0.08, 1.9);
    g.fillStyle = trim; g.fillRect(-hl - 0.02, -0.4, 0.06, 0.06); g.fillRect(-hl - 0.02, 0.34, 0.06, 0.06);
    for (const sy of [-1, 1]) barrel(1.45, 2.05, sy * 0.62, 0.06);
  }
  if (S.kit === 'interceptor') { // the roof turret
    g.fillStyle = '#0d0e10'; g.beginPath(); g.arc(-0.3, 0, 0.42, 0, TAU); g.fill();
    g.fillStyle = wreck ? '#1a1614' : '#26282c'; g.beginPath(); g.arc(-0.3, 0, 0.36, 0, TAU); g.fill();
    g.fillStyle = hi; g.beginPath(); g.arc(-0.38, -0.08, 0.14, 0, TAU); g.fill();
    for (const sy of [-1, 1]) barrel(-0.1, 1.5, sy * 0.16, 0.08);
  }
  void lite; void dark;
}

// dents, scratches, bare metal, cracked glass and soot, by damage step (1…3); a wreck is charred
function damage(g, S, body, dmg, wreck, R, cf, cr) {
  const hl = S.L / 2, hw = S.W / 2;
  g.save(); g.beginPath(); roundPoly(g, body, S.r); g.clip();
  const n = wreck ? 10 : dmg * 4;
  for (let i = 0; i < n; i++) { // dents: a dark crescent with a lit lip
    const end = R() < 0.6, x = end ? Math.sign(R() - 0.5) * (hl - 0.2 - R() * 0.5) : (R() - 0.5) * S.L * 0.8, y = (R() - 0.5) * S.W * 0.95;
    const r = 0.07 + R() * 0.1 * (1 + dmg * 0.3), a = R() * TAU;
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.beginPath(); g.ellipse(x, y, r, r * 0.6, a, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 0.025; g.beginPath(); g.ellipse(x, y, r, r * 0.6, a, Math.PI * 1.1, Math.PI * 1.8); g.stroke();
  }
  g.strokeStyle = wreck ? 'rgba(120,90,70,0.25)' : 'rgba(225,225,220,0.55)'; g.lineWidth = 0.015;
  for (let i = 0; i < dmg * 6 + (wreck ? 6 : 0); i++) { // scratches, bare metal along them
    const x = (R() - 0.5) * S.L, y = (R() > 0.5 ? 1 : -1) * hw * (0.55 + R() * 0.4), l = 0.2 + R() * 0.6, a = (R() - 0.5) * 0.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l * 0.5); g.stroke();
  }
  if (dmg >= 2 || wreck) { // soot from the engine bay, and bare primer
    const gr = g.createRadialGradient(hl - 0.8, 0, 0, hl - 0.8, 0, 1.4);
    gr.addColorStop(0, wreck ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(-hl, -hw, S.L, S.W);
    if (!wreck) g.fillStyle = 'rgba(140,140,132,0.5)'; for (let i = 0; !wreck && i < 3; i++) { g.beginPath(); g.ellipse((R() - 0.5) * S.L, (R() - 0.5) * S.W, 0.15 + R() * 0.2, 0.08 + R() * 0.1, R() * 3, 0, TAU); g.fill(); }
  }
  if (wreck) { // charred to the primer and rust, embers still in the seams
    for (let i = 0; i < 9; i++) { g.fillStyle = R() < 0.5 ? 'rgba(96,48,26,0.35)' : 'rgba(8,6,5,0.45)'; g.beginPath(); g.ellipse((R() - 0.5) * S.L, (R() - 0.5) * S.W, 0.2 + R() * 0.4, 0.1 + R() * 0.25, R() * 3, 0, TAU); g.fill(); }
    g.fillStyle = 'rgba(255,110,30,0.5)'; for (let i = 0; i < 7; i++) { g.beginPath(); g.arc((R() - 0.5) * S.L * 0.9, (R() - 0.5) * S.W * 0.9, 0.015 + R() * 0.025, 0, TAU); g.fill(); }
  }
  g.restore();
  if (dmg >= 1 && !wreck) { // cracks across the windscreen
    const O = outline(S);
    g.save(); g.beginPath(); roundPoly(g, O.cabin, S.r); g.clip();
    g.strokeStyle = 'rgba(235,245,255,0.6)'; g.lineWidth = 0.012;
    for (let k = 0; k < dmg; k++) {
      const x0 = cf - 0.15 - R() * 0.2, y0 = (R() - 0.5) * hw;
      for (let j = 0; j < 6; j++) { const a = R() * TAU, l = 0.15 + R() * 0.35; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(a) * l * 0.6, y0 + Math.sin(a) * l * 0.6); g.lineTo(x0 + Math.cos(a + 0.3) * l, y0 + Math.sin(a + 0.3) * l); g.stroke(); }
    }
    if (dmg >= 3) { g.fillStyle = 'rgba(10,12,14,0.6)'; g.beginPath(); g.ellipse(cr + 0.3, hw * 0.3, 0.3, 0.2, 0.5, 0, TAU); g.fill(); }
    g.restore();
  }
  if (dmg >= 2 && !wreck) { // a smashed headlamp and a bumper hanging off
    const [x, y, l, w] = S.head[0];
    g.fillStyle = '#16181a'; g.beginPath(); g.roundRect(x - l / 2, y - w / 2, l, w, 0.03); g.fill();
    if (S.bumper && dmg >= 3) { g.save(); g.translate(-hl, hw * 0.6); g.rotate(-0.3); g.fillStyle = '#1b1d20'; g.fillRect(-0.1, -0.05, 0.14, 0.6); g.restore(); }
  }
}

// ---------- per frame ----------
const glowCache = {};
function glow(col) { return (glowCache[col] ??= puff(64, col, 0.2)); }
const quant = scale => 2 ** (Math.round(Math.log2(Math.max(2, scale)) * 4) / 4); // quarter-octave steps
const SUN = [0.32, 0.44]; // the shadow's offset in metres (light from the upper left)

function wheel(g, x, y, a, l, w, burnt) {
  g.save(); g.translate(x, y); g.rotate(a);
  g.fillStyle = burnt ? '#2a2420' : '#141414'; g.beginPath(); g.roundRect(-l / 2, -w / 2, l, w, w * 0.3); g.fill();
  if (!burnt) { g.fillStyle = 'rgba(255,255,255,0.08)'; for (let k = -2; k <= 2; k++) g.fillRect(k * l * 0.18 - 0.02, -w / 2, 0.04, w); }
  else { g.fillStyle = '#4a423c'; g.fillRect(-l * 0.3, -w * 0.25, l * 0.6, w * 0.5); }
  g.restore();
}

/**
 * Draw a car. x, y and scale (px per metre) are in g's current units; a is the heading.
 * opts: damage 0…1, boost, brake, lights (lamps lit), wreck, steer −1…1, flash 0…1 (a hit),
 * t (s, for flicker), shadow (false: none), alpha.
 */
export function drawCar(g, model, colour, x, y, a, scale, opts = {}) {
  // the sprite's resolution follows the device pixels it lands on (screens draw in 1080p units)
  const m = g.getTransform(), S = shapeOf(model), q = quant(scale * fit(S) * Math.hypot(m.a, m.b)), k = (scale * fit(S)) / q, wreck = !!opts.wreck;
  const dmg = wreck ? 3 : Math.min(3, Math.floor(clamp(opts.damage ?? 0, 0, 1) * 4 + 0.15));
  const t = opts.t ?? 0;
  const prevA = g.globalAlpha;
  g.save();
  if (opts.shadow !== false) {
    const sh = sprite(S, '', 0, false, q, 'shadow');
    g.globalAlpha = prevA * (opts.shadowAlpha ?? 0.5);
    g.translate(x + SUN[0] * scale, y + SUN[1] * scale); g.rotate(a);
    g.drawImage(sh, (-sh.width / 2) * k, (-sh.height / 2) * k, sh.width * k, sh.height * k);
    g.restore(); g.save();
    g.globalAlpha = prevA;
  }
  g.translate(x, y); g.rotate(a); g.scale(scale * fit(S), scale * fit(S));
  // wheels under the body: the front pair turns with the steering
  const st = clamp(opts.steer ?? 0, -1, 1) * 0.42;
  for (const sy of [-1, 1]) { wheel(g, S.f, sy * S.ty, wreck ? 0 : st, S.tl, S.tw, wreck); wheel(g, S.rr, sy * S.ty, 0, S.tl, S.tw, wreck); }
  const spr = sprite(S, colour, dmg, wreck, q, 'body');
  g.drawImage(spr, -spr.width / 2 / q, -spr.height / 2 / q, spr.width / q, spr.height / q);
  if (opts.flash > 0) { const fl = sprite(S, '', 0, false, q, 'flash'); g.globalAlpha = prevA * clamp(opts.flash, 0, 1) * 0.75; g.drawImage(fl, -fl.width / 2 / q, -fl.height / 2 / q, fl.width / q, fl.height / q); g.globalAlpha = prevA; }
  // lit lamps, brake lights and the turbo's flame glow additively
  if (!wreck && (opts.lights || opts.brake || opts.boost)) {
    g.globalCompositeOperation = 'lighter';
    if (opts.lights) for (const [hx, hy] of S.head) for (const sy of [-1, 1]) { const r = 0.55; g.globalAlpha = prevA * 0.8; g.drawImage(glow('#fff4d8'), hx - r + 0.15, sy * hy - r, r * 2, r * 2); }
    for (const [tx, ty, , tw] of S.tail) for (const sy of [-1, 1]) {
      const r = opts.brake ? 0.7 : opts.lights ? 0.35 : 0;
      if (r) { g.globalAlpha = prevA * (opts.brake ? 0.95 : 0.6); g.drawImage(glow('#ff2a14'), tx - r, sy * ty - r, r * 2, r * 2); if (opts.brake) { g.fillStyle = '#ff6a50'; g.fillRect(tx - 0.03, sy * ty - tw / 2, 0.06, tw); } }
    }
    if (opts.boost) for (const [px, py] of S.pipe) {
      const fl = 0.7 + Math.sin(t * 61 + py * 9) * 0.2 + Math.sin(t * 37) * 0.1, len = 0.9 * fl;
      g.globalAlpha = prevA * 0.9; g.drawImage(glow('#ff9a3a'), px - len * 1.6, py - 0.35, len * 1.8, 0.7);
      g.globalAlpha = prevA; g.drawImage(glow('#7ad0ff'), px - len * 0.8, py - 0.18, len, 0.36);
    }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = prevA;
  }
  g.restore();
}

// ---------- headlight beams (night): soft cones on the road ahead, drawn additively ----------
let cone = null;
function coneSprite() {
  if (cone) return cone;
  // one fan for both lamps, 24 m × 15 m at 5 px/m: soft enough to scale up without showing it
  const P = 5, Lm = 24, Wm = 15, c = canvas(Lm * P, Wm * P), g = c.getContext('2d');
  const cy = c.height / 2;
  g.save();
  g.beginPath(); g.moveTo(0, cy - 0.8 * P); g.lineTo(Lm * P, cy - Wm * P * 0.46); g.lineTo(Lm * P, cy + Wm * P * 0.46); g.lineTo(0, cy + 0.8 * P); g.closePath(); g.clip();
  let gr = g.createRadialGradient(0, cy, 0, 0, cy, Lm * P);
  gr.addColorStop(0, 'rgba(255,244,214,0.95)'); gr.addColorStop(0.25, 'rgba(255,238,200,0.5)'); gr.addColorStop(0.6, 'rgba(255,230,190,0.14)'); gr.addColorStop(1, 'rgba(255,230,190,0)');
  g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
  g.restore();
  // soften the cone's sides
  g.globalCompositeOperation = 'destination-in';
  gr = g.createLinearGradient(0, 0, 0, c.height);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.3, 'rgba(0,0,0,1)'); gr.addColorStop(0.7, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
  cone = { c, Lm, Wm };
  return cone;
}
/** headlight beams from a car's lamps, additive; k: brightness 0…1 */
export function drawBeams(g, model, x, y, a, scale, k = 1) {
  const S = shapeOf(model), C = coneSprite(), f = fit(S);
  g.save();
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.5 * k;
  g.translate(x, y); g.rotate(a); g.scale(scale, scale);
  g.drawImage(C.c, (S.L / 2) * f - 0.1, -C.Wm / 2, C.Lm, C.Wm);
  g.restore();
}

const specs = new Map();
/** the numbers the renderer needs to place wheels' skid marks, muzzles and exhausts */
export function carSpec(model) {
  const S = shapeOf(model);
  let sp = specs.get(S);
  if (!sp) {
    const f = fit(S), m = ([x, y]) => [x * f, y * f];
    sp = {
      L: S.L * f, W: S.W * f, tyre: S.tw * f,
      wheels: [[S.f, -S.ty], [S.f, S.ty], [S.rr, -S.ty], [S.rr, S.ty]].map(m),
      gun: S.gun.map(m), pipe: S.pipe.map(m), head: S.head.map(m), tail: S.tail.map(m),
    };
    specs.set(S, sp);
  }
  return sp;
}
export const SILHOUETTES = ORDER;
